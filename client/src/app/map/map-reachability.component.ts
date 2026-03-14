import { Component, inject, output, NgZone, ChangeDetectorRef } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import {
  TransportService,
  type HikeIsochroneResult,
  type ReachabilityStop,
} from '../services/transport.service';
import { TripDateTimeService } from '../services/trip-datetime.service';

interface IsochroneBucket {
  seconds: number;
  label: string;
  color: string;
  fillOpacity: number;
}

const ELEVATION_COMPENSATION_FACTOR = 1.5;

const ISOCHRONE_BUCKETS: IsochroneBucket[] = [
  {
    seconds: Math.round((3 * 3600) / ELEVATION_COMPENSATION_FACTOR),
    label: '3 h',
    color: '#e65100',
    fillOpacity: 0.12,
  },
  {
    seconds: Math.round((2 * 3600) / ELEVATION_COMPENSATION_FACTOR),
    label: '2 h',
    color: '#f9a825',
    fillOpacity: 0.18,
  },
  {
    seconds: Math.round((1 * 3600) / ELEVATION_COMPENSATION_FACTOR),
    label: '1 h',
    color: '#2e7d32',
    fillOpacity: 0.25,
  },
];

const ISOCHRONE_DISCLAIMER =
  'Approximate — elevation gain/loss not modelled. Actual hiking time in steep terrain will be longer.';

function reachabilityColor(bucketMinutes: number): string {
  const t = Math.min(1, Math.max(0, (bucketMinutes - 15) / 45));
  const lightness = Math.round(62 - t * 38);
  return `hsl(122, 62%, ${lightness}%)`;
}

function reachabilityIcon(bucket: number): L.DivIcon {
  const color = reachabilityColor(bucket);
  return L.divIcon({
    className: 'map-marker',
    html: `<div style="
      background:${color};
      width:13px;height:13px;
      border-radius:50%;
      border:2px solid rgba(255,255,255,0.85);
      box-shadow:0 1px 4px rgba(0,0,0,.45);
    "></div>`,
    iconSize: [17, 17],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

function formatDepartureTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

@Component({
  selector: 'app-map-reachability',
  templateUrl: './map-reachability.component.html',
  styleUrl: './map-reachability.component.scss',
})
export class MapReachabilityComponent {
  private transportService = inject(TransportService);
  private tripDateTime = inject(TripDateTimeService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  hikingRangesCleared = output<void>();

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private reachabilityLayer?: L.LayerGroup;
  private isochroneLayer?: L.LayerGroup;

  reachabilityLoading = false;
  isochroneLoading = false;
  rangeLoading = false;

  get hasHikingRanges(): boolean {
    return !!this.isochroneLayer;
  }

  get reachabilityLoadingText(): string {
    return this.tripDateTime.departureTime()
      ? 'Optimizing reachability (9 slots)\u2026'
      : 'Loading reachability\u2026';
  }

  init(map: L.Map, layerControl: L.Control.Layers): void {
    this.map = map;
    this.layerControl = layerControl;
    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => this.onMapRightClick(e));
  }

  clearHikingRanges(): void {
    if (!this.isochroneLayer) return;
    this.layerControl.removeLayer(this.isochroneLayer);
    this.map.removeLayer(this.isochroneLayer);
    this.isochroneLayer = undefined;
    this.hikingRangesCleared.emit();
    this.cdr.detectChanges();
  }

  async loadRangesForLocation(mapUuid: string, locationId: number): Promise<void> {
    this.rangeLoading = true;
    this.cdr.detectChanges();
    const time = this.tripDateTime.departureTime()?.toISOString();
    try {
      const [isochroneResult, reachabilityResult] = await Promise.all([
        this.transportService.getLocationHikeIsochrone(mapUuid, locationId),
        this.transportService.getLocationReachability(mapUuid, locationId, time),
      ]);
      this.renderIsochroneLayer(isochroneResult);
      this.renderReachabilityLayer(reachabilityResult.features);
    } catch (e) {
      console.error('Failed to load saved location range data', e);
    } finally {
      this.rangeLoading = false;
      this.cdr.detectChanges();
    }
  }

  private onMapRightClick(e: L.LeafletMouseEvent): void {
    const { lat, lng } = e.latlng;
    const departure = this.tripDateTime.departureTime();
    const departureHint = departure
      ? `<div style="font-size:11px;opacity:.65;margin-bottom:6px">9 slots (10 min intervals, 1.5 h) from ${formatDepartureTime(departure.toISOString())}</div>`
      : '';
    const popup = L.popup({ closeButton: true, minWidth: 180 })
      .setLatLng(e.latlng)
      .setContent(
        `<div style="display:flex;flex-direction:column;gap:6px">
          <div>
            <div style="font-weight:600;margin-bottom:4px">Transit reachability</div>
            ${departureHint}
            <button class="reachability-trigger-btn" type="button">
              Show stops within 60 min
            </button>
          </div>
          <hr style="margin:2px 0;border:none;border-top:1px solid rgba(0,0,0,.12)">
          <div>
            <div style="font-weight:600;margin-bottom:4px">Hike isochrones</div>
            <button class="isochrone-trigger-btn" type="button">
              Show 1/2/3 h hiking range
            </button>
            <div style="font-size:10px;opacity:.6;margin-top:4px;line-height:1.3">
              Approximate — elevation not modelled
            </div>
          </div>
        </div>`,
      )
      .openOn(this.map);

    setTimeout(() => {
      const reachBtn = popup
        .getElement()
        ?.querySelector<HTMLButtonElement>('.reachability-trigger-btn');
      if (reachBtn) {
        reachBtn.addEventListener('click', () => {
          this.map.closePopup();
          this.ngZone.run(() => this.loadReachability(lat, lng));
        });
      }

      const isoBtn = popup.getElement()?.querySelector<HTMLButtonElement>('.isochrone-trigger-btn');
      if (isoBtn) {
        isoBtn.addEventListener('click', () => {
          this.map.closePopup();
          this.ngZone.run(() => this.loadHikeIsochrone(lat, lng));
        });
      }
    }, 0);
  }

  private async loadReachability(lat: number, lng: number): Promise<void> {
    this.reachabilityLoading = true;
    this.cdr.detectChanges();
    try {
      const departureTime = this.tripDateTime.departureTime();
      const result = departureTime
        ? await this.transportService.getReachabilityOptimal(lat, lng, departureTime)
        : await this.transportService.getReachability(lat, lng);
      this.renderReachabilityLayer(result.features);
    } catch {
      console.error('Failed to load reachability data');
    } finally {
      this.reachabilityLoading = false;
      this.cdr.detectChanges();
    }
  }

  private async loadHikeIsochrone(lat: number, lng: number): Promise<void> {
    this.isochroneLoading = true;
    this.cdr.detectChanges();
    try {
      const result = await this.transportService.getHikeIsochrone(lat, lng);
      this.renderIsochroneLayer(result);
    } catch {
      console.error('Failed to load hike isochrone data');
    } finally {
      this.isochroneLoading = false;
      this.cdr.detectChanges();
    }
  }

  private renderIsochroneLayer(result: HikeIsochroneResult): void {
    if (this.isochroneLayer) {
      this.layerControl.removeLayer(this.isochroneLayer);
      this.map.removeLayer(this.isochroneLayer);
    }

    const sorted = [...result.features].sort((a, b) => b.properties.value - a.properties.value);

    const layers = sorted.map((feature) => {
      const cfg =
        ISOCHRONE_BUCKETS.find((b) => b.seconds === feature.properties.value) ??
        ISOCHRONE_BUCKETS[0];
      const layer = L.geoJSON(feature as GeoJSON.Feature, {
        style: {
          color: cfg.color,
          weight: 2,
          opacity: 0.8,
          fillColor: cfg.color,
          fillOpacity: cfg.fillOpacity,
        },
      });
      layer.bindPopup(
        `<b>Hiking range: ${cfg.label}</b>` +
          `<div style="font-size:11px;opacity:.65;margin-top:4px;max-width:180px;line-height:1.3">${ISOCHRONE_DISCLAIMER}</div>`,
      );
      return layer;
    });

    this.isochroneLayer = L.layerGroup(layers).addTo(this.map);
    this.layerControl.addOverlay(this.isochroneLayer, 'Hike isochrones');
  }

  private renderReachabilityLayer(
    features: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[],
  ): void {
    if (this.reachabilityLayer) {
      this.layerControl.removeLayer(this.reachabilityLayer);
      this.map.removeLayer(this.reachabilityLayer);
    }

    const markers = features.map((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const props = f.properties;
      const marker = L.marker([lat, lon], { icon: reachabilityIcon(props.bucket) });
      const transferText =
        props.transfers === 0
          ? 'Direct'
          : props.transfers === 1
            ? '1 transfer'
            : `${props.transfers} transfers`;
      const timeText = props.best_time
        ? `<br><span style="font-size:11px;opacity:.65">Best at ${formatDepartureTime(props.best_time)}</span>`
        : '';
      marker.bindPopup(
        `<b>${props.name}</b><br>
        <span style="font-size:12px">${props.duration_min} min &mdash; ${transferText}</span>${timeText}`,
      );
      return marker;
    });

    this.reachabilityLayer = L.layerGroup(markers).addTo(this.map);
    this.layerControl.addOverlay(this.reachabilityLayer, 'Transit reachability');
  }
}

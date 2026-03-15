import { Component, inject, input, output, signal, NgZone, ChangeDetectorRef } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import {
  TransportService,
  type HikeIsochroneResult,
  type ReachabilityStop,
} from '../services/transport.service';
import { LocationService, type SavedLocation } from '../services/location.service';
import { TripDateTimeService } from '../services/trip-datetime.service';
import { showReachabilityIsochronesForCategory } from './location-categories';

const CACHE_USE_RADIUS_M = 500;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findLocationWithinRadius(
  locations: SavedLocation[],
  lat: number,
  lng: number,
  radiusM: number,
): SavedLocation | undefined {
  return locations.find((loc) => distanceMeters(lat, lng, loc.latitude, loc.longitude) <= radiusM);
}

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
    color: '#64b5f6',
    fillOpacity: 0.10,
  },
  {
    seconds: Math.round((2 * 3600) / ELEVATION_COMPENSATION_FACTOR),
    label: '2 h',
    color: '#1976d2',
    fillOpacity: 0.10,
  },
  {
    seconds: Math.round((1 * 3600) / ELEVATION_COMPENSATION_FACTOR),
    label: '1 h',
    color: '#0d47a1',
    fillOpacity: 0.10,
  },
];

const ISOCHRONE_DISCLAIMER =
  'Approximate — elevation gain/loss not modelled. Actual hiking time in steep terrain will be longer.';

function reachabilityColor(durationMin: number): string {
  const t = Math.min(1, Math.max(0, (durationMin - 15) / 45));
  const lightness = 62 - t * 38;
  return `hsl(122, 62%, ${lightness}%)`;
}

const MODE_ICONS: Record<string, string> = {
  BUS: 'directions_bus',
  COACH: 'directions_bus',
  TRAM: 'tram',
  SUBWAY: 'subway',
  RAIL: 'train',
  HIGHSPEED_RAIL: 'train',
  LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train',
  SUBURBAN: 'train',
  FERRY: 'directions_boat',
  AIRPLANE: 'flight',
  FUNICULAR: 'terrain',
  AERIAL_LIFT: 'terrain',
  ODM: 'local_taxi',
  FLEX: 'directions_car',
  OTHER: 'directions_transit',
  TRANSIT: 'directions_transit',
};

function reachabilityModeIcon(modes: string[] | undefined): string {
  const first = modes?.[0];
  return (first && MODE_ICONS[first]) || MODE_ICONS['OTHER'];
}

function reachabilityIcon(durationMin: number, modes: string[] | undefined): L.DivIcon {
  const color = reachabilityColor(durationMin);
  const iconName = reachabilityModeIcon(modes);
  const size = 22;
  const iconSize = 14;
  return L.divIcon({
    className: 'reachability-marker',
    html: `<div style="
      display:flex;
      align-items:center;
      justify-content:center;
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      background:${color};
      border:2px solid rgba(255,255,255,0.85);
      box-shadow:0 1px 4px rgba(0,0,0,.45);
    "><span style="font-family:'Material Icons';font-size:${iconSize}px;color:white;line-height:1;">${iconName}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function formatDepartureTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const MODE_LABELS: Record<string, string> = {
  BUS: 'Bus',
  COACH: 'Coach',
  TRAM: 'Tram',
  SUBWAY: 'Subway',
  RAIL: 'Rail',
  HIGHSPEED_RAIL: 'High-speed rail',
  LONG_DISTANCE: 'Long-distance',
  NIGHT_RAIL: 'Night train',
  REGIONAL_FAST_RAIL: 'Regional express',
  REGIONAL_RAIL: 'Regional rail',
  SUBURBAN: 'Suburban',
  FERRY: 'Ferry',
  AIRPLANE: 'Air',
  FUNICULAR: 'Funicular',
  AERIAL_LIFT: 'Gondola / cable car',
  ODM: 'On-demand',
  FLEX: 'Flex',
  OTHER: 'Transit',
};

function formatReachabilityModes(modes: string[] | undefined): string {
  if (!modes?.length) return '';
  const labels = [...new Set(modes.map((m) => MODE_LABELS[m] ?? m.replace(/_/g, ' ')))];
  return labels.join(', ');
}

@Component({
  selector: 'app-map-reachability',
  templateUrl: './map-reachability.component.html',
  styleUrl: './map-reachability.component.scss',
})
export class MapReachabilityComponent {
  private transportService = inject(TransportService);
  private locationService = inject(LocationService);
  private tripDateTime = inject(TripDateTimeService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  mapUuid = input.required<string>();
  hikingRangesCleared = output<void>();

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private reachabilityLayer?: L.LayerGroup;
  private isochroneLayer?: L.LayerGroup;
  private currentReachabilityFeatures: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[] = [];
  routingBackend: string | null = null;

  reachabilityLoading = false;

  getReachabilityInBounds(
    bounds: L.LatLngBounds,
  ): GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[] {
    return this.currentReachabilityFeatures.filter((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      return bounds.contains([lat, lon]);
    });
  }
  isochroneLoading = false;
  rangeLoading = false;
  readonly hasHikingRanges = signal(false);
  readonly rangeError = signal(false);

  get reachabilityLoadingText(): string {
    return this.tripDateTime.departureTime()
      ? 'Optimizing reachability (9 slots)\u2026'
      : 'Loading reachability\u2026';
  }

  init(map: L.Map, layerControl: L.Control.Layers): void {
    this.map = map;
    this.layerControl = layerControl;
    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => this.onMapRightClick(e));
    this.transportService.getConfig().then((c) => {
      this.routingBackend = c.routingBackend;
      this.cdr.detectChanges();
    });
  }

  clearHikingRanges(): void {
    if (!this.isochroneLayer) return;
    this.layerControl.removeLayer(this.isochroneLayer);
    this.map.removeLayer(this.isochroneLayer);
    this.isochroneLayer = undefined;
    this.hasHikingRanges.set(false);
    this.hikingRangesCleared.emit();
    this.cdr.detectChanges();
  }

  async loadRangesForLocation(mapUuid: string, locationId: number): Promise<void> {
    this.rangeLoading = true;
    this.rangeError.set(false);
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
      this.rangeError.set(true);
    } finally {
      this.deferDetectChanges(() => {
        this.rangeLoading = false;
      });
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
            ${this.routingBackend === 'ors' ? '<div style="font-size:10px;opacity:.6;margin-top:4px;line-height:1.3">Approximate — elevation not modelled</div>' : ''}
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
      this.deferDetectChanges(() => {
        this.reachabilityLoading = false;
      });
    }
  }

  private async loadHikeIsochrone(lat: number, lng: number): Promise<void> {
    this.isochroneLoading = true;
    this.cdr.detectChanges();
    try {
      const mapUuid = this.mapUuid();
      const locations = mapUuid ? await this.locationService.getAll(mapUuid) : [];
      const cachedLoc = findLocationWithinRadius(locations, lat, lng, CACHE_USE_RADIUS_M);
      const useCachedLoc =
        cachedLoc && showReachabilityIsochronesForCategory(cachedLoc.category);
      const result = useCachedLoc
        ? await this.transportService.getLocationHikeIsochrone(mapUuid, cachedLoc.id)
        : await this.transportService.getHikeIsochrone(lat, lng);
      this.renderIsochroneLayer(result);
    } catch {
      console.error('Failed to load hike isochrone data');
    } finally {
      this.deferDetectChanges(() => {
        this.isochroneLoading = false;
      });
    }
  }

  private deferDetectChanges(update: () => void): void {
    update();
    setTimeout(() => this.cdr.detectChanges(), 0);
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
          weight: 3,
          opacity: 0.8,
          fillColor: cfg.color,
          fillOpacity: cfg.fillOpacity,
        },
      });
      const disclaimerHtml =
        this.routingBackend === 'ors'
          ? `<div style="font-size:11px;opacity:.65;margin-top:4px;max-width:180px;line-height:1.3">${ISOCHRONE_DISCLAIMER}</div>`
          : '';
      layer.bindPopup(`<b>Hiking range: ${cfg.label}</b>${disclaimerHtml}`);
      return layer;
    });

    this.isochroneLayer = L.layerGroup(layers).addTo(this.map);
    this.layerControl.addOverlay(this.isochroneLayer, 'Hike isochrones');
    this.hasHikingRanges.set(true);
  }

  private renderReachabilityLayer(
    features: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[],
  ): void {
    this.currentReachabilityFeatures = features;
    if (this.reachabilityLayer) {
      this.layerControl.removeLayer(this.reachabilityLayer);
      this.map.removeLayer(this.reachabilityLayer);
    }

    const markers = features.map((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const props = f.properties;
      const marker = L.marker([lat, lon], {
        icon: reachabilityIcon(props.duration_min, props.modes),
      });
      const transferText =
        props.transfers === 0
          ? 'Direct'
          : props.transfers === 1
            ? '1 transfer'
            : `${props.transfers} transfers`;
      const timeText = props.best_time
        ? `<br><span style="font-size:11px;opacity:.65">Best at ${formatDepartureTime(props.best_time)}</span>`
        : '';
      const modesText = formatReachabilityModes(props.modes);
      const typeLine = modesText
        ? `<br><span style="font-size:11px;opacity:.8">${modesText}</span>`
        : '';
      const arrivalLine =
        props.arrival &&
        `<br><span style="font-size:11px;opacity:.8">Arrive ${formatDepartureTime(props.arrival)}</span>`;
      const trackLine =
        props.track && `<br><span style="font-size:11px;opacity:.8">${escapeHtml(props.track)}</span>`;
      const descLine =
        props.description &&
        `<br><span style="font-size:11px;opacity:.7">${escapeHtml(props.description)}</span>`;
      marker.bindPopup(
        `<b>${props.name}</b><br>
        <span style="font-size:12px">${props.duration_min} min &mdash; ${transferText}</span>${typeLine}${arrivalLine ?? ''}${trackLine ?? ''}${descLine ?? ''}${timeText}`,
      );
      return marker;
    });

    this.reachabilityLayer = L.layerGroup(markers).addTo(this.map);
    this.layerControl.addOverlay(this.reachabilityLayer, 'Transit reachability');
  }
}

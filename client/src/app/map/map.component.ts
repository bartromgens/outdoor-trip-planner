import {
  Component,
  AfterViewInit,
  OnDestroy,
  inject,
  NgZone,
  ChangeDetectorRef,
} from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ChatService } from '../services/chat.service';
import { LocationService, savedLocationsToFeatureCollection } from '../services/location.service';
import { TransportService, type ReachabilityStop } from '../services/transport.service';
import type { BoundingBox } from '../services/chat.service';
import { environment } from '../../environments/environment';
import {
  AddLocationDialogComponent,
  type AddLocationDialogResult,
} from './add-location-dialog.component';

const CATEGORY_COLORS: Record<string, string> = {
  trail: '#e65100',
  hut: '#bf360c',
  campsite: '#33691e',
  peak: '#4a148c',
  water: '#01579b',
  parking: '#37474f',
  viewpoint: '#f57f17',
  station: '#0d47a1',
  transit_route: '#1565c0',
};

const DEFAULT_COLOR = '#1976d2';

const BUCKET_COLORS: Record<number, string> = {
  15: '#2e7d32',
  30: '#f9a825',
  45: '#e65100',
  60: '#b71c1c',
};

function colorForCategory(category?: string): string {
  return (category && CATEGORY_COLORS[category]) || DEFAULT_COLOR;
}

function reachabilityIcon(bucket: number): L.DivIcon {
  const color = BUCKET_COLORS[bucket] ?? '#757575';
  return L.divIcon({
    className: 'map-marker',
    html: `<div style="
      background:${color};
      width:8px;height:8px;
      border-radius:50%;
      border:1.5px solid rgba(255,255,255,0.8);
      box-shadow:0 1px 3px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [11, 11],
    iconAnchor: [5, 5],
    popupAnchor: [0, -7],
  });
}

function iconForCategory(category?: string): L.DivIcon {
  const color = colorForCategory(category);
  return L.divIcon({
    className: 'map-marker',
    html: `<div style="
      background:${color};
      width:12px;height:12px;
      border-radius:50%;
      border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

function savedIconForCategory(category?: string): L.DivIcon {
  const color = colorForCategory(category);
  return L.divIcon({
    className: 'map-marker-saved',
    html: `<div style="
      position:relative;
      width:16px;height:22px;
    ">
      <div style="
        background:${color};
        width:16px;height:16px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid #fff;
        box-shadow:0 2px 4px rgba(0,0,0,.4);
      "></div>
    </div>`,
    iconSize: [16, 22],
    iconAnchor: [8, 22],
    popupAnchor: [0, -24],
  });
}

interface ContourConfig {
  level: number;
  label: string;
  color: string;
  weight: number;
  dashArray?: string;
}

const CONTOUR_CONFIGS: ContourConfig[] = [
  { level: 1500, label: 'Contour 1500 m', color: '#a0522d', weight: 1.5, dashArray: '6 4' },
  { level: 1750, label: 'Contour 1750 m', color: '#964b1a', weight: 1.8, dashArray: '7 4' },
  { level: 2000, label: 'Contour 2000 m', color: '#8b3a0f', weight: 2, dashArray: '8 4' },
  { level: 2500, label: 'Contour 2500 m', color: '#6b2800', weight: 2.5 },
  { level: 3000, label: 'Contour 3000 m', color: '#4a1500', weight: 3 },
];

function buildTransportLayer(): L.TileLayer {
  const key = environment.thunderforestApiKey;
  if (key) {
    return L.tileLayer(`https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${key}`, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.thunderforest.com/">Thunderforest</a>',
      maxZoom: 22,
    });
  }
  return L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://memomaps.de/">memomaps</a>',
  });
}

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  imports: [MatButtonModule],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private chatService = inject(ChatService);
  private locationService = inject(LocationService);
  private transportService = inject(TransportService);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);
  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private featureLayer?: L.GeoJSON;
  private savedLayer?: L.GeoJSON;
  private reachabilityLayer?: L.LayerGroup;
  private subscription?: Subscription;
  addingLocation = false;
  reachabilityLoading = false;

  ngAfterViewInit(): void {
    this.map = L.map('map').setView([46.8182, 8.2275], 8);

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });

    const transportLayer = buildTransportLayer();

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19,
      },
    );

    osmLayer.addTo(this.map);

    this.layerControl = L.control
      .layers(
        {
          Standard: osmLayer,
          Transport: transportLayer,
          Satellite: satelliteLayer,
        },
        undefined,
        { collapsed: true },
      )
      .addTo(this.map);

    L.control.scale({ imperial: false }).addTo(this.map);

    this.emitBbox();
    this.map.on('moveend', () => this.emitBbox());
    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => this.onMapRightClick(e));

    this.subscription = this.chatService.mapFeatures$.subscribe((fc) => {
      if (!fc) return;
      this.renderFeatures(fc);
    });

    this.loadSavedLocations();
    this.loadContourLayers();
  }

  private emitBbox(): void {
    const b = this.map.getBounds();
    const bbox: BoundingBox = {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    };
    this.chatService.setBbox(bbox);
  }

  toggleAddLocation(): void {
    this.addingLocation = !this.addingLocation;
    if (this.addingLocation) {
      setTimeout(() => {
        this.map.once('click', (e: L.LeafletMouseEvent) => this.onMapClick(e));
      }, 0);
    } else {
      this.map.off('click');
    }
  }

  private onMapClick(e: L.LeafletMouseEvent): void {
    const { lat, lng } = e.latlng;
    this.addingLocation = false;
    this.cdr.detectChanges();
    this.ngZone.run(() => {
      const ref = this.dialog.open(AddLocationDialogComponent, {
        data: { lat, lng },
        width: '360px',
      });
      ref.afterClosed().subscribe((result: AddLocationDialogResult | undefined) => {
        if (!result) return;
        this.locationService
          .savePoint(lat, lng, result.name, result.category, result.description)
          .then(() => this.loadSavedLocations())
          .catch((err) => console.error('Failed to save location', err));
      });
    });
  }

  private onMapRightClick(e: L.LeafletMouseEvent): void {
    const { lat, lng } = e.latlng;
    const popup = L.popup({ closeButton: true, minWidth: 180 })
      .setLatLng(e.latlng)
      .setContent(
        `<div>
          <div style="font-weight:600;margin-bottom:8px">Transit reachability</div>
          <button class="reachability-trigger-btn" type="button">
            Show stops within 60 min
          </button>
        </div>`,
      )
      .openOn(this.map);

    setTimeout(() => {
      const btn = popup.getElement()?.querySelector<HTMLButtonElement>('.reachability-trigger-btn');
      if (!btn) return;
      btn.addEventListener('click', () => {
        this.map.closePopup();
        this.ngZone.run(() => this.loadReachability(lat, lng));
      });
    }, 0);
  }

  private async loadReachability(lat: number, lng: number): Promise<void> {
    this.reachabilityLoading = true;
    this.cdr.detectChanges();
    try {
      const result = await this.transportService.getReachability(lat, lng);
      this.renderReachabilityLayer(result.features);
    } catch {
      console.error('Failed to load reachability data');
    } finally {
      this.reachabilityLoading = false;
      this.cdr.detectChanges();
    }
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
      marker.bindPopup(
        `<b>${props.name}</b><br>
        <span style="font-size:12px">${props.duration_min} min &mdash; ${transferText}</span>`,
      );
      return marker;
    });

    this.reachabilityLayer = L.layerGroup(markers).addTo(this.map);
    this.layerControl.addOverlay(this.reachabilityLayer, 'Transit reachability');
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.map) {
      this.map.remove();
    }
  }

  private async loadSavedLocations(): Promise<void> {
    try {
      const locations = await this.locationService.getAll();
      const fc = savedLocationsToFeatureCollection(locations);
      if (this.savedLayer) {
        this.map.removeLayer(this.savedLayer);
      }
      this.savedLayer = L.geoJSON(fc, {
        pointToLayer: (_feature, latlng) => {
          const cat = _feature.properties?.['category'];
          return L.marker(latlng, { icon: savedIconForCategory(cat) });
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const label = props['label'] || '';
          const desc = props['description'] || '';
          const cat = props['category'] || '';
          const altitude = props['altitude'];
          const parts = [`<b>${label}</b>`];
          if (altitude != null)
            parts.push(`<span style="font-size:12px">Altitude: ${altitude} m</span>`);
          if (cat) parts.push(`<span style="opacity:.6;font-size:12px">${cat}</span>`);
          if (desc) parts.push(`<div style="margin-top:4px">${desc}</div>`);
          layer.bindPopup(parts.join('<br>'));
        },
        style: (feature) => {
          const cat = feature?.properties?.['category'];
          return { color: colorForCategory(cat), weight: 3, opacity: 0.8 };
        },
      }).addTo(this.map);
    } catch {
      // Silently ignore load errors on startup
    }
  }

  private async loadContourLayers(): Promise<void> {
    for (const cfg of CONTOUR_CONFIGS) {
      try {
        const response = await fetch(`/api/contours/${cfg.level}/`);
        if (!response.ok) continue;
        const geojson: GeoJSON.FeatureCollection = await response.json();
        const layer = L.geoJSON(geojson, {
          style: {
            color: cfg.color,
            weight: cfg.weight,
            opacity: 0.8,
            dashArray: cfg.dashArray,
            fill: false,
          },
        });
        this.layerControl.addOverlay(layer, cfg.label);
      } catch {
        // Silently skip unavailable contour levels
      }
    }
  }

  private saveFeature(feature: GeoJSON.Feature, btn: HTMLButtonElement): void {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    this.locationService
      .saveFromFeature(feature)
      .then(() => {
        btn.textContent = 'Saved';
        btn.classList.add('popup-save-btn--saved');
      })
      .catch(() => {
        btn.disabled = false;
        btn.textContent = 'Save failed – retry';
      });
  }

  private renderFeatures(fc: GeoJSON.FeatureCollection): void {
    if (this.featureLayer) {
      this.map.removeLayer(this.featureLayer);
    }

    this.featureLayer = L.geoJSON(fc, {
      pointToLayer: (_feature, latlng) => {
        const cat = _feature.properties?.['category'];
        return L.marker(latlng, { icon: iconForCategory(cat) });
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const label = props['label'] || '';
        const desc = props['description'] || '';
        const cat = props['category'] || '';
        const parts = [`<b>${label}</b>`];
        if (cat) parts.push(`<span style="opacity:.6;font-size:12px">${cat}</span>`);
        if (desc) parts.push(`<div style="margin-top:4px">${desc}</div>`);
        parts.push(
          `<div style="margin-top:8px"><button class="popup-save-btn" type="button">Save location</button></div>`,
        );
        layer.bindPopup(parts.join('<br>'));

        layer.on('popupopen', (e) => {
          const btn = (e as L.PopupEvent).popup
            .getElement()
            ?.querySelector<HTMLButtonElement>('.popup-save-btn');
          if (!btn) return;
          btn.addEventListener('click', () => this.saveFeature(feature, btn));
        });
      },
      style: (feature) => {
        const cat = feature?.properties?.['category'];
        return {
          color: colorForCategory(cat),
          weight: 3,
          opacity: 0.8,
        };
      },
    }).addTo(this.map);

    const bounds = this.featureLayer.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }
}

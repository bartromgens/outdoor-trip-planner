import {
  Component,
  AfterViewInit,
  OnDestroy,
  OnInit,
  inject,
  NgZone,
  ChangeDetectorRef,
  effect,
  signal,
  computed,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../services/chat.service';
import { LocationService, savedLocationsToFeatureCollection } from '../services/location.service';
import {
  TransportService,
  type HikeDirectionsResult,
  type HikeIsochroneResult,
  type ReachabilityStop,
} from '../services/transport.service';
import { TripDateTimeService } from '../services/trip-datetime.service';
import { MapManagerService } from '../services/map-manager.service';
import type { BoundingBox } from '../services/chat.service';
import { environment } from '../../environments/environment';
import {
  AddLocationDialogComponent,
  type AddLocationDialogResult,
} from './add-location-dialog.component';
import { SaveHikeDialogComponent, type SaveHikeDialogResult } from './save-hike-dialog.component';
import { HikeRouteService, type SavedHikeRoute } from '../services/hike-route.service';

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

function reachabilityColor(bucketMinutes: number): string {
  const t = Math.min(1, Math.max(0, (bucketMinutes - 15) / 45));
  const lightness = Math.round(62 - t * 38);
  return `hsl(122, 62%, ${lightness}%)`;
}

interface IsochroneBucket {
  seconds: number;
  label: string;
  color: string;
  fillOpacity: number;
}

// Must match the backend ELEVATION_COMPENSATION_FACTOR in api/views.py.
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

function colorForCategory(category?: string): string {
  return (category && CATEGORY_COLORS[category]) || DEFAULT_COLOR;
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

type WaypointRole = 'start' | 'end' | 'mid';

const WAYPOINT_COLORS: Record<WaypointRole, string> = {
  start: '#2e7d32',
  end: '#d32f2f',
  mid: '#1976d2',
};

function waypointIcon(role: WaypointRole): L.DivIcon {
  const color = WAYPOINT_COLORS[role];
  return L.divIcon({
    className: 'map-marker',
    html: `<div style="
      background:${color};
      width:14px;height:14px;
      border-radius:50%;
      border:2.5px solid #fff;
      box-shadow:0 2px 4px rgba(0,0,0,.45);
      cursor:grab;
    "></div>`,
    iconSize: [19, 19],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

function formatRouteDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

interface ContourConfig {
  level: number;
  label: string;
  color: string;
  weight: number;
  dashArray?: string;
}

const DEFAULT_CONTOUR_LEVEL = 2000;

const CONTOUR_CONFIGS: ContourConfig[] = [
  { level: 1500, label: 'Contour 1500 m', color: '#a0522d', weight: 1.5, dashArray: '6 4' },
  { level: 1750, label: 'Contour 1750 m', color: '#964b1a', weight: 1.8, dashArray: '7 4' },
  { level: 2000, label: 'Contour 2000 m', color: '#8b3a0f', weight: 2, dashArray: '8 4' },
  { level: 2500, label: 'Contour 2500 m', color: '#6b2800', weight: 2.5 },
  { level: 3000, label: 'Contour 3000 m', color: '#4a1500', weight: 3 },
];

function formatDepartureTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const THUNDERFOREST_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.thunderforest.com/">Thunderforest</a>';

function buildThunderforestLayer(style: string): L.TileLayer | null {
  const key = environment.thunderforestApiKey;
  if (!key) return null;
  return L.tileLayer(`https://tile.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${key}`, {
    attribution: THUNDERFOREST_ATTRIBUTION,
    maxZoom: 22,
  });
}

function buildTransportLayer(): L.TileLayer {
  const layer = buildThunderforestLayer('transport');
  if (layer) return layer;
  return L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://memomaps.de/">memomaps</a>',
  });
}

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  imports: [MatButtonModule, MatMenuModule, FormsModule],
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  private chatService = inject(ChatService);
  private locationService = inject(LocationService);
  private transportService = inject(TransportService);
  private hikeRouteService = inject(HikeRouteService);
  private tripDateTime = inject(TripDateTimeService);
  private mapManager = inject(MapManagerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);
  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private featureLayer?: L.GeoJSON;
  private savedLayer?: L.GeoJSON;
  private reachabilityLayer?: L.LayerGroup;
  private isochroneLayer?: L.LayerGroup;
  private subscription?: Subscription;
  private baseLayers = new Map<string, L.Layer>();
  private activeBaseLayerName = 'Standard';
  private activeOverlayNames = new Set<string>();
  private urlOverlays: string[] | null = null;
  private mapReady = false;
  private syncUrlTimer: ReturnType<typeof setTimeout> | null = null;
  addingLocation = false;
  reachabilityLoading = false;
  isochroneLoading = false;
  hikePlanningActive = false;
  hikeLoading = false;
  private hikeWaypoints: L.LatLng[] = [];
  private hikeMarkers: L.Marker[] = [];
  private hikeRouteDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  editingRouteId: number | null = null;
  get hikeRouteLayer(): L.GeoJSON | undefined {
    return this._hikeRouteLayer;
  }
  private _hikeRouteLayer?: L.GeoJSON;
  private lastHikeDirectionsResult: HikeDirectionsResult | null = null;
  private savedHikesLayer?: L.LayerGroup;

  currentMapUuid = '';
  mapSelectorOpen = false;
  editingMapName = false;
  mapNameInput = '';
  readonly myMaps = computed(() => this.mapManager.myMaps());
  get currentMapName(): string {
    return this.mapManager.getMapName(this.currentMapUuid);
  }

  constructor() {
    effect(() => {
      this.tripDateTime.departureTime();
      if (this.mapReady) this.debouncedSyncUrl();
    });
  }

  async ngOnInit(): Promise<void> {
    let uuid = this.route.snapshot.params['uuid'] as string;

    if (uuid === 'new') {
      const newUuid = await this.mapManager.createMap({ name: 'My Trip' });
      this.router.navigate(['/map', newUuid], { replaceUrl: true });
      return;
    }

    this.currentMapUuid = uuid;
    this.chatService.setMapUuid(uuid);

    const mapInfo = await this.mapManager.fetchMap(uuid);
    if (mapInfo) {
      if (!this.mapManager.isMyMap(uuid)) {
        this.mapManager.addToMyMaps(uuid, mapInfo.name);
      }
    } else {
      await this.mapManager.createMap({ uuid, name: 'My Trip' });
    }
    this.cdr.detectChanges();

    this.loadSavedLocations();
    this.loadSavedHikes();
  }

  get reachabilityLoadingText(): string {
    return this.tripDateTime.departureTime()
      ? 'Optimizing reachability (9 slots)\u2026'
      : 'Loading reachability\u2026';
  }

  ngAfterViewInit(): void {
    const urlParams = this.readUrlParams();

    this.map = L.map('map').setView(
      [urlParams.lat ?? 46.8182, urlParams.lng ?? 8.2275],
      urlParams.z ?? 8,
    );

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

    const landscapeLayer = buildThunderforestLayer('landscape');
    const outdoorsLayer = buildThunderforestLayer('outdoors');

    const baseLayerConfig: Record<string, L.Layer> = {
      Standard: osmLayer,
      Transport: transportLayer,
      Satellite: satelliteLayer,
      ...(landscapeLayer && { Landscape: landscapeLayer }),
      ...(outdoorsLayer && { Outdoors: outdoorsLayer }),
    };
    for (const [name, layer] of Object.entries(baseLayerConfig)) {
      this.baseLayers.set(name, layer);
    }

    this.activeBaseLayerName =
      urlParams.base && this.baseLayers.has(urlParams.base) ? urlParams.base : 'Standard';
    this.baseLayers.get(this.activeBaseLayerName)!.addTo(this.map);

    this.urlOverlays = urlParams.overlays ?? null;

    this.layerControl = L.control
      .layers(baseLayerConfig, undefined, { collapsed: false })
      .addTo(this.map);

    L.control.scale({ imperial: false }).addTo(this.map);

    this.map.on('baselayerchange', (e: L.LayersControlEvent) => {
      this.activeBaseLayerName = e.name;
      this.debouncedSyncUrl();
    });
    this.map.on('overlayadd', (e: L.LayersControlEvent) => {
      this.activeOverlayNames.add(e.name);
      this.debouncedSyncUrl();
    });
    this.map.on('overlayremove', (e: L.LayersControlEvent) => {
      this.activeOverlayNames.delete(e.name);
      this.debouncedSyncUrl();
    });

    this.emitBbox();
    this.map.on('moveend', () => {
      this.emitBbox();
      this.debouncedSyncUrl();
    });
    this.map.on('contextmenu', (e: L.LeafletMouseEvent) => this.onMapRightClick(e));
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onHikeMapClick(e));

    this.subscription = this.chatService.mapFeatures$.subscribe((fc) => {
      if (!fc) return;
      this.renderFeatures(fc);
    });

    this.loadContourLayers();
    this.mapReady = true;
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

  private readUrlParams(): {
    lat?: number;
    lng?: number;
    z?: number;
    base?: string;
    overlays?: string[];
    departure?: string;
  } {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('lat');
    const lng = params.get('lng');
    const z = params.get('z');
    return {
      lat: lat !== null ? Number(lat) : undefined,
      lng: lng !== null ? Number(lng) : undefined,
      z: z !== null ? Number(z) : undefined,
      base: params.get('base') ?? undefined,
      overlays: params.has('overlays')
        ? params.get('overlays')!.split(',').filter(Boolean)
        : undefined,
      departure: params.get('departure') ?? undefined,
    };
  }

  private debouncedSyncUrl(): void {
    if (this.syncUrlTimer) clearTimeout(this.syncUrlTimer);
    this.syncUrlTimer = setTimeout(() => this.writeUrlParams(), 300);
  }

  private writeUrlParams(): void {
    if (!this.mapReady) return;
    const center = this.map.getCenter();
    const params = new URLSearchParams();
    params.set('lat', center.lat.toFixed(4));
    params.set('lng', center.lng.toFixed(4));
    params.set('z', String(this.map.getZoom()));
    params.set('base', this.activeBaseLayerName);
    if (this.activeOverlayNames.size) {
      params.set('overlays', [...this.activeOverlayNames].sort().join(','));
    }
    const departure = this.tripDateTime.inputValue();
    if (departure) {
      params.set('departure', departure);
    }
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  toggleAddLocation(): void {
    this.addingLocation = !this.addingLocation;
    if (!this.addingLocation) {
      this.map.off('click', this.addLocationClickHandler);
    } else {
      setTimeout(() => {
        this.map.once('click', this.addLocationClickHandler);
      }, 0);
    }
  }

  private addLocationClickHandler = (e: L.LeafletMouseEvent): void => {
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
          .savePoint(
            this.currentMapUuid,
            lat,
            lng,
            result.name,
            result.category,
            result.description,
          )
          .then(() => this.loadSavedLocations())
          .catch((err) => console.error('Failed to save location', err));
      });
    });
  };

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

    // ORS returns features ordered smallest → largest range (1h, 2h, 3h).
    // Render largest first so smaller polygons paint on top.
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

  toggleHikePlanning(): void {
    this.hikePlanningActive = !this.hikePlanningActive;
    if (!this.hikePlanningActive) {
      this.clearHikeRoute();
    }
  }

  clearHikeRoute(): void {
    this.hikeWaypoints = [];
    for (const m of this.hikeMarkers) {
      this.map.removeLayer(m);
    }
    this.hikeMarkers = [];
    if (this._hikeRouteLayer) {
      this.map.removeLayer(this._hikeRouteLayer);
      this._hikeRouteLayer = undefined;
    }
    if (this.hikeRouteDebounceTimer) {
      clearTimeout(this.hikeRouteDebounceTimer);
      this.hikeRouteDebounceTimer = null;
    }
    this.hikeLoading = false;
    this.editingRouteId = null;
    this.lastHikeDirectionsResult = null;
  }

  private onHikeMapClick(e: L.LeafletMouseEvent): void {
    if (!this.hikePlanningActive) return;
    this.addHikeWaypoint(e.latlng);
  }

  private addHikeWaypoint(latlng: L.LatLng, insertAt?: number): void {
    const index = insertAt ?? this.hikeWaypoints.length;
    this.hikeWaypoints.splice(index, 0, latlng);
    const marker = this.createWaypointMarker(latlng, index);
    this.hikeMarkers.splice(index, 0, marker);
    this.refreshAllWaypointIcons();
    if (this.hikeWaypoints.length >= 2) {
      this.fetchHikeRoute();
    }
  }

  private createWaypointMarker(latlng: L.LatLng, index: number): L.Marker {
    const role = this.resolveRole(index);
    const marker = L.marker(latlng, {
      icon: waypointIcon(role),
      draggable: true,
    }).addTo(this.map);

    marker.on('dragend', () => {
      const idx = this.hikeMarkers.indexOf(marker);
      if (idx === -1) return;
      this.hikeWaypoints[idx] = marker.getLatLng();
      this.debouncedFetchHikeRoute();
    });

    marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      const idx = this.hikeMarkers.indexOf(marker);
      if (idx === -1) return;
      this.ngZone.run(() => this.removeHikeWaypoint(idx));
    });

    return marker;
  }

  private resolveRole(index: number): WaypointRole {
    const total = this.hikeWaypoints.length;
    if (index === 0) return 'start';
    if (index === total - 1) return 'end';
    return 'mid';
  }

  private refreshAllWaypointIcons(): void {
    for (let i = 0; i < this.hikeMarkers.length; i++) {
      const role = this.resolveRole(i);
      this.hikeMarkers[i].setIcon(waypointIcon(role));
    }
  }

  private removeHikeWaypoint(index: number): void {
    this.map.removeLayer(this.hikeMarkers[index]);
    this.hikeMarkers.splice(index, 1);
    this.hikeWaypoints.splice(index, 1);
    this.refreshAllWaypointIcons();
    if (this.hikeWaypoints.length >= 2) {
      this.fetchHikeRoute();
    } else {
      if (this._hikeRouteLayer) {
        this.map.removeLayer(this._hikeRouteLayer);
        this._hikeRouteLayer = undefined;
      }
    }
  }

  private debouncedFetchHikeRoute(): void {
    if (this.hikeRouteDebounceTimer) clearTimeout(this.hikeRouteDebounceTimer);
    this.hikeRouteDebounceTimer = setTimeout(() => this.fetchHikeRoute(), 300);
  }

  private async fetchHikeRoute(): Promise<void> {
    if (this.hikeWaypoints.length < 2) return;
    const coordinates: [number, number][] = this.hikeWaypoints.map((wp) => [wp.lng, wp.lat]);
    this.hikeLoading = true;
    this.cdr.detectChanges();
    try {
      const result = await this.transportService.getHikeDirections(coordinates);
      this.lastHikeDirectionsResult = result;
      this.renderHikeRoute(result);
    } catch {
      console.error('Failed to fetch hike directions');
    } finally {
      this.hikeLoading = false;
      this.cdr.detectChanges();
    }
  }

  private renderHikeRoute(result: HikeDirectionsResult): void {
    if (this._hikeRouteLayer) {
      this.map.removeLayer(this._hikeRouteLayer);
    }
    this._hikeRouteLayer = L.geoJSON(result, {
      style: {
        color: '#e65100',
        weight: 4,
        opacity: 0.85,
      },
      onEachFeature: (feature, layer) => {
        const summary = feature.properties?.['summary'];
        if (!summary) return;
        const distKm = (summary['distance'] / 1000).toFixed(1);
        const dur = formatRouteDuration(summary['duration']);
        layer.bindPopup(
          `<b>Hike route</b><br>
          <span style="font-size:12px">${distKm} km &mdash; ${dur}</span>`,
        );
      },
    }).addTo(this.map);
    for (const m of this.hikeMarkers) {
      m.remove();
      m.addTo(this.map);
    }
  }

  saveHikeRoute(): void {
    this.ngZone.run(() => {
      const ref = this.dialog.open(SaveHikeDialogComponent, {
        data: {},
        width: '360px',
      });
      ref.afterClosed().subscribe(async (result: SaveHikeDialogResult | undefined) => {
        if (!result) return;
        await this.persistHikeRoute(result.name, false);
      });
    });
  }

  updateHikeRoute(): void {
    if (!this.editingRouteId) return;
    this.ngZone.run(() => {
      const ref = this.dialog.open(SaveHikeDialogComponent, {
        data: {},
        width: '360px',
      });
      ref.afterClosed().subscribe(async (result: SaveHikeDialogResult | undefined) => {
        if (!result) return;
        await this.persistHikeRoute(result.name, true);
      });
    });
  }

  private async persistHikeRoute(name: string, isUpdate: boolean): Promise<void> {
    const directions = this.lastHikeDirectionsResult;
    if (!directions?.features?.length) return;

    const feature = directions.features[0];
    const summary = feature.properties?.['summary'];
    const payload = {
      name,
      waypoints: this.hikeWaypoints.map((wp): [number, number] => [wp.lng, wp.lat]),
      geometry: feature.geometry.coordinates as [number, number][],
      distance_m: summary?.['distance'] ?? null,
      duration_s: summary?.['duration'] ?? null,
    };

    try {
      if (isUpdate && this.editingRouteId) {
        await this.hikeRouteService.update(this.currentMapUuid, this.editingRouteId, payload);
      } else {
        const saved = await this.hikeRouteService.create(this.currentMapUuid, payload);
        this.editingRouteId = saved.id;
      }
      await this.loadSavedHikes();
    } catch {
      console.error('Failed to save hike route');
    }
  }

  async deleteHikeRoute(id: number): Promise<void> {
    try {
      await this.hikeRouteService.delete(this.currentMapUuid, id);
      if (this.editingRouteId === id) {
        this.clearHikeRoute();
        this.hikePlanningActive = false;
        this.cdr.detectChanges();
      }
      await this.loadSavedHikes();
    } catch {
      console.error('Failed to delete hike route');
    }
  }

  editSavedRoute(route: SavedHikeRoute): void {
    this.clearHikeRoute();
    this.hikePlanningActive = true;
    this.editingRouteId = route.id;
    for (const [lon, lat] of route.waypoints) {
      const latlng = L.latLng(lat, lon);
      this.hikeWaypoints.push(latlng);
      const marker = this.createWaypointMarker(latlng, this.hikeWaypoints.length - 1);
      this.hikeMarkers.push(marker);
    }
    this.refreshAllWaypointIcons();
    if (this.hikeWaypoints.length >= 2) {
      this.fetchHikeRoute();
    }
    this.cdr.detectChanges();
  }

  private async loadSavedHikes(): Promise<void> {
    try {
      const routes = await this.hikeRouteService.getAll(this.currentMapUuid);

      if (this.savedHikesLayer) {
        this.layerControl.removeLayer(this.savedHikesLayer);
        this.map.removeLayer(this.savedHikesLayer);
      }

      const layers = routes.map((route) => {
        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: route.geometry },
          properties: {},
        };
        const layer = L.geoJSON(geojson, {
          style: { color: '#1565c0', weight: 3, opacity: 0.75 },
        });

        const distKm = route.distance_m != null ? (route.distance_m / 1000).toFixed(1) : '?';
        const dur = route.duration_s != null ? formatRouteDuration(route.duration_s) : '?';
        const popupId = `hike-popup-${route.id}`;
        layer.bindPopup(
          `<div id="${popupId}">
            <b>${route.name}</b><br>
            <span style="font-size:12px">${distKm} km &mdash; ${dur}</span>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="hike-edit-btn" data-id="${route.id}" type="button">Edit</button>
              <button class="hike-delete-btn" data-id="${route.id}" type="button">Delete</button>
            </div>
          </div>`,
        );

        layer.on('popupopen', () => {
          setTimeout(() => {
            const el = this.map.getContainer();
            const editBtn = el.querySelector<HTMLButtonElement>(`#${popupId} .hike-edit-btn`);
            const deleteBtn = el.querySelector<HTMLButtonElement>(`#${popupId} .hike-delete-btn`);
            editBtn?.addEventListener('click', () => {
              this.map.closePopup();
              this.ngZone.run(() => this.editSavedRoute(route));
            });
            deleteBtn?.addEventListener('click', () => {
              this.map.closePopup();
              this.ngZone.run(() => this.deleteHikeRoute(route.id));
            });
          }, 0);
        });

        return layer;
      });

      this.savedHikesLayer = L.layerGroup(layers).addTo(this.map);
      this.layerControl.addOverlay(this.savedHikesLayer, 'Saved hikes');
    } catch {
      console.error('Failed to load saved hikes');
    }
  }

  switchToMap(uuid: string): void {
    this.router.navigate(['/map', uuid]);
  }

  async createNewMap(): Promise<void> {
    await this.mapManager.navigateToNewMap();
  }

  startEditMapName(): void {
    this.mapNameInput = this.currentMapName;
    this.editingMapName = true;
    this.cdr.detectChanges();
  }

  async saveMapName(): Promise<void> {
    const trimmed = this.mapNameInput.trim();
    if (trimmed && trimmed !== this.currentMapName) {
      await this.mapManager.renameMap(this.currentMapUuid, trimmed);
      this.cdr.detectChanges();
    }
    this.editingMapName = false;
  }

  cancelEditMapName(): void {
    this.editingMapName = false;
  }

  copyShareLink(): void {
    navigator.clipboard.writeText(window.location.href).catch(() => {
      prompt('Copy this link to share the map:', window.location.href);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.syncUrlTimer) clearTimeout(this.syncUrlTimer);
    if (this.hikeRouteDebounceTimer) clearTimeout(this.hikeRouteDebounceTimer);
    if (this.map) {
      this.map.remove();
    }
  }

  private async loadSavedLocations(): Promise<void> {
    try {
      const locations = await this.locationService.getAll(this.currentMapUuid);
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
        const shouldAdd =
          this.urlOverlays !== null
            ? this.urlOverlays.includes(cfg.label)
            : cfg.level === DEFAULT_CONTOUR_LEVEL;
        if (shouldAdd) {
          layer.addTo(this.map);
        }
      } catch {
        // Silently skip unavailable contour levels
      }
    }
  }

  private saveFeature(feature: GeoJSON.Feature, btn: HTMLButtonElement): void {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    this.locationService
      .saveFromFeature(this.currentMapUuid, feature)
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

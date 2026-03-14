import {
  Component,
  AfterViewInit,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  effect,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChatService } from '../services/chat.service';
import { TripDateTimeService } from '../services/trip-datetime.service';
import { MapManagerService } from '../services/map-manager.service';
import type { BoundingBox } from '../services/chat.service';
import { environment } from '../../environments/environment';
import { MapControlsComponent } from './map-controls.component';
import { HikePlanningComponent } from './hike-planning.component';
import { MapReachabilityComponent } from './map-reachability.component';
import { MapSavedLocationsComponent } from './map-saved-locations.component';

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

const THUNDERFOREST_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.thunderforest.com/">Thunderforest</a>';

const TRACESTRACK_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.tracestrack.com/">Tracestrack</a>';

function buildThunderforestLayer(style: string): L.TileLayer | null {
  const key = environment.thunderforestApiKey;
  if (!key) return null;
  return L.tileLayer(`https://tile.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${key}`, {
    attribution: THUNDERFOREST_ATTRIBUTION,
    maxZoom: 22,
  });
}

function buildTracestrackTopoLayer(): L.TileLayer | null {
  const key = environment.tracestrackApiKey;
  if (!key) return null;
  return L.tileLayer(
    `https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
    {
      attribution: TRACESTRACK_ATTRIBUTION,
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
    },
  );
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
  imports: [
    MatButtonModule,
    MapControlsComponent,
    HikePlanningComponent,
    MapReachabilityComponent,
    MapSavedLocationsComponent,
  ],
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  private chatService = inject(ChatService);
  private tripDateTime = inject(TripDateTimeService);
  private mapManager = inject(MapManagerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('hikePlanning') private hikePlanningComp!: HikePlanningComponent;
  @ViewChild('reachability') private reachabilityComp!: MapReachabilityComponent;
  @ViewChild('savedLocations') private savedLocationsComp!: MapSavedLocationsComponent;

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private routeParamsSubscription?: Subscription;
  private baseLayers = new Map<string, L.Layer>();
  private activeBaseLayerName = 'Standard';
  private activeOverlayNames = new Set<string>();
  private urlOverlays: string[] | null = null;
  private mapReady = false;
  private syncUrlTimer: ReturnType<typeof setTimeout> | null = null;

  currentMapUuid = '';
  addingLocation = false;

  constructor() {
    effect(() => {
      this.tripDateTime.departureTime();
      if (this.mapReady) this.debouncedSyncUrl();
    });
  }

  ngOnInit(): void {
    const uuid = this.route.snapshot.params['uuid'] as string;
    this.loadMapByUuid(uuid);

    this.routeParamsSubscription = this.route.params.subscribe((params) => {
      const nextUuid = params['uuid'] as string;
      if (nextUuid && nextUuid !== this.currentMapUuid && this.mapReady) {
        this.loadMapByUuid(nextUuid);
      }
    });
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
    const tracestrackTopoLayer = buildTracestrackTopoLayer();

    const baseLayerConfig: Record<string, L.Layer> = {
      Standard: osmLayer,
      Satellite: satelliteLayer,
      Transport: transportLayer,
      ...(landscapeLayer && { Landscape: landscapeLayer }),
      ...(outdoorsLayer && { Outdoors: outdoorsLayer }),
      ...(tracestrackTopoLayer && { Topo: tracestrackTopoLayer }),
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

    this.hikePlanningComp.init(this.map, this.layerControl);
    this.reachabilityComp.init(this.map, this.layerControl);
    this.savedLocationsComp.init(this.map);

    this.loadContourLayers();
    this.mapReady = true;

    if (this.currentMapUuid) {
      this.savedLocationsComp.loadSavedLocations();
      this.hikePlanningComp.loadSavedHikes();
    }
  }

  private async loadMapByUuid(uuid: string): Promise<void> {
    if (uuid === 'new') {
      const newUuid = await this.mapManager.createMap({ name: 'My Trip' });
      this.router.navigate(['/map', newUuid], { replaceUrl: true });
      return;
    }

    const wasKnown = this.mapManager.isMyMap(uuid);
    const mapInfo = await this.mapManager.fetchMap(uuid);

    if (!mapInfo && wasKnown) {
      this.mapManager.removeFromMyMaps(uuid);
      this.snackBar.open('Map not found — it may have been deleted', 'Dismiss', {
        duration: 6000,
      });
      const remaining = this.mapManager.myMaps();
      const target = remaining.length > 0 ? `/map/${remaining[0].uuid}` : '/map/new';
      this.router.navigate([target], { replaceUrl: true });
      return;
    }

    this.currentMapUuid = uuid;
    this.mapManager.currentMapUuid.set(uuid);
    this.chatService.setMapUuid(uuid);

    if (mapInfo) {
      if (!wasKnown) {
        this.mapManager.addToMyMaps(uuid, mapInfo.name);
      }
    } else {
      await this.mapManager.createMap({ uuid, name: 'My Trip' });
    }
    this.cdr.detectChanges();

    if (this.mapReady && this.savedLocationsComp && this.hikePlanningComp) {
      this.savedLocationsComp.loadSavedLocations();
      this.hikePlanningComp.loadSavedHikes();
    }
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
    const locationsInView = this.savedLocationsComp.getLocationsInBounds(b);
    const reachabilityInView = this.reachabilityComp.getReachabilityInBounds(b);
    this.chatService.setContext({
      locationsInView,
      reachabilityMarkersInView: reachabilityInView,
    });
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
          this.activeOverlayNames.add(cfg.label);
        }
      } catch {
        // Silently skip unavailable contour levels
      }
    }
  }

  onAddLocationToggle(): void {
    this.addingLocation = !this.addingLocation;
  }

  onAddingLocationChange(value: boolean): void {
    this.addingLocation = value;
  }

  onHikePlanningToggle(): void {
    setTimeout(() => this.hikePlanningComp.toggleHikePlanning(), 0);
  }

  onLocationRangesRequested(locationId: number): void {
    this.reachabilityComp.loadRangesForLocation(this.currentMapUuid, locationId);
  }

  onHikingRangesCleared(): void {
    this.activeOverlayNames.delete('Hike isochrones');
    this.debouncedSyncUrl();
  }

  ngOnDestroy(): void {
    this.routeParamsSubscription?.unsubscribe();
    if (this.syncUrlTimer) clearTimeout(this.syncUrlTimer);
    if (this.map) {
      this.map.remove();
    }
  }
}

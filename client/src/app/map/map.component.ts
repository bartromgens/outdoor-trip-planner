import {
  Component,
  AfterViewInit,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  effect,
  signal,
  ChangeDetectorRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChatService } from '../services/chat.service';
import { TripDateTimeService } from '../services/trip-datetime.service';
import { MapManagerService } from '../services/map-manager.service';
import { MapUrlService } from '../services/map-url.service';
import { MapTileLayerService } from '../services/map-tile-layer.service';
import { LocationSearchService, type GeocodeResult } from '../services/location-search.service';
import { LocationService } from '../services/location.service';
import type { BoundingBox } from '../services/chat.service';
import {
  buildSaveLocationPopupContent,
  handleSaveLocationClick,
  POPUP_SAVE_BTN_CLASS,
} from './map-save-popup.helper';
import { MapControlsComponent } from './map-controls.component';
import { HikePlanningComponent } from './hike-planning.component';
import { MapReachabilityComponent } from './map-reachability.component';
import { MapSavedLocationsComponent } from './map-saved-locations.component';
import { ElevationProfileComponent } from './elevation-profile.component';
import { circleMarkerIcon } from './map-marker-icons';

interface ContourConfig {
  level: number;
  label: string;
  color: string;
  weight: number;
  dashArray?: string;
}

const DEFAULT_CONTOUR_LEVEL = 2000;
const MOBILE_BREAKPOINT = '(max-width: 768px)';

const CONTOUR_CONFIGS: ContourConfig[] = [
  { level: 1500, label: 'Contour 1500 m', color: '#a0522d', weight: 1.5, dashArray: '6 4' },
  { level: 1750, label: 'Contour 1750 m', color: '#964b1a', weight: 1.8, dashArray: '7 4' },
  { level: 2000, label: 'Contour 2000 m', color: '#8b3a0f', weight: 2, dashArray: '8 4' },
  { level: 2500, label: 'Contour 2500 m', color: '#6b2800', weight: 2.5 },
  { level: 3000, label: 'Contour 3000 m', color: '#4a1500', weight: 3 },
];

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
    ElevationProfileComponent,
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
  private mapUrl = inject(MapUrlService);
  private tileLayerService = inject(MapTileLayerService);
  private locationSearch = inject(LocationSearchService);
  private locationService = inject(LocationService);
  private breakpointObserver = inject(BreakpointObserver);

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
  private searchResultMarker: L.Marker | null = null;

  currentMapUuid = '';
  addingLocation = false;
  activeElevationProfile = signal<[number, number][] | null>(null);

  constructor() {
    effect(() => {
      this.tripDateTime.departureTime();
      if (this.mapReady) this.debouncedSyncUrl();
    });
    effect(() => {
      const result = this.locationSearch.resultToShow();
      if (result && this.mapReady && this.map) this.showSearchResult(result);
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
    const urlParams = this.mapUrl.read();

    this.map = L.map('map').setView(
      [urlParams.lat ?? 46.8182, urlParams.lng ?? 8.2275],
      urlParams.z ?? 8,
    );

    const baseLayerConfig = this.tileLayerService.buildBaseLayers();
    this.baseLayers = new Map(Object.entries(baseLayerConfig));

    this.activeBaseLayerName =
      urlParams.base && this.baseLayers.has(urlParams.base) ? urlParams.base : 'Standard';
    this.baseLayers.get(this.activeBaseLayerName)!.addTo(this.map);

    this.urlOverlays = urlParams.overlays ?? null;

    const isMobile = this.breakpointObserver.isMatched(MOBILE_BREAKPOINT);
    this.layerControl = L.control
      .layers(baseLayerConfig, undefined, {
        collapsed: isMobile,
        position: isMobile ? 'bottomright' : 'topright',
      })
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

    const pendingSearch = this.locationSearch.resultToShow();
    if (pendingSearch) this.showSearchResult(pendingSearch);

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

  private debouncedSyncUrl(): void {
    if (this.syncUrlTimer) clearTimeout(this.syncUrlTimer);
    this.syncUrlTimer = setTimeout(() => {
      if (!this.mapReady) return;
      const center = this.map.getCenter();
      this.mapUrl.write(
        center.lat,
        center.lng,
        this.map.getZoom(),
        this.activeBaseLayerName,
        this.activeOverlayNames,
      );
    }, 300);
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

  private showSearchResult(result: GeocodeResult): void {
    if (this.searchResultMarker) {
      this.map.removeLayer(this.searchResultMarker);
      this.searchResultMarker = null;
    }
    const latlng: L.LatLngExpression = [result.lat, result.lon];
    const feature: GeoJSON.Feature<GeoJSON.Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [result.lon, result.lat] },
      properties: { label: result.label },
    };
    const popupContent = buildSaveLocationPopupContent(result.label);
    this.searchResultMarker = L.marker(latlng, {
      icon: circleMarkerIcon({ color: '#1976d2', size: 14 }),
    })
      .bindPopup(popupContent, { className: 'search-result-popup' })
      .addTo(this.map);
    this.searchResultMarker.on('popupopen', (e: L.PopupEvent) => {
      const btn = e.popup
        .getElement()
        ?.querySelector<HTMLButtonElement>(`.${POPUP_SAVE_BTN_CLASS}`);
      if (!btn) return;
      btn.addEventListener('click', () =>
        handleSaveLocationClick(this.currentMapUuid, feature, btn, this.locationService, () =>
          this.savedLocationsComp.loadSavedLocations(),
        ),
      );
    });
    this.searchResultMarker.openPopup();
    this.map.setView(latlng, Math.max(this.map.getZoom(), 14), { animate: true });
    this.locationSearch.clearResultToShow();
  }

  ngOnDestroy(): void {
    this.routeParamsSubscription?.unsubscribe();
    if (this.syncUrlTimer) clearTimeout(this.syncUrlTimer);
    if (this.searchResultMarker && this.map) {
      this.map.removeLayer(this.searchResultMarker);
    }
    if (this.map) {
      this.map.remove();
    }
  }
}

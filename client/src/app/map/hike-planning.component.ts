import {
  Component,
  inject,
  input,
  output,
  effect,
  NgZone,
  ChangeDetectorRef,
  OnDestroy,
  signal,
} from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { DecimalPipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { TransportService, type HikeDirectionsResult } from '../services/transport.service';
import { HikeRouteService, type SavedHikeRoute } from '../services/hike-route.service';
import { SaveHikeDialogComponent, type SaveHikeDialogResult } from './save-hike-dialog.component';
import { circleMarkerIcon } from './map-marker-icons';
import { routesToGpx, downloadGpx } from './gpx';

type WaypointRole = 'start' | 'end' | 'mid';

const WAYPOINT_COLORS: Record<WaypointRole, string> = {
  start: '#2e7d32',
  end: '#d32f2f',
  mid: '#1976d2',
};

function waypointIcon(role: WaypointRole): L.DivIcon {
  return circleMarkerIcon({
    color: WAYPOINT_COLORS[role],
    size: 22,
    shadow: '0 2px 4px rgba(0,0,0,.45)',
    border: '2.5px solid #fff',
    popupAnchor: [0, -12],
    extraStyle: 'cursor:grab',
  });
}

function formatRouteDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function formatElevationStats(
  ascentM: number | null | undefined,
  descentM: number | null | undefined,
): string {
  if (ascentM == null || descentM == null) return '';
  return `<br><span style="font-size:12px">&#8593; ${ascentM} m &nbsp; &#8595; ${descentM} m</span>`;
}

function elevationRangeFromProfile(profile: [number, number][] | null | undefined): number | null {
  if (!profile?.length) return null;
  const elevations = profile.map((p) => p[1]);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  return Math.round(max - min);
}

function formatElevationRange(profile: [number, number][] | null | undefined): string {
  const range = elevationRangeFromProfile(profile);
  if (range == null) return '';
  return `<br><span style="font-size:12px">&#8597; ${range} m (highest − lowest)</span>`;
}

export interface HikeRouteStats {
  distance_km: number;
  duration_s: number;
  ascent_m: number | null;
  descent_m: number | null;
  elevation_range_m: number | null;
}

const SAVED_HIKE_ROUTE_STYLE_DEFAULT: L.PathOptions = {
  color: '#1565c0',
  weight: 5,
  opacity: 0.75,
};

const SAVED_HIKE_ROUTE_STYLE_SELECTED: L.PathOptions = {
  color: '#7b1fa2',
  weight: 6,
  opacity: 0.95,
};

@Component({
  selector: 'app-hike-planning',
  templateUrl: './hike-planning.component.html',
  styleUrl: './hike-planning.component.scss',
  imports: [DecimalPipe],
})
export class HikePlanningComponent implements OnDestroy {
  private transportService = inject(TransportService);
  private hikeRouteService = inject(HikeRouteService);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  mapUuid = input.required<string>();
  hikePlanningActive = input<boolean>(false);
  readonly hikePlanningActiveChange = output<boolean>();
  readonly elevationProfile = output<[number, number][] | null>();
  readonly savedHikesCountChange = output<number>();
  readonly selectedHikeIdChange = output<number | null>();

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private hikeWaypoints: L.LatLng[] = [];
  private hikeMarkers: L.Marker[] = [];
  private hikeRouteDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _hikeRouteLayer?: L.GeoJSON;
  private lastHikeDirectionsResult: HikeDirectionsResult | null = null;
  private savedHikesLayer?: L.LayerGroup;
  private readonly savedHikeGeoJsonById = new Map<number, L.GeoJSON>();

  hikeLoading = false;
  editingRouteId: number | null = null;
  editingRouteName: string | null = null;
  readonly routeStats = signal<HikeRouteStats | null>(null);
  readonly savedHikeRoutes = signal<SavedHikeRoute[]>([]);

  constructor() {
    effect(() => {
      if (!this.hikePlanningActive() && this.map) this.clearHikeRoute();
    });
  }

  get hikeRouteLayer(): L.GeoJSON | undefined {
    return this._hikeRouteLayer;
  }

  formatDuration(seconds: number): string {
    return formatRouteDuration(seconds);
  }

  init(map: L.Map, layerControl: L.Control.Layers): void {
    this.map = map;
    this.layerControl = layerControl;
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onHikeMapClick(e));
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
    this.editingRouteName = null;
    this.lastHikeDirectionsResult = null;
    this.routeStats.set(null);
    this.elevationProfile.emit(null);
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
        data: { existingName: this.editingRouteName ?? undefined },
        width: '360px',
      });
      ref.afterClosed().subscribe(async (result: SaveHikeDialogResult | undefined) => {
        if (!result) return;
        await this.persistHikeRoute(result.name, true);
      });
    });
  }

  async deleteHikeRoute(id: number): Promise<void> {
    const uuid = this.mapUuid();
    try {
      await this.hikeRouteService.delete(uuid, id);
      if (this.editingRouteId === id) {
        this.hikePlanningActiveChange.emit(false);
      }
      await this.loadSavedHikes();
    } catch {
      console.error('Failed to delete hike route');
    }
  }

  editSavedRoute(route: SavedHikeRoute): void {
    this.hikePlanningActiveChange.emit(true);
    this.clearHikeRoute();
    this.editingRouteId = route.id;
    this.editingRouteName = route.name;
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

  downloadRouteAsGpx(route: SavedHikeRoute): void {
    const gpx = routesToGpx([route]);
    const filename = route.name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'hike-route';
    downloadGpx(gpx, `${filename}.gpx`);
  }

  async loadSavedHikes(): Promise<void> {
    const uuid = this.mapUuid();
    if (!this.map || !this.layerControl) return;
    try {
      const routes = await this.hikeRouteService.getAll(uuid);
      this.savedHikeRoutes.set(routes);
      this.savedHikesCountChange.emit(routes.length);

      if (this.savedHikesLayer) {
        this.layerControl.removeLayer(this.savedHikesLayer);
        this.map.removeLayer(this.savedHikesLayer);
      }
      this.savedHikeGeoJsonById.clear();

      const layers = routes.map((route) => {
        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: route.geometry },
          properties: {},
        };
        const layer = L.geoJSON(geojson, {
          style: SAVED_HIKE_ROUTE_STYLE_DEFAULT,
        });
        this.savedHikeGeoJsonById.set(route.id, layer);

        const distKm = route.distance_m != null ? (route.distance_m / 1000).toFixed(1) : '?';
        const dur = route.duration_s != null ? formatRouteDuration(route.duration_s) : '?';
        const statsRow = formatElevationStats(route.ascent_m, route.descent_m);
        const rangeRow = formatElevationRange(route.elevation_profile);
        const popupId = `hike-popup-${route.id}`;
        layer.bindPopup(
          `<div id="${popupId}">
            <b>${route.name}</b><br>
            <span style="font-size:12px">${distKm} km &mdash; ${dur}</span>
            ${statsRow}${rangeRow}
            <div class="hike-popup-actions">
              <button class="hike-edit-btn" data-id="${route.id}" type="button">Edit</button>
              <button class="hike-download-gpx-btn" data-id="${route.id}" type="button">GPX</button>
              <button class="hike-delete-btn" data-id="${route.id}" type="button">Delete</button>
            </div>
          </div>`,
        );

        layer.on('popupopen', () => {
          this.setSavedHikeRouteHighlight(route.id);
          this.ngZone.run(() => {
            this.elevationProfile.emit(route.elevation_profile ?? null);
            this.selectedHikeIdChange.emit(route.id);
          });
          setTimeout(() => {
            const el = this.map.getContainer();
            const editBtn = el.querySelector<HTMLButtonElement>(`#${popupId} .hike-edit-btn`);
            const downloadGpxBtn = el.querySelector<HTMLButtonElement>(
              `#${popupId} .hike-download-gpx-btn`,
            );
            const deleteBtn = el.querySelector<HTMLButtonElement>(`#${popupId} .hike-delete-btn`);
            editBtn?.addEventListener('click', () => {
              this.map.closePopup();
              this.ngZone.run(() => this.editSavedRoute(route));
            });
            downloadGpxBtn?.addEventListener('click', () => {
              this.ngZone.run(() => this.downloadRouteAsGpx(route));
            });
            deleteBtn?.addEventListener('click', () => {
              this.map.closePopup();
              this.ngZone.run(() => this.deleteHikeRoute(route.id));
            });
          }, 0);
        });

        layer.on('popupclose', () => {
          this.setSavedHikeRouteHighlight(null);
          this.ngZone.run(() => {
            this.elevationProfile.emit(null);
            this.selectedHikeIdChange.emit(null);
          });
        });

        return layer;
      });

      this.savedHikesLayer = L.layerGroup(layers).addTo(this.map);
      this.layerControl.addOverlay(this.savedHikesLayer, 'Saved hikes');
    } catch {
      console.error('Failed to load saved hikes');
    }
  }

  private setSavedHikeRouteHighlight(selectedId: number | null): void {
    for (const [id, geo] of this.savedHikeGeoJsonById) {
      geo.setStyle(
        id === selectedId ? SAVED_HIKE_ROUTE_STYLE_SELECTED : SAVED_HIKE_ROUTE_STYLE_DEFAULT,
      );
    }
  }

  ngOnDestroy(): void {
    if (this.hikeRouteDebounceTimer) clearTimeout(this.hikeRouteDebounceTimer);
  }

  addWaypointAt(lat: number, lng: number): void {
    this.addHikeWaypoint(L.latLng(lat, lng));
  }

  private onHikeMapClick(e: L.LeafletMouseEvent): void {
    if (!this.hikePlanningActive()) return;
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
        const statsRow = formatElevationStats(summary['ascent_m'], summary['descent_m']);
        const rangeRow = formatElevationRange(summary['elevation_profile']);
        layer.bindPopup(
          `<b>Hike route</b><br>
          <span style="font-size:12px">${distKm} km &mdash; ${dur}</span>
          ${statsRow}${rangeRow}`,
        );
      },
    }).addTo(this.map);
    for (const m of this.hikeMarkers) {
      m.remove();
      m.addTo(this.map);
    }
    const profile = result.features[0]?.properties?.summary?.elevation_profile;
    this.elevationProfile.emit(profile ?? null);

    const summary = result.features[0]?.properties?.summary;
    if (summary) {
      this.routeStats.set({
        distance_km: summary['distance'] / 1000,
        duration_s: summary['duration'],
        ascent_m: summary['ascent_m'] ?? null,
        descent_m: summary['descent_m'] ?? null,
        elevation_range_m: elevationRangeFromProfile(profile),
      });
    } else {
      this.routeStats.set(null);
    }
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
      ascent_m: summary?.['ascent_m'] ?? null,
      descent_m: summary?.['descent_m'] ?? null,
      elevation_profile: summary?.['elevation_profile'] ?? null,
    };

    const uuid = this.mapUuid();
    try {
      if (isUpdate && this.editingRouteId) {
        await this.hikeRouteService.update(uuid, this.editingRouteId, payload);
      } else {
        const saved = await this.hikeRouteService.create(uuid, payload);
        this.editingRouteId = saved.id;
      }
      await this.loadSavedHikes();
    } catch {
      console.error('Failed to save hike route');
    }
  }
}

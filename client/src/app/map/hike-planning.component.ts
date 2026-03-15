import { Component, inject, input, NgZone, ChangeDetectorRef, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { MatDialog } from '@angular/material/dialog';
import { TransportService, type HikeDirectionsResult } from '../services/transport.service';
import { HikeRouteService, type SavedHikeRoute } from '../services/hike-route.service';
import { SaveHikeDialogComponent, type SaveHikeDialogResult } from './save-hike-dialog.component';
import { circleMarkerIcon } from './map-marker-icons';

type WaypointRole = 'start' | 'end' | 'mid';

const WAYPOINT_COLORS: Record<WaypointRole, string> = {
  start: '#2e7d32',
  end: '#d32f2f',
  mid: '#1976d2',
};

function waypointIcon(role: WaypointRole): L.DivIcon {
  return circleMarkerIcon({
    color: WAYPOINT_COLORS[role],
    size: 14,
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

@Component({
  selector: 'app-hike-planning',
  templateUrl: './hike-planning.component.html',
  styleUrl: './hike-planning.component.scss',
})
export class HikePlanningComponent implements OnDestroy {
  private transportService = inject(TransportService);
  private hikeRouteService = inject(HikeRouteService);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  mapUuid = input.required<string>();

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private hikeWaypoints: L.LatLng[] = [];
  private hikeMarkers: L.Marker[] = [];
  private hikeRouteDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _hikeRouteLayer?: L.GeoJSON;
  private lastHikeDirectionsResult: HikeDirectionsResult | null = null;
  private savedHikesLayer?: L.LayerGroup;

  hikePlanningActive = false;
  hikeLoading = false;
  editingRouteId: number | null = null;

  get hikeRouteLayer(): L.GeoJSON | undefined {
    return this._hikeRouteLayer;
  }

  init(map: L.Map, layerControl: L.Control.Layers): void {
    this.map = map;
    this.layerControl = layerControl;
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onHikeMapClick(e));
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

  async deleteHikeRoute(id: number): Promise<void> {
    const uuid = this.mapUuid();
    try {
      await this.hikeRouteService.delete(uuid, id);
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

  async loadSavedHikes(): Promise<void> {
    const uuid = this.mapUuid();
    if (!this.map || !this.layerControl) return;
    try {
      const routes = await this.hikeRouteService.getAll(uuid);

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
            <div class="hike-popup-actions">
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

  ngOnDestroy(): void {
    if (this.hikeRouteDebounceTimer) clearTimeout(this.hikeRouteDebounceTimer);
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

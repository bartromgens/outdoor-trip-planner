import { Component, inject, input, output, effect, NgZone, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChatService } from '../services/chat.service';
import {
  LocationService,
  savedLocationsToFeatureCollection,
  type SavedLocation,
} from '../services/location.service';
import {
  AddLocationDialogComponent,
  type AddLocationDialogResult,
} from './add-location-dialog.component';
import {
  buildSaveLocationPopupContent,
  handleSaveLocationClick,
  POPUP_SAVE_BTN_CLASS,
} from './map-save-popup.helper';
import { circleMarkerIcon } from './map-marker-icons';
import {
  colorForCategory,
  showReachabilityIsochronesForCategory,
} from './location-categories';

function iconForCategory(category?: string): L.DivIcon {
  return circleMarkerIcon({
    color: colorForCategory(category),
    size: 12,
    shadow: '0 1px 3px rgba(0,0,0,.4)',
    border: '2px solid #fff',
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

function geoJsonLayerStyle(feature?: GeoJSON.Feature): L.PathOptions {
  const cat = feature?.properties?.['category'];
  return { color: colorForCategory(cat), weight: 3, opacity: 0.8 };
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeHref(url: string): string {
  return escapeHtml(url)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSavedLocationPopupHtml(
  label: string,
  cat: string,
  desc: string,
  link: string | undefined,
  altitude: number | null | undefined,
  locationId: number | undefined,
): string {
  const parts = [`<b>${escapeHtml(label)}</b>`];
  if (altitude != null) {
    parts.push(`<span style="font-size:12px">Altitude: ${altitude} m</span>`);
  }
  if (cat) parts.push(`<span style="opacity:.6;font-size:12px">${escapeHtml(cat)}</span>`);
  if (desc) parts.push(`<div style="margin-top:4px">${escapeHtml(desc)}</div>`);
  const trimmedLink = link?.trim();
  if (trimmedLink && /^https?:\/\//i.test(trimmedLink)) {
    parts.push(
      `<a href="${escapeHref(trimmedLink)}" target="_blank" rel="noopener noreferrer" class="saved-location-popup-link">Open link</a>`,
    );
  }
  if (locationId != null) {
    parts.push(
      '<div class="saved-location-popup-actions">' +
        '<button class="saved-location-edit-btn" type="button">Edit</button>' +
        '<button class="saved-location-delete-btn" type="button">Delete</button>' +
        '</div>',
    );
  }
  return parts.join('<br>');
}

@Component({
  selector: 'app-map-saved-locations',
  template: '',
})
export class MapSavedLocationsComponent implements OnDestroy {
  private chatService = inject(ChatService);
  private locationService = inject(LocationService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private ngZone = inject(NgZone);

  mapUuid = input.required<string>();
  addingLocation = input<boolean>(false);
  addingLocationChange = output<boolean>();
  locationRangesRequested = output<number>();

  private map!: L.Map;
  private featureLayer?: L.GeoJSON;
  private savedLayer?: L.GeoJSON;
  private subscription?: Subscription;
  private lastLoadedLocations: SavedLocation[] = [];

  constructor() {
    effect(() => {
      const adding = this.addingLocation();
      if (!this.map) return;
      if (adding) {
        this.map.once('click', this.addLocationClickHandler);
      } else {
        this.map.off('click', this.addLocationClickHandler);
      }
    });
  }

  init(map: L.Map): void {
    this.map = map;
    this.subscription = this.chatService.mapFeatures$.subscribe((fc) => {
      if (!fc) return;
      this.renderFeatures(fc);
    });
  }

  async loadSavedLocations(): Promise<void> {
    const uuid = this.mapUuid();
    if (!this.map) return;
    try {
      const locations = await this.locationService.getAll(uuid);
      this.lastLoadedLocations = locations;
      const fc = savedLocationsToFeatureCollection(locations);
      if (this.savedLayer) {
        this.map.removeLayer(this.savedLayer);
      }
      this.savedLayer = L.geoJSON(fc, {
        pointToLayer: (_feature, latlng) => {
          const cat = _feature.properties?.['category'];
          return L.marker(latlng, {
            icon: savedIconForCategory(cat),
            draggable: true,
          });
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const label = props['label'] || '';
          const desc = props['description'] || '';
          const cat = props['category'] || '';
          const link = props['link'] as string | undefined;
          const altitude = props['altitude'];
          const locationId = props['id'] as number | undefined;

          layer.bindPopup(
            buildSavedLocationPopupHtml(label, cat, desc, link, altitude, locationId),
          );

          if (locationId != null) {
            layer.on('click', () => {
              if (showReachabilityIsochronesForCategory(cat)) {
                this.ngZone.run(() =>
                  this.locationRangesRequested.emit(locationId as number),
                );
              }
            });
            layer.on('popupopen', (e: L.PopupEvent) => {
              const popupEl = e.popup.getElement();
              const deleteBtn = popupEl?.querySelector<HTMLButtonElement>(
                '.saved-location-delete-btn',
              );
              const editBtn = popupEl?.querySelector<HTMLButtonElement>('.saved-location-edit-btn');
              const deleteHandler = () => this.deleteSavedLocation(locationId, layer);
              const editHandler = () =>
                this.openEditLocationDialog(
                  locationId,
                  label,
                  cat,
                  desc ?? '',
                  link ?? '',
                  layer,
                );
              deleteBtn?.addEventListener('click', deleteHandler);
              editBtn?.addEventListener('click', editHandler);
              layer.once('popupclose', () => {
                deleteBtn?.removeEventListener('click', deleteHandler);
                editBtn?.removeEventListener('click', editHandler);
              });
            });
            layer.on('dragend', (e: L.LeafletEvent) => {
              const marker = e.target as L.Marker;
              const { lat, lng } = marker.getLatLng();
              this.ngZone.run(() =>
                this.updateSavedLocationPosition(locationId, lat, lng, feature),
              );
            });
          }
        },
        style: geoJsonLayerStyle,
      }).addTo(this.map);
    } catch {
      // Silently ignore load errors on startup
    }
  }

  getLocationsInBounds(bounds: L.LatLngBounds): SavedLocation[] {
    return this.lastLoadedLocations.filter((loc) => bounds.contains([loc.latitude, loc.longitude]));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.map) {
      this.map.off('click', this.addLocationClickHandler);
    }
  }

  private openEditLocationDialog(
    locationId: number,
    name: string,
    category: string,
    description: string,
    link: string,
    layer: L.Layer,
  ): void {
    const ref = this.dialog.open(AddLocationDialogComponent, {
      data: {
        title: 'Edit location',
        initialName: name,
        initialCategory: category,
        initialDescription: description,
        initialLink: link,
      },
      width: '360px',
    });
    ref.afterClosed().subscribe((result: AddLocationDialogResult | undefined) => {
      if (!result) return;
      const uuid = this.mapUuid();
      this.locationService
        .updateDetails(uuid, locationId, {
          name: result.name,
          category: result.category,
          description: result.description,
          link: result.link,
        })
        .then(() => {
          (layer as L.Marker).closePopup();
          return this.loadSavedLocations();
        })
        .then(() => this.snackBar.open('Location updated', 'Dismiss', { duration: 3000 }))
        .catch((err) => console.error('Failed to update location', err));
    });
  }

  private deleteSavedLocation(locationId: number, layer: L.Layer): void {
    const uuid = this.mapUuid();
    this.locationService
      .delete(uuid, locationId)
      .then(() => {
        this.savedLayer?.removeLayer(layer);
        this.snackBar.open('Location deleted', 'Dismiss', { duration: 3000 });
      })
      .catch((err) => console.error('Failed to delete location', err));
  }

  private updateSavedLocationPosition(
    locationId: number,
    lat: number,
    lng: number,
    feature: GeoJSON.Feature,
  ): void {
    const uuid = this.mapUuid();
    this.locationService
      .updatePosition(uuid, locationId, lat, lng)
      .then(() => {
        if (feature.geometry?.type === 'Point') {
          (feature.geometry as GeoJSON.Point).coordinates = [lng, lat];
        }
      })
      .catch((err) => console.error('Failed to update location position', err));
  }

  private addLocationClickHandler = (e: L.LeafletMouseEvent): void => {
    const { lat, lng } = e.latlng;
    this.ngZone.run(() => {
      this.addingLocationChange.emit(false);
      const ref = this.dialog.open(AddLocationDialogComponent, {
        data: { lat, lng },
        width: '360px',
      });
      ref.afterClosed().subscribe((result: AddLocationDialogResult | undefined) => {
        if (!result) return;
        const uuid = this.mapUuid();
        this.locationService
          .savePoint(
            uuid,
            lat,
            lng,
            result.name,
            result.category,
            result.description,
            result.link,
          )
          .then(() => this.loadSavedLocations())
          .catch((err) => console.error('Failed to save location', err));
      });
    });
  };

  private renderFeatures(fc: GeoJSON.FeatureCollection): void {
    if (!this.map) return;
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
        layer.bindPopup(buildSaveLocationPopupContent(label, cat, desc));

        layer.on('popupopen', (e) => {
          const btn = (e as L.PopupEvent).popup
            .getElement()
            ?.querySelector<HTMLButtonElement>(`.${POPUP_SAVE_BTN_CLASS}`);
          if (!btn) return;
          btn.addEventListener('click', () =>
            handleSaveLocationClick(this.mapUuid(), feature, btn, this.locationService, () =>
              this.loadSavedLocations(),
            ),
          );
        });
      },
      style: geoJsonLayerStyle,
    }).addTo(this.map);

    const bounds = this.featureLayer.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }
}

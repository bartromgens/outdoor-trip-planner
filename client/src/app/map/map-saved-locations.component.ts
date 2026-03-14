import {
  Component,
  inject,
  input,
  output,
  NgZone,
  ChangeDetectorRef,
  OnDestroy,
} from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChatService } from '../services/chat.service';
import { LocationService, savedLocationsToFeatureCollection } from '../services/location.service';
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

function colorForCategory(category?: string): string {
  return (category && CATEGORY_COLORS[category]) || DEFAULT_COLOR;
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
  private cdr = inject(ChangeDetectorRef);

  mapUuid = input.required<string>();

  private map!: L.Map;
  private featureLayer?: L.GeoJSON;
  private savedLayer?: L.GeoJSON;
  private subscription?: Subscription;

  addingLocation = false;

  locationRangesRequested = output<number>();

  init(map: L.Map): void {
    this.map = map;
    this.subscription = this.chatService.mapFeatures$.subscribe((fc) => {
      if (!fc) return;
      this.renderFeatures(fc);
    });
  }

  toggleAddLocation(): void {
    const next = !this.addingLocation;
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => {
        this.addingLocation = next;
        if (!next) {
          this.map.off('click', this.addLocationClickHandler);
        } else {
          this.map.once('click', this.addLocationClickHandler);
        }
        this.ngZone.run(() => this.cdr.detectChanges());
      }, 0);
    });
  }

  async loadSavedLocations(): Promise<void> {
    const uuid = this.mapUuid();
    if (!this.map) return;
    try {
      const locations = await this.locationService.getAll(uuid);
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
          const altitude = props['altitude'];
          const locationId = props['id'] as number | undefined;
          const parts = [`<b>${label}</b>`];
          if (altitude != null)
            parts.push(`<span style="font-size:12px">Altitude: ${altitude} m</span>`);
          if (cat) parts.push(`<span style="opacity:.6;font-size:12px">${cat}</span>`);
          if (desc) parts.push(`<div style="margin-top:4px">${desc}</div>`);
          if (locationId != null) {
            parts.push(
              '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="saved-location-edit-btn" type="button" style="background:#1976d2;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer">Edit</button>' +
                '<button class="saved-location-delete-btn" type="button" style="background:#c62828;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer">Delete</button>' +
              '</div>',
            );
          }
          layer.bindPopup(parts.join('<br>'));
          if (locationId != null) {
            layer.on('click', () => {
              this.ngZone.run(() => this.locationRangesRequested.emit(locationId as number));
            });
            layer.on('popupopen', (e: L.PopupEvent) => {
              const popupEl = e.popup.getElement();
              const deleteBtn = popupEl?.querySelector<HTMLButtonElement>('.saved-location-delete-btn');
              const editBtn = popupEl?.querySelector<HTMLButtonElement>('.saved-location-edit-btn');
              const onClose = () => {
                deleteBtn?.removeEventListener('click', deleteHandler);
                editBtn?.removeEventListener('click', editHandler);
              };
              const deleteHandler = () => this.deleteSavedLocation(locationId, layer);
              const editHandler = () =>
                this.openEditLocationDialog(locationId, label, cat, desc ?? '', layer);
              deleteBtn?.addEventListener('click', deleteHandler);
              editBtn?.addEventListener('click', editHandler);
              layer.once('popupclose', onClose);
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
        style: (feature) => {
          const cat = feature?.properties?.['category'];
          return { color: colorForCategory(cat), weight: 3, opacity: 0.8 };
        },
      }).addTo(this.map);
    } catch {
      // Silently ignore load errors on startup
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private openEditLocationDialog(
    locationId: number,
    name: string,
    category: string,
    description: string,
    layer: L.Layer,
  ): void {
    const ref = this.dialog.open(AddLocationDialogComponent, {
      data: {
        title: 'Edit location',
        initialName: name,
        initialCategory: category,
        initialDescription: description,
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
        })
        .then(() => {
          (layer as L.Marker).closePopup();
          return this.loadSavedLocations();
        })
        .then(() =>
          this.snackBar.open('Location updated', 'Dismiss', { duration: 3000 }),
        )
        .catch((err) => console.error('Failed to update location', err));
    });
  }

  private deleteSavedLocation(locationId: number, layer: L.Layer): void {
    const uuid = this.mapUuid();
    this.locationService
      .delete(uuid, locationId)
      .then(() => {
        if (this.savedLayer) {
          this.savedLayer.removeLayer(layer);
        }
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
    this.ngZone.runOutsideAngular(() => {
      this.addingLocation = false;
      this.ngZone.run(() => this.cdr.detectChanges());
    });
    this.ngZone.run(() => {
      const ref = this.dialog.open(AddLocationDialogComponent, {
        data: { lat, lng },
        width: '360px',
      });
      ref.afterClosed().subscribe((result: AddLocationDialogResult | undefined) => {
        if (!result) return;
        const uuid = this.mapUuid();
        this.locationService
          .savePoint(uuid, lat, lng, result.name, result.category, result.description)
          .then(() => this.loadSavedLocations())
          .catch((err) => console.error('Failed to save location', err));
      });
    });
  };

  private saveFeature(feature: GeoJSON.Feature, btn: HTMLButtonElement): void {
    const uuid = this.mapUuid();
    btn.disabled = true;
    btn.textContent = 'Saving…';
    this.locationService
      .saveFromFeature(uuid, feature)
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

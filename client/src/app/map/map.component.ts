import { Component, AfterViewInit, OnDestroy, inject } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { ChatService } from '../services/chat.service';
import { LocationService, savedLocationsToFeatureCollection } from '../services/location.service';
import type { BoundingBox } from '../services/chat.service';
import { environment } from '../../environments/environment';

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
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private chatService = inject(ChatService);
  private locationService = inject(LocationService);
  private map!: L.Map;
  private featureLayer?: L.GeoJSON;
  private savedLayer?: L.GeoJSON;
  private subscription?: Subscription;

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

    L.control
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

    this.emitBbox();
    this.map.on('moveend', () => this.emitBbox());

    this.subscription = this.chatService.mapFeatures$.subscribe((fc) => {
      if (!fc) return;
      this.renderFeatures(fc);
    });

    this.loadSavedLocations();
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

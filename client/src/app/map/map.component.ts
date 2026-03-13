import { Component, AfterViewInit, OnDestroy, inject } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { ChatService } from '../services/chat.service';
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
  private map!: L.Map;
  private featureLayer?: L.GeoJSON;
  private subscription?: Subscription;

  ngAfterViewInit(): void {
    this.map = L.map('map').setView([46.8182, 8.2275], 8);

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });

    const transportLayer = buildTransportLayer();

    osmLayer.addTo(this.map);

    L.control
      .layers(
        {
          Standard: osmLayer,
          Transport: transportLayer,
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

  private renderFeatures(fc: GeoJSON.FeatureCollection): void {
    if (this.featureLayer) {
      this.map.removeLayer(this.featureLayer);
    }

    this.featureLayer = L.geoJSON(fc, {
      pointToLayer: (_feature, latlng) => {
        const cat = _feature.properties?.['category'];
        return L.marker(latlng, { icon: iconForCategory(cat) });
      },
      onEachFeature: (_feature, layer) => {
        const props = _feature.properties || {};
        const label = props['label'] || '';
        const desc = props['description'] || '';
        const cat = props['category'] || '';
        const parts = [`<b>${label}</b>`];
        if (cat) parts.push(`<span style="opacity:.6;font-size:12px">${cat}</span>`);
        if (desc) parts.push(`<div style="margin-top:4px">${desc}</div>`);
        layer.bindPopup(parts.join('<br>'));
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

import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';

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

@Injectable({ providedIn: 'root' })
export class MapContourService {
  async loadContourLayers(
    map: L.Map,
    layerControl: L.Control.Layers,
    urlOverlays: string[] | null,
    activeOverlayNames: Set<string>,
  ): Promise<void> {
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
        layerControl.addOverlay(layer, cfg.label);
        const shouldAdd =
          urlOverlays !== null
            ? urlOverlays.includes(cfg.label)
            : cfg.level === DEFAULT_CONTOUR_LEVEL;
        if (shouldAdd) {
          layer.addTo(map);
          activeOverlayNames.add(cfg.label);
        }
      } catch {
        // Silently skip unavailable contour levels
      }
    }
  }
}

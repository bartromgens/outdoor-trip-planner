import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type * as GeoJSON from 'geojson';

export interface SavedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  description: string;
  category: string;
  geometry_type: string;
  coordinates: unknown;
  created_at: string;
  updated_at: string;
}

function savedLocationToFeature(loc: SavedLocation): GeoJSON.Feature | null {
  let geometry: GeoJSON.Geometry | null = null;

  if (loc.geometry_type === 'point') {
    geometry = { type: 'Point', coordinates: loc.coordinates as [number, number] };
  } else if (loc.geometry_type === 'line') {
    geometry = { type: 'LineString', coordinates: loc.coordinates as [number, number][] };
  } else if (loc.geometry_type === 'polygon') {
    geometry = {
      type: 'Polygon',
      coordinates: [loc.coordinates as [number, number][]],
    };
  }

  if (!geometry) return null;

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: loc.id,
      label: loc.name,
      description: loc.description,
      category: loc.category,
      altitude: loc.altitude,
      saved: true,
    },
  };
}

export function savedLocationsToFeatureCollection(
  locations: SavedLocation[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: locations.map(savedLocationToFeature).filter((f): f is GeoJSON.Feature => f !== null),
  };
}

interface LocationPayload {
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  description: string;
  category: string;
  geometry_type: string;
  coordinates: unknown;
}

function geoJsonTypeToModel(type: string): string {
  if (type === 'LineString') return 'line';
  if (type === 'Polygon') return 'polygon';
  return 'point';
}

function extractCoords(
  feature: GeoJSON.Feature,
): { lat: number; lon: number; coordinates: unknown } | null {
  const geom = feature.geometry;
  if (!geom) return null;

  if (geom.type === 'Point') {
    const [lon, lat] = geom.coordinates as [number, number];
    return { lat, lon, coordinates: geom.coordinates };
  }

  if (geom.type === 'LineString') {
    const coords = geom.coordinates as [number, number][];
    const [lon, lat] = coords[0];
    return { lat, lon, coordinates: coords };
  }

  if (geom.type === 'Polygon') {
    const outerRing = (geom.coordinates as [number, number][][])[0];
    const [lon, lat] = outerRing[0];
    return { lat, lon, coordinates: outerRing };
  }

  return null;
}

@Injectable({ providedIn: 'root' })
export class LocationService {
  constructor(private http: HttpClient) {}

  async getAll(): Promise<SavedLocation[]> {
    return firstValueFrom(this.http.get<SavedLocation[]>('/api/locations/'));
  }

  async saveFromFeature(feature: GeoJSON.Feature): Promise<SavedLocation> {
    const props = feature.properties || {};
    const extracted = extractCoords(feature);
    if (!extracted) {
      throw new Error('Cannot extract coordinates from feature');
    }

    const payload: LocationPayload = {
      name: props['label'] || '',
      latitude: extracted.lat,
      longitude: extracted.lon,
      altitude: props['altitude'] ?? null,
      description: props['description'] || '',
      category: props['category'] || '',
      geometry_type: geoJsonTypeToModel(feature.geometry?.type ?? ''),
      coordinates: extracted.coordinates,
    };

    return firstValueFrom(this.http.post<SavedLocation>('/api/locations/', payload));
  }
}

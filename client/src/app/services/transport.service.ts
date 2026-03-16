import { Injectable } from '@angular/core';
import type * as GeoJSON from 'geojson';

export interface HikeIsochroneProperties {
  value: number;
  group_index: number;
}

export interface HikeIsochroneResult {
  type: 'FeatureCollection';
  features: GeoJSON.Feature<GeoJSON.Polygon, HikeIsochroneProperties>[];
}

export interface HikeDirectionsSummary {
  distance: number;
  duration: number;
  ascent_m?: number;
  descent_m?: number;
  elevation_profile?: [number, number][];
}

export interface HikeDirectionsProperties {
  summary: HikeDirectionsSummary;
  way_points: number[];
}

export interface HikeDirectionsResult {
  type: 'FeatureCollection';
  features: GeoJSON.Feature<GeoJSON.LineString, HikeDirectionsProperties>[];
}

export interface ReachabilityStop {
  name: string;
  duration_min: number;
  bucket: 15 | 30 | 45 | 60;
  transfers: number;
  best_time?: string;
  modes?: string[];
  stop_id?: string | null;
  arrival?: string | null;
  track?: string | null;
  description?: string | null;
}

export interface ReachabilityResult {
  type: 'FeatureCollection';
  origin: { lat: number; lon: number };
  features: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[];
  query_datetime?: string;
}


export interface AppConfig {
  routingBackend: string;
}

@Injectable({ providedIn: 'root' })
export class TransportService {
  async getConfig(): Promise<AppConfig> {
    const resp = await fetch('/api/config/');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<AppConfig>;
  }

  async getReachability(
    lat: number,
    lon: number,
    maxTravelTime = 60,
    time?: string,
    optimal = false,
  ): Promise<ReachabilityResult> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      max_travel_time: String(maxTravelTime),
    });
    if (time) params.set('time', time);
    if (optimal) params.set('optimal', '1');

    const resp = await fetch(`/api/reachability/?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<ReachabilityResult>;
  }

  async getHikeDirections(coordinates: [number, number][]): Promise<HikeDirectionsResult> {
    const resp = await fetch('/api/hike-directions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<HikeDirectionsResult>;
  }

  async getHikeIsochrone(lat: number, lon: number): Promise<HikeIsochroneResult> {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    const resp = await fetch(`/api/hike-isochrone/?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<HikeIsochroneResult>;
  }

  async getLocationHikeIsochrone(
    mapUuid: string,
    locationId: number,
  ): Promise<HikeIsochroneResult> {
    const resp = await fetch(`/api/maps/${mapUuid}/locations/${locationId}/hike-isochrone/`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<HikeIsochroneResult>;
  }

  async getLocationReachability(
    mapUuid: string,
    locationId: number,
    time?: string,
    optimal = false,
  ): Promise<ReachabilityResult> {
    const params = new URLSearchParams();
    if (time) params.set('time', time);
    if (optimal) params.set('optimal', '1');
    const qs = params.toString();
    const url = `/api/maps/${mapUuid}/locations/${locationId}/reachability/${qs ? `?${qs}` : ''}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = (await resp.json()) as ReachabilityResult;
    if (result.query_datetime && result.features?.length) {
      const bestTime = result.query_datetime;
      result.features = result.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          best_time: f.properties.best_time ?? bestTime,
        },
      }));
    }
    return result;
  }

}

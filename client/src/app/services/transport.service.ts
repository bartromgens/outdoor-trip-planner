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
}

export interface ReachabilityResult {
  type: 'FeatureCollection';
  origin: { lat: number; lon: number };
  features: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[];
  query_datetime?: string;
}

const WINDOW_MINUTES = 90;
const INTERVAL_MINUTES = 10;
const NUM_SLOTS = WINDOW_MINUTES / INTERVAL_MINUTES;
const SLOT_INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function toIsoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

function bucket(durationMin: number): 15 | 30 | 45 | 60 {
  if (durationMin <= 15) return 15;
  if (durationMin <= 30) return 30;
  if (durationMin <= 45) return 45;
  return 60;
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
  ): Promise<ReachabilityResult> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      max_travel_time: String(maxTravelTime),
    });
    if (time) params.set('time', time);

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
  ): Promise<ReachabilityResult> {
    const params = new URLSearchParams();
    if (time) params.set('time', time);
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

  async getReachabilityOptimal(
    lat: number,
    lon: number,
    startTime: Date,
    maxTravelTime = 60,
  ): Promise<ReachabilityResult> {
    const times = Array.from({ length: NUM_SLOTS }, (_, i) =>
      toIsoUtc(new Date(startTime.getTime() + i * SLOT_INTERVAL_MS)),
    );

    const settled = await Promise.allSettled(
      times.map((t) => this.getReachability(lat, lon, maxTravelTime, t)),
    );

    const bestMap = new Map<string, GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>>();
    let origin = { lat, lon };

    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status !== 'fulfilled') continue;
      origin = r.value.origin;
      for (const feature of r.value.features) {
        const [fLon, fLat] = feature.geometry.coordinates as [number, number];
        const key = `${fLon},${fLat}`;
        const existing = bestMap.get(key);
        if (!existing || feature.properties.duration_min < existing.properties.duration_min) {
          const dMin = feature.properties.duration_min;
          bestMap.set(key, {
            ...feature,
            properties: {
              ...feature.properties,
              bucket: bucket(dMin),
              best_time: times[i],
            },
          });
        }
      }
    }

    return {
      type: 'FeatureCollection',
      origin,
      features: Array.from(bestMap.values()),
    };
  }
}

import { Injectable } from '@angular/core';
import type * as GeoJSON from 'geojson';

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
}

const SLOTS_PER_HOUR = 6;
const SLOT_INTERVAL_MS = (60 / SLOTS_PER_HOUR) * 60 * 1000;

function toIsoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

function bucket(durationMin: number): 15 | 30 | 45 | 60 {
  if (durationMin <= 15) return 15;
  if (durationMin <= 30) return 30;
  if (durationMin <= 45) return 45;
  return 60;
}

@Injectable({ providedIn: 'root' })
export class TransportService {
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

  async getReachabilityOptimal(
    lat: number,
    lon: number,
    startTime: Date,
    maxTravelTime = 60,
  ): Promise<ReachabilityResult> {
    const times = Array.from({ length: SLOTS_PER_HOUR }, (_, i) =>
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

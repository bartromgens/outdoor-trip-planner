import { Injectable } from '@angular/core';
import type * as GeoJSON from 'geojson';

export interface ReachabilityStop {
  name: string;
  duration_min: number;
  bucket: 15 | 30 | 45 | 60;
  transfers: number;
}

export interface ReachabilityResult {
  type: 'FeatureCollection';
  origin: { lat: number; lon: number };
  features: GeoJSON.Feature<GeoJSON.Point, ReachabilityStop>[];
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
}

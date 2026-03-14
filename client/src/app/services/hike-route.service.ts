import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface SavedHikeRoute {
  id: number;
  name: string;
  waypoints: [number, number][];
  geometry: [number, number][];
  distance_m: number | null;
  duration_s: number | null;
  created_at: string;
  updated_at: string;
}

interface HikeRoutePayload {
  name: string;
  waypoints: [number, number][];
  geometry: [number, number][];
  distance_m: number | null;
  duration_s: number | null;
}

@Injectable({ providedIn: 'root' })
export class HikeRouteService {
  constructor(private http: HttpClient) {}

  getAll(): Promise<SavedHikeRoute[]> {
    return firstValueFrom(this.http.get<SavedHikeRoute[]>('/api/hike-routes/'));
  }

  create(payload: HikeRoutePayload): Promise<SavedHikeRoute> {
    return firstValueFrom(this.http.post<SavedHikeRoute>('/api/hike-routes/', payload));
  }

  update(id: number, payload: Partial<HikeRoutePayload>): Promise<SavedHikeRoute> {
    return firstValueFrom(this.http.put<SavedHikeRoute>(`/api/hike-routes/${id}/`, payload));
  }

  delete(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/hike-routes/${id}/`));
  }
}

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
  ascent_m: number | null;
  descent_m: number | null;
  elevation_profile: [number, number][] | null;
  color: string;
  created_at: string;
  updated_at: string;
}

interface HikeRoutePayload {
  name: string;
  waypoints: [number, number][];
  geometry: [number, number][];
  distance_m: number | null;
  duration_s: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  elevation_profile: [number, number][] | null;
  color: string;
}

@Injectable({ providedIn: 'root' })
export class HikeRouteService {
  constructor(private http: HttpClient) {}

  getAll(mapUuid: string): Promise<SavedHikeRoute[]> {
    return firstValueFrom(this.http.get<SavedHikeRoute[]>(`/api/maps/${mapUuid}/hike-routes/`));
  }

  create(mapUuid: string, payload: HikeRoutePayload): Promise<SavedHikeRoute> {
    return firstValueFrom(
      this.http.post<SavedHikeRoute>(`/api/maps/${mapUuid}/hike-routes/`, payload),
    );
  }

  update(mapUuid: string, id: number, payload: Partial<HikeRoutePayload>): Promise<SavedHikeRoute> {
    return firstValueFrom(
      this.http.put<SavedHikeRoute>(`/api/maps/${mapUuid}/hike-routes/${id}/`, payload),
    );
  }

  delete(mapUuid: string, id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/maps/${mapUuid}/hike-routes/${id}/`));
  }
}

import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

interface GeocodeApiResponse {
  results: GeocodeResult[];
}

@Injectable({ providedIn: 'root' })
export class LocationSearchService {
  private http = inject(HttpClient);

  private pendingResult = signal<GeocodeResult | null>(null);
  readonly resultToShow = this.pendingResult.asReadonly();

  search(query: string) {
    const q = query.trim();
    if (!q) return this.http.get<GeocodeApiResponse>('/api/geocode/', { params: { q: '' } });
    return this.http.get<GeocodeApiResponse>('/api/geocode/', { params: { q } });
  }

  setResultToShow(result: GeocodeResult): void {
    this.pendingResult.set(result);
  }

  clearResultToShow(): void {
    this.pendingResult.set(null);
  }
}

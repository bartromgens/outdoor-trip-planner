import { Injectable, inject } from '@angular/core';
import { TripDateTimeService } from './trip-datetime.service';

export interface UrlMapParams {
  lat?: number;
  lng?: number;
  z?: number;
  base?: string;
  overlays?: string[];
}

@Injectable({ providedIn: 'root' })
export class MapUrlService {
  private tripDateTime = inject(TripDateTimeService);

  read(): UrlMapParams {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('lat');
    const lng = params.get('lng');
    const z = params.get('z');
    return {
      lat: lat !== null ? Number(lat) : undefined,
      lng: lng !== null ? Number(lng) : undefined,
      z: z !== null ? Number(z) : undefined,
      base: params.get('base') ?? undefined,
      overlays: params.has('overlays')
        ? params.get('overlays')!.split(',').filter(Boolean)
        : undefined,
    };
  }

  write(
    lat: number,
    lng: number,
    zoom: number,
    baseName: string,
    overlayNames: Set<string>,
  ): void {
    const params = new URLSearchParams();
    params.set('lat', lat.toFixed(4));
    params.set('lng', lng.toFixed(4));
    params.set('z', String(zoom));
    params.set('base', baseName);
    if (overlayNames.size) {
      params.set('overlays', [...overlayNames].sort().join(','));
    }
    const departure = this.tripDateTime.inputValue();
    if (departure) {
      params.set('departure', departure);
    }
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }
}

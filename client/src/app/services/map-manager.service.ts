import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface MapEntry {
  uuid: string;
  name: string;
  createdAt: string;
}

interface MapApiResponse {
  uuid: string;
  name: string;
  created_at: string;
}

const STORAGE_KEY = 'otp_maps';

@Injectable({ providedIn: 'root' })
export class MapManagerService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private mapsSignal = signal<MapEntry[]>(this.loadFromStorage());
  readonly myMaps = this.mapsSignal.asReadonly();

  private loadFromStorage(): MapEntry[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  private saveToStorage(maps: MapEntry[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  }

  async createMap(options: { name?: string; uuid?: string } = {}): Promise<string> {
    const body: Record<string, string> = { name: options.name ?? 'My Trip' };
    if (options.uuid) {
      body['uuid'] = options.uuid;
    }
    const response = await firstValueFrom(this.http.post<MapApiResponse>('/api/maps/', body));
    const entry: MapEntry = {
      uuid: response.uuid,
      name: response.name,
      createdAt: new Date().toISOString(),
    };
    const updated = [entry, ...this.mapsSignal()];
    this.mapsSignal.set(updated);
    this.saveToStorage(updated);
    return response.uuid;
  }

  async fetchMap(uuid: string): Promise<MapApiResponse | null> {
    try {
      return await firstValueFrom(this.http.get<MapApiResponse>(`/api/maps/${uuid}/`));
    } catch {
      return null;
    }
  }

  addToMyMaps(uuid: string, name: string): void {
    if (this.isMyMap(uuid)) return;
    const entry: MapEntry = { uuid, name, createdAt: new Date().toISOString() };
    const updated = [entry, ...this.mapsSignal()];
    this.mapsSignal.set(updated);
    this.saveToStorage(updated);
  }

  updateLocalName(uuid: string, name: string): void {
    const updated = this.mapsSignal().map((m) => (m.uuid === uuid ? { ...m, name } : m));
    this.mapsSignal.set(updated);
    this.saveToStorage(updated);
  }

  async renameMap(uuid: string, name: string): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/maps/${uuid}/`, { name }));
    this.updateLocalName(uuid, name);
  }

  isMyMap(uuid: string): boolean {
    return this.mapsSignal().some((m) => m.uuid === uuid);
  }

  getMapName(uuid: string): string {
    return this.mapsSignal().find((m) => m.uuid === uuid)?.name ?? 'Shared Map';
  }

  async navigateToNewMap(): Promise<void> {
    const uuid = await this.createMap();
    await this.router.navigate(['/map', uuid]);
  }
}

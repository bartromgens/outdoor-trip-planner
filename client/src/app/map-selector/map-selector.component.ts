import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MapManagerService } from '../services/map-manager.service';

@Component({
  selector: 'app-map-selector',
  templateUrl: './map-selector.component.html',
  styleUrl: './map-selector.component.scss',
  imports: [MatButtonModule, MatMenuModule, FormsModule],
})
export class MapSelectorComponent {
  private mapManager = inject(MapManagerService);
  private router = inject(Router);

  readonly myMaps = computed(() => this.mapManager.myMaps());
  readonly currentMapUuid = computed(() => this.mapManager.currentMapUuid());
  readonly currentMapName = computed(() =>
    this.mapManager.getMapName(this.mapManager.currentMapUuid()),
  );

  editingMapName = false;
  mapNameInput = '';
  creatingNewMap = false;
  newMapNameInput = '';

  startEditMapName(): void {
    this.mapNameInput = this.currentMapName();
    this.editingMapName = true;
  }

  async saveMapName(): Promise<void> {
    const trimmed = this.mapNameInput.trim();
    if (trimmed && trimmed !== this.currentMapName()) {
      await this.mapManager.renameMap(this.currentMapUuid(), trimmed);
    }
    this.editingMapName = false;
  }

  cancelEditMapName(): void {
    this.editingMapName = false;
  }

  switchToMap(uuid: string): void {
    this.router.navigate(['/map', uuid]);
  }

  startCreatingNewMap(): void {
    this.newMapNameInput = '';
    this.creatingNewMap = true;
  }

  cancelCreatingNewMap(): void {
    this.creatingNewMap = false;
  }

  async confirmCreateNewMap(): Promise<void> {
    const name = this.newMapNameInput.trim() || 'My Trip';
    this.creatingNewMap = false;
    const uuid = await this.mapManager.createMap({ name });
    this.router.navigate(['/map', uuid]);
  }

  copyShareLink(): void {
    navigator.clipboard.writeText(window.location.href).catch(() => {
      prompt('Copy this link to share the map:', window.location.href);
    });
  }
}

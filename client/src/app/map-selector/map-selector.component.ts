import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MapManagerService } from '../services/map-manager.service';
import {
  MapNameDialogComponent,
  MapNameDialogData,
  MapNameDialogResult,
} from './map-name-dialog.component';

@Component({
  selector: 'app-map-selector',
  templateUrl: './map-selector.component.html',
  styleUrl: './map-selector.component.scss',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
  ],
})
export class MapSelectorComponent {
  private mapManager = inject(MapManagerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly myMaps = computed(() => this.mapManager.myMaps());
  readonly currentMapUuid = computed(() => this.mapManager.currentMapUuid());
  readonly currentMapName = computed(() =>
    this.mapManager.getMapName(this.mapManager.currentMapUuid()),
  );

  switchToMap(uuid: string): void {
    this.router.navigate(['/map', uuid]);
  }

  openNewMapDialog(): void {
    const data: MapNameDialogData = { title: 'New map', value: '' };
    this.dialog
      .open<MapNameDialogComponent, MapNameDialogData, MapNameDialogResult>(
        MapNameDialogComponent,
        { data, width: '340px' },
      )
      .afterClosed()
      .subscribe((result) => {
        if (result) {
          this.createMapAndNavigate(result.name);
        }
      });
  }

  openRenameDialog(): void {
    const data: MapNameDialogData = {
      title: 'Rename map',
      value: this.currentMapName(),
    };
    this.dialog
      .open<MapNameDialogComponent, MapNameDialogData, MapNameDialogResult>(
        MapNameDialogComponent,
        { data, width: '340px' },
      )
      .afterClosed()
      .subscribe((result) => {
        if (result && result.name.trim() !== this.currentMapName()) {
          this.mapManager.renameMap(this.currentMapUuid(), result.name.trim());
        }
      });
  }

  private async createMapAndNavigate(name: string): Promise<void> {
    const trimmed = name.trim() || 'My Trip';
    const uuid = await this.mapManager.createMap({ name: trimmed });
    this.router.navigate(['/map', uuid]);
  }

  copyShareLink(): void {
    navigator.clipboard.writeText(window.location.href).catch(() => {
      prompt('Copy this link to share the map:', window.location.href);
    });
  }
}

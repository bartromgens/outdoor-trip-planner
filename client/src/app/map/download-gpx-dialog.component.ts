import { Component, inject, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { HikeRouteService, type SavedHikeRoute } from '../services/hike-route.service';
import { routesToGpx, downloadGpx } from './gpx';

export interface DownloadGpxDialogData {
  mapUuid: string;
}

@Component({
  selector: 'app-download-gpx-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Download hike routes as GPX</h2>
    <mat-dialog-content>
      @if (loading()) {
        <p>Loading routes…</p>
      } @else if (routes().length === 0) {
        <p>No saved hike routes on this map.</p>
      } @else {
        <div class="route-list">
          <label class="select-all">
            <mat-checkbox [checked]="allSelected()" (change)="toggleAll($event.checked)">
              Select all
            </mat-checkbox>
          </label>
          @for (route of routes(); track route.id) {
            <label class="route-item">
              <mat-checkbox [checked]="isSelected(route.id)" (change)="toggleRoute(route.id, $event.checked)">
                {{ route.name }}
                @if (route.distance_m != null) {
                  <span class="route-meta"> ({{ (route.distance_m / 1000).toFixed(1) }} km)</span>
                }
              </mat-checkbox>
            </label>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      @if (routes().length > 0) {
        <button
          mat-raised-button
          color="primary"
          [disabled]="selectedIds().size === 0"
          (click)="download()"
        >
          Download selected
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [
    `
      .route-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 320px;
        max-height: 60vh;
        overflow-y: auto;
      }
      .select-all {
        margin-bottom: 4px;
      }
      .route-item {
        display: block;
      }
      .route-meta {
        color: var(--mat-secondary-text-color, #666);
        font-size: 0.9em;
      }
    `,
  ],
})
export class DownloadGpxDialogComponent implements OnInit {
  private readonly data = inject<DownloadGpxDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<DownloadGpxDialogComponent>);
  private readonly hikeRouteService = inject(HikeRouteService);

  readonly routes = signal<SavedHikeRoute[]>([]);
  readonly loading = signal(true);
  readonly selectedIds = signal<Set<number>>(new Set());

  allSelected(): boolean {
    const routes = this.routes();
    if (routes.length === 0) return false;
    return routes.every((r) => this.selectedIds().has(r.id));
  }

  ngOnInit(): void {
    this.hikeRouteService.getAll(this.data.mapUuid).then((list) => {
      this.routes.set(list);
      this.selectedIds.set(new Set(list.map((r) => r.id)));
      this.loading.set(false);
    });
  }

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  toggleRoute(id: number, checked: boolean): void {
    const next = new Set(this.selectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedIds.set(next);
  }

  toggleAll(checked: boolean): void {
    if (checked) {
      this.selectedIds.set(new Set(this.routes().map((r) => r.id)));
    } else {
      this.selectedIds.set(new Set());
    }
  }

  download(): void {
    const ids = this.selectedIds();
    const toExport = this.routes().filter((r) => ids.has(r.id));
    if (toExport.length === 0) return;
    const gpx = routesToGpx(toExport);
    const name = toExport.length === 1 ? toExport[0].name : 'hike-routes';
    const filename = name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'hike-routes';
    downloadGpx(gpx, `${filename}.gpx`);
    this.dialogRef.close();
  }
}

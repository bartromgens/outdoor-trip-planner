import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type * as L from 'leaflet';

@Component({
  selector: 'app-map-controls',
  templateUrl: './map-controls.component.html',
  styleUrl: './map-controls.component.scss',
  imports: [MatButtonModule],
})
export class MapControlsComponent {
  addingLocation = input<boolean>(false);
  hikePlanningActive = input<boolean>(false);
  hasHikingRanges = input<boolean>(false);
  hikeRouteLayer = input<L.GeoJSON | undefined>(undefined);
  editingRouteId = input<number | null>(null);
  hikeLoading = input<boolean>(false);

  addLocationToggle = output<void>();
  hikePlanningToggle = output<void>();
  clearHikingRanges = output<void>();
  clearHikeRoute = output<void>();
  saveHikeRoute = output<void>();
  updateHikeRoute = output<void>();
}

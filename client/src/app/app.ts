import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ChatComponent } from './chat/chat.component';
import { DepartureDatetimePickerComponent } from './departure-datetime-picker/departure-datetime-picker.component';
import { MapSelectorComponent } from './map-selector/map-selector.component';
import { LocationSearchComponent } from './location-search/location-search.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    MatToolbarModule,
    MatSidenavModule,
    LocationSearchComponent,
    ChatComponent,
    DepartureDatetimePickerComponent,
    MapSelectorComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('Outdoor Trip Planner');
}

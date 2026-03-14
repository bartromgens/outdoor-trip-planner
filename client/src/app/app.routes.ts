import { Routes } from '@angular/router';
import { MapComponent } from './map/map.component';
import { MapRedirectComponent } from './map/map-redirect.component';

export const routes: Routes = [
  { path: '', redirectTo: 'map', pathMatch: 'full' },
  { path: 'map', component: MapRedirectComponent },
  { path: 'map/:uuid', component: MapComponent },
  { path: '**', redirectTo: 'map' },
];

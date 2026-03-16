import {
  Component,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { ChatComponent } from './chat/chat.component';
import { MapSelectorComponent } from './map-selector/map-selector.component';
import { LocationSearchComponent } from './location-search/location-search.component';
import { DepartureDatetimePickerComponent } from './departure-datetime-picker/departure-datetime-picker.component';

const MOBILE_BREAKPOINT = '(max-width: 768px)';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    MatSidenavModule,
    MatIconModule,
    ChatComponent,
    MapSelectorComponent,
    LocationSearchComponent,
    DepartureDatetimePickerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly title = signal('Outdoor Trip Planner');
  private readonly sidenav = viewChild(MatSidenav);
  private readonly breakpointObserver = inject(BreakpointObserver);

  protected readonly isMobile = signal(false);
  protected readonly sidenavMode = signal<'over' | 'side'>('side');
  protected readonly sidenavOpened = signal(true);

  ngOnInit(): void {
    this.breakpointObserver.observe(MOBILE_BREAKPOINT).subscribe((state) => {
      const mobile = state.matches;
      this.isMobile.set(mobile);
      this.sidenavMode.set(mobile ? 'over' : 'side');
      this.sidenavOpened.set(!mobile);
    });
  }

  protected toggleSidebar(): void {
    this.sidenav()?.toggle();
  }
}

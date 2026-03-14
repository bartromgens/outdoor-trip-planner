import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

const STORAGE_KEY = 'otp_maps';

@Component({
  selector: 'app-map-redirect',
  template: '<p class="map-redirect">Loading map…</p>',
  styles: [
    `
      .map-redirect {
        padding: 1rem;
        margin: 0;
        font-size: 14px;
        color: #666;
      }
    `,
  ],
  standalone: true,
})
export class MapRedirectComponent implements OnInit {
  private router = inject(Router);

  ngOnInit(): void {
    let target: string;
    try {
      const maps: { uuid: string }[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      target = maps.length > 0 ? `/map/${maps[0].uuid}` : '/map/new';
    } catch {
      target = '/map/new';
    }
    this.router.navigateByUrl(target, { replaceUrl: true });
  }
}

import { Component, inject, NgZone, ChangeDetectorRef, signal } from '@angular/core';
import * as L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { TransportService, type GondolaStop } from '../services/transport.service';
import { TripDateTimeService } from '../services/trip-datetime.service';

const GONDOLA_MARKER_GREY = '#757575';
const GONDOLA_MARKER_DARK_GREEN = '#1b5e20';
const GONDOLA_MARKER_LIGHT_GREEN = '#81c784';
const GONDOLA_MARKER_RED = '#c62828';

function gondolaMarkerBackground(props: GondolaStop): string {
  if (props.timetable_available === false) {
    return GONDOLA_MARKER_GREY;
  }
  const cal = props.day_calendar ?? [];
  if (cal.length > 0) {
    const openCount = cal.filter((d) => d.open).length;
    if (openCount === 0) {
      return GONDOLA_MARKER_RED;
    }
    if (openCount === cal.length) {
      return GONDOLA_MARKER_DARK_GREEN;
    }
    return GONDOLA_MARKER_LIGHT_GREEN;
  }
  const od = props.open_dates ?? [];
  if (od.length >= 7) {
    return GONDOLA_MARKER_DARK_GREEN;
  }
  if (od.length > 0) {
    return GONDOLA_MARKER_LIGHT_GREEN;
  }
  return GONDOLA_MARKER_RED;
}

function gondolaIconForStop(props: GondolaStop): L.DivIcon {
  const bg = gondolaMarkerBackground(props);
  return L.divIcon({
    className: 'gondola-schedule-marker',
    html: `<div style="
      display:flex;
      align-items:center;
      justify-content:center;
      width:24px;
      height:24px;
      border-radius:50%;
      background:${bg};
      border:2px solid rgba(255,255,255,0.85);
      box-shadow:0 1px 4px rgba(0,0,0,.45);
    "><span style="font-family:'Material Icons';font-size:14px;color:white;line-height:1;">terrain</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildCalendarTable(
  days: { date_label: string; weekday: string; open: boolean }[],
): string {
  const cell =
    'padding:3px 5px;text-align:center;border:1px solid rgba(0,0,0,.12);vertical-align:middle';
  const dateRow = days
    .map(
      (d) =>
        `<td style="${cell};font-size:10px;font-weight:600;white-space:nowrap">${escapeHtml(d.date_label)}</td>`,
    )
    .join('');
  const wdRow = days
    .map((d) => `<td style="${cell};font-size:10px;opacity:.85">${escapeHtml(d.weekday)}</td>`)
    .join('');
  const iconRow = days
    .map((d) => {
      const icon = d.open ? 'check_circle' : 'cancel';
      const color = d.open ? '#2e7d32' : '#c62828';
      return `<td style="${cell}"><span class="material-icons" style="font-size:18px;color:${color};line-height:1" title="${d.open ? 'Open' : 'Closed'}">${icon}</span></td>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;margin-top:8px;max-width:100%;table-layout:fixed"><tbody><tr>${dateRow}</tr><tr>${wdRow}</tr><tr>${iconRow}</tr></tbody></table>`;
}

function buildPopupContent(props: GondolaStop): string {
  const title = `<b>${escapeHtml(props.name)}</b>`;
  const timetableOk = props.timetable_available !== false;
  const days = props.day_calendar ?? [];

  if (days.length > 0 && timetableOk) {
    return `${title}${buildCalendarTable(days)}`;
  }

  if (!timetableOk) {
    return `${title}<br><span style="font-size:12px;opacity:.9">No timetable available for this stop in the routing data.</span>`;
  }
  const rows: string[] = [];
  if (props.schedule_summary) {
    rows.push(`<span style="font-size:12px">${escapeHtml(props.schedule_summary)}</span>`);
  }
  if (props.weekday_label) {
    rows.push(
      `<span style="font-size:12px"><b>Open weekdays:</b> ${escapeHtml(props.weekday_label)}</span>`,
    );
  }
  const detail = rows.length ? `<br>${rows.join('<br>')}` : '';
  return `${title}${detail}`;
}

@Component({
  selector: 'app-gondola-schedule',
  templateUrl: './gondola-schedule.component.html',
  styleUrl: './gondola-schedule.component.scss',
})
export class GondolaScheduleComponent {
  private transportService = inject(TransportService);
  private tripDateTime = inject(TripDateTimeService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private map!: L.Map;
  private layerControl!: L.Control.Layers;
  private gondolaLayer?: L.LayerGroup;

  readonly loading = signal(false);
  readonly error = signal(false);

  init(map: L.Map, layerControl: L.Control.Layers): void {
    this.map = map;
    this.layerControl = layerControl;
  }

  async loadGondolaSchedule(lat: number, lng: number): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    this.cdr.detectChanges();

    try {
      const dep = this.tripDateTime.departureTime();
      const departureDate = dep
        ? `${dep.getFullYear()}-${String(dep.getMonth() + 1).padStart(2, '0')}-${String(dep.getDate()).padStart(2, '0')}`
        : new Date().toISOString().slice(0, 10);
      const result = await this.transportService.getGondolaSchedule(lat, lng, departureDate);
      this.ngZone.run(() => this.renderLayer(result.features));
    } catch {
      console.error('Failed to load gondola schedule');
      this.ngZone.run(() => this.error.set(true));
    } finally {
      this.ngZone.run(() => {
        this.loading.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  private renderLayer(features: GeoJSON.Feature<GeoJSON.Point, GondolaStop>[]): void {
    if (this.gondolaLayer) {
      this.layerControl.removeLayer(this.gondolaLayer);
      this.map.removeLayer(this.gondolaLayer);
    }

    const markers = features.map((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      return L.marker([lat, lon], { icon: gondolaIconForStop(f.properties) }).bindPopup(
        buildPopupContent(f.properties),
        { minWidth: 260, maxWidth: 360, className: 'gondola-schedule-popup' },
      );
    });

    this.gondolaLayer = L.layerGroup(markers);
    this.layerControl.addOverlay(this.gondolaLayer, 'Gondola schedule');
    this.gondolaLayer.addTo(this.map);
  }
}

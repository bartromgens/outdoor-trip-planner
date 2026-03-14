import type * as GeoJSON from 'geojson';
import type { LocationService } from '../services/location.service';

export const POPUP_SAVE_BTN_CLASS = 'popup-save-btn';

export function buildSaveLocationPopupContent(
  label: string,
  category?: string,
  description?: string,
): string {
  const parts = [`<b>${escapeHtml(label)}</b>`];
  if (category) {
    parts.push(`<span style="opacity:.6;font-size:12px">${escapeHtml(category)}</span>`);
  }
  if (description) {
    parts.push(`<div style="margin-top:4px">${escapeHtml(description)}</div>`);
  }
  parts.push(
    `<div style="margin-top:8px"><button class="${POPUP_SAVE_BTN_CLASS}" type="button">Save location</button></div>`,
  );
  return parts.join('<br>');
}

export function handleSaveLocationClick(
  mapUuid: string,
  feature: GeoJSON.Feature,
  btn: HTMLButtonElement,
  locationService: LocationService,
  onSaved?: () => void,
): void {
  btn.disabled = true;
  btn.textContent = 'Saving…';
  locationService
    .saveFromFeature(mapUuid, feature)
    .then(() => {
      btn.textContent = 'Saved';
      btn.classList.add('popup-save-btn--saved');
      onSaved?.();
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = 'Save failed – retry';
    });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

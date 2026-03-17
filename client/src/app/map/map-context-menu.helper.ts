import * as L from 'leaflet';

export interface ContextMenuActions {
  onAddLocation: () => void;
  onPlanHike: () => void;
  onTransitRange: () => void;
  onHikeRanges: () => void;
  onGondolaSchedule: () => void;
}

export function buildContextMenuContent(): string {
  return `<div class="map-ctx-menu">
    <button class="map-ctx-menu__item" data-action="add-location">
      <span class="map-ctx-menu__icon material-icons">add_location_alt</span>Add location
    </button>
    <button class="map-ctx-menu__item" data-action="plan-hike">
      <span class="map-ctx-menu__icon material-icons">route</span>Plan hike
    </button>
    <button class="map-ctx-menu__item" data-action="transit-range">
      <span class="map-ctx-menu__icon material-icons">directions_transit</span>Show transit range
    </button>
    <button class="map-ctx-menu__item" data-action="hike-ranges">
      <span class="map-ctx-menu__icon material-icons">hiking</span>Show hike ranges
    </button>
    <button class="map-ctx-menu__item" data-action="gondola-schedule">
      <span class="map-ctx-menu__icon material-icons">terrain</span>Gondola schedule
    </button>
  </div>`;
}

export function setupContextMenuHandlers(
  popup: L.Popup,
  map: L.Map,
  actions: ContextMenuActions,
): void {
  setTimeout(() => {
    const el = popup.getElement();
    if (!el) return;

    el.querySelector('[data-action="add-location"]')?.addEventListener('click', () => {
      map.closePopup();
      actions.onAddLocation();
    });
    el.querySelector('[data-action="plan-hike"]')?.addEventListener('click', () => {
      map.closePopup();
      actions.onPlanHike();
    });
    el.querySelector('[data-action="transit-range"]')?.addEventListener('click', () => {
      map.closePopup();
      actions.onTransitRange();
    });
    el.querySelector('[data-action="hike-ranges"]')?.addEventListener('click', () => {
      map.closePopup();
      actions.onHikeRanges();
    });
    el.querySelector('[data-action="gondola-schedule"]')?.addEventListener('click', () => {
      map.closePopup();
      actions.onGondolaSchedule();
    });
  }, 0);
}

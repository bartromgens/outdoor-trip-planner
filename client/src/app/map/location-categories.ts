export interface LocationCategory {
  value: string;
  label: string;
  color: string;
  /** Material Icons name for this category. */
  icon: string;
  /** When true, transit reachability and hike isochrones can be loaded for this category. */
  showReachabilityIsochrones: boolean;
}

export const LOCATION_CATEGORIES: LocationCategory[] = [
  { value: '', label: '— none —', color: '#1976d2', icon: 'place', showReachabilityIsochrones: true },
  { value: 'apartment', label: 'Apartment', color: '#ec407a', icon: 'hotel', showReachabilityIsochrones: true },
  { value: 'bus-stop', label: 'Bus Stop', color: '#1565c0', icon: 'directions_bus', showReachabilityIsochrones: true },
  { value: 'campsite', label: 'Campsite', color: '#33691e', icon: 'camping', showReachabilityIsochrones: false },
  { value: 'hut', label: 'Hut', color: '#bf360c', icon: 'cabin', showReachabilityIsochrones: false },
  { value: 'parking', label: 'Parking', color: '#37474f', icon: 'local_parking', showReachabilityIsochrones: false },
  { value: 'peak', label: 'Peak', color: '#4a148c', icon: 'terrain', showReachabilityIsochrones: false },
  { value: 'supermarket', label: 'Supermarket', color: '#f9a825', icon: 'store', showReachabilityIsochrones: false },
  { value: 'train-station', label: 'Train Station', color: '#0d47a1', icon: 'train', showReachabilityIsochrones: true },
  { value: 'trail', label: 'Trail', color: '#e65100', icon: 'hiking', showReachabilityIsochrones: false },
  { value: 'village', label: 'Village', color: '#1976d2', icon: 'location_city', showReachabilityIsochrones: true },
  { value: 'viewpoint', label: 'Viewpoint', color: '#f57f17', icon: 'visibility', showReachabilityIsochrones: false },
  { value: 'water', label: 'Water', color: '#01579b', icon: 'water_drop', showReachabilityIsochrones: false },
];

export function showReachabilityIsochronesForCategory(category: string): boolean {
  const c = LOCATION_CATEGORIES.find((cat) => cat.value === category);
  return c?.showReachabilityIsochrones ?? false;
}

const COLOR_BY_VALUE = new Map(
  LOCATION_CATEGORIES.filter((c) => c.value !== '').map((c) => [c.value, c.color]),
);

const ICON_BY_VALUE = new Map(
  LOCATION_CATEGORIES.map((c) => [c.value, c.icon]),
);

const DEFAULT_COLOR = LOCATION_CATEGORIES[0].color;
const DEFAULT_ICON = LOCATION_CATEGORIES[0].icon;

export function colorForCategory(category?: string): string {
  return (category && COLOR_BY_VALUE.get(category)) || DEFAULT_COLOR;
}

export function iconForCategory(category?: string): string {
  return ICON_BY_VALUE.get(category ?? '') ?? DEFAULT_ICON;
}

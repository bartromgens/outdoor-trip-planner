export interface LocationCategory {
  value: string;
  label: string;
  color: string;
  /** When true, transit reachability and hike isochrones can be loaded for this category. */
  showReachabilityIsochrones: boolean;
}

export const LOCATION_CATEGORIES: LocationCategory[] = [
  { value: '', label: '— none —', color: '#1976d2', showReachabilityIsochrones: false },
  { value: 'apartment', label: 'Apartment', color: '#ec407a', showReachabilityIsochrones: true },
  { value: 'bus-stop', label: 'Bus Stop', color: '#1565c0', showReachabilityIsochrones: true },
  { value: 'campsite', label: 'Campsite', color: '#33691e', showReachabilityIsochrones: false },
  { value: 'hut', label: 'Hut', color: '#bf360c', showReachabilityIsochrones: false },
  { value: 'parking', label: 'Parking', color: '#37474f', showReachabilityIsochrones: false },
  { value: 'peak', label: 'Peak', color: '#4a148c', showReachabilityIsochrones: false },
  { value: 'supermarket', label: 'Supermarket', color: '#f9a825', showReachabilityIsochrones: false },
  { value: 'train-station', label: 'Train Station', color: '#0d47a1', showReachabilityIsochrones: true },
  { value: 'trail', label: 'Trail', color: '#e65100', showReachabilityIsochrones: false },
  { value: 'village', label: 'Village', color: '#1976d2', showReachabilityIsochrones: true },
  { value: 'viewpoint', label: 'Viewpoint', color: '#f57f17', showReachabilityIsochrones: false },
  { value: 'water', label: 'Water', color: '#01579b', showReachabilityIsochrones: false },
];

export function showReachabilityIsochronesForCategory(category: string): boolean {
  const c = LOCATION_CATEGORIES.find((cat) => cat.value === category);
  return c?.showReachabilityIsochrones ?? false;
}

const COLOR_BY_VALUE = new Map(
  LOCATION_CATEGORIES.filter((c) => c.value !== '').map((c) => [c.value, c.color]),
);

const DEFAULT_COLOR = LOCATION_CATEGORIES[0].color;

export function colorForCategory(category?: string): string {
  return (category && COLOR_BY_VALUE.get(category)) || DEFAULT_COLOR;
}

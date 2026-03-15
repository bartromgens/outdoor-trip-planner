export interface LocationCategory {
  value: string;
  label: string;
  color: string;
}

export const LOCATION_CATEGORIES: LocationCategory[] = [
  { value: '', label: '— none —', color: '#1976d2' },
  { value: 'apartment', label: 'Apartment', color: '#ec407a' },
  { value: 'bus-stop', label: 'Bus Stop', color: '#1565c0' },
  { value: 'campsite', label: 'Campsite', color: '#33691e' },
  { value: 'hut', label: 'Hut', color: '#bf360c' },
  { value: 'parking', label: 'Parking', color: '#37474f' },
  { value: 'peak', label: 'Peak', color: '#4a148c' },
  { value: 'supermarket', label: 'Supermarket', color: '#f9a825' },
  { value: 'train-station', label: 'Train Station', color: '#0d47a1' },
  { value: 'trail', label: 'Trail', color: '#e65100' },
  { value: 'village', label: 'Village', color: '#1976d2' },
  { value: 'viewpoint', label: 'Viewpoint', color: '#f57f17' },
  { value: 'water', label: 'Water', color: '#01579b' },
];

const COLOR_BY_VALUE = new Map(
  LOCATION_CATEGORIES.filter((c) => c.value !== '').map((c) => [c.value, c.color]),
);

const DEFAULT_COLOR = LOCATION_CATEGORIES[0].color;

export function colorForCategory(category?: string): string {
  return (category && COLOR_BY_VALUE.get(category)) || DEFAULT_COLOR;
}

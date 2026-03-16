import type { SavedHikeRoute } from '../services/hike-route.service';

function haversineDistanceM(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function interpolateElevation(
  distM: number,
  profile: [number, number][],
): number | null {
  if (!profile.length) return null;
  if (distM <= profile[0][0]) return profile[0][1];
  if (distM >= profile[profile.length - 1][0]) return profile[profile.length - 1][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [d0, e0] = profile[i];
    const [d1, e1] = profile[i + 1];
    if (distM >= d0 && distM <= d1) {
      const t = (distM - d0) / (d1 - d0);
      return e0 + t * (e1 - e0);
    }
  }
  return null;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function routeToTrk(route: SavedHikeRoute): string {
  const coords = route.geometry;
  if (!coords?.length) return '';

  const profile = route.elevation_profile ?? [];
  let cumDistM = 0;
  const points: { lat: number; lon: number; ele: number | null }[] = [];

  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const ele = profile.length ? interpolateElevation(cumDistM, profile) : null;
    points.push({ lat, lon, ele });
    if (i < coords.length - 1) {
      const [nextLon, nextLat] = coords[i + 1];
      cumDistM += haversineDistanceM(lon, lat, nextLon, nextLat);
    }
  }

  const trkpts = points
    .map(
      (p) =>
        `    <trkpt lat="${p.lat}" lon="${p.lon}">` +
        (p.ele != null ? `\n      <ele>${Math.round(p.ele)}</ele>` : '') +
        '\n    </trkpt>',
    )
    .join('\n');

  const name = escapeXml(route.name);
  return `  <trk>\n    <name>${name}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>`;
}

export function routesToGpx(routes: SavedHikeRoute[]): string {
  const trks = routes.map(routeToTrk).filter(Boolean);
  const body = trks.join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Outdoor Trip Planner" xmlns="http://www.topografix.com/GPX/1/1">
${body}
</gpx>`;
}

export function downloadGpx(gpxXml: string, filename: string): void {
  const blob = new Blob([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.gpx') ? filename : `${filename}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

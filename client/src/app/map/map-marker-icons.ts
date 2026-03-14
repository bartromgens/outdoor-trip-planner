import * as L from 'leaflet';

const DEFAULT_SHADOW = '0 1px 4px rgba(0,0,0,.45)';

export interface CircleMarkerIconOptions {
  color: string;
  size?: number;
  shadow?: string;
  border?: string;
  popupAnchor?: [number, number];
  extraStyle?: string;
  className?: string;
}

export function circleMarkerIcon(options: CircleMarkerIconOptions): L.DivIcon {
  const size = options.size ?? 14;
  const shadow = options.shadow ?? DEFAULT_SHADOW;
  const border = options.border ?? '2px solid rgba(255,255,255,0.9)';
  const iconSize = size + 4;
  const iconAnchor = Math.round(iconSize / 2);
  const extra = options.extraStyle ? `;${options.extraStyle}` : '';
  return L.divIcon({
    className: options.className ?? 'map-marker',
    html: `<div style="
      background:${options.color};
      width:${size}px;height:${size}px;
      border-radius:50%;
      border:${border};
      box-shadow:${shadow}${extra}
    "></div>`,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconAnchor, iconAnchor],
    popupAnchor: options.popupAnchor ?? [0, -10],
  });
}

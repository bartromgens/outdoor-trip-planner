import * as L from 'leaflet';

const DEFAULT_SHADOW = '0 1px 4px rgba(0,0,0,.45)';

export interface CircleMarkerIconOptions {
  color: string;
  size?: number;
  /** Material Icons name to show inside the circle (white). */
  icon?: string;
  shadow?: string;
  border?: string;
  popupAnchor?: [number, number];
  extraStyle?: string;
  className?: string;
}

export function circleMarkerIcon(options: CircleMarkerIconOptions): L.DivIcon {
  const size = options.size ?? 22;
  const shadow = options.shadow ?? DEFAULT_SHADOW;
  const border = options.border ?? '2px solid rgba(255,255,255,0.9)';
  const iconSize = size + 4;
  const iconAnchor = Math.round(iconSize / 2);
  const extra = options.extraStyle ? `;${options.extraStyle}` : '';
  const iconName = options.icon;
  const innerContent = iconName
    ? `<span style="font-family:'Material Icons';font-size:${Math.max(10, size - 4)}px;color:white;line-height:1;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${iconName}</span>`
    : '';
  return L.divIcon({
    className: options.className ?? 'map-marker',
    html: `<div style="
      position:relative;
      background:${options.color};
      width:${size}px;height:${size}px;
      border-radius:50%;
      border:${border};
      box-shadow:${shadow}${extra}
    ">${innerContent}</div>`,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconAnchor, iconAnchor],
    popupAnchor: options.popupAnchor ?? [0, -10],
  });
}

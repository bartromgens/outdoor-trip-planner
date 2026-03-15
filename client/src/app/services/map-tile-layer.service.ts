import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../../environments/environment';

const THUNDERFOREST_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.thunderforest.com/">Thunderforest</a>';

const TRACESTRACK_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.tracestrack.com/">Tracestrack</a>';

@Injectable({ providedIn: 'root' })
export class MapTileLayerService {
  thunderforest(style: string): L.TileLayer | null {
    const key = environment.thunderforestApiKey;
    if (!key) return null;
    return L.tileLayer(`https://tile.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${key}`, {
      attribution: THUNDERFOREST_ATTRIBUTION,
      maxZoom: 22,
    });
  }

  tracestrackTopo(): L.TileLayer | null {
    const key = environment.tracestrackApiKey;
    if (!key) return null;
    return L.tileLayer(
      `https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      {
        attribution: TRACESTRACK_ATTRIBUTION,
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
      },
    );
  }

  transport(): L.TileLayer {
    const layer = this.thunderforest('transport');
    if (layer) return layer;
    return L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://memomaps.de/">memomaps</a>',
    });
  }

  buildBaseLayers(): Record<string, L.Layer> {
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19,
      },
    );
    const landscape = this.thunderforest('landscape');
    const outdoors = this.thunderforest('outdoors');
    const topo = this.tracestrackTopo();
    return {
      Standard: osm,
      Satellite: satellite,
      Transport: this.transport(),
      ...(landscape && { Landscape: landscape }),
      ...(outdoors && { Outdoors: outdoors }),
      ...(topo && { Topo: topo }),
    };
  }
}

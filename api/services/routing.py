import logging
import math
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TIMEOUT = 15.0

ORS_BASE = "https://api.openrouteservice.org/v2"
VALHALLA_BASE = "https://api.stadiamaps.com"

# ORS foot-hiking uses a flat 5 km/h regardless of slope (elevation not modelled).
# Dividing the requested time ranges by this factor compensates for the speed
# overestimation in mountain terrain so displayed labels (1h/2h/3h) reflect
# realistic hiking time.  Valhalla already accounts for elevation, so
# no compensation is needed there.
ELEVATION_COMPENSATION_FACTOR = 1.5

_ISOCHRONE_HOURS = [1, 2, 3]

# ORS: request shorter times and let the compensation factor stand in for terrain.
ORS_ISOCHRONE_RANGES = [
    int(h * 3600 / ELEVATION_COMPENSATION_FACTOR) for h in _ISOCHRONE_HOURS
]
# Valhalla: request realistic hiking hours directly.
# The Valhalla pedestrian isochrone is capped at 120 minutes, so the 3 h
# contour is omitted for this backend.
VALHALLA_ISOCHRONE_CONTOURS = [h * 60 for h in _ISOCHRONE_HOURS if h * 60 <= 120]

VALHALLA_PEDESTRIAN_OPTIONS = {
    "max_hiking_difficulty": 4,
    "use_tracks": 1.0,
    "use_hills": 1.0,
}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two (lat, lon) points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def _ascent_descent(elevations: list[float]) -> tuple[int, int]:
    ascent = descent = 0.0
    for i in range(1, len(elevations)):
        diff = elevations[i] - elevations[i - 1]
        if diff > 0:
            ascent += diff
        else:
            descent += abs(diff)
    return round(ascent), round(descent)


def _elevation_profile_from_3d_coords(
    coords_3d: list[list[float]],
) -> list[list[float]]:
    """Build [[dist_m, elev_m], ...] from [lon, lat, elev] triples."""
    profile: list[list[float]] = []
    dist_m = 0.0
    prev: list[float] | None = None
    for coord in coords_3d:
        if len(coord) < 3:
            continue
        if prev is not None:
            dist_m += _haversine_m(prev[1], prev[0], coord[1], coord[0])
        profile.append([round(dist_m), round(coord[2])])
        prev = coord
    return profile


def _enrich_ors_directions(data: dict[str, Any]) -> dict[str, Any]:
    """Add elevation_profile, ascent_m, descent_m to ORS response; strip to 2D geometry."""
    for feature in data.get("features", []):
        coords: list[list[float]] = feature.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords[0]) < 3:
            continue
        profile = _elevation_profile_from_3d_coords(coords)
        elevations = [p[1] for p in profile]
        ascent, descent = _ascent_descent(elevations)

        summary: dict[str, Any] = (
            feature.setdefault("properties", {}).setdefault("summary", {})
        )
        summary["ascent_m"] = ascent
        summary["descent_m"] = descent
        summary["elevation_profile"] = profile

        feature["geometry"]["coordinates"] = [[c[0], c[1]] for c in coords]
    return data


def _decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decode a Valhalla-encoded polyline (precision 6) to (lat, lon) pairs."""
    coords: list[tuple[float, float]] = []
    index = 0
    lat = 0
    lng = 0
    while index < len(encoded):
        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if result & 1 else result >> 1
        lat += dlat

        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if result & 1 else result >> 1
        lng += dlng

        coords.append((lat / 1e6, lng / 1e6))
    return coords


def isochrone_ors(lat: float, lon: float, api_key: str) -> dict[str, Any]:
    logger.info(
        "ROUTING_BACKEND_REQUEST backend=ors endpoint=isochrone lat=%s lon=%s",
        lat,
        lon,
    )
    resp = httpx.post(
        f"{ORS_BASE}/isochrones/foot-hiking",
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        json={
            "locations": [[lon, lat]],
            "range": ORS_ISOCHRONE_RANGES,
            "range_type": "time",
        },
        timeout=TIMEOUT,
    )
    if not resp.is_success:
        logger.error("ORS isochrone error %s: %s", resp.status_code, resp.text[:500])
    resp.raise_for_status()
    return resp.json()


def isochrone_valhalla(lat: float, lon: float, api_key: str) -> dict[str, Any]:
    logger.info(
        "ROUTING_BACKEND_REQUEST backend=valhalla endpoint=isochrone lat=%s lon=%s",
        lat,
        lon,
    )
    contours = [{"time": m} for m in VALHALLA_ISOCHRONE_CONTOURS]
    resp = httpx.post(
        f"{VALHALLA_BASE}/isochrone/v1",
        params={"api_key": api_key},
        json={
            "locations": [{"lat": lat, "lon": lon}],
            "costing": "pedestrian",
            "costing_options": {"pedestrian": VALHALLA_PEDESTRIAN_OPTIONS},
            "contours": contours,
            "polygons": True,
            "generalize": 0,
        },
        timeout=TIMEOUT,
    )
    if not resp.is_success:
        logger.error(
            "Valhalla isochrone error %s: %s", resp.status_code, resp.text[:500]
        )
    resp.raise_for_status()
    data = resp.json()
    return _normalize_valhalla_isochrone(data)


def _normalize_valhalla_isochrone(data: dict[str, Any]) -> dict[str, Any]:
    """Convert Valhalla isochrone response to ORS-compatible format.

    ORS features carry ``properties.value`` in seconds; the frontend uses this
    to match against ISOCHRONE_BUCKETS.  Those bucket values are defined as
    ``round(hours * 3600 / ELEVATION_COMPENSATION_FACTOR)``.  Valhalla already
    accounts for terrain, so its contours represent true hiking time in minutes.
    We convert by dividing out the compensation factor so the same bucket keys
    apply: ``value = contour_minutes * 60 / ELEVATION_COMPENSATION_FACTOR``.
    """
    features = []
    for i, feature in enumerate(data.get("features", [])):
        props = feature.get("properties", {})
        contour_minutes = props.get("contour", 0)
        bucket_seconds = round(contour_minutes * 60 / ELEVATION_COMPENSATION_FACTOR)
        features.append(
            {
                "type": "Feature",
                "geometry": feature.get("geometry"),
                "properties": {
                    "value": bucket_seconds,
                    "group_index": i,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def directions_ors(coordinates: list[list[float]], api_key: str) -> dict[str, Any]:
    logger.info(
        "ROUTING_BACKEND_REQUEST backend=ors endpoint=directions waypoints=%s",
        len(coordinates),
    )
    resp = httpx.post(
        f"{ORS_BASE}/directions/foot-hiking/geojson",
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        json={"coordinates": coordinates, "elevation": True},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return _enrich_ors_directions(resp.json())


def directions_valhalla(coordinates: list[list[float]], api_key: str) -> dict[str, Any]:
    logger.info(
        "ROUTING_BACKEND_REQUEST backend=valhalla endpoint=directions waypoints=%s",
        len(coordinates),
    )
    locations = [{"lon": lon, "lat": lat} for lon, lat in coordinates]
    resp = httpx.post(
        f"{VALHALLA_BASE}/route/v1",
        params={"api_key": api_key},
        json={
            "locations": locations,
            "costing": "pedestrian",
            "costing_options": {"pedestrian": VALHALLA_PEDESTRIAN_OPTIONS},
            "units": "km",
            "elevation_interval": 30,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return _normalize_valhalla_directions(data)


def _normalize_valhalla_directions(data: dict[str, Any]) -> dict[str, Any]:
    """Convert a Valhalla trip response to an ORS-compatible GeoJSON FeatureCollection.

    The frontend expects a FeatureCollection with a single LineString feature
    whose ``properties`` contain ``summary.distance`` (metres) and
    ``summary.duration`` (seconds).  Valhalla encodes the shape as a precision-6
    polyline and reports distance in kilometres.
    """
    trip = data.get("trip", {})
    legs = trip.get("legs", [])

    all_coords: list[list[float]] = []
    all_elevations: list[float] = []
    elevation_interval_m: float = 30.0
    total_distance_m = 0.0
    total_duration_s = 0.0
    cumulative_dist_m = 0.0

    for i, leg in enumerate(legs):
        shape = leg.get("shape", "")
        decoded = _decode_polyline6(shape)
        leg_coords = [[lon, lat] for lat, lon in decoded]
        if all_coords and leg_coords:
            leg_coords = leg_coords[1:]
        all_coords.extend(leg_coords)

        summary = leg.get("summary", {})
        leg_dist_m = summary.get("length", 0.0) * 1000
        total_distance_m += leg_dist_m
        total_duration_s += summary.get("time", 0.0)

        leg_elev: list[float] = leg.get("elevation", [])
        interval_m: float = float(leg.get("elevation_interval", 30))
        if i == 0:
            elevation_interval_m = interval_m
        if leg_elev:
            skip = 1 if all_elevations else 0
            all_elevations.extend(leg_elev[skip:])

        cumulative_dist_m += leg_dist_m

    elevation_profile: list[list[float]] = []
    ascent_m: int | None = None
    descent_m: int | None = None
    if all_elevations:
        elevation_profile = [
            [round(j * elevation_interval_m), round(e)]
            for j, e in enumerate(all_elevations)
        ]
        ascent_m, descent_m = _ascent_descent(all_elevations)

    n = len(all_coords)
    summary_props: dict[str, Any] = {
        "distance": total_distance_m,
        "duration": total_duration_s,
    }
    if ascent_m is not None:
        summary_props["ascent_m"] = ascent_m
        summary_props["descent_m"] = descent_m
        summary_props["elevation_profile"] = elevation_profile

    feature: dict[str, Any] = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": all_coords},
        "properties": {
            "summary": summary_props,
            "way_points": [0, n - 1] if n > 0 else [0, 0],
        },
    }
    return {"type": "FeatureCollection", "features": [feature]}

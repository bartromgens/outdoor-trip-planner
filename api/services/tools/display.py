import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def features_to_geojson(
    features: list[dict[str, Any]],
) -> dict[str, Any]:
    geo_features = []
    for f in features:
        geom_type = f.get("geometry_type", "point")
        coords = f.get("coordinates", [])

        if geom_type == "point":
            geometry = {"type": "Point", "coordinates": coords}
        elif geom_type == "line":
            geometry = {"type": "LineString", "coordinates": coords}
        elif geom_type == "polygon":
            geometry = {"type": "Polygon", "coordinates": [coords]}
        else:
            geometry = {"type": "Point", "coordinates": coords}

        properties: dict[str, Any] = {"label": f.get("label", "")}
        if f.get("description"):
            properties["description"] = f["description"]
        if f.get("category"):
            properties["category"] = f["category"]

        geo_features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": properties,
            }
        )

    return {"type": "FeatureCollection", "features": geo_features}


def _extract_point_coords(feature: dict[str, Any]) -> tuple[float, float] | None:
    coords = feature.get("coordinates", [])
    geom = feature.get("geometry_type", "point")
    if geom == "point" and isinstance(coords, list) and len(coords) >= 2:
        return coords[1], coords[0]  # lat, lon
    if geom in ("line", "polygon") and isinstance(coords, list) and coords:
        first = coords[0]
        if isinstance(first, list) and len(first) >= 2:
            return first[1], first[0]
    return None


def _save_features_to_db(features: list[dict[str, Any]]) -> int:
    from api.models import Location

    saved = 0
    for f in features:
        point = _extract_point_coords(f)
        if point is None:
            continue
        lat, lon = point
        Location.objects.create(
            name=f.get("label", ""),
            latitude=lat,
            longitude=lon,
            description=f.get("description", ""),
            category=f.get("category", ""),
            geometry_type=f.get("geometry_type", "point"),
            coordinates=f.get("coordinates", []),
            altitude=f.get("altitude"),
        )
        saved += 1
    return saved


def handle_show_on_map(
    tool_input: dict[str, Any],
    map_features: list[dict[str, Any]],
) -> str:
    features = tool_input.get("features", [])
    for f in features:
        map_features.append(f)

    count = len(features)
    return json.dumps({"status": "ok", "message": f"{count} feature(s) added to map"})


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "show_on_map",
        "description": (
            "Display geographic features on the user's map. Call this "
            "whenever you find locations, trails, transit routes, or "
            "points of interest that the user would benefit from seeing "
            "on the map. Each feature needs a geometry type, coordinates, "
            "and a label."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "features": {
                    "type": "array",
                    "description": "List of geographic features to display",
                    "items": {
                        "type": "object",
                        "properties": {
                            "geometry_type": {
                                "type": "string",
                                "enum": ["point", "line", "polygon"],
                                "description": "The type of geometry",
                            },
                            "coordinates": {
                                "description": (
                                    "[lon, lat] for point, "
                                    "[[lon,lat],...] for line/polygon"
                                ),
                            },
                            "label": {
                                "type": "string",
                                "description": "Display name for the feature",
                            },
                            "description": {
                                "type": "string",
                                "description": "Additional info shown in popup",
                            },
                            "category": {
                                "type": "string",
                                "description": (
                                    "Semantic category: hut, campsite, peak, "
                                    "trail, transit_route, water, parking, "
                                    "viewpoint, station, etc."
                                ),
                            },
                        },
                        "required": [
                            "geometry_type",
                            "coordinates",
                            "label",
                        ],
                    },
                },
            },
            "required": ["features"],
        },
    },
]

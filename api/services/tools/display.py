import json
from typing import Any


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

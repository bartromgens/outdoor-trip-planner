import json
import logging
import re
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OVERPASS_API = "https://overpass-api.de/api/interpreter"
TIMEOUT = 30.0

MAX_BBOX_DEG = 0.18
MAX_AROUND_METERS = 20000
DEFAULT_TIMEOUT_SEC = 25
DEFAULT_MAXSIZE_BYTES = 536870912

USER_AGENT = (
    "OutdoorTripPlanner/0.1.0 (https://github.com/bartromgens/outdoor-trip-planner; "
    "contact@outdoor-trip-planner.example)"
)
OVERPASS_HEADERS = {
    "User-Agent": USER_AGENT,
    "From": "contact@outdoor-trip-planner.example",
    "Referer": "https://github.com/bartromgens/outdoor-trip-planner",
}


def _clamp_around_radius(query: str) -> str:
    pattern = re.compile(r"\(around:(\d+)\s*,")
    return pattern.sub(
        lambda m: f"(around:{min(int(m.group(1)), MAX_AROUND_METERS)},",
        query,
    )


def _clamp_bbox(query: str) -> str:
    pattern = re.compile(
        r"\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)"
    )

    def repl(m: re.Match[str]) -> str:
        s = float(m.group(1))
        w = float(m.group(2))
        n = float(m.group(3))
        e = float(m.group(4))
        lat_span = abs(n - s)
        lon_span = abs(e - w)
        if lat_span <= MAX_BBOX_DEG and lon_span <= MAX_BBOX_DEG:
            return m.group(0)
        lat_mid = (s + n) / 2
        lon_mid = (w + e) / 2
        half_lat = min(lat_span / 2, MAX_BBOX_DEG / 2)
        half_lon = min(lon_span / 2, MAX_BBOX_DEG / 2)
        new_s = lat_mid - half_lat
        new_n = lat_mid + half_lat
        new_w = lon_mid - half_lon
        new_e = lon_mid + half_lon
        return f"({new_s},{new_w},{new_n},{new_e})"

    return pattern.sub(repl, query, count=1)


def _ensure_query_settings(query: str) -> str:
    if "[timeout:" in query and "[maxsize:" in query:
        return query
    timeout_decl = f"[timeout:{DEFAULT_TIMEOUT_SEC}]"
    maxsize_decl = f"[maxsize:{DEFAULT_MAXSIZE_BYTES}];"
    prefix = timeout_decl + maxsize_decl
    return prefix + query.lstrip()


def _prepare_query(query: str) -> str:
    q = _clamp_around_radius(query)
    q = _clamp_bbox(q)
    q = _ensure_query_settings(q)
    return q


def query_overpass(query: str) -> str:
    prepared = _prepare_query(query)
    query_preview = prepared[:160].replace("\n", " ")
    logger.info("Overpass query  %d chars  %s…", len(prepared), query_preview)
    logger.debug("Overpass full query:\n%s", prepared)

    t0 = time.perf_counter()
    resp = httpx.post(
        OVERPASS_API,
        data={"data": prepared},
        headers=OVERPASS_HEADERS,
        timeout=TIMEOUT,
    )
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.debug(
        "Overpass HTTP %s  %.2fs  %d bytes",
        resp.status_code,
        elapsed,
        len(resp.content),
    )

    data = resp.json()

    elements = data.get("elements", [])
    results = []
    for el in elements[:50]:
        item: dict[str, Any] = {"type": el.get("type"), "id": el.get("id")}
        if "lat" in el and "lon" in el:
            item["lat"] = el["lat"]
            item["lon"] = el["lon"]
        if "center" in el:
            item["lat"] = el["center"]["lat"]
            item["lon"] = el["center"]["lon"]
        if "geometry" in el:
            item["geometry"] = el["geometry"]
        if "tags" in el:
            item["tags"] = el["tags"]
        results.append(item)

    logger.info(
        "Overpass result  %d elements total  %d returned  %.2fs",
        len(elements),
        len(results),
        elapsed,
    )
    return json.dumps(
        {"count": len(elements), "results": results},
        ensure_ascii=False,
    )


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "query_overpass",
        "description": (
            "Execute an Overpass QL query to search OpenStreetMap data. "
            "Use this to find hiking trails, mountain huts, campsites, "
            "water sources, viewpoints, peaks, parking areas, and other "
            "geographic features. Always request JSON output with "
            "[out:json]. For ways and relations, add 'out center;' or "
            "'out geom;' to get coordinates. Queries are limited to a "
            "20x20 km area: use a bbox (south,west,north,east) or "
            "(around:radius,lat,lon) with radius in meters (max 20000)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The Overpass QL query string. Example: "
                        '[out:json];node["tourism"="alpine_hut"]'
                        "(around:20000,46.82,8.23);out;"
                    ),
                },
            },
            "required": ["query"],
        },
    },
]

TOOL_HANDLERS = {
    "query_overpass": lambda inp: query_overpass(inp["query"]),
}

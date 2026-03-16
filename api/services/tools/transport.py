import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TRANSITOUS_BASE = "https://api.transitous.org"
TIMEOUT = 15.0

USER_AGENT = (
    "OutdoorTripPlanner/0.1.0 (https://github.com/bartromgens/outdoor-trip-planner; "
    "contact@outdoor-trip-planner.example)"
)

HEADERS = {"User-Agent": USER_AGENT}


def geocode_location(text: str) -> str:
    logger.info("Geocode  %r", text)
    t0 = time.perf_counter()
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v1/geocode",
        params={"text": text},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.info("Geocode HTTP %s  %s  %.2fs", resp.status_code, resp.url, elapsed)

    matches = resp.json()
    results = []
    for m in matches[:5]:
        item: dict[str, Any] = {
            "name": m.get("name", ""),
            "type": m.get("type", ""),
        }
        if "lat" in m and "lon" in m:
            item["lat"] = m["lat"]
            item["lon"] = m["lon"]
        if "id" in m:
            item["id"] = m["id"]
        results.append(item)

    logger.info(
        "Geocode result  %d matches  top=%r  %.2fs",
        len(results),
        results[0].get("name", "") if results else "",
        elapsed,
    )
    return json.dumps(results, ensure_ascii=False)


def plan_transit_route(
    from_place: str,
    to_place: str,
    departure_time: str | None = None,
    arrive_by: bool = False,
) -> str:
    logger.info(
        "Transit route  from=%r  to=%r  time=%s  arrive_by=%s",
        from_place,
        to_place,
        departure_time or "now",
        arrive_by,
    )
    params: dict[str, str] = {
        "fromPlace": from_place,
        "toPlace": to_place,
    }
    if departure_time:
        params["time"] = departure_time
    if arrive_by:
        params["arriveBy"] = "true"

    t0 = time.perf_counter()
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v5/plan",
        params=params,
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.info("Transit HTTP %s  %s  %.2fs", resp.status_code, resp.url, elapsed)

    data = resp.json()

    itineraries = data.get("itineraries", [])
    results = []
    for itin in itineraries[:5]:
        legs = []
        for leg in itin.get("legs", []):
            leg_info: dict[str, Any] = {
                "mode": leg.get("mode", ""),
                "from": leg.get("from", {}).get("name", ""),
                "to": leg.get("to", {}).get("name", ""),
                "startTime": leg.get("startTime", ""),
                "endTime": leg.get("endTime", ""),
                "duration": leg.get("duration", 0),
            }
            if leg.get("routeShortName"):
                leg_info["line"] = leg["routeShortName"]
            if leg.get("legGeometry", {}).get("points"):
                leg_info["geometry"] = leg["legGeometry"]["points"]
            legs.append(leg_info)
        results.append(
            {
                "duration": itin.get("duration", 0),
                "startTime": itin.get("startTime", ""),
                "endTime": itin.get("endTime", ""),
                "transfers": itin.get("transfers", 0),
                "legs": legs,
            }
        )

    logger.info(
        "Transit result  %d itineraries  %.2fs",
        len(results),
        elapsed,
    )
    return json.dumps(results, ensure_ascii=False)


def get_stoptimes(
    stop_id: str,
    departure_time: str | None = None,
    n: int = 10,
) -> str:
    logger.info(
        "Stop times  stop_id=%r  n=%d  time=%s", stop_id, n, departure_time or "now"
    )
    params: dict[str, Any] = {
        "stopId": stop_id,
        "n": min(n, 20),
    }
    if departure_time:
        params["time"] = departure_time

    t0 = time.perf_counter()
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v5/stoptimes",
        params=params,
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.info("Stop times HTTP %s  %s  %.2fs", resp.status_code, resp.url, elapsed)

    data = resp.json()

    stop_times = data.get("stopTimes", [])
    results = []
    for st in stop_times[:20]:
        item: dict[str, Any] = {
            "mode": st.get("mode", ""),
            "routeShortName": st.get("routeShortName", ""),
            "headsign": st.get("headsign", ""),
            "scheduledDeparture": st.get("scheduledDeparture", ""),
            "realtimeDeparture": st.get("realtimeDeparture", ""),
        }
        results.append(item)

    logger.info("Stop times result  %d departures  %.2fs", len(results), elapsed)
    return json.dumps(results, ensure_ascii=False)


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "geocode_location",
        "description": (
            "Resolve a place name to coordinates and public transport "
            "stop IDs using the Transitous geocoding API. Use this to "
            "convert user-provided place names into lat/lon coordinates "
            "or stop IDs for routing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The place name or address to geocode",
                },
            },
            "required": ["text"],
        },
    },
    {
        "name": "plan_transit_route",
        "description": (
            "Plan a public transport journey between two places using "
            "the Transitous routing API. Provide coordinates as "
            "'lat,lon' strings. Returns itineraries with legs, times, "
            "and transfer information."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "from_place": {
                    "type": "string",
                    "description": "Origin as 'lat,lon' or a stop ID",
                },
                "to_place": {
                    "type": "string",
                    "description": "Destination as 'lat,lon' or a stop ID",
                },
                "time": {
                    "type": "string",
                    "description": (
                        "Departure/arrival time in ISO 8601 format "
                        "(optional, defaults to now)"
                    ),
                },
                "arrive_by": {
                    "type": "boolean",
                    "description": (
                        "If true, 'time' is the desired arrival time " "(default false)"
                    ),
                },
            },
            "required": ["from_place", "to_place"],
        },
    },
    {
        "name": "get_stoptimes",
        "description": (
            "Get upcoming departures/arrivals at a public transport "
            "stop. Use geocode_location first to find the stop ID."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stop_id": {
                    "type": "string",
                    "description": "The stop ID from geocoding results",
                },
                "time": {
                    "type": "string",
                    "description": (
                        "Time in ISO 8601 format (optional, defaults to now)"
                    ),
                },
                "n": {
                    "type": "integer",
                    "description": "Number of departures to return (default 10, max 20)",
                },
            },
            "required": ["stop_id"],
        },
    },
]

TOOL_HANDLERS = {
    "geocode_location": lambda inp: geocode_location(inp["text"]),
    "plan_transit_route": lambda inp: plan_transit_route(
        inp["from_place"],
        inp["to_place"],
        departure_time=inp.get("time"),
        arrive_by=inp.get("arrive_by", False),
    ),
    "get_stoptimes": lambda inp: get_stoptimes(
        inp["stop_id"],
        departure_time=inp.get("time"),
        n=inp.get("n", 10),
    ),
}

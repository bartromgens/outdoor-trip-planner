import calendar
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
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

_STOPTIMES_TIME_TZ = re.compile(r"(Z|[+-][0-9]{2}:[0-9]{2})$")


def _ensure_stoptimes_time(time_str: str) -> str:
    s = time_str.strip()
    if len(s) < 12 or "T" not in s:
        return s
    if _STOPTIMES_TIME_TZ.search(s):
        return s
    return s + "Z"


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
        params["time"] = _ensure_stoptimes_time(departure_time)

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
        dep = _stop_time_departure_iso(st) or ""
        item: dict[str, Any] = {
            "mode": st.get("mode", ""),
            "routeShortName": st.get("routeShortName", ""),
            "headsign": st.get("headsign", ""),
            "scheduledDeparture": dep,
            "realtimeDeparture": st.get("realtimeDeparture", ""),
        }
        results.append(item)

    logger.info("Stop times result  %d departures  %.2fs", len(results), elapsed)
    return json.dumps(results, ensure_ascii=False)


_MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]
_AERIAL_LIFT_RADIUS_DEG = 0.060  # ~7 km
_AERIAL_LIFT_MAX_STOPS = 20
_GONDOLA_PROBE_HOUR_UTC = 12
_WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _geocode_child_stop_id(name: str, lat: float, lon: float) -> str | None:
    """Use the geocode endpoint to find a non-parent stop ID near (lat, lon)."""
    try:
        resp = httpx.get(
            f"{TRANSITOUS_BASE}/api/v1/geocode",
            params={"text": name},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        for m in resp.json():
            m_id = m.get("id", "")
            if not m_id:
                continue
            m_lat = m.get("lat", 0.0)
            m_lon = m.get("lon", 0.0)
            # Accept if within ~500 m and not a parent stop
            if abs(m_lat - lat) < 0.005 and abs(m_lon - lon) < 0.005:
                logger.info(
                    "Geocode child  name=%s  id=%s  parent=%s",
                    name,
                    m_id,
                    m.get("parent", {}).get("id", "—"),
                )
                return m_id
    except Exception:
        logger.debug("Geocode child lookup failed for %r", name)
    return None


def _deg2_dist_sq(lat0: float, lon0: float, plat: float, plon: float) -> float:
    dlat = plat - lat0
    dlon = plon - lon0
    return dlat * dlat + dlon * dlon


def _is_parent_stop(stop: dict[str, Any]) -> bool:
    """Return True if this stop appears to be a parent/station stop."""
    stop_id = stop.get("stopId", "")
    # No parentId of its own → it IS the parent; also check for common "Parent" token
    return not stop.get("parentId") or "Parent" in stop_id


def get_aerial_lift_stops(lat: float, lon: float) -> list[dict[str, Any]]:
    min_coord = f"{lat - _AERIAL_LIFT_RADIUS_DEG},{lon - _AERIAL_LIFT_RADIUS_DEG}"
    max_coord = f"{lat + _AERIAL_LIFT_RADIUS_DEG},{lon + _AERIAL_LIFT_RADIUS_DEG}"
    logger.info("Aerial lift stops  lat=%.4f  lon=%.4f", lat, lon)
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v1/map/stops",
        params={"min": min_coord, "max": max_coord},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    places: list[dict[str, Any]] = resp.json()

    aerial = [p for p in places if "AERIAL_LIFT" in (p.get("modes") or [])]
    # Child stops first so dedup prefers them over parent station stops.
    aerial.sort(key=lambda p: (0 if p.get("parentId") else 1))
    seen_parents: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for p in aerial:
        key = p.get("parentId") or p.get("stopId") or p.get("name", "")
        if key not in seen_parents:
            seen_parents.add(key)
            deduped.append(p)

    deduped.sort(
        key=lambda p: _deg2_dist_sq(
            lat, lon, float(p.get("lat") or 0), float(p.get("lon") or 0)
        )
    )

    logger.info(
        "Aerial lift stops  total=%d  aerial=%d  deduped=%d",
        len(places),
        len(aerial),
        len(deduped),
    )

    # For any stop that is still a parent, try geocoding to find a child stop ID.
    result = []
    for s in deduped[:_AERIAL_LIFT_MAX_STOPS]:
        if _is_parent_stop(s):
            child_id = _geocode_child_stop_id(
                s.get("name", ""), s.get("lat", 0.0), s.get("lon", 0.0)
            )
            if child_id:
                s = {**s, "stopId": child_id}
        logger.info(
            "  stop  name=%-40s  stopId=%-50s  parentId=%s",
            s.get("name", ""),
            s.get("stopId", ""),
            s.get("parentId", "—"),
        )
        result.append(s)
    return result


def _stoptimes_query_time(probe_date: date, hour: int = 8) -> str:
    """Transitous requires an offset or Z; naive local times return HTTP 500."""
    return f"{probe_date.isoformat()}T{hour:02d}:00:00Z"


def _stop_time_departure_iso(st: dict[str, Any]) -> str | None:
    dep = st.get("scheduledDeparture") or st.get("departure")
    if dep:
        return dep
    place = st.get("place") or {}
    return place.get("scheduledDeparture") or place.get("departure")


def _is_same_day(stop_time: dict[str, Any], probe_date: date) -> bool:
    departure = _stop_time_departure_iso(stop_time)
    if not departure:
        return False
    try:
        return departure[:10] == probe_date.isoformat()
    except Exception:
        return False


def _probe_day_stoptimes(stop_id: str, probe_date: date) -> tuple[bool, bool]:
    """Returns (has_departure_that_day, stop_not_in_timetable_404)."""
    try:
        params = {
            "stopId": stop_id,
            "time": _stoptimes_query_time(probe_date, _GONDOLA_PROBE_HOUR_UTC),
            "n": "4",
        }
        logger.debug("Gondola probe  stop=%s  date=%s", stop_id, probe_date)
        resp = httpx.get(
            f"{TRANSITOUS_BASE}/api/v5/stoptimes",
            params=params,
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        stop_times = data.get("stopTimes", [])
        has_service = any(_is_same_day(st, probe_date) for st in stop_times)
        logger.info(
            "Gondola probe  stop=%s  date=%s  has_service=%s",
            stop_id,
            probe_date,
            has_service,
        )
        return has_service, False
    except httpx.HTTPStatusError as e:
        body = (e.response.text or "")[:200]
        logger.warning(
            "Gondola probe HTTP %s  stop=%s  date=%s  %s",
            e.response.status_code,
            stop_id,
            probe_date,
            body,
        )
        not_found = e.response.status_code == 404
        return False, not_found
    except Exception:
        logger.exception("Gondola probe failed  stop=%s  date=%s", stop_id, probe_date)
        return False, False


def _format_gondola_window_summary(window_start: date, open_days: list[date]) -> str:
    window_end = window_start + timedelta(days=6)
    m0 = _MONTH_NAMES[window_start.month - 1]
    m1 = _MONTH_NAMES[window_end.month - 1]
    if window_start.year == window_end.year and window_start.month == window_end.month:
        window_txt = f"{window_start.day}–{window_end.day} {m0} {window_start.year}"
    elif window_start.year == window_end.year:
        window_txt = (
            f"{window_start.day} {m0} – {window_end.day} {m1} {window_start.year}"
        )
    else:
        window_txt = (
            f"{window_start.day} {m0} {window_start.year} – "
            f"{window_end.day} {m1} {window_end.year}"
        )
    if not open_days:
        return f"No departures ({window_txt})"
    bits = [f"{_WEEKDAY_SHORT[d.weekday()]} {d.day}/{d.month}" for d in open_days]
    return f"{window_txt}: " + ", ".join(bits)


def _weekdays_from_dates(days: list[date]) -> str:
    wds = sorted({d.weekday() for d in days})
    return ", ".join(_WEEKDAY_SHORT[w] for w in wds)


def probe_gondola_schedule(stop_id: str, window_start: date) -> dict[str, Any]:
    """Seven calendar days from window_start; noon UTC stoptimes probe per day."""
    logger.info(
        "Gondola window  stop=%s  %s..%s",
        stop_id,
        window_start,
        window_start + timedelta(days=6),
    )

    def check_day(i: int) -> tuple[date, bool, bool]:
        d = window_start + timedelta(days=i)
        has_dep, not_found = _probe_day_stoptimes(stop_id, d)
        return d, has_dep, not_found

    with ThreadPoolExecutor(max_workers=7) as pool:
        triples = list(pool.map(check_day, range(7)))

    open_days = sorted(d for d, ok, _ in triples if ok)
    all_probes_not_found = all(nf for _, _, nf in triples)
    timetable_available = not (not open_days and all_probes_not_found)
    summary = _format_gondola_window_summary(window_start, open_days)
    if not timetable_available:
        summary = "No timetable available for this stop in the routing data."
    weekday_label = ""
    if timetable_available and 0 < len(open_days) < 7:
        weekday_label = _weekdays_from_dates(open_days)

    day_calendar: list[dict[str, Any]] = []
    if timetable_available:
        for d, has_dep, _ in sorted(triples, key=lambda t: t[0]):
            mo = calendar.month_abbr[d.month]
            day_calendar.append(
                {
                    "date_iso": d.isoformat(),
                    "date_label": f"{d.day} {mo}",
                    "weekday": _WEEKDAY_SHORT[d.weekday()],
                    "open": bool(has_dep),
                }
            )

    return {
        "schedule_summary": summary,
        "open_dates": [d.isoformat() for d in open_days],
        "weekday_label": weekday_label,
        "timetable_available": timetable_available,
        "day_calendar": day_calendar,
    }


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

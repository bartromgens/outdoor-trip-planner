import json
import logging
import re
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
TIMEOUT = 15.0
MAX_PLACES = 20
SEARCH_DELAY_S = 0.25
SEARCH_LIMIT = 5

USER_AGENT = (
    "OutdoorTripPlanner/1.0 (https://github.com/bartromgens/outdoor-trip-planner; "
    "contact@outdoor-trip-planner.example) httpx"
)
HEADERS = {"User-Agent": USER_AGENT}

P_COORDINATE = "P625"
P_ELEVATION = "P2044"


def _parse_quantity_amount(amount_str: str) -> float | None:
    if not amount_str:
        return None
    match = re.match(r"^[+-]?[\d.]+", str(amount_str).strip())
    if match:
        try:
            return float(match.group(0))
        except ValueError:
            pass
    return None


def _extract_coordinates(
    claims: dict[str, Any],
) -> tuple[float | None, float | None, float | None]:
    lat, lon, altitude = None, None, None
    if P_COORDINATE not in claims:
        return lat, lon, altitude
    for stmt in claims[P_COORDINATE]:
        snak = stmt.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        dv = snak.get("datavalue", {}).get("value", {})
        lat = dv.get("latitude")
        lon = dv.get("longitude")
        altitude = dv.get("altitude")
        if lat is not None and lon is not None:
            break
    return lat, lon, altitude


def _result_fallback(
    place: str, label: str, qid: str, elevation_m: float | None = None
) -> dict[str, Any]:
    return {
        "place": place,
        "label": label,
        "wikidata_id": qid,
        "lat": None,
        "lon": None,
        "elevation_m": elevation_m,
        "found": False,
    }


def _extract_elevation(claims: dict[str, Any]) -> float | None:
    if P_ELEVATION not in claims:
        return None
    for stmt in claims[P_ELEVATION]:
        snak = stmt.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        dv = snak.get("datavalue", {}).get("value", {})
        amount = dv.get("amount")
        if amount is not None:
            parsed = _parse_quantity_amount(amount)
            if parsed is not None:
                return parsed
    return None


def get_place_coordinates(places: list[str]) -> str:
    if not places:
        return json.dumps({"results": [], "error": "places list is empty"})
    places = [p.strip() for p in places if p and p.strip()][:MAX_PLACES]

    place_candidates: dict[str, list[tuple[str, str]]] = {}
    with httpx.Client(timeout=TIMEOUT, headers=HEADERS) as client:
        for i, place in enumerate(places):
            if i > 0:
                time.sleep(SEARCH_DELAY_S)
            search_query = place
            try:
                resp = client.get(
                    WIKIDATA_API,
                    params={
                        "action": "wbsearchentities",
                        "search": search_query,
                        "language": "en",
                        "limit": SEARCH_LIMIT,
                        "type": "item",
                        "format": "json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if "error" in data:
                    logger.warning(
                        "Wikidata API error for %r: %s",
                        search_query,
                        data.get("error", {}).get("info", data["error"]),
                    )
                    continue
                search_list = data.get("search") or []
                if not search_list:
                    logger.debug(
                        "Wikidata empty search for %r (status=%s)",
                        search_query,
                        resp.status_code,
                    )
                    continue
                candidates = [
                    (item["id"], item.get("label", place))
                    for item in search_list
                    if item.get("id")
                ]
                if candidates:
                    place_candidates[place] = candidates
            except (httpx.HTTPError, KeyError) as e:
                logger.warning("Wikidata search failed for %r: %s", place, e)

        if not place_candidates:
            return json.dumps(
                {
                    "results": [],
                    "message": "No Wikidata entities found for the given places",
                }
            )

        all_ids = list(
            {qid for candidates in place_candidates.values() for qid, _ in candidates}
        )
        ids = "|".join(all_ids)
        try:
            resp = client.get(
                WIKIDATA_API,
                params={
                    "action": "wbgetentities",
                    "ids": ids,
                    "props": "claims",
                    "format": "json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            logger.warning("Wikidata wbgetentities failed: %s", e)
            return json.dumps({"results": [], "error": str(e)})

    entities = data.get("entities", {})
    results: list[dict[str, Any]] = []
    for place, candidates in place_candidates.items():
        chosen: dict[str, Any] | None = None
        for qid, label in candidates:
            entity = entities.get(qid)
            if not entity or "claims" not in entity:
                if chosen is None:
                    chosen = _result_fallback(place, label, qid)
                continue
            claims = entity.get("claims", {})
            lat, lon, alt = _extract_coordinates(claims)
            elevation = _extract_elevation(claims)
            elevation_m = elevation if elevation is not None else alt
            if lat is None or lon is None:
                if chosen is None:
                    chosen = _result_fallback(place, label, qid, elevation_m)
                continue
            chosen = {
                "place": place,
                "label": label,
                "wikidata_id": qid,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "elevation_m": (
                    round(elevation_m, 1) if elevation_m is not None else None
                ),
                "found": True,
            }
            break
        if chosen is not None:
            results.append(chosen)

    logger.info(
        "Wikidata places  requested=%d  found=%d  with_coords=%d",
        len(places),
        len(results),
        sum(1 for r in results if r.get("found")),
    )
    return json.dumps({"results": results}, ensure_ascii=False)


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "get_place_coordinates",
        "description": (
            "Get coordinates and elevation for a list of place names (e.g. towns, "
            "villages, landmarks) from Wikidata. Use this to accurately place towns "
            "and places on the map. Returns lat, lon, and elevation_m for each place. "
            "Call show_on_map with the returned coordinates to display them."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "places": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of place names to look up (e.g. ['Chamonix', 'Saint-Gervais']).",
                },
            },
            "required": ["places"],
        },
    },
]

TOOL_HANDLERS = {
    "get_place_coordinates": lambda inp: get_place_coordinates(inp["places"]),
}

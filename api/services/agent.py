import logging
import time
from collections.abc import Generator
from typing import Any

import anthropic
from django.conf import settings

from .tools import ALL_TOOL_DEFINITIONS, execute_tool
from .tools.display import features_to_geojson

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 15

_RESULT_PREVIEW_LEN = 200

SYSTEM_PROMPT = """\
You are an outdoor trip planning assistant. You help users plan hiking, \
camping, cycling, and other outdoor trips.

## Capabilities

- **Wikipedia**: Search for and read articles about locations, trails, \
mountains, national parks, and natural features.
- **Wikimedia Commons**: Find photos of locations.
- **Overpass API**: Query OpenStreetMap to find points of interest such as \
hiking trails, mountain huts, campsites, water sources, viewpoints, peaks, \
parking areas, shelters, and more.
- **Public Transport (Transitous)**: Geocode place names to coordinates, \
plan public transport routes, and look up departure times at stops.
- **Map Display**: Show found locations, trails, and routes on the user's \
interactive map.

## Guidelines

- When you find geographic results (locations, trails, POIs, routes), \
always call `show_on_map` so the user can see them visually.
- For Overpass queries, always use `[out:json];` at the start. For ways \
and relations, use `out center;` or `out geom;` to get coordinates. \
Limit the search area to at most 10x10 km: use a bbox (south,west,north,east) \
or (around:radius,lat,lon) with radius up to 5000 m.
- Use `geocode_location` before `plan_transit_route` to resolve place names \
to coordinates.
- Be practical: consider access routes, travel times, difficulty levels, \
and seasonal conditions.
- Keep responses concise but informative.

## Common Overpass patterns

Find alpine huts within 5km of a point (max radius 5000 m):
`[out:json];node["tourism"="alpine_hut"](around:5000,LAT,LON);out;`

Find campsites:
`[out:json];node["tourism"="camp_site"](around:5000,LAT,LON);out;`

Find hiking trails in a bounding box:
`[out:json];way["route"="hiking"](SOUTH,WEST,NORTH,EAST);out geom;`

Find drinking water:
`[out:json];node["amenity"="drinking_water"](around:5000,LAT,LON);out;`

Find viewpoints:
`[out:json];node["tourism"="viewpoint"](around:5000,LAT,LON);out;`

Find peaks:
`[out:json];node["natural"="peak"](around:5000,LAT,LON);out;`

Find parking:
`[out:json];node["amenity"="parking"](around:5000,LAT,LON);out;`
"""


def _serialize_content(
    content: list[Any],
) -> list[dict[str, Any]]:
    serialized = []
    for block in content:
        if hasattr(block, "model_dump"):
            serialized.append(block.model_dump())
        elif isinstance(block, dict):
            serialized.append(block)
        else:
            serialized.append({"type": "text", "text": str(block)})
    return serialized


def _extract_text(content: list[Any]) -> str:
    parts = []
    for block in content:
        if hasattr(block, "text"):
            parts.append(block.text)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts)


def _tool_label(name: str, tool_input: dict[str, Any]) -> str:
    match name:
        case "search_wikipedia":
            return f"Searching Wikipedia for \"{tool_input.get('query', '')}\""
        case "get_wikipedia_article":
            return f"Reading Wikipedia: {tool_input.get('title', '')}"
        case "search_wikimedia_images":
            return f"Searching images for \"{tool_input.get('query', '')}\""
        case "query_overpass":
            return "Querying OpenStreetMap\u2026"
        case "geocode_location":
            return f"Looking up \"{tool_input.get('text', '')}\""
        case "plan_transit_route":
            return "Planning transit route\u2026"
        case "get_stoptimes":
            return "Fetching departures\u2026"
        case "show_on_map":
            n = len(tool_input.get("features", []))
            return f"Adding {n} feature(s) to map"
        case _:
            return f"Using tool: {name}"


def _build_system_prompt(bbox: dict[str, float] | None) -> str:
    if not bbox:
        return SYSTEM_PROMPT
    south = bbox.get("south", 0)
    west = bbox.get("west", 0)
    north = bbox.get("north", 0)
    east = bbox.get("east", 0)
    coords = (
        f"South={south:.4f}, West={west:.4f}, " f"North={north:.4f}, East={east:.4f}"
    )
    bbox_section = (
        f"\n\n## Current Map View\n"
        f"The user's map is currently showing this bounding box: {coords}. "
        f"When the user asks about 'this area', 'here', or nearby places "
        f"without specifying a location, prefer results within or close to "
        f"this bounding box."
    )
    return SYSTEM_PROMPT + bbox_section


def _log_llm_response(response: anthropic.types.Message) -> None:
    usage = getattr(response, "usage", None)
    usage_str = ""
    if usage:
        usage_str = (
            f" | tokens in={usage.input_tokens} out={usage.cache_read_input_tokens if hasattr(usage, 'cache_read_input_tokens') else '?'}"
            f"→{usage.output_tokens}"
        )
    tool_names = [
        block.name
        for block in response.content
        if getattr(block, "type", None) == "tool_use"
    ]
    tools_str = f" | tools=[{', '.join(tool_names)}]" if tool_names else ""
    logger.info(
        "LLM response  stop_reason=%s%s%s",
        response.stop_reason,
        usage_str,
        tools_str,
    )


def stream_agent_events(
    messages: list[dict[str, Any]],
    bbox: dict[str, float] | None = None,
) -> Generator[dict[str, Any], None, None]:
    api_key = getattr(settings, "CLAUDE_API_KEY", None)
    if not api_key:
        logger.error("CLAUDE_API_KEY is not configured")
        yield {
            "type": "final",
            "response": "Claude API key is not configured.",
            "map_features": None,
            "messages": messages,
        }
        return

    model = getattr(settings, "CLAUDE_MODEL", "claude-sonnet-4-20250514")
    client = anthropic.Anthropic(api_key=api_key)
    map_features: list[dict[str, Any]] = []
    system_prompt = _build_system_prompt(bbox)

    logger.info(
        "Agent start  model=%s  messages=%d  bbox=%s",
        model,
        len(messages),
        f"yes ({bbox})" if bbox else "none",
    )

    t0 = time.perf_counter()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        tools=ALL_TOOL_DEFINITIONS,
        messages=messages,
    )
    logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
    _log_llm_response(response)

    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        logger.info("── Tool round %d ──────────────────────────────", rounds)

        tool_results: list[dict[str, Any]] = []
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            label = _tool_label(block.name, block.input)
            logger.info(
                "Tool call  %-28s  input=%s",
                block.name,
                str(block.input)[:120],
            )
            yield {"type": "tool_call", "name": block.name, "label": label}
            t_tool = time.perf_counter()
            result_text = execute_tool(block.name, block.input, map_features)
            elapsed = time.perf_counter() - t_tool
            preview = result_text[:_RESULT_PREVIEW_LEN].replace("\n", " ")
            if len(result_text) > _RESULT_PREVIEW_LEN:
                preview += "…"
            logger.debug(
                "Tool result %-28s  %.2fs  %d chars  %s",
                block.name,
                elapsed,
                len(result_text),
                preview,
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                }
            )

        serialized = _serialize_content(response.content)
        messages.append({"role": "assistant", "content": serialized})
        messages.append({"role": "user", "content": tool_results})

        t0 = time.perf_counter()
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOL_DEFINITIONS,
            messages=messages,
        )
        logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
        _log_llm_response(response)

    final_content = _serialize_content(response.content)
    messages.append({"role": "assistant", "content": final_content})

    final_text = _extract_text(response.content)
    geojson = features_to_geojson(map_features) if map_features else None
    logger.info(
        "Agent done  rounds=%d  map_features=%d  response=%d chars",
        rounds,
        len(map_features),
        len(final_text),
    )

    yield {
        "type": "final",
        "response": final_text,
        "map_features": geojson,
        "messages": messages,
    }


def run_agent(
    messages: list[dict[str, Any]],
    bbox: dict[str, float] | None = None,
) -> dict[str, Any]:
    api_key = getattr(settings, "CLAUDE_API_KEY", None)
    if not api_key:
        logger.error("CLAUDE_API_KEY is not configured")
        return {
            "response": "Claude API key is not configured.",
            "map_features": None,
            "messages": messages,
        }

    model = getattr(settings, "CLAUDE_MODEL", "claude-sonnet-4-20250514")
    client = anthropic.Anthropic(api_key=api_key)
    map_features: list[dict[str, Any]] = []
    system_prompt = _build_system_prompt(bbox)

    logger.info(
        "Agent start  model=%s  messages=%d  bbox=%s",
        model,
        len(messages),
        f"yes ({bbox})" if bbox else "none",
    )

    t0 = time.perf_counter()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        tools=ALL_TOOL_DEFINITIONS,
        messages=messages,
    )
    logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
    _log_llm_response(response)

    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        logger.info("── Tool round %d ──────────────────────────────", rounds)

        tool_results: list[dict[str, Any]] = []
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            logger.info(
                "Tool call  %-28s  input=%s",
                block.name,
                str(block.input)[:120],
            )
            t_tool = time.perf_counter()
            result_text = execute_tool(block.name, block.input, map_features)
            elapsed = time.perf_counter() - t_tool
            preview = result_text[:_RESULT_PREVIEW_LEN].replace("\n", " ")
            if len(result_text) > _RESULT_PREVIEW_LEN:
                preview += "…"
            logger.debug(
                "Tool result %-28s  %.2fs  %d chars  %s",
                block.name,
                elapsed,
                len(result_text),
                preview,
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                }
            )

        serialized = _serialize_content(response.content)
        messages.append({"role": "assistant", "content": serialized})
        messages.append({"role": "user", "content": tool_results})

        t0 = time.perf_counter()
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOL_DEFINITIONS,
            messages=messages,
        )
        logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
        _log_llm_response(response)

    final_content = _serialize_content(response.content)
    messages.append({"role": "assistant", "content": final_content})

    final_text = _extract_text(response.content)
    geojson = features_to_geojson(map_features) if map_features else None
    logger.info(
        "Agent done  rounds=%d  map_features=%d  response=%d chars",
        rounds,
        len(map_features),
        len(final_text),
    )

    return {
        "response": final_text,
        "map_features": geojson,
        "messages": messages,
    }

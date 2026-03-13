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
MAX_TOOL_RESULT_CHARS = 8_000

WEB_SEARCH_TOOL: dict[str, str] = {"type": "web_search_20250305", "name": "web_search"}

_RESULT_PREVIEW_LEN = 200

SYSTEM_PROMPT = """\
You are an outdoor trip planning assistant. You help users plan hiking, \
camping, cycling, and other outdoor trips.

## Capabilities

- Web Search: Search the web for up-to-date information about trails, \
conditions, regulations, gear, weather, and anything not covered by the \
other tools.
- Map Display: Show found locations, trails, and routes on the user's \
interactive map.

## Guidelines

- When you find geographic results (locations, trails, POIs, routes), \
always call `show_on_map` so the user can see them visually.
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
        case "web_search":
            return f"Searching the web for \"{tool_input.get('query', '')}\""
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
    bbox_section = (
        f"\n\n## Current Map View\n"
        f"The user's map is currently showing the area with bounding box "
        f"south={south:.4f}, west={west:.4f}, north={north:.4f}, east={east:.4f}. "
        f"Whenever the user asks a question without explicitly naming a region, "
        f"treat this area as the default search context — do NOT ask for "
        f"clarification. Use the bounding box coordinates for Overpass queries "
        f"and as the geographic scope for web searches and Wikipedia lookups."
    )
    return SYSTEM_PROMPT + bbox_section


def _cached_system(text: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def _cached_tools(tools: list[Any]) -> list[Any]:
    if not tools:
        return tools
    tools = list(tools)
    last = dict(tools[-1])
    last["cache_control"] = {"type": "ephemeral"}
    tools[-1] = last
    return tools


def _truncate_tool_result(text: str) -> str:
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    drop = len(text) - MAX_TOOL_RESULT_CHARS
    return text[:MAX_TOOL_RESULT_CHARS] + f"\n[…{drop} chars truncated]"


def _log_llm_response(response: anthropic.types.Message) -> None:
    usage = getattr(response, "usage", None)
    usage_str = ""
    if usage:
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_create = getattr(usage, "cache_creation_input_tokens", 0) or 0
        usage_str = (
            f" | in={usage.input_tokens}"
            f" cache_read={cache_read}"
            f" cache_create={cache_create}"
            f" out={usage.output_tokens}"
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

    model = getattr(settings, "CLAUDE_MODEL")
    client = anthropic.Anthropic(api_key=api_key)
    map_features: list[dict[str, Any]] = []
    system_prompt = _build_system_prompt(bbox)

    logger.info(
        "Agent start  model=%s  messages=%d  bbox=%s",
        model,
        len(messages),
        f"yes ({bbox})" if bbox else "none",
    )

    all_tools: list[Any] = _cached_tools([WEB_SEARCH_TOOL, *ALL_TOOL_DEFINITIONS])
    cached_system = _cached_system(system_prompt)

    t0 = time.perf_counter()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=cached_system,
        tools=all_tools,
        messages=messages,
    )
    logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
    _log_llm_response(response)

    container_id: str | None = response.container.id if response.container else None

    rounds = 0
    while (
        response.stop_reason in ("tool_use", "pause_turn") and rounds < MAX_TOOL_ROUNDS
    ):
        rounds += 1
        logger.info("── Tool round %d ──────────────────────────────", rounds)

        serialized = _serialize_content(response.content)
        messages.append({"role": "assistant", "content": serialized})

        if response.stop_reason == "pause_turn":
            for block in response.content:
                if getattr(block, "type", None) == "server_tool_use":
                    label = _tool_label(block.name, block.input)
                    logger.info(
                        "Server tool  %-28s  input=%s",
                        block.name,
                        str(block.input)[:120],
                    )
                    yield {"type": "tool_call", "name": block.name, "label": label}
        else:
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
                if block.name == "show_on_map" and map_features:
                    yield {
                        "type": "map_update",
                        "map_features": features_to_geojson(map_features),
                    }
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": _truncate_tool_result(result_text),
                    }
                )
            messages.append({"role": "user", "content": tool_results})

        t0 = time.perf_counter()
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=cached_system,
            tools=all_tools,
            messages=messages,
            **({"container": container_id} if container_id else {}),
        )
        if response.container:
            container_id = response.container.id
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

    model = getattr(settings, "CLAUDE_MODEL")
    client = anthropic.Anthropic(api_key=api_key)
    map_features: list[dict[str, Any]] = []
    system_prompt = _build_system_prompt(bbox)

    logger.info(
        "Agent start  model=%s  messages=%d  bbox=%s",
        model,
        len(messages),
        f"yes ({bbox})" if bbox else "none",
    )

    all_tools: list[Any] = _cached_tools([WEB_SEARCH_TOOL, *ALL_TOOL_DEFINITIONS])
    cached_system = _cached_system(system_prompt)

    t0 = time.perf_counter()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=cached_system,
        tools=all_tools,
        messages=messages,
    )
    logger.debug("LLM call took %.2fs", time.perf_counter() - t0)
    _log_llm_response(response)

    container_id: str | None = response.container.id if response.container else None

    rounds = 0
    while (
        response.stop_reason in ("tool_use", "pause_turn") and rounds < MAX_TOOL_ROUNDS
    ):
        rounds += 1
        logger.info("── Tool round %d ──────────────────────────────", rounds)

        serialized = _serialize_content(response.content)
        messages.append({"role": "assistant", "content": serialized})

        if response.stop_reason == "pause_turn":
            for block in response.content:
                if getattr(block, "type", None) == "server_tool_use":
                    logger.info(
                        "Server tool  %-28s  input=%s",
                        block.name,
                        str(block.input)[:120],
                    )
        else:
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
                        "content": _truncate_tool_result(result_text),
                    }
                )
            messages.append({"role": "user", "content": tool_results})

        t0 = time.perf_counter()
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=cached_system,
            tools=all_tools,
            messages=messages,
            **({"container": container_id} if container_id else {}),
        )
        if response.container:
            container_id = response.container.id
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

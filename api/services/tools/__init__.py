from typing import Any

from . import display, overpass, transport, wikipedia, wikidata

DISPLAY_TOOLS = {"show_on_map"}

ALL_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    # *wikipedia.TOOL_DEFINITIONS,
    # *overpass.TOOL_DEFINITIONS,
    *transport.TOOL_DEFINITIONS,
    *display.TOOL_DEFINITIONS,
    *wikidata.TOOL_DEFINITIONS,
]

_DATA_HANDLERS: dict[str, Any] = {
    **wikipedia.TOOL_HANDLERS,
    **overpass.TOOL_HANDLERS,
    **transport.TOOL_HANDLERS,
    **wikidata.TOOL_HANDLERS,
}


def execute_tool(
    name: str,
    tool_input: dict[str, Any],
    map_features: list[dict[str, Any]],
) -> str:
    if name in DISPLAY_TOOLS:
        return display.handle_show_on_map(tool_input, map_features)

    handler = _DATA_HANDLERS.get(name)
    if handler is None:
        return f'{{"error": "Unknown tool: {name}"}}'

    try:
        return handler(tool_input)
    except Exception as e:
        return f'{{"error": "{type(e).__name__}: {e}"}}'

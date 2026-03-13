import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

TIMEOUT = 15.0
HEADERS = {
    "User-Agent": "OutdoorTripPlanner/1.0 (https://github.com/bartromgens/outdoor-trip-planner; contact@example.com) httpx"
}


def search_wikipedia(query: str, limit: int = 5) -> str:
    logger.info("Wikipedia search  %r  limit=%d", query, limit)
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": min(limit, 10),
        "format": "json",
    }
    t0 = time.perf_counter()
    resp = httpx.get(WIKIPEDIA_API, params=params, timeout=TIMEOUT, headers=HEADERS)
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.debug("Wikipedia search HTTP %s  %.2fs", resp.status_code, elapsed)

    data = resp.json()
    results = [
        {"title": r["title"], "snippet": r.get("snippet", "")}
        for r in data.get("query", {}).get("search", [])
    ]
    titles = [r["title"] for r in results]
    logger.info(
        "Wikipedia search result  %d hits  %s  %.2fs", len(results), titles, elapsed
    )
    return json.dumps(results, ensure_ascii=False)


def get_wikipedia_article(title: str) -> str:
    logger.info("Wikipedia article  %r", title)
    url = f"{WIKIPEDIA_REST}/page/summary/{title}"
    t0 = time.perf_counter()
    resp = httpx.get(url, timeout=TIMEOUT, follow_redirects=True, headers=HEADERS)
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.debug(
        "Wikipedia article HTTP %s  %.2fs  url=%s", resp.status_code, elapsed, resp.url
    )

    data = resp.json()
    result: dict[str, Any] = {
        "title": data.get("title", title),
        "extract": data.get("extract", ""),
    }
    if "coordinates" in data:
        result["coordinates"] = data["coordinates"]
    if data.get("thumbnail"):
        result["thumbnail"] = data["thumbnail"].get("source")

    has_coords = "coordinates" in result
    extract_len = len(result["extract"])
    logger.info(
        "Wikipedia article result  %r  extract=%d chars  coords=%s  %.2fs",
        result["title"],
        extract_len,
        has_coords,
        elapsed,
    )
    return json.dumps(result, ensure_ascii=False)


def search_wikimedia_images(query: str, limit: int = 5) -> str:
    logger.info("Wikimedia images  %r  limit=%d", query, limit)
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": 6,
        "gsrlimit": min(limit, 10),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata",
        "iiurlwidth": 800,
        "format": "json",
    }
    t0 = time.perf_counter()
    resp = httpx.get(COMMONS_API, params=params, timeout=TIMEOUT, headers=HEADERS)
    elapsed = time.perf_counter() - t0
    resp.raise_for_status()
    logger.debug("Wikimedia images HTTP %s  %.2fs", resp.status_code, elapsed)

    data = resp.json()
    pages = data.get("query", {}).get("pages", {})
    results = []
    for page in pages.values():
        info = page.get("imageinfo", [{}])[0]
        results.append(
            {
                "title": page.get("title", ""),
                "url": info.get("thumburl") or info.get("url", ""),
                "description_url": info.get("descriptionurl", ""),
            }
        )
    logger.info("Wikimedia images result  %d images  %.2fs", len(results), elapsed)
    return json.dumps(results, ensure_ascii=False)


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "search_wikipedia",
        "description": (
            "Search Wikipedia for articles matching a query. "
            "Returns article titles and snippets."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 5, max 10)",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_wikipedia_article",
        "description": (
            "Fetch a Wikipedia article summary by title. "
            "Returns the extract text, coordinates if available, "
            "and a thumbnail URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "The exact Wikipedia article title",
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "search_wikimedia_images",
        "description": (
            "Search Wikimedia Commons for images related to a query. "
            "Returns image titles and URLs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query for images",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 5, max 10)",
                },
            },
            "required": ["query"],
        },
    },
]

TOOL_HANDLERS = {
    "search_wikipedia": lambda inp: search_wikipedia(inp["query"], inp.get("limit", 5)),
    "get_wikipedia_article": lambda inp: get_wikipedia_article(inp["title"]),
    "search_wikimedia_images": lambda inp: search_wikimedia_images(
        inp["query"], inp.get("limit", 5)
    ),
}

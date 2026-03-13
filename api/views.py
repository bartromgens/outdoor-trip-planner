import json
import logging
from typing import Any

from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .services.agent import run_agent, stream_agent_events

logger = logging.getLogger(__name__)


@api_view(["GET"])
def health_check(request: Request) -> Response:
    return Response({"status": "ok"})


@api_view(["POST"])
def chat(request: Request) -> Response:
    messages = request.data.get("messages", [])
    if not messages:
        return Response(
            {"error": "messages is required"},
            status=400,
        )

    bbox = request.data.get("bbox") or None

    try:
        result = run_agent(messages, bbox=bbox)
    except Exception:
        logger.exception("Agent error")
        return Response(
            {"error": "An error occurred while processing your request."},
            status=500,
        )

    return Response(
        {
            "response": result["response"],
            "map_features": result["map_features"],
            "messages": result["messages"],
        }
    )


def _ndjson_event_stream(
    messages: list[dict[str, Any]],
    bbox: dict[str, float] | None,
) -> Any:
    try:
        for event in stream_agent_events(messages, bbox=bbox):
            yield json.dumps(event, ensure_ascii=False) + "\n"
    except Exception:
        logger.exception("Agent stream error")
        error_event = {"type": "error", "message": "An error occurred."}
        yield json.dumps(error_event) + "\n"


@csrf_exempt
@require_POST
def chat_stream(request: HttpRequest) -> HttpResponse:
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return HttpResponse(
            json.dumps({"error": "Invalid JSON body"}),
            status=400,
            content_type="application/json",
        )

    messages = body.get("messages", [])
    if not messages:
        return HttpResponse(
            json.dumps({"error": "messages is required"}),
            status=400,
            content_type="application/json",
        )

    bbox = body.get("bbox") or None

    return StreamingHttpResponse(
        _ndjson_event_stream(messages, bbox),
        content_type="application/x-ndjson",
    )

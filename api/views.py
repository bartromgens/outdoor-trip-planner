import json
import logging
from typing import Any

from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .models import Location
from .serializers import LocationSerializer
from .services.agent import run_agent, stream_agent_events
from .services.tools.wikidata import find_place_info

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


@api_view(["GET", "POST"])
def locations(request: Request) -> Response:
    if request.method == "GET":
        qs = Location.objects.all()
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        serializer = LocationSerializer(qs, many=True)
        return Response(serializer.data)

    try:
        existing = Location.objects.filter(
            name=request.data.get("name"),
            latitude=float(request.data.get("latitude", 0)),
            longitude=float(request.data.get("longitude", 0)),
        ).first()
        if existing:
            return Response(
                LocationSerializer(existing).data, status=status.HTTP_200_OK
            )
    except (TypeError, ValueError):
        pass

    serializer = LocationSerializer(data=request.data)
    if not serializer.is_valid():
        logger.warning(
            "Location save rejected  errors=%s  data=%s",
            serializer.errors,
            request.data,
        )
        raise serializers.ValidationError(serializer.errors)

    extra: dict = {}
    if not serializer.validated_data.get("wikidata_id"):
        try:
            info = find_place_info(serializer.validated_data["name"])
            if info:
                if info["wikidata_id"]:
                    extra["wikidata_id"] = info["wikidata_id"]
                if info[
                    "elevation_m"
                ] is not None and not serializer.validated_data.get("altitude"):
                    extra["altitude"] = info["elevation_m"]
        except Exception:
            logger.warning(
                "Wikidata enrichment failed for %r", serializer.validated_data["name"]
            )

    serializer.save(**extra)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def location_detail(request: Request, pk: int) -> Response:
    try:
        location = Location.objects.get(pk=pk)
    except Location.DoesNotExist:
        return Response(
            {"error": "Location not found"}, status=status.HTTP_404_NOT_FOUND
        )

    if request.method == "GET":
        return Response(LocationSerializer(location).data)

    if request.method == "PUT":
        serializer = LocationSerializer(location, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    location.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


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

import json
import logging
from pathlib import Path
from typing import Any

import httpx
from django.http import FileResponse, HttpRequest, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from django.conf import settings

from .models import Location
from .serializers import LocationSerializer
from .services.agent import run_agent, stream_agent_events
from .services.tools.transport import HEADERS, TIMEOUT, TRANSITOUS_BASE
from .services.tools.wikidata import find_place_info

logger = logging.getLogger(__name__)

CONTOURS_DIR = Path(__file__).resolve().parent / "static" / "contours"
VALID_CONTOUR_LEVELS = {1500, 1750, 2000, 2500, 3000}


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


@api_view(["GET"])
def contour(request: Request, elevation: int) -> Response:
    if elevation not in VALID_CONTOUR_LEVELS:
        return Response(
            {
                "error": f"Invalid elevation. Choose from {sorted(VALID_CONTOUR_LEVELS)}."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    path = CONTOURS_DIR / f"contour_{elevation}.geojson"
    if not path.exists():
        return Response(
            {
                "error": "Contour data not yet generated. Run manage.py generate_contours."
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    response = FileResponse(path.open("rb"), content_type="application/geo+json")
    response["Cache-Control"] = "public, max-age=86400"
    return response


@api_view(["GET"])
def reachability(request: Request) -> Response:
    lat_str = request.query_params.get("lat", "")
    lon_str = request.query_params.get("lon", "")
    time_str = request.query_params.get("time", "")
    try:
        max_travel_time = int(request.query_params.get("max_travel_time", 60))
    except (ValueError, TypeError):
        max_travel_time = 60

    if not lat_str or not lon_str:
        return Response(
            {"error": "lat and lon are required"}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return Response(
            {"error": "lat and lon must be numeric"}, status=status.HTTP_400_BAD_REQUEST
        )

    max_travel_time = min(max(max_travel_time, 15), 90)

    params: dict[str, Any] = {
        "one": f"{lat},{lon}",
        "maxTravelTime": max_travel_time,
        "maxMatchingDistance": 150,
        "maxTransfers": 3,
    }
    if time_str:
        params["time"] = time_str

    try:
        resp = httpx.get(
            f"{TRANSITOUS_BASE}/api/v1/one-to-all",
            params=params,
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except Exception:
        logger.exception("Reachability API error")
        return Response(
            {"error": "Failed to fetch reachability data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    data = resp.json()
    origin = data.get("one", {})

    features: list[dict[str, Any]] = []
    for item in data.get("all", []):
        place = item.get("place", {})
        if "lat" not in place or "lon" not in place:
            continue
        duration_min = item.get("duration", 0)
        if duration_min <= 15:
            bucket = 15
        elif duration_min <= 30:
            bucket = 30
        elif duration_min <= 45:
            bucket = 45
        else:
            bucket = 60
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [place["lon"], place["lat"]],
                },
                "properties": {
                    "name": place.get("name", ""),
                    "duration_min": duration_min,
                    "bucket": bucket,
                    "transfers": max(0, item.get("k", 1) - 1),
                },
            }
        )

    return Response(
        {
            "type": "FeatureCollection",
            "origin": {
                "lat": origin.get("lat", lat),
                "lon": origin.get("lon", lon),
            },
            "features": features,
        }
    )


ORS_BASE = "https://api.openrouteservice.org/v2"
# ORS foot-hiking uses a flat 5 km/h regardless of slope (elevation not modelled).
# Dividing the ORS time ranges by this factor compensates for the speed overestimation
# in mountain terrain, so the displayed labels (1h/2h/3h) reflect realistic hiking time.
ELEVATION_COMPENSATION_FACTOR = 1.5
ISOCHRONE_RANGES = [int(h * 3600 / ELEVATION_COMPENSATION_FACTOR) for h in [1, 2, 3]]


@api_view(["GET"])
def hike_isochrone(request: Request) -> Response:
    lat_str = request.query_params.get("lat", "")
    lon_str = request.query_params.get("lon", "")

    if not lat_str or not lon_str:
        return Response(
            {"error": "lat and lon are required"}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return Response(
            {"error": "lat and lon must be numeric"}, status=status.HTTP_400_BAD_REQUEST
        )

    api_key = getattr(settings, "ORS_API_KEY", "")
    if not api_key:
        return Response(
            {"error": "OpenRouteService API key not configured"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        resp = httpx.post(
            f"{ORS_BASE}/isochrones/foot-hiking",
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            json={
                "locations": [[lon, lat]],
                "range": ISOCHRONE_RANGES,
                "range_type": "time",
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except Exception:
        logger.exception("ORS isochrone API error")
        return Response(
            {"error": "Failed to fetch isochrone data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(resp.json())


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

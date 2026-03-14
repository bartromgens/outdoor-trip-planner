import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
from django.http import FileResponse, HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from django.conf import settings

from .models import (
    HikeRoute,
    Location,
    LocationIsochroneCache,
    LocationReachabilityCache,
    Map,
)
from .serializers import HikeRouteSerializer, LocationSerializer, MapSerializer
from .services.agent import run_agent, stream_agent_events
from .services import routing as routing_svc
from .services.tools.transport import HEADERS, TIMEOUT, TRANSITOUS_BASE
from .services.tools.wikidata import find_place_info

logger = logging.getLogger(__name__)

CONTOURS_DIR = Path(__file__).resolve().parent / "static" / "contours"
VALID_CONTOUR_LEVELS = {1500, 1750, 2000, 2500, 3000}


def _get_map_or_404(uuid: UUID) -> Map:
    try:
        return Map.objects.get(uuid=uuid)
    except Map.DoesNotExist:
        from rest_framework.exceptions import NotFound

        raise NotFound("Map not found")


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
    locations_in_view = request.data.get("locations_in_view") or None
    reachability_markers_in_view = (
        request.data.get("reachability_markers_in_view") or None
    )

    try:
        result = run_agent(
            messages,
            bbox=bbox,
            locations_in_view=locations_in_view,
            reachability_markers_in_view=reachability_markers_in_view,
        )
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
    locations_in_view: list[dict[str, Any]] | None = None,
    reachability_markers_in_view: list[dict[str, Any]] | None = None,
) -> Any:
    try:
        for event in stream_agent_events(
            messages,
            bbox=bbox,
            locations_in_view=locations_in_view,
            reachability_markers_in_view=reachability_markers_in_view,
        ):
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


DEFAULT_REACHABILITY_DATETIME = datetime(2026, 6, 23, 7, 0, 0, tzinfo=timezone.UTC)


def _parse_query_datetime(time_str: str | None) -> datetime:
    if not time_str:
        return DEFAULT_REACHABILITY_DATETIME
    s = time_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return DEFAULT_REACHABILITY_DATETIME


def _fetch_reachability(
    lat: float,
    lon: float,
    time_str: str | None = None,
    max_travel_time: int = 60,
) -> tuple[dict[str, Any], datetime]:
    max_travel_time = min(max(max_travel_time, 15), 90)
    query_datetime = _parse_query_datetime(time_str)
    params: dict[str, Any] = {
        "one": f"{lat},{lon}",
        "maxTravelTime": max_travel_time,
        "maxMatchingDistance": 150,
        "maxTransfers": 3,
        "time": query_datetime.isoformat(),
    }
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v1/one-to-all",
        params=params,
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
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
    return (
        {
            "type": "FeatureCollection",
            "origin": {
                "lat": origin.get("lat", lat),
                "lon": origin.get("lon", lon),
            },
            "features": features,
        },
        query_datetime,
    )


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
    try:
        data, _ = _fetch_reachability(lat, lon, time_str, max_travel_time)
        return Response(data)
    except Exception:
        logger.exception("Reachability API error")
        return Response(
            {"error": "Failed to fetch reachability data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )


def _routing_backend() -> str:
    return getattr(settings, "ROUTING_BACKEND", "ors").lower()


def _routing_api_key() -> str:
    backend = _routing_backend()
    if backend == "valhalla":
        return getattr(settings, "VALHALLA_API_KEY", "")
    return getattr(settings, "ORS_API_KEY", "")


def _routing_not_configured_error() -> Response:
    backend = _routing_backend()
    if backend == "valhalla":
        msg = "Valhalla API key not configured"
    else:
        msg = "OpenRouteService API key not configured"
    return Response({"error": msg}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


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

    api_key = _routing_api_key()
    if not api_key:
        return _routing_not_configured_error()

    backend = _routing_backend()
    try:
        if backend == "valhalla":
            data = routing_svc.isochrone_valhalla(lat, lon, api_key)
        else:
            data = routing_svc.isochrone_ors(lat, lon, api_key)
    except Exception:
        logger.exception("%s isochrone API error", backend.upper())
        return Response(
            {"error": "Failed to fetch isochrone data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(data)


@api_view(["GET", "POST"])
def hike_routes(request: Request) -> Response:
    if request.method == "GET":
        serializer = HikeRouteSerializer(HikeRoute.objects.all(), many=True)
        return Response(serializer.data)

    serializer = HikeRouteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def hike_route_detail(request: Request, pk: int) -> Response:
    try:
        route = HikeRoute.objects.get(pk=pk)
    except HikeRoute.DoesNotExist:
        return Response(
            {"error": "Hike route not found"}, status=status.HTTP_404_NOT_FOUND
        )

    if request.method == "GET":
        return Response(HikeRouteSerializer(route).data)

    if request.method == "PUT":
        serializer = HikeRouteSerializer(route, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    route.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def hike_directions(request: Request) -> Response:
    coordinates = request.data.get("coordinates")

    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return Response(
            {"error": "coordinates must be a list of at least 2 [lon, lat] pairs"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    api_key = _routing_api_key()
    if not api_key:
        return _routing_not_configured_error()

    backend = _routing_backend()
    try:
        if backend == "valhalla":
            data = routing_svc.directions_valhalla(coordinates, api_key)
        else:
            data = routing_svc.directions_ors(coordinates, api_key)
    except Exception:
        logger.exception("%s directions API error", backend.upper())
        return Response(
            {"error": "Failed to fetch directions data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(data)


@api_view(["POST"])
def maps(request: Request) -> Response:
    serializer = MapSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj = serializer.save()
    return Response(MapSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
def map_detail(request: Request, uuid: UUID) -> Response:
    map_obj = _get_map_or_404(uuid)
    if request.method == "GET":
        return Response(MapSerializer(map_obj).data)
    serializer = MapSerializer(map_obj, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(MapSerializer(map_obj).data)


@api_view(["GET", "POST"])
def map_locations(request: Request, uuid: UUID) -> Response:
    map_obj = _get_map_or_404(uuid)

    if request.method == "GET":
        qs = Location.objects.filter(map=map_obj)
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return Response(LocationSerializer(qs, many=True).data)

    try:
        existing = Location.objects.filter(
            map=map_obj,
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

    serializer.save(map=map_obj, **extra)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def map_location_detail(request: Request, uuid: UUID, pk: int) -> Response:
    map_obj = _get_map_or_404(uuid)
    try:
        loc = Location.objects.get(pk=pk, map=map_obj)
    except Location.DoesNotExist:
        return Response(
            {"error": "Location not found"}, status=status.HTTP_404_NOT_FOUND
        )

    if request.method == "GET":
        return Response(LocationSerializer(loc).data)

    if request.method == "PUT":
        serializer = LocationSerializer(loc, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    loc.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def location_hike_isochrone(request: Request, uuid: UUID, pk: int) -> Response:
    map_obj = _get_map_or_404(uuid)
    try:
        loc = Location.objects.get(pk=pk, map=map_obj)
    except Location.DoesNotExist:
        return Response(
            {"error": "Location not found"}, status=status.HTTP_404_NOT_FOUND
        )
    cache = LocationIsochroneCache.objects.filter(location=loc).first()
    if cache is not None:
        return Response(cache.data)
    api_key = _routing_api_key()
    if not api_key:
        return _routing_not_configured_error()
    lat, lon = loc.latitude, loc.longitude
    backend = _routing_backend()
    try:
        if backend == "valhalla":
            data = routing_svc.isochrone_valhalla(lat, lon, api_key)
        else:
            data = routing_svc.isochrone_ors(lat, lon, api_key)
    except Exception:
        logger.exception("%s isochrone API error", backend.upper())
        return Response(
            {"error": "Failed to fetch isochrone data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    LocationIsochroneCache.objects.create(
        location=loc, latitude=lat, longitude=lon, data=data
    )
    return Response(data)


@api_view(["GET"])
def location_reachability(request: Request, uuid: UUID, pk: int) -> Response:
    map_obj = _get_map_or_404(uuid)
    try:
        loc = Location.objects.get(pk=pk, map=map_obj)
    except Location.DoesNotExist:
        return Response(
            {"error": "Location not found"}, status=status.HTTP_404_NOT_FOUND
        )
    time_str = request.query_params.get("time", "")
    cache = LocationReachabilityCache.objects.filter(location=loc).first()
    if cache is not None:
        out = {**cache.data, "query_datetime": cache.query_datetime.isoformat()}
        return Response(out)
    lat, lon = loc.latitude, loc.longitude
    try:
        data, query_dt = _fetch_reachability(lat, lon, time_str or None, 60)
    except Exception:
        logger.exception("Reachability API error")
        return Response(
            {"error": "Failed to fetch reachability data"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    LocationReachabilityCache.objects.update_or_create(
        location=loc,
        defaults={"data": data, "query_datetime": query_dt},
    )
    out = {**data, "query_datetime": query_dt.isoformat()}
    return Response(out)


@api_view(["GET", "POST"])
def map_hike_routes(request: Request, uuid: UUID) -> Response:
    map_obj = _get_map_or_404(uuid)

    if request.method == "GET":
        serializer = HikeRouteSerializer(
            HikeRoute.objects.filter(map=map_obj), many=True
        )
        return Response(serializer.data)

    serializer = HikeRouteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(map=map_obj)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def map_hike_route_detail(request: Request, uuid: UUID, pk: int) -> Response:
    map_obj = _get_map_or_404(uuid)
    try:
        route = HikeRoute.objects.get(pk=pk, map=map_obj)
    except HikeRoute.DoesNotExist:
        return Response(
            {"error": "Hike route not found"}, status=status.HTTP_404_NOT_FOUND
        )

    if request.method == "GET":
        return Response(HikeRouteSerializer(route).data)

    if request.method == "PUT":
        serializer = HikeRouteSerializer(route, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    route.delete()
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
    locations_in_view = body.get("locations_in_view") or None
    reachability_markers_in_view = body.get("reachability_markers_in_view") or None

    return StreamingHttpResponse(
        _ndjson_event_stream(
            messages,
            bbox=bbox,
            locations_in_view=locations_in_view,
            reachability_markers_in_view=reachability_markers_in_view,
        ),
        content_type="application/x-ndjson",
    )

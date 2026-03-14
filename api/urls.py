from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("chat/", views.chat, name="chat"),
    path("chat/stream/", views.chat_stream, name="chat-stream"),
    path("locations/", views.locations, name="locations"),
    path("locations/<int:pk>/", views.location_detail, name="location-detail"),
    path("contours/<int:elevation>/", views.contour, name="contour"),
    path("reachability/", views.reachability, name="reachability"),
    path("hike-isochrone/", views.hike_isochrone, name="hike-isochrone"),
    path("hike-directions/", views.hike_directions, name="hike-directions"),
    path("hike-routes/", views.hike_routes, name="hike-routes"),
    path("hike-routes/<int:pk>/", views.hike_route_detail, name="hike-route-detail"),
    # Map-scoped endpoints
    path("maps/", views.maps, name="maps"),
    path("maps/<uuid:uuid>/", views.map_detail, name="map-detail"),
    path("maps/<uuid:uuid>/locations/", views.map_locations, name="map-locations"),
    path(
        "maps/<uuid:uuid>/locations/<int:pk>/",
        views.map_location_detail,
        name="map-location-detail",
    ),
    path(
        "maps/<uuid:uuid>/locations/<int:pk>/hike-isochrone/",
        views.location_hike_isochrone,
        name="location-hike-isochrone",
    ),
    path(
        "maps/<uuid:uuid>/locations/<int:pk>/reachability/",
        views.location_reachability,
        name="location-reachability",
    ),
    path(
        "maps/<uuid:uuid>/hike-routes/",
        views.map_hike_routes,
        name="map-hike-routes",
    ),
    path(
        "maps/<uuid:uuid>/hike-routes/<int:pk>/",
        views.map_hike_route_detail,
        name="map-hike-route-detail",
    ),
]

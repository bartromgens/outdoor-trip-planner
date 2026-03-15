import uuid as uuid_module

from django.db import models


class Map(models.Model):
    uuid = models.UUIDField(default=uuid_module.uuid4, unique=True, db_index=True)
    name = models.CharField(max_length=255, default="My Trip")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class HikeRoute(models.Model):
    map = models.ForeignKey(
        Map,
        on_delete=models.CASCADE,
        related_name="hike_routes",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    waypoints = models.JSONField(help_text="[[lon, lat], ...] user control points")
    geometry = models.JSONField(
        help_text="[[lon, lat], ...] LineString coordinates"
    )
    distance_m = models.FloatField(null=True, blank=True)
    duration_s = models.FloatField(null=True, blank=True)
    ascent_m = models.FloatField(null=True, blank=True)
    descent_m = models.FloatField(null=True, blank=True)
    elevation_profile = models.JSONField(
        null=True, blank=True, help_text="[[dist_m, elev_m], ...] elevation profile"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class Location(models.Model):
    GEOMETRY_TYPES = [
        ("point", "Point"),
        ("line", "Line"),
        ("polygon", "Polygon"),
    ]

    map = models.ForeignKey(
        Map,
        on_delete=models.CASCADE,
        related_name="locations",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    latitude = models.FloatField()
    longitude = models.FloatField()
    altitude = models.FloatField(null=True, blank=True)
    wikidata_id = models.CharField(max_length=20, blank=True, default="")
    description = models.TextField(blank=True, default="")
    link = models.URLField(max_length=500, blank=True, default="")
    category = models.CharField(max_length=100, blank=True, default="")
    geometry_type = models.CharField(
        max_length=10, choices=GEOMETRY_TYPES, default="point"
    )
    coordinates = models.JSONField(
        help_text="Raw coordinates: [lon, lat] for point, [[lon,lat],...] for line/polygon",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("map", "name", "latitude", "longitude")]

    def __str__(self) -> str:
        return self.name


class LocationIsochroneCache(models.Model):
    location = models.OneToOneField(
        Location,
        on_delete=models.CASCADE,
        related_name="isochrone_cache",
    )
    latitude = models.FloatField(help_text="Lat used for the isochrone request")
    longitude = models.FloatField(help_text="Lon used for the isochrone request")
    data = models.JSONField(help_text="Normalized FeatureCollection from ORS/Valhalla")


class LocationReachabilityCache(models.Model):
    location = models.OneToOneField(
        Location,
        on_delete=models.CASCADE,
        related_name="reachability_cache",
    )
    data = models.JSONField(help_text="Reachability response: type, origin, features")
    query_datetime = models.DateTimeField(
        help_text="Departure time used for the Transitous query (UTC)"
    )

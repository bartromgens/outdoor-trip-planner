from django.db import models


class Location(models.Model):
    GEOMETRY_TYPES = [
        ("point", "Point"),
        ("line", "Line"),
        ("polygon", "Polygon"),
    ]

    name = models.CharField(max_length=255)
    latitude = models.FloatField()
    longitude = models.FloatField()
    altitude = models.FloatField(null=True, blank=True)
    wikidata_id = models.CharField(max_length=20, blank=True, default="")
    description = models.TextField(blank=True, default="")
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
        unique_together = [("name", "latitude", "longitude")]

    def __str__(self) -> str:
        return self.name

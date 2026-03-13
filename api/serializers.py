from rest_framework import serializers

from .models import Location


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = [
            "id",
            "name",
            "latitude",
            "longitude",
            "altitude",
            "wikidata_id",
            "description",
            "category",
            "geometry_type",
            "coordinates",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

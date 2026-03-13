from django.contrib import admin

from .models import Location


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "category",
        "latitude",
        "longitude",
        "altitude",
        "created_at",
    ]
    list_filter = ["category", "geometry_type"]
    search_fields = ["name", "description"]
    readonly_fields = ["created_at", "updated_at"]

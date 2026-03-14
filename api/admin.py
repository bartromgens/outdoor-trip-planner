from django.contrib import admin

from .models import HikeRoute, Location, Map


class HikeRouteInline(admin.TabularInline):
    model = HikeRoute
    extra = 0
    readonly_fields = ["created_at", "updated_at"]


class LocationInline(admin.TabularInline):
    model = Location
    extra = 0
    readonly_fields = ["created_at", "updated_at"]


@admin.register(Map)
class MapAdmin(admin.ModelAdmin):
    list_display = ["name", "uuid", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["name"]
    readonly_fields = ["uuid", "created_at"]
    inlines = [HikeRouteInline, LocationInline]


@admin.register(HikeRoute)
class HikeRouteAdmin(admin.ModelAdmin):
    list_display = ["name", "map", "distance_m", "duration_s", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["name"]
    readonly_fields = ["created_at", "updated_at"]
    raw_id_fields = ["map"]


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "map",
        "category",
        "latitude",
        "longitude",
        "altitude",
        "created_at",
    ]
    list_filter = ["category", "geometry_type"]
    search_fields = ["name", "description"]
    readonly_fields = ["created_at", "updated_at"]
    raw_id_fields = ["map"]

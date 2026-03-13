from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("chat/", views.chat, name="chat"),
    path("chat/stream/", views.chat_stream, name="chat-stream"),
    path("locations/", views.locations, name="locations"),
    path("locations/<int:pk>/", views.location_detail, name="location-detail"),
]

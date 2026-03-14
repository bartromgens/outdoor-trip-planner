from django.db import migrations


def assign_locations_to_map_one(apps, schema_editor):
    Location = apps.get_model("api", "Location")
    Location.objects.all().update(map_id=1)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_map_alter_location_unique_together_hikeroute_map_and_more"),
    ]

    operations = [
        migrations.RunPython(assign_locations_to_map_one, noop),
    ]

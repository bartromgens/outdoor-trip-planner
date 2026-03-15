from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0007_location_isochrone_reachability_cache"),
    ]

    operations = [
        migrations.AddField(
            model_name="hikeroute",
            name="ascent_m",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="hikeroute",
            name="descent_m",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="hikeroute",
            name="elevation_profile",
            field=models.JSONField(
                blank=True,
                null=True,
                help_text="[[dist_m, elev_m], ...] elevation profile",
            ),
        ),
        migrations.AlterField(
            model_name="hikeroute",
            name="geometry",
            field=models.JSONField(
                help_text="[[lon, lat], ...] LineString coordinates"
            ),
        ),
    ]

from datetime import date, datetime, timezone

import httpx
from django.core.management.base import BaseCommand

from api.services.tools.transport import HEADERS, TIMEOUT, TRANSITOUS_BASE

LAT = 46.62683586735256
LON = 10.335130691528322
MAX_TRAVEL_TIME = 60

TEST_HOURS = [6, 8, 10, 12, 16, 18, 22]
BUCKETS = [15, 30, 45, 60]


def _bucket(duration_min: int) -> int:
    if duration_min <= 15:
        return 15
    if duration_min <= 30:
        return 30
    if duration_min <= 45:
        return 45
    return 60


def _fetch(iso_time: str) -> dict:
    resp = httpx.get(
        f"{TRANSITOUS_BASE}/api/v1/one-to-all",
        params={
            "one": f"{LAT},{LON}",
            "maxTravelTime": MAX_TRAVEL_TIME,
            "time": iso_time,
        },
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _summarise(data: dict) -> dict:
    counts: dict[int, int] = {b: 0 for b in BUCKETS}
    top: list[tuple[float, str]] = []

    for item in data.get("all", []):
        place = item.get("place", {})
        duration_min = item.get("duration", 0)
        counts[_bucket(duration_min)] += 1
        top.append((duration_min, place.get("name", "?")))

    top.sort(reverse=True)
    return {"counts": counts, "total": sum(counts.values()), "top5": top[:5]}


class Command(BaseCommand):
    help = "Compare reachability results at different times of day"

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            default=None,
            help="Date to test in YYYY-MM-DD format (default: today)",
        )

    def handle(self, *args, **options):
        test_date = (
            date.fromisoformat(options["date"]) if options["date"] else date.today()
        )

        self.stdout.write(self.style.SUCCESS(f"\nOrigin: {LAT}, {LON}"))
        self.stdout.write(
            self.style.SUCCESS(
                f"Date:   {test_date}  |  max_travel_time={MAX_TRAVEL_TIME} min\n"
            )
        )

        col_w = 7
        header = f"{'Time':<6} | {'Total':>{col_w}} | " + " | ".join(
            f"≤{b}min".rjust(col_w) for b in BUCKETS
        )
        divider = "-" * len(header)
        self.stdout.write(divider)
        self.stdout.write(header)
        self.stdout.write(divider)

        summaries: dict[int, dict] = {}

        for hour in TEST_HOURS:
            dt = datetime(
                test_date.year,
                test_date.month,
                test_date.day,
                hour,
                0,
                0,
                tzinfo=timezone.utc,
            )
            iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            self.stdout.write(f"  Fetching {iso} …", ending="\r")
            self.stdout.flush()

            try:
                data = _fetch(iso)
                s = _summarise(data)
                summaries[hour] = s
                row = f"{hour:02d}:00 | {s['total']:>{col_w}} | " + " | ".join(
                    f"{s['counts'][b]:>{col_w}}" for b in BUCKETS
                )
                self.stdout.write(row)
            except Exception as exc:
                self.stdout.write(f"{hour:02d}:00 | {'ERROR':>{col_w}} | {exc}")

        self.stdout.write(divider)

        self._print_top_stops(summaries)

    def _print_top_stops(self, summaries: dict[int, dict]) -> None:
        self.stdout.write(
            self.style.WARNING(
                "\nTop 5 most distant reachable stops per time slot (longest travel time first):\n"
            )
        )
        for hour, s in summaries.items():
            self.stdout.write(f"  {hour:02d}:00")
            if not s["top5"]:
                self.stdout.write("    (no stops reachable)")
                continue
            for dur, name in s["top5"]:
                self.stdout.write(f"    {dur:3d} min  {name}")

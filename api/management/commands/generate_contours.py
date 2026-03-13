import json
from pathlib import Path

import httpx
import numpy as np
from django.core.management.base import BaseCommand
from matplotlib import pyplot as plt
from shapely.geometry import LineString, mapping

CONTOUR_LEVELS = [1500, 2000, 2500, 3000]

# Switzerland bounding box (degrees)
SWISS_LON_MIN = 5.9
SWISS_LON_MAX = 10.5
SWISS_LAT_MIN = 45.8
SWISS_LAT_MAX = 47.8

# SRTM tiles needed: lat rows 45,46,47 × lon cols 5..10
SRTM_LATS = [45, 46, 47]
SRTM_LONS = [5, 6, 7, 8, 9, 10]

SRTM_BASE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/skadi"
TILE_SIZE = 3601  # SRTM1 (1 arc-second, ~30 m resolution)
SIMPLIFY_TOLERANCE = 0.0003  # ~30 m in degrees (matches SRTM1 resolution)

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "static" / "contours"


def tile_name(lat: int, lon: int) -> str:
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}"


def download_tile(lat: int, lon: int, cache_dir: Path) -> np.ndarray | None:
    name = tile_name(lat, lon)
    gz_path = cache_dir / f"{name}.hgt.gz"
    hgt_path = cache_dir / f"{name}.hgt"

    if not hgt_path.exists():
        url = f"{SRTM_BASE_URL}/{ns_dir(lat)}/{name}.hgt.gz"
        try:
            response = httpx.get(url, follow_redirects=True, timeout=30)
            response.raise_for_status()
            gz_path.write_bytes(response.content)
            import gzip

            with gzip.open(gz_path, "rb") as f_in:
                hgt_path.write_bytes(f_in.read())
            gz_path.unlink()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    data = np.frombuffer(hgt_path.read_bytes(), dtype=">i2").reshape(
        TILE_SIZE, TILE_SIZE
    )
    # Replace void values (-32768) with NaN
    arr = data.astype(np.float32)
    arr[arr == -32768] = np.nan
    return arr


def ns_dir(lat: int) -> str:
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"


def mosaic_tiles(
    tiles: dict[tuple[int, int], np.ndarray],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lats = sorted({lat for lat, _ in tiles}, reverse=True)
    lons = sorted({lon for _, lon in tiles})

    n_lat = len(lats) * (TILE_SIZE - 1) + 1
    n_lon = len(lons) * (TILE_SIZE - 1) + 1
    grid = np.full((n_lat, n_lon), np.nan, dtype=np.float32)

    for row_idx, lat in enumerate(lats):
        for col_idx, lon in enumerate(lons):
            tile = tiles.get((lat, lon))
            if tile is None:
                continue
            r_start = row_idx * (TILE_SIZE - 1)
            c_start = col_idx * (TILE_SIZE - 1)
            grid[r_start : r_start + TILE_SIZE, c_start : c_start + TILE_SIZE] = tile

    lat_arr = np.linspace(max(lats) + 1, min(lats), n_lat)
    lon_arr = np.linspace(min(lons), max(lons) + 1, n_lon)
    return grid, lat_arr, lon_arr


def extract_contour_geojson(
    grid: np.ndarray,
    lat_arr: np.ndarray,
    lon_arr: np.ndarray,
    level: int,
) -> dict:
    lon_grid, lat_grid = np.meshgrid(lon_arr, lat_arr)
    fig, ax = plt.subplots()
    cs = ax.contour(lon_grid, lat_grid, grid, levels=[level])
    plt.close(fig)

    # cs.allsegs is a list-per-level; we have exactly one level
    segments = cs.allsegs[0] if cs.allsegs else []

    features = []
    for seg in segments:
        if len(seg) < 2:
            continue
        line = LineString(seg).simplify(SIMPLIFY_TOLERANCE, preserve_topology=False)
        if line.is_empty or line.geom_type not in ("LineString", "MultiLineString"):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"elevation": level},
                "geometry": mapping(line),
            }
        )

    return {"type": "FeatureCollection", "features": features}


class Command(BaseCommand):
    help = "Generate GeoJSON contour lines for Switzerland at 1500/2000/2500/3000 m"

    def add_arguments(self, parser):
        parser.add_argument(
            "--cache-dir",
            type=Path,
            default=Path("/tmp/srtm_cache"),
            help="Directory to cache downloaded SRTM .hgt files",
        )
        parser.add_argument(
            "--levels",
            nargs="+",
            type=int,
            default=CONTOUR_LEVELS,
            help="Elevation levels to generate (default: 1500 2000 2500 3000)",
        )

    def handle(self, *args, **options):
        cache_dir: Path = options["cache_dir"]
        levels: list[int] = options["levels"]
        cache_dir.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        self.stdout.write("Downloading SRTM tiles for Switzerland…")
        tiles: dict[tuple[int, int], np.ndarray] = {}
        for lat in SRTM_LATS:
            for lon in SRTM_LONS:
                name = tile_name(lat, lon)
                self.stdout.write(f"  {name}… ", ending="")
                tile = download_tile(lat, lon, cache_dir)
                if tile is not None:
                    tiles[(lat, lon)] = tile
                    self.stdout.write("ok")
                else:
                    self.stdout.write("not found (ocean/void)")

        if not tiles:
            self.stderr.write(self.style.ERROR("No tiles downloaded – aborting."))
            return

        self.stdout.write("Mosaicking tiles…")
        grid, lat_arr, lon_arr = mosaic_tiles(tiles)

        # Clip to Swiss bounding box
        lat_mask = (lat_arr >= SWISS_LAT_MIN) & (lat_arr <= SWISS_LAT_MAX)
        lon_mask = (lon_arr >= SWISS_LON_MIN) & (lon_arr <= SWISS_LON_MAX)
        grid = grid[np.ix_(lat_mask, lon_mask)]
        lat_arr = lat_arr[lat_mask]
        lon_arr = lon_arr[lon_mask]

        for level in levels:
            self.stdout.write(f"Extracting {level} m contour…")
            geojson = extract_contour_geojson(grid, lat_arr, lon_arr, level)
            out_path = OUTPUT_DIR / f"contour_{level}.geojson"
            out_path.write_text(json.dumps(geojson, separators=(",", ":")))
            feat_count = len(geojson["features"])
            size_kb = out_path.stat().st_size // 1024
            self.stdout.write(
                self.style.SUCCESS(
                    f"  Saved {out_path} ({feat_count} features, {size_kb} KB)"
                )
            )

        self.stdout.write(self.style.SUCCESS("Done."))

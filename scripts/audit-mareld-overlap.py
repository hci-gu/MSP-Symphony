#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "shapely>=2.1,<3", "pyproj>=3.7,<4", "matplotlib>=3.9,<4"]
# ///
"""Read-only raster audit of the saved MARELD area and supplied wind-park polygon.

Run with uv run --python 3.12 scripts/audit-mareld-overlap.py
--area data/hav-symphony-2019/mareld-review-area.json.
Uses an explicit area snapshot; never
changes the application, input rasters, model configuration or account settings.
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer
import rasterio
from rasterio.features import geometry_mask
from hav_grid import grid_from_bounds
from hav_io import load_json, save_json, sha256
from rasterio.windows import from_bounds, Window
from shapely.geometry import mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/hav-symphony-2019"
PIXEL = 250


def statistics(values, included):
    data = np.asarray(values.data)
    valid = included & ~np.ma.getmaskarray(values) & np.isfinite(data) & (data >= 0)
    positive = valid & (data > 0)
    vals = data[valid]
    positives = data[positive]
    total = int(included.sum())
    return {
        "aoi_cells_250m": total,
        "valid_cells": int(valid.sum()),
        "positive_cells": int(positive.sum()),
        "zero_cells": int(np.count_nonzero(valid & (data == 0))),
        "missing_or_invalid_cells": int(np.count_nonzero(included & ~valid)),
        "valid_percent_aoi": round(float(valid.sum()) / total * 100, 4),
        "positive_percent_aoi": round(float(positive.sum()) / total * 100, 4),
        "positive_area_km2": float(positive.sum()) * PIXEL**2 / 1e6,
        "minimum": float(vals.min()) if vals.size else None,
        "maximum": float(vals.max()) if vals.size else None,
        "mean_valid": float(vals.mean()) if vals.size else None,
        "stddev_valid": float(vals.std()) if vals.size else None,
        "minimum_positive": float(positives.min()) if positives.size else None,
        "distinct_valid_values": int(np.unique(vals).size),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--area",
        type=Path,
        required=True,
        help="JSON area snapshot containing name, id and polygon (EPSG:4326)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DATA / "validation",
        help="Directory for the audit JSON and PNG",
    )
    args = parser.parse_args()
    area = load_json(args.area)
    windpark = load_json(ROOT / "data/hav-symphony-2019/historical-mareld/windpark.json")
    to_grid = Transformer.from_crs(4326, 3035, always_xy=True).transform
    square = transform(to_grid, shape(area["polygon"]))
    park = transform(to_grid, shape(windpark["geometry"]))
    assert square.is_valid and park.is_valid and square.contains(park)
    # The saved square is kilometre-aligned; remove only projection roundtrip noise.
    bounds = tuple(round(v) for v in square.bounds)
    assert np.allclose(square.bounds, bounds, rtol=0, atol=0.001)
    left, bottom, right, top = bounds
    affine, width, height = grid_from_bounds(bounds, PIXEL)
    assert width == height == 156
    masks = {
        "review_square": geometry_mask(
            [mapping(square)], (height, width), affine, invert=True
        ),
        "windpark": geometry_mask(
            [mapping(park)], (height, width), affine, invert=True
        ),
    }
    assert masks["review_square"].all()
    spec = load_json(DATA / "regional-import-mapping.json")
    boundaries = load_json(DATA / "derived/boundaries.json")
    prepared = load_json(DATA / "validation/regional-import-preparation.json")
    report = {
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "area_name": area["name"],
        "area_id": area["id"],
        "area_geometry_4326": area["polygon"],
        "windpark_geometry_4326": windpark["geometry"],
        "review_square_area_km2": (right - left) * (top - bottom) / 1e6,
        "windpark_area_km2": park.area / 1e6,
        "grid": {"crs": "EPSG:3035", "bounds": bounds, "pixel_metres": PIXEL},
        "method": "Positive finite raster values at 250 m cell centres inside each polygon. "
        "Original NoData and negative values excluded. Prepared rasters are UInt8 0-100, "
        "cropped/masked to 2022 offshore planning regions; their zero includes missing data. "
        "Original regional rasters are audited where that region intersects the square. "
        "Percentages use the entire AOI, not only valid-data cells. "
        "This measures spatial data availability, not current ecological abundance.",
        "regions": [],
        "datasets": [],
        "identical_positive_working_maps": [],
    }
    fingerprints = defaultdict(list)
    plot_layers = {}
    plot_names = [
        "Porpoise north sea",
        "Plankton pelagic",
        "Soft bottom deep",
        "Catch bottom trawl",
        "Noise 125Hz shipping",
    ]
    imported_mask = np.zeros((height, width), dtype=bool)

    def read_band(src, index):
        assert CRS(src.crs).to_epsg(min_confidence=20) == 3035
        assert np.allclose(src.res, (PIXEL, PIXEL), rtol=0, atol=1e-5)
        window = from_bounds(*bounds, src.transform)
        assert np.allclose(
            [window.col_off, window.row_off],
            [round(window.col_off), round(window.row_off)],
            rtol=0,
            atol=1e-5,
        )
        window = Window(round(window.col_off), round(window.row_off), width, height)
        return src.read(index, window=window, boundless=True, masked=True)

    for region in spec["regions"]:
        region_geometry = shape(
            next(
                r["polygon3035"]
                for r in boundaries["regions"]
                if r["name"] == region["region"]
            )
        )
        region_mask = geometry_mask(
            [mapping(region_geometry)], (height, width), affine, invert=True
        )
        imported_mask |= region_mask
        intersections = {
            name: {
                "intersection_km2": geom.intersection(region_geometry).area / 1e6,
                "intersection_percent": geom.intersection(region_geometry).area
                / geom.area
                * 100,
                "covered_cell_centres_percent": float((mask & region_mask).sum())
                / mask.sum()
                * 100,
            }
            for name, geom, mask in [
                ("review_square", square, masks["review_square"]),
                ("windpark", park, masks["windpark"]),
            ]
        }
        report["regions"].append(
            {
                "baseline": region["baseline_name"],
                "region": region["region"],
                "overlap": intersections,
            }
        )
        old_report = next(
            r for r in prepared if r["baseline"] == region["baseline_name"]
        )
        for category, filename in [
            ("Ecosystem", "ecosystems.tif"),
            ("Pressure", "pressures.tif"),
        ]:
            working_path = DATA / "derived" / region["slug"] / filename
            working_hash = sha256(working_path)
            expected = next(
                o
                for o in old_report["outputs"]
                if o["path"] == str(working_path.relative_to(DATA))
            )
            assert working_hash == expected["sha256"], (
                f"Prepared raster changed: {working_path}"
            )
            with rasterio.open(working_path) as working:
                for band in region["bands"][category]:
                    values = read_band(working, band["band_number"] + 1)
                    assert not np.any((values.filled(0) > 0) & ~region_mask)
                    row = {
                        "baseline": region["baseline_name"],
                        "category": category,
                        **band,
                        "working_path": str(working_path.relative_to(DATA)),
                        "working_sha256": working_hash,
                        "working": {
                            name: statistics(values, mask)
                            for name, mask in masks.items()
                        },
                    }
                    positive = values.filled(0) > 0
                    if region["slug"] == "vasterhavet" and band["title"] in plot_names:
                        plot_layers[band["title"]] = values.filled(0)
                    row["working"]["review_square"]["cells_1km_with_any_positive"] = (
                        int(
                            positive.reshape(height // 4, 4, width // 4, 4)
                            .any(axis=(1, 3))
                            .sum()
                        )
                    )
                    if positive.any():
                        key = hashlib.sha256(values.filled(0).tobytes()).hexdigest()
                        fingerprints[(category, key)].append(band["title"])
                    if intersections["review_square"]["intersection_km2"] > 0:
                        original_path = DATA / band["source"]
                        source_hash = sha256(original_path)
                        expected_band = next(
                            b
                            for b in old_report["bands"]
                            if b["category"] == category
                            and b["number"] == band["band_number"] + 1
                        )
                        assert source_hash == expected_band["source_sha256"], (
                            f"Source changed: {original_path}"
                        )
                        with rasterio.open(original_path) as original:
                            raw = read_band(original, 1)
                            row["original"] = {
                                name: statistics(raw, mask)
                                for name, mask in masks.items()
                            }
                            raw_positive = (~np.ma.getmaskarray(raw)) & (raw.data > 0)
                            for name, mask in masks.items():
                                row["original"][name][
                                    "positive_cells_outside_imported_domain"
                                ] = int(
                                    np.count_nonzero(raw_positive & mask & ~region_mask)
                                )
                                row["original"][name][
                                    "positive_cells_rounded_to_zero_inside_domain"
                                ] = int(
                                    np.count_nonzero(
                                        raw_positive & mask & region_mask & ~positive
                                    )
                                )
                            row["original_sha256"] = source_hash
                            quantized = np.floor(
                                np.clip(raw.filled(0), 0, 1) * 100 + 0.5
                            ).astype("uint8")
                            quantized[~region_mask] = 0
                            assert np.array_equal(quantized, values.filled(0)), (
                                f"Conversion mismatch: {band['source']}"
                            )
                    report["datasets"].append(row)
            print(
                f"Audited {region['region']}: {len(region['bands'][category])} {category} layers",
                flush=True,
            )
    report["identical_positive_working_maps"] = [
        {"category": category, "datasets": titles}
        for (category, _), titles in fingerprints.items()
        if len(titles) > 1
    ]
    assert len(report["datasets"]) == 212
    report["summary"] = {
        category: {
            "checked": sum(r["category"] == category for r in report["datasets"]),
            "positive_in_review_square": sum(
                r["category"] == category
                and r["working"]["review_square"]["positive_cells"] > 0
                for r in report["datasets"]
            ),
            "positive_in_windpark": sum(
                r["category"] == category
                and r["working"]["windpark"]["positive_cells"] > 0
                for r in report["datasets"]
            ),
        }
        for category in ["Ecosystem", "Pressure"]
    }
    path = args.output_dir / "mareld-overlap.json"
    save_json(path, report)
    plot_overlap(
        plot_layers,
        plot_names,
        imported_mask,
        park,
        bounds,
        args.output_dir / "mareld-overlap.png",
    )
    print(
        json.dumps(
            {
                "report": str(path),
                "summary": report["summary"],
                "regions": report["regions"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def plot_overlap(layers, names, covered, park, bounds, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    from matplotlib.patches import Patch
    import matplotlib.patheffects as effects

    left, bottom, right, top = bounds
    extent = (0, (right - left) / 1000, 0, (top - bottom) / 1000)
    x, y = park.exterior.xy
    x = (np.asarray(x) - left) / 1000
    y = (np.asarray(y) - bottom) / 1000
    fig, axes = plt.subplots(2, 3, figsize=(12.5, 9.5), layout="constrained")
    for ax in axes.flat:
        ax.set_xlim(0, 39)
        ax.set_ylim(0, 39)
        ax.set_xticks([0, 10, 20, 30, 39])
        ax.set_yticks([0, 10, 20, 30, 39])
        ax.set_xlabel("km east within review square", fontsize=9)
        ax.set_ylabel("km north within review square", fontsize=9)
        (line,) = ax.plot(x, y, color="#172f3d", lw=1.4)
        line.set_path_effects(
            [effects.Stroke(linewidth=2.8, foreground="white"), effects.Normal()]
        )
        ax.tick_params(labelsize=8)
    axes.flat[0].imshow(
        covered.astype(int),
        origin="upper",
        extent=extent,
        cmap=ListedColormap(["#e3e4e6", "#3697a7"]),
        vmin=0,
        vmax=1,
    )
    axes.flat[0].set_title(
        "Imported planning-area coverage\n44.4% of square · 100% of wind park",
        fontsize=11,
    )
    axes.flat[0].legend(
        handles=[
            Patch(color="#3697a7", label="Inside imported domain"),
            Patch(color="#e3e4e6", label="Outside imported domain"),
        ],
        loc="lower left",
        fontsize=7.5,
        framealpha=0.96,
    )
    cm = plt.get_cmap("viridis").copy()
    cm.set_bad("#e3e4e6")
    for ax, name in zip(list(axes.flat)[1:], names):
        image = ax.imshow(
            np.ma.array(layers[name], mask=~covered),
            origin="upper",
            extent=extent,
            cmap=cm,
            vmin=0,
            vmax=100,
        )
        ax.set_title(name, fontsize=11)
        bar = fig.colorbar(image, ax=ax, shrink=0.72, pad=0.025)
        bar.set_label("Normalized index (0–100)", fontsize=8)
        bar.ax.tick_params(labelsize=8)
    fig.suptitle(
        "MARELD: spatial data available for the 39 × 39 km review area\n"
        "Outlined polygon = wind park · 250 m raster cells · HaV 2019 package / 2022 planning mask",
        fontsize=13,
    )
    fig.savefig(path, dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    main()

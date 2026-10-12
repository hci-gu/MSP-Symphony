#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "shapely>=2.1,<3", "pyproj>=3.7,<4", "scipy>=1.14,<2"]
# ///
"""Prepare map-only MARELD source rasters and explicitly labelled POC extensions.

uv run --python 3.12 scripts/prepare-mareld-layers.py
Reads the overlap audit and original HaV files. Does not change native baselines,
account state, simulation inputs or API requests. All output is reproducible.
"""

import json
from pathlib import Path
import re

import numpy as np
from pyproj import CRS, Transformer
import rasterio
from rasterio.features import geometry_mask
from hav_grid import grid_from_bounds
from hav_io import load_json, save_json, sha256
from rasterio.windows import from_bounds, Window
from scipy.ndimage import distance_transform_edt
from shapely.geometry import shape, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/hav-symphony-2019"
OUTPUT = ROOT / "frontend/src/assets/mareld-layers"
PIXEL = 250
EXTEND = {"Porpoise north sea", "Plankton pelagic"}
FULL_SUPPORT = {"Cod", "Herring", "Sprat", "Noise 125Hz shipping"}
SUPPORT_LAYERS = [
    "Porpoise north sea",
    "Plankton pelagic",
    "Soft bottom deep",
    "Transport bottom deep",
]
NOTES = {
    "Porpoise north sea": "Historical relative distribution. Extension assumes comparable offshore habitat; habitat suitability and abundance are not validated.",
    "Plankton pelagic": "Normalized chlorophyll-a proxy for phytoplankton. Extension assumes a comparable offshore background; this is not zooplankton biomass.",
    "Cod": "Coarse regional abundance index, recovered across the square. Not calibrated biomass.",
    "Herring": "Coarse regional abundance index, recovered across the square. Not calibrated biomass.",
    "Sprat": "Coarse regional abundance index, recovered across the square. Not calibrated biomass.",
    "Fish spawning": "Weighted spawning-area index; not a recruitment rate. No extrapolation.",
    "Harbour seal": "Modelled distribution already uses a 40 km home range. Localized extent retained.",
    "Mussel reef": "Presence and habitat predictions. Zero can also mean no observations. Sparse features are retained without extension.",
    "Artificial reef": "Recorded structures that may form reefs; actual reef surface area is unknown. No extension.",
    "Hard bottom aphotic": "Substrate habitat, not benthic biomass. No extension without supporting depth and sediment data.",
    "Transport bottom deep": "Deep substrate habitat, not benthic biomass. No extension without supporting depth and sediment data.",
    "Soft bottom deep": "Deep soft-sediment habitat, not benthic biomass. No extension without supporting depth and sediment data.",
    "Rough bottom deep": "Deep substrate habitat. Small source values are preserved; no extension without depth and sediment evidence.",
    "Catch gillnet": "Historical gear-effort proxy. Foreign-fleet coverage is incomplete; zero does not establish absence of fishing. No extension.",
    "Catch pelagic trawl": "Six source cells overlap the review square, all outside the wind park. No extrapolation.",
    "Catch bottom trawl": "Swept-area proxy, not fishing mortality. Shares the same raster values as trawling turbidity; avoid double counting.",
    "Turbidity bottom trawl": "Same source intensity as bottom-trawl catch. A separate ecological response would be needed; avoid double counting.",
    "Abrasion bottom trawl": "Historical seabed abrasion index. Fishing-ground boundaries retained without extension.",
    "Noise 125Hz shipping": "Normalized historical shipping-noise index, not dB. Original coverage and low values recovered; no extrapolation.",
    "Oilspill shipping": "Shipping-related oil-spill pressure index. No extrapolation.",
    "Heavy metals background": "Normalized background contamination index. No extrapolation or assumed biological response.",
    "Toxic munition dump": "Distance-based risk around historical dumping sites and routes, not measured contamination. Spatial extent retained.",
    "Synthetic toxins background": "Normalized background contamination index. No extrapolation or assumed biological response.",
    "Nitrogen background": "Processed eutrophication index, not a direct nutrient-food input. Small source values retained; no extension.",
    "Phosphorous background": "Processed eutrophication index, not a direct nutrient-food input. Small source values retained; no extension.",
    "Climate change temperature": "2050 future scenario; not present-day baseline temperature. No extrapolation.",
    "Climate change acidification": "2050 future scenario; not present-day baseline pH. No extrapolation.",
}


def nearest(values, support):
    assert support.any()
    distances, indices = distance_transform_edt(
        ~support, sampling=PIXEL / 1000, return_indices=True
    )
    filled = values[tuple(indices)]
    filled[support] = values[support]
    return filled.astype("float32"), distances.astype("float32")


def validate_extension(values, support):
    """Spatially held-out 8 km blocks; errors are diagnostic, not confidence limits."""
    errors, median_errors, distances = [], [], []
    blocks = []
    for row in range(0, support.shape[0], 32):
        for col in range(0, support.shape[1], 32):
            held = np.zeros_like(support)
            held[row : row + 32, col : col + 32] = True
            held &= support
            train = support & ~held
            if held.sum() < 100 or train.sum() < 100:
                continue
            predicted, distance = nearest(values, train)
            err = predicted[held] - values[held]
            errors.extend(err.tolist())
            median_errors.extend((np.median(values[train]) - values[held]).tolist())
            distances.extend(distance[held].tolist())
            blocks.append(
                {
                    "row": row,
                    "column": col,
                    "cells": int(held.sum()),
                    "mae": float(np.abs(err).mean()),
                }
            )
    error, median_error = np.array(errors), np.array(median_errors)
    assert error.size > 0
    return {
        "method": "Leave one 8 km spatial block out; >=100 source cells per held-out block.",
        "blocks": len(blocks),
        "held_out_cells": len(errors),
        "nearest_mae": float(np.abs(error).mean()),
        "nearest_rmse": float(np.sqrt(np.mean(error**2))),
        "regional_median_mae": float(np.abs(median_error).mean()),
        "absolute_error_p90": float(np.percentile(np.abs(error), 90)),
        "max_tested_distance_km": max(distances),
        "limitation": "Internal spatial holdouts do not establish validity beyond the source footprint or across different habitats.",
        "block_results": blocks,
    }


def coverage(provenance, masks):
    return {
        name: {
            label: round(
                float(np.count_nonzero((provenance == code) & mask)) / mask.sum() * 100,
                3,
            )
            for code, label in [
                (0, "unknown"),
                (1, "source"),
                (2, "recovered"),
                (3, "inferred"),
            ]
        }
        for name, mask in masks.items()
    }


def main():
    audit = load_json(DATA / "validation/mareld-overlap.json")
    bounds = audit["grid"]["bounds"]
    left, bottom, right, top = bounds
    affine, width, height = grid_from_bounds(bounds, PIXEL)
    to_grid = Transformer.from_crs(4326, 3035, always_xy=True).transform
    park = transform(to_grid, shape(audit["windpark_geometry_4326"]))
    boundary = next(
        r
        for r in load_json(DATA / "derived/boundaries.json")["regions"]
        if r["name"] == "Västerhavet"
    )
    imported = geometry_mask(
        [boundary["polygon3035"]], (height, width), affine, invert=True
    )
    masks = {
        "square": np.ones((height, width), dtype=bool),
        "park": geometry_mask([mapping(park)], (height, width), affine, invert=True),
    }
    assert masks["park"].sum() == 5900
    rows = [
        r
        for r in audit["datasets"]
        if r["baseline"] == "HAV_2019_WEST_LOCAL"
        and r["original"]["review_square"]["positive_cells"] > 0
    ]
    arrays, valid_masks = {}, {}
    for layer in rows:
        path = DATA / layer["source"]
        assert sha256(path) == layer["original_sha256"], f"Source changed: {path}"
        with rasterio.open(path) as src:
            assert CRS(src.crs).to_epsg(min_confidence=20) == 3035
            assert np.allclose(src.res, (PIXEL, PIXEL))
            win = from_bounds(*bounds, src.transform)
            assert np.allclose(
                [win.col_off, win.row_off], [round(win.col_off), round(win.row_off)]
            )
            raw = src.read(
                1,
                window=Window(round(win.col_off), round(win.row_off), width, height),
                masked=True,
                boundless=True,
            )
            valid = (
                ~np.ma.getmaskarray(raw)
                & np.isfinite(raw.data)
                & (raw.data >= 0)
                & (raw.data <= 1.000001)
            )
            arrays[layer["title"]] = (raw.filled(0) * 100).astype("float32")
            valid_masks[layer["title"]] = valid
    # Four independent continuous regional rasters share exactly the same support.
    # Outside it, zero is ambiguous. We keep it unknown except in two explicit POC variants.
    support = arrays[SUPPORT_LAYERS[0]] > 0
    assert all(np.array_equal(support, arrays[name] > 0) for name in SUPPORT_LAYERS)
    assert np.all(support[masks["park"]])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "windpark-mask.bin").write_bytes(masks["park"].astype("uint8").tobytes())
    manifest = {
        "version": 1,
        "title": "MARELD area data",
        "reviewAreaName": audit["area_name"],
        "grid": {
            "crs": "EPSG:3035",
            "extent": bounds,
            "width": width,
            "height": height,
            "cellMetres": PIXEL,
        },
        "reviewGeometry": audit["area_geometry_4326"],
        "windparkGeometry": audit["windpark_geometry_4326"],
        "windparkMask": "windpark-mask.bin",
        "defaultLayer": "porpoise-north-sea",
        "attribution": "Havs- och vattenmyndigheten / original providers, CC BY 4.0. HaV 2019 package; source years vary.",
        "sourceUrl": "https://www.havochvatten.se/data-kartor-och-rapporter/rapporter-och-andra-publikationer/publikationer/2018-04-10-symphony---integrerat-planeringsstod-for-statlig-havsplanering-utifran-en-ekosystemansats.html",
        "binaryFormat": "Row-major north to south: width*height little-endian Float32 normalized 0–100 values, then width*height UInt8 provenance codes. Unknown values are NaN.",
        "provenance": {
            "0": "Unknown source support",
            "1": "Source within imported boundary",
            "2": "Recovered source beyond imported boundary",
            "3": "Inferred POC extension",
        },
        "supportPolicy": "Source support is conservatively estimated from four continuous regional rasters with identical positive footprints. Original fish and shipping-noise fields retain their full valid extent. Other layers retain zeros within regional support and any positive values outside it; ambiguous zeros beyond it remain unknown. Source means published model/index, not direct observation.",
        "layers": [],
    }
    validation = {
        "source_audit_sha256": sha256(DATA / "validation/mareld-overlap.json"),
        "layers": [],
    }

    for layer in rows:
        name = layer["title"]
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        raw = arrays[name]
        known = valid_masks[name] & (
            True if name in FULL_SUPPORT else support | (raw > 0)
        )
        original = np.where(known, raw, np.nan).astype("float32")
        provenance = np.where(known, np.where(imported, 1, 2), 0).astype("uint8")
        variants = {"source": (original, provenance)}
        extension = None
        if name in EXTEND:
            central, distance = nearest(original, known)
            diagnostic = validate_extension(original, known)
            error = diagnostic["absolute_error_p90"]
            lo, hi = np.percentile(original[known], [10, 90])
            lower, upper = central.copy(), central.copy()
            lower[~known] = np.clip(np.minimum(central[~known], lo - error), 0, 100)
            upper[~known] = np.clip(np.maximum(central[~known], hi + error), 0, 100)
            extended_provenance = np.where(known, provenance, 3).astype("uint8")
            variants.update(
                {
                    "extended": (central, extended_provenance),
                    "lower": (lower, extended_provenance),
                    "upper": (upper, extended_provenance),
                }
            )
            distance_file = f"{slug}-distance-km.bin"
            (OUTPUT / distance_file).write_bytes(distance.astype("<f4").tobytes())
            extension = {
                "method": "Nearest source cell across unknown offshore support; source values remain unchanged.",
                "sensitivity": "Only inferred cells vary: lower/upper use source p10/p90 widened by held-out p90 absolute error, enclosing the nearest-cell estimate. These are illustrative sensitivity bounds, not confidence intervals.",
                "distanceFile": distance_file,
                "maxDistanceKm": float(distance.max()),
                "beyondValidationPercent": float(
                    np.mean(distance[~known] > diagnostic["max_tested_distance_km"])
                    * 100
                ),
                "validation": diagnostic,
            }
            assert np.array_equal(central[known], original[known])
            assert np.array_equal(lower[masks["park"]], original[masks["park"]])
            assert np.all(lower <= central) and np.all(central <= upper)

        entry = {
            "id": slug,
            "title": name,
            "category": layer["category"].upper(),
            "theme": layer["theme"],
            "future": name.startswith("Climate change"),
            "note": NOTES[name],
            "source": layer["source"],
            "sourceSha256": layer["original_sha256"],
            "metadataPdfPage": layer["metadata_pdf_page"],
            "positivePercent": {
                "square": layer["original"]["review_square"]["positive_percent_aoi"],
                "park": layer["original"]["windpark"]["positive_percent_aoi"],
            },
            "extension": extension,
            "variants": {},
        }
        for variant, (values, codes) in variants.items():
            assert np.array_equal(values[known], raw[known])
            assert np.all((values[codes > 0] >= 0) & (values[codes > 0] <= 100.0001))
            assert np.all(np.isnan(values[codes == 0]))
            assert np.array_equal(values[masks["park"]], raw[masks["park"]])
            filename = f"{slug}-{variant}.bin"
            content = values.astype("<f4").tobytes() + codes.tobytes()
            (OUTPUT / filename).write_bytes(content)
            # A georeferenced, self-describing download, independent of the renderer.
            tiff = f"{slug}-{variant}.tif"
            with rasterio.open(
                OUTPUT / tiff,
                "w",
                driver="GTiff",
                width=width,
                height=height,
                count=2,
                dtype="float32",
                crs="EPSG:3035",
                transform=affine,
                nodata=-9999,
                compress="deflate",
            ) as dst:
                dst.write(np.where(codes > 0, values, -9999), 1)
                dst.write(codes.astype("float32"), 2)
                dst.set_band_description(1, f"{name}: normalized index 0–100")
                dst.set_band_description(
                    2, "Provenance: 0 unknown, 1 source, 2 recovered, 3 inferred"
                )
                dst.update_tags(
                    source=layer["source"],
                    source_sha256=layer["original_sha256"],
                    variant=variant,
                    attribution=manifest["attribution"],
                    purpose="Map-only exploratory POC; not a calibrated simulation input",
                )
            entry["variants"][variant] = {
                "file": filename,
                "geotiff": tiff,
                "sha256": sha256(OUTPUT / filename),
                "coverage": coverage(codes, masks),
            }
        manifest["layers"].append(entry)
        validation["layers"].append(
            {
                "id": slug,
                "sourceValuesPreserved": True,
                "windparkValuesUnchanged": True,
                "extension": extension,
            }
        )
        print(f"Prepared {name}: {', '.join(variants)}", flush=True)
    assert len(manifest["layers"]) == 27
    save_json(OUTPUT / "manifest.json", manifest)
    (DATA / "validation/mareld-layer-preparation.json").write_text(
        json.dumps(validation, indent=2) + "\n"
    )
    print(
        f"Prepared 27 map layers, including two POC extensions, in {OUTPUT.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()

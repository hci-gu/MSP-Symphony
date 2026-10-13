#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "shapely>=2.1,<3", "pyproj>=3.7,<4"]
# ///
"""Prepare Poseidon geometries and audit native input support. No database writes.

The official EPSG:3006 corners and study square are recorded in poseidon.md.
Native values remain those used by Symphony; source rasters supply provenance.
"""

from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import transform

from hav_grid import grid_from_bounds
from hav_io import load_json, save_json, sha256

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/hav-symphony-2019"
OUTPUT = ROOT / "data/poseidon"
EXTENT = [4358000, 3858000, 4397000, 3897000]
CORNERS = [
    (253118.60, 6447499.29), (254780.37, 6448455.64),
    (263678.20, 6424446.46), (267785.01, 6424209.70),
    (269043.79, 6421569.61), (260088.58, 6422185.58),
    (252814.98, 6431907.42), (253118.60, 6447499.29),
]
CANDIDATES = {"Ecosystem": [1, 8, 10, 14, 17, 20, 21, 22, 31],
              "Pressure": [3, 4, 7, 13, 14]}


def feature(geometry, name, **properties):
    return {"type": "Feature", "properties": {"name": name, **properties},
            "geometry": mapping(geometry)}


def read(path, band=1):
    with rasterio.open(path) as source:
        assert CRS(source.crs).to_epsg(min_confidence=20) == 3035
        assert np.allclose(source.res, (250, 250))
        window = from_bounds(*EXTENT, source.transform)
        assert np.allclose([window.col_off, window.row_off],
                           np.round([window.col_off, window.row_off]), atol=1e-5)
        return source.read(band, window=Window(round(window.col_off), round(window.row_off), 156, 156),
                           masked=True, boundless=True)


def stats(values, support, mask):
    selected = mask & support
    total = int(mask.sum())
    data = np.asarray(values)
    return {"cells": total, "supportedCells": int(selected.sum()),
            "positiveCells": int(np.count_nonzero(selected & (data > 0))),
            "zeroCells": int(np.count_nonzero(selected & (data == 0))),
            "unknownCells": int(np.count_nonzero(mask & ~support)),
            "coverage": float(selected.sum() / total) if total else 0,
            "minimum": float(data[selected].min()) if selected.any() else None,
            "maximum": float(data[selected].max()) if selected.any() else None}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    square = box(*EXTENT)
    park = transform(Transformer.from_crs(3006, 3035, always_xy=True).transform,
                     Polygon(CORNERS).segmentize(100))
    to_wgs84 = Transformer.from_crs(3035, 4326, always_xy=True).transform
    save_json(OUTPUT / "study-area.geojson", feature(
        transform(to_wgs84, square.segmentize(250)), "Poseidon POC review area",
        sourceCrs="EPSG:3035", sourceExtent=EXTENT, reference="poseidon.md"))
    save_json(OUTPUT / "windpark.geojson", feature(
        transform(to_wgs84, park), "Poseidon wind park",
        sourceCrs="EPSG:3006", reference="Government decision KN2023/00991; poseidon.md"))
    affine, width, height = grid_from_bounds(EXTENT, 250)
    mask = lambda geom: geometry_mask([mapping(geom)], (height, width), affine, invert=True)
    mapping_spec = load_json(DATA / "regional-import-mapping.json")
    region = next(r for r in mapping_spec["regions"] if r["baseline_name"] == "HAV_2019_WEST_LOCAL")
    boundary = shape(next(r["polygon3035"] for r in load_json(DATA / "derived/boundaries.json")["regions"]
                          if r["name"] == region["region"]))
    imported = mask(boundary)
    masks = {"square": mask(square), "park": mask(park), "nativeSquare": mask(square) & imported,
             "nativePark": mask(park) & imported}
    # Original files include ambiguous zero padding outside regional support.
    # Porpoise and plankton are the continuous regional support proxies.
    # Habitat layers have meaningful zeros at Poseidon and must not define
    # the regional boundary; this is a support assumption, not observed absence.
    continuous = []
    for number in [1, 8]:
        band = next(b for b in region["bands"]["Ecosystem"] if b["band_number"] == number)
        values = read(DATA / band["source"])
        continuous.append(~np.ma.getmaskarray(values) & (values.filled(0) > 0))
    regional_support = np.logical_and.reduce(continuous)
    report = {"baseline": region["baseline_name"], "reference": "poseidon.md",
              "grid": {"crs": "EPSG:3035", "extent": EXTENT, "width": width,
                       "height": height, "cellMetres": 250, "rowOrder": "north-first"},
              "nativeDomainCells": int(imported.sum()), "squareCells": width * height,
              "parkAreaKm2": park.area / 1e6,
              "supportPolicy": "Finite nonnegative original cells inside imported boundary. "
              "Fish/noise use original validity; other bands require joint porpoise/plankton support "
              "or positive original values. Zero outside that support remains unknown.",
              "layers": []}
    for category, numbers in CANDIDATES.items():
        native_path = DATA / "derived/vasterhavet" / ("ecosystems.tif" if category == "Ecosystem" else "pressures.tif")
        native_hash = sha256(native_path)
        for number in numbers:
            band = next(b for b in region["bands"][category] if b["band_number"] == number)
            source_path = DATA / band["source"]
            original = read(source_path)
            data = original.filled(np.nan)
            valid = ~np.ma.getmaskarray(original) & np.isfinite(data) & (data >= 0)
            full_support = (category == "Pressure" and number == 13) or (category == "Ecosystem" and number in [20, 21, 22])
            support = valid & (True if full_support else (regional_support | (data > 0)))
            native = read(native_path, number + 1).filled(0)
            report["layers"].append({"category": category, "bandNumber": number, "title": band["title"],
                "nativePath": str(native_path.relative_to(ROOT)), "nativeSha256": native_hash,
                "sourceScale": "normalized relative index; typically 0–1",
                "nativeScale": "rounded UInt8 relative index 0–100",
                "source": {"path": band["source"], "sha256": sha256(source_path)},
                "coverage": {name: stats(native, support & imported, m) for name, m in masks.items()}})
    save_json(OUTPUT / "coverage-audit.json", report)
    print("Poseidon domain:", report["nativeDomainCells"], "/", width * height, "native cells")
    for layer in report["layers"]:
        coverage = layer["coverage"]["nativeSquare"]
        print(layer["category"], layer["bandNumber"], layer["title"],
              f"support={coverage['coverage']:.2%}, positive={coverage['positiveCells']}, unknown={coverage['unknownCells']}")


if __name__ == "__main__":
    main()

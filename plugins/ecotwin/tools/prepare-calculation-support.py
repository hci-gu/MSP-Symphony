#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "shapely>=2.1,<3", "pyproj>=3.7,<4"]
# ///
"""Build provenance sidecars for saved-calculation exports; native rasters stay unchanged.

Currently the reviewed support policy is available for the West 2019 package.
Copy the generated sidecars beside the corresponding deployed baseline rasters.
"""
from pathlib import Path
import argparse

import numpy as np
import rasterio
from pyproj import CRS
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds, Window

from profile_io import load_json, save_json, sha256

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "examples/ecotwin/data/hav-symphony-2019"


def main():
    region = next(r for r in load_json(DATA / "regional-import-mapping.json")["regions"]
                  if r["baseline_name"] == "HAV_2019_WEST_LOCAL")
    folder = DATA / "derived" / region["slug"]
    with rasterio.open(folder / "ecosystems.tif") as native:
        bounds, affine, width, height = native.bounds, native.transform, native.width, native.height
        profile = native.profile.copy()
    profile.update(dtype="uint8", nodata=None, compress="deflate", count=1)
    boundary = next(r["polygon3035"] for r in load_json(DATA / "derived/boundaries.json")["regions"]
                    if r["name"] == region["region"])
    domain = geometry_mask([boundary], (height, width), affine, invert=True)

    def read(band):
        with rasterio.open(DATA / band["source"]) as source:
            assert CRS(source.crs).to_epsg(min_confidence=20) == 3035
            assert np.allclose(source.res, (250, 250))
            window = from_bounds(*bounds, source.transform)
            assert np.allclose([window.col_off, window.row_off],
                               np.round([window.col_off, window.row_off]), atol=1e-5)
            return source.read(1, window=Window(round(window.col_off), round(window.row_off), width, height),
                               boundless=True, masked=True)

    regional = domain.copy()
    for number in [1, 8]:
        value = read(next(b for b in region["bands"]["Ecosystem"] if b["band_number"] == number))
        regional &= ~np.ma.getmaskarray(value) & (value.filled(0) > 0)
    manifest = {"version": "native-input-support-v1", "baselineName": region["baseline_name"],
                "crs": "EPSG:3035", "units": "relative index 0–100",
                "sourceUnits": "historical normalized index, typically 0–1",
                "policy": "Published finite nonnegative cells within the imported planning boundary. "
                "Fish and shipping noise use original validity. Other layers use joint positive "
                "porpoise/plankton regional support or positive original values. Regional support "
                "is a documented proxy; source values may be modelled and zeros outside support remain unknown.",
                "historicalLimitation": "Hashes describe files at export preparation time, not independently archived calculation-time files.",
                "sources": {}, "layers": [], "domainFile": "calculation-domain.tif"}
    with rasterio.open(folder / manifest["domainFile"], "w", **profile) as target:
        target.write(domain.astype("uint8"), 1)
    manifest["domainSha256"] = sha256(folder / manifest["domainFile"])
    for category, filename in [("Ecosystem", "ecosystems.tif"), ("Pressure", "pressures.tif")]:
        bands = region["bands"][category]
        support_name = filename.replace(".tif", "-support.tif")
        source_hash = sha256(folder / filename)
        with rasterio.open(folder / support_name, "w", **{**profile, "count": len(bands)}) as target:
            for band in bands:
                original = read(band)
                data = original.filled(np.nan)
                valid = ~np.ma.getmaskarray(original) & np.isfinite(data) & (data >= 0)
                full = (category == "Pressure" and band["band_number"] == 13) or (
                    category == "Ecosystem" and band["band_number"] in [20, 21, 22])
                supported = valid & domain & (True if full else (regional | (data > 0)))
                target.write(supported.astype("uint8"), band["band_number"] + 1)
                target.set_band_description(band["band_number"] + 1, band["title"])
                manifest["layers"].append({"category": category.upper(), "bandNumber": band["band_number"],
                    "title": band["title"], "sourcePath": band["source"],
                    "sourceSha256": sha256(DATA / band["source"]), "units": manifest["units"]})
        manifest["sources"][category.upper()] = {"sha256": source_hash, "supportFile": support_name,
                                                "supportSha256": sha256(folder / support_name)}
    save_json(folder / "calculation-input-support.json", manifest)
    # Small versioned provenance record; rasters are reproducible generated assets.
    save_json(DATA / "validation/calculation-input-support.json", manifest)
    print("Prepared calculation support in", folder, "without modifying native inputs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA, help="Prepared HaV West profile data directory")
    DATA = parser.parse_args().data.resolve()
    main()

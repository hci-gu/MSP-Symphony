#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["rasterio>=1.4,<2", "fiona>=1.10,<2", "shapely>=2.1,<3", "pyproj>=3.7,<4"]
# ///
"""Build explicitly mapped, exploratory regional baselines; never modifies the DB.
Run the source fetcher first, then: uv run scripts/prepare-hav-symphony-regions.py
"""
from pathlib import Path
import csv
import hashlib
import json
import math
import urllib.request
import zipfile

import fiona
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from pyproj import CRS, Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/hav-symphony-2019"
OUT = DATA / "derived"


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def fetch_boundaries():
    spec = json.loads((DATA / "regional-import-sources.json").read_text())
    for item in spec["downloads"]:
        path = DATA / item["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            part = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(item["url"], part)
            if sha(part) != item["sha256"]:
                raise ValueError(f"Download checksum mismatch: {part}")
            part.rename(path)
        if sha(path) != item["sha256"]:
            raise ValueError(f"Checksum mismatch: {path}")
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as z:
                # The pinned archive has only these two flat, reviewed members.
                assert set(z.namelist()) == {"havsplaner-2022.gpkg", "Datadokumentation_Havsplaner_2022.pdf"}
                for name in z.namelist():
                    dest = path.parent / name
                    payload = z.read(name)
                    if dest.exists() and dest.read_bytes() != payload:
                        raise ValueError(f"Existing extracted file changed: {dest}")
                    dest.write_bytes(payload)
    return DATA / "reference/boundaries/havsplaner-2022.gpkg"


def boundaries(gpkg):
    to_geo = Transformer.from_crs(3006, 4326, always_xy=True).transform
    to_grid = Transformer.from_crs(3006, 3035, always_xy=True).transform
    result = {}
    for key, layer in [("regions", "1 - havsplaneomraden"), ("seas", "2 - havsomraden"), ("areas", "5 - omraden")]:
        result[key] = []
        with fiona.open(gpkg, layer=layer) as src:
            for feature in src:
                props = dict(feature.properties)
                geom = shape(feature.geometry)
                assert geom.is_valid and not geom.is_empty
                if key == "areas":
                    name = props["IDnummer"] + " – " + props["Omrade"]
                else:
                    name = props["Namn"]
                result[key].append({"name": name, "properties": props,
                    "areaKm2": geom.area / 1e6,
                    "polygon": mapping(transform(to_geo, geom)),
                    "polygon3035": mapping(transform(to_grid, geom))})
    save(OUT / "boundaries.json", result)
    return result


def prepare_region(region, area):
    folder = OUT / region["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    geom = shape(area["polygon3035"])
    left, bottom, right, top = geom.bounds
    # All original grids use the same 250 m alignment (checked below).
    left, bottom = math.floor(left / 250) * 250, math.floor(bottom / 250) * 250
    right, top = math.ceil(right / 250) * 250, math.ceil(top / 250) * 250
    affine = from_origin(left, top, 250, 250)
    width, height = int((right-left)/250), int((top-bottom)/250)
    inside = geometry_mask([mapping(geom)], (height, width), affine, invert=True)
    report = {"baseline": region["baseline_name"], "region": region["region"],
        "width": width, "height": height, "crs": "EPSG:3035", "pixel_size_m": 250,
        "bounds": [left, bottom, right, top], "inside_pixels": int(inside.sum()), "bands": [], "outputs": []}
    profile = dict(driver="GTiff", width=width, height=height, transform=affine,
        crs="EPSG:3035", dtype="uint8", tiled=True, blockxsize=256, blockysize=256,
        compress="deflate", interleave="pixel", photometric="MINISBLACK", BIGTIFF="IF_SAFER")
    selected = {}
    for category, filename in [("Ecosystem", "ecosystems.tif"), ("Pressure", "pressures.tif")]:
        bands = region["bands"][category]
        selected[category] = []
        path = folder / filename
        with rasterio.open(path.with_suffix(".part.tif"), "w", count=len(bands), **profile) as dst:
            for band in bands:
                with rasterio.open(DATA / band["source"]) as src:
                    # ESRI exports round GRS80 flattening, lowering EPSG match confidence.
                    assert src.count == 1 and CRS(src.crs).to_epsg(min_confidence=20) == 3035
                    assert np.allclose(src.res, (250,250), atol=1e-5)
                    offset = ((src.transform.c-left)/250, (src.transform.f-top)/250)
                    if not np.allclose(offset, np.rint(offset), atol=1e-5):
                        raise ValueError(f"Unexpected grid misalignment: {band['source']} {offset}")
                    source = src.read(1, masked=True)
                    valid = source.compressed()
                    lo, hi = float(valid.min()), float(valid.max())
                    negatives = valid[valid < 0]
                    # Published boating rasters also contain -0.01, despite their -1e9
                    # NoData tag. Treat this invalid intensity as missing, never as 255.
                    if not np.isfinite(valid).all() or hi > 1+1e-6 or (negatives.size and not np.allclose(negatives, -.01, atol=1e-8)):
                        raise ValueError(f"Unexpected normalized value range {lo}..{hi}: {band['source']}")
                    grid = np.zeros((height, width), dtype="float32")
                    reproject(source=source.filled(0), destination=grid,
                        src_transform=src.transform, src_crs=src.crs,
                        dst_transform=affine, dst_crs=src.crs, resampling=Resampling.nearest)
                    # Off-domain, declared NoData and invalid negative intensity become zero.
                    grid[~inside] = 0
                    converted = np.floor(np.clip(grid,0,1)*100 + .5).astype("uint8")
                    n = band["band_number"] + 1
                    dst.write(converted, n)
                    dst.set_band_description(n, band["title"])
                    dst.update_tags(n, source=band["source"], scale="round(source*100)",
                        metadata_pdf_page=band["metadata_pdf_page"])
                    report["bands"].append({"category":category, "number":n,
                        "title":band["title"], "source":band["source"], "source_sha256":sha(DATA/band["source"]),
                        "source_range":[lo,hi], "source_nodata_pixels":int(np.ma.getmaskarray(source).sum()),
                        "negative_source_pixels_mapped_to_zero":int(negatives.size),
                        "output_range":[int(converted.min()),int(converted.max())],
                        "nonzero_domain_pixels":int(np.count_nonzero(converted)),
                        "default_selected":band["default_selected"]})
                    selected[category].append(converted[inside])
            dst.update_tags(attribution="Havs- och vattenmyndigheten / SGU and original providers",
                purpose="Local exploratory reconstruction, 2019 data / 2022 offshore plan boundary")
        path.with_suffix(".part.tif").replace(path)
        report["outputs"].append({"path":str(path.relative_to(DATA)),"bytes":path.stat().st_size,"sha256":sha(path)})
        print(f"Prepared {region['region']}: {len(bands)} {category} bands ({width}x{height})", flush=True)
    rows=list(csv.reader((DATA / region["matrix"]).open(),delimiter=";"))
    assert rows[0][1:] == [b["title"] for b in region["bands"]["Ecosystem"]]
    assert [r[0] for r in rows[1:]] == [b["title"] for b in region["bands"]["Pressure"]]
    coefficients=np.array([r[1:] for r in rows[1:]],dtype="float64")
    assert np.isfinite(coefficients).all() and coefficients.min() >= 0 and coefficients.max() <= 1
    # Same per-pair integer truncation as the backend cumulative operation.
    impact=np.zeros(inside.sum(), dtype="int64")
    for p,b in enumerate(region["bands"]["Pressure"]):
        if not b["default_selected"]:continue
        pressure=selected["Pressure"][p].astype("float64")
        for e,eco in enumerate(selected["Ecosystem"]):
            if coefficients[p,e]:
                impact += (pressure*eco*coefficients[p,e]).astype("int64")
    report["local_calibration"]={"method":"Maximum cumulative impact over rasterized 2022 planning area, default bands; sum of per-pair truncated E*P*K. Local calibration, not official HaV calibration.",
        "maximum":int(impact.max()),"percentile95":float(np.percentile(impact,95)),
        "mean":float(impact.mean()),"positive_pixels":int(np.count_nonzero(impact))}
    assert impact.max()>0
    save(folder / "validation.json", report)
    # Transparent arithmetic means, not the official Green Map ecological-value model.
    for cat in ["Ecosystem", "Pressure"]:
        ids=[b["band_number"] for b in region["bands"][cat] if b["default_selected"]]
        save(DATA / "summary-models" / region["baseline_name"].lower() / cat.lower() / "local-mean.json",
            {"title":{"en":"Unweighted mean · local exploration","sv":"Oviktat medel · lokal utforskning"},
             "name":{"en":"Unweighted mean (2019; excludes 2050 climate)","sv":"Oviktat medel (2019; utan klimat 2050)"},
             "steps":[{"name":"mean","label":{"en":"Unweighted arithmetic mean"},"operation":"MEAN","order":1,"bands":ids,
                       "normalization":{"type":"none","min":0,"max":100}}],"outputStep":"mean"})
    return report


def main():
    areas = boundaries(fetch_boundaries())
    spec = json.loads((DATA / "regional-import-mapping.json").read_text())
    reports=[]
    for region in spec["regions"]:
        area=next(a for a in areas["regions"] if a["name"]==region["region"])
        reports.append(prepare_region(region,area))
    save(DATA / "validation/regional-import-preparation.json", reports)
    print("Prepared all regional baselines. No database changes made.")


if __name__ == "__main__":main()

# MARELD map layers

The Ecosystems and Pressures panels contain a **MARELD area data** collection:
13 ecosystem layers and 14 pressures from the original Västerhavet rasters. This
includes the small pelagic-trawl overlap outside the wind park that was excluded
by the native import mask. Existing Symphony baselines remain unchanged.

Select **MARELD POC review area** in Areas to automatically show the porpoise layer
and the existing wind-park footprint. The collection provides one MARELD raster at
a time, source/extension variants, review-square/wind-park clipping, opacity,
inference hatching, a provenance view and GeoTIFF downloads. Native Symphony
layers remain independently controlled. Switching baseline, deselecting the area,
or leaving the map clears the MARELD raster. Manual visibility is retained while
the same area remains selected. The existing `mareldPoc.enabled` flag gates the
collection; public maps do not attach it.

This is a map-only feature. Code is isolated in `features/mareld-layers`; it has no
dependency on the simulation session, model client, results or tab. No Eco-evo
request or calibrated ecological input is produced.

## Preparation and interpretation

Run from the repository root:

```sh
uv run --python 3.12 scripts/prepare-mareld-layers.py
```

Inputs are the overlap audit, its fixed 39 × 39 km review geometry, the local
original HaV rasters and imported planning boundary. Source hashes are verified
against the audit. The output grid has 156 × 156 cells, 250 m per cell in
EPSG:3035, with extent `[4326000, 3873000, 4365000, 3912000]`.

Original floating-point values are multiplied by 100 without integer rounding.
Source values are retained exactly on that Float32 scale, including meaningful
zeros and small positive values. The preparation asserts that every source value
inside the wind park is unchanged in every variant.

“Source” means a published raster/model/index, not a direct observation. The
original files also contain ambiguous zeros beyond their regional support. A
conservative support footprint is derived from four continuous regional layers
(porpoise, plankton, deep soft bottom and deep transport bottom); the script
asserts that their positive footprints coincide. Other layers retain zeros within
that footprint and any positive values outside it. Fish and shipping-noise
rasters retain their full valid extent. This support rule is documented in the
manifest; it does not certify that all source zeros represent biological absence.

Only **Porpoise north sea** and **Plankton pelagic** receive optional extensions.
Unknown cells use their nearest supported source cell. No source cells are
overwritten. Comparable offshore conditions are an explicit, unvalidated POC
assumption: we do not have independent habitat data to establish their similarity.
Other layers are recovered and displayed without extrapolation. In particular,
habitat patches, fishing grounds and munitions risk are not expanded to fill the
square. The entire wind park already has source support, so extensions affect
only its surrounding review square.

Eight-kilometre spatial blocks are held out to compare nearest-cell prediction
with a regional-median fill. Mean absolute errors on the normalized 0–100 scale:

| Layer | Nearest-cell MAE | Regional-median MAE |
| --- | ---: | ---: |
| Porpoise north sea | 0.864 | 3.401 |
| Plankton pelagic | 0.313 | 1.291 |

Internal holdouts test distances up to 8 km. The extension reaches 27.5 km, and
53.4% of inferred cells lie beyond the tested distance. This is reported in the
controls and validation output; small holdout errors do not establish accuracy
over that larger distance or across habitats.

Lower and upper variants change only inferred cells. They use the source p10/p90
range widened by the p90 absolute holdout error, enclosing the central estimate.
These are illustrative sensitivity bounds, not statistical confidence intervals.
They are available for visual comparison; ecological sensitivity simulations are
deferred until API integration and model calibration.

## Reusable data contract

Generated assets live in `frontend/src/assets/mareld-layers/`. `manifest.json`
records grid geometry, source filenames/hashes, metadata pages, units, caveats,
coverage by provenance, validation, sensitivity assumptions and variant paths.

Each `.bin` contains, in row-major north-to-south order:

1. `width × height` little-endian Float32 values (normalized 0–100; NaN if unknown).
2. The same number of UInt8 provenance codes: 0 unknown, 1 source inside the import
   boundary, 2 recovered source outside it, 3 inferred extension.

`windpark-mask.bin` is a matching UInt8 0/1 cell-centre mask. The extension distance
files contain Float32 kilometre distances from source cells. Each downloadable
GeoTIFF has a value band (NoData −9999), a provenance band, the grid CRS/transform
and attribution tags. No biomass, mortality or decibel conversion is implied.

`data/hav-symphony-2019/validation/mareld-layer-preparation.json` records source
preservation checks and the per-block validation results. The earlier overlap
report continues to describe the native imported rasters, not these supplemental
layers.

The frontend lazy-loads selected static assets, validates dimensions, values and
provenance, and ignores stale responses after selection changes or navigation.
It renders EPSG:3035 imagery through the existing OpenLayers map. A separate map
group allows cleanup without changing native layers or simulation results.

## Verification (2026-10-06)

- 17 focused frontend tests pass: binary validation, zero/unknown distinction,
  extension provenance, clipping, static-asset caching/retry, automatic area
  selection, stale-response protection, map lifecycle and feature-flag gating.
- All 33 binary/GeoTIFF variant pairs match in values, provenance, checksums and
  georeferencing. The browser's trawling GeoTIFF download matches the prepared file.
- Browser checks cover automatic visibility, Ecosystems/Pressures switching,
  collection search, all extension variants, full-square/park clipping, provenance,
  map fitting and downloading. A fresh authenticated review has no console errors;
  OpenLayers can emit advisory canvas-readback performance warnings.
- ESLint and production build pass. The existing initial-bundle warning remains
  (2.33 MB against the 2 MB warning threshold; below the 5 MB error threshold).
- Screenshots are retained under ignored `output/playwright/mareld-layers-*.png`.
  Simulation runs and Eco-evo API integration were outside this work's scope.

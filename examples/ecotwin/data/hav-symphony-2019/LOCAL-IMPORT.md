# Running the imported HaV data locally

Imported on 2026-09-29 into the existing `msp-symphony-db` and
`msp-symphony-wildfly` Docker containers. The original `LOCAL_TEST_2019` baseline,
its matrix, and existing user data were retained. The frontend runs at
[http://127.0.0.1:4200](http://127.0.0.1:4200).

## What is usable

| Baseline | Ecosystems | Pressures | Matrix coefficients | Example area |
| --- | ---: | ---: | ---: | --- |
| `HAV_2019_NORTH_LOCAL` — Bottniska viken | 31 | 41 | 1,271 | B122 — Sydostbrotten |
| `HAV_2019_EAST_LOCAL` — Östersjön | 32 | 39 | 1,248 | Ö265 — Kiviksbredan |
| `HAV_2019_WEST_LOCAL` — Västerhavet | 32 | 37 | 1,184 | V347 — Sydväst Måseskär |
| **Total** | **95** | **117** | **3,703** | **Three saved examples** |

These are 212 regional band entries, not 212 different ecological concepts:
many components occur in multiple regional packages. The English titles and
band order exactly match each region's published matrix. No coefficients were
invented or expanded to fit the differently sized national stacks.

Also imported:

- 1,696 metadata values: titles, source themes, method references, limitations,
  value ranges, conversion notes, source filenames and attribution. Every band
  references its component's page in the 253-page metadata PDF. This is a compact
  metadata index, not a transcription of the full scientific documentation.
- Three default calculation areas linked to their respective matrices.
- 134 selectable official geographical areas: three planning regions, ten sea
  areas and 121 named planning areas. HaV's 2022 boundaries supply the geometry.
- Six explicitly labelled **unweighted mean** summary models, one ecosystem and
  one pressure model per region. These are simple local visualization aids, not
  HaV's official ecological-value/Green Map model.
- One saved example scenario and completed cumulative-impact calculation per
  region, owned by the dedicated `hav-local` account.

## Open and use it

Log in as **`hav-local`**. Its generated password is stored only in the ignored,
permission-restricted file [`../../.local/symphony/hav-local-credentials.json`](../../../../.local/symphony/hav-local-credentials.json).
Existing accounts have not been changed. The new account initially selects
Västerhavet; change the baseline through the user menu to explore the other regions.
Use the matching region's planning areas when creating a scenario. The other
regions' polygons are available in the shared area catalogue, but their matrices
belong to their own baselines.

The **Scenarios** panel contains an example for each baseline. Its saved result
can be opened from the scenario or previous-calculations controls. The Ecosystem
Components and Pressures panels provide individual layers and the local mean models.
Climate-change temperature and acidification are **2050 projections** and are
available but unselected by default in each baseline and example calculation.

To restart later, start Docker Desktop and run from the repository root:

```sh
SYMPHONY_DB_CONTAINER=msp-symphony-db \
SYMPHONY_APP_CONTAINER=msp-symphony-wildfly \
  bash distributions/symphony-ecotwin/start-local.sh
```

This reuses the two existing containers and starts Angular on `127.0.0.1:4200`.
It requires the already installed frontend dependencies. Stop an existing Angular
server before starting another on the same port. Both startup paths use `frontend/proxy.conf.js`. The script selects the local
HTTP backend with `SYMPHONY_API_URL=http://127.0.0.1:8080`; an explicit value
can override it. Configure `ECOTWIN_API_URL` on the backend for both inference and
model discovery; the frontend no longer has a separate inference target.

## Transformation and scientific limits

**These are local exploratory reconstructions, not an official national baseline
or a reproduction of the published scenario results.**

1. All 212 source rasters were fully scanned. Published Float32 values mostly
   span 0–1. Working rasters use `floor(value * 100 + 0.5)` as UInt8, 250 m pixels,
   EPSG:3035, 256×256 tiles and lossless DEFLATE compression. They retain band
   descriptions and source references. Quantization changes values by at most
   0.005 on the source scale.
2. Six boating/boating-copy rasters each contain 10,666,353 pixels valued at
   approximately **−0.01**, despite their different declared NoData sentinel.
   This is outside the valid intensity range and is explicitly converted to zero;
   it is never allowed to wrap to 255. Declared NoData and off-domain pixels also
   become zero. Zero therefore cannot distinguish absence from missing data.
   All original files remain untouched. Counts are recorded in the validation JSON.
3. The stacks are cropped and masked to **official 2022 offshore planning areas**.
   Those polygons were not included in the original 2019 download and were obtained
   separately from HaV. This excludes coastal waters outside those planning areas.
   **40 regional band entries are consequently all zero within the working
   footprint** (19 north, 8 east, 13 west); their source files are still present.
   Do not interpret a blank layer as proof that the component does not exist on
   the coast. Full national/coastal modelling needs the original calculation-area
   definitions and coupling rules.
4. Each published regional matrix is assigned uniformly within its corresponding
   offshore planning area. No fine-grained coastal matrix coupling was supplied.
5. Domain normalization uses the **95th percentile of locally calculated cumulative impact**
   over that region's rasterized planning area and default selection, using the
   backend's per-pair integer truncation. Values are 8,641 north, 31,441 east and
   33,135 west. These are explicit local normalization values, not HaV calibration.
   Example scenarios use the application's **AREA** normalization.
6. Baseline `validFrom` dates are 2019-05-01, 02 and 03 respectively, solely to give
   this date-oriented application deterministic selection of three regional
   alternatives. They are administrative selection dates, not asserted publication
   or survey dates. The source matrix edition is May 2019; underlying survey years
   vary by component and are described in the metadata.
7. The 35/69-band national production TIFFs are retained but **not registered as a
   working baseline**. They lack an authoritative band map and matching matrices.
   No national stack bands were guessed. Result PDFs, processing workbooks and
   the Green Map appendix remain reference material, not input layers.

Boundary provenance is pinned in [`regional-import-sources.json`](regional-import-sources.json).
The [HaV download page](https://www.havochvatten.se/vagledning-foreskrifter-och-lagar/vagledningar/havsplaner/havsplanering---geografiska-data.html)
states CC BY; the enclosed documentation states CC0. HaV attribution is retained.
The ecological layers retain their individual providers' conditions in the source
metadata; the software repository's license does not replace those conditions.

## Files and reproducibility

- [`regional-import-mapping.json`](regional-import-mapping.json): explicit reviewed
  0-based component-to-source mapping, matrix labels, themes, source-PDF pages and
  default selection states. Numeric file prefixes are regional, not national.
- `derived/<region>/ecosystems.tif` and `pressures.tif`: six generated working
  stacks, about 10 MB compressed in total. The backend reads copies under
  `/app/data/symphony/hav2019/<region>/` in the existing WildFly container.
- `derived/boundaries.json`: converted EPSG:4326 and EPSG:3035 boundary geometries.
- `summary-models/hav_2019_*_local/`: the six generated model definitions, copied
  into `/app/data/symphony/summary-models`.
- [`validation/regional-import-preparation.json`](validation/regional-import-preparation.json):
  hashes, per-band range/pixel counts, output sizes and normalization calculations.
- [`validation/regional-import-runtime.json`](validation/regional-import-runtime.json):
  API metadata counts, rendered image dimensions, saved scenario/result IDs,
  calculation timings and summary-model checks.
- [`validation/regional-source-negative-values.json`](validation/regional-source-negative-values.json):
  all observed out-of-range source values and their counts.

From a checkout with the original data bundle restored:

```sh
python3 examples/ecotwin/scripts/fetch-hav-symphony-data.py
uv run --python 3.12 examples/ecotwin/scripts/prepare-hav-symphony-regions.py
python3 examples/ecotwin/scripts/import-hav-symphony-regions.py         # generate reviewable SQL only
python3 examples/ecotwin/scripts/import-hav-symphony-regions.py --apply # import into existing local containers
```

Preparation uses isolated Python 3.12 GIS wheels to avoid the broken system GDAL
installation. It checks grid alignment, source ranges and matrix order. The import
verifies generated raster hashes, backs up the current database and configuration,
adds baselines transactionally, creates/reuses the dedicated local account, merges
country/cache/model paths into the existing config and restarts WildFly. A rerun
skips existing regional baseline names; it does not update their metadata or
remove user scenarios. This helper targets this repository's existing local Docker
instance and schema; it is not a general production deployment tool.

Database backups, generated SQL, development credentials, runtime logs and image
checks are under ignored `.local/symphony/`. Raw downloads and generated TIFFs are
also ignored by Git. Keep the repository's source-data bundle and named PostgreSQL
volume: the WildFly copies survive container restarts but not container replacement.
The importer can restore those copies from the host. Do not remove Docker volumes
as part of ordinary restarting.

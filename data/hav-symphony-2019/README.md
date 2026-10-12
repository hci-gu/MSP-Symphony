# Public HaV Symphony data, 2018 report / 2019 baseline

Downloaded and inspected on **2026-09-29** from the
[HaV publication page](https://www.havochvatten.se/data-kartor-och-rapporter/rapporter-och-andra-publikationer/publikationer/2018-04-10-symphony---integrerat-planeringsstod-for-statlig-havsplanering-utifran-en-ekosystemansats.html#h-SammanstalldarasterdatatillSymphonyverktyget).
The page was last updated on 2025-08-19. The underlying data are historical;
the page update does not make these a 2025 or 2026 baseline.

**Three reconstructed regional baselines are now imported and running locally**,
with all 212 regional layers, the three matching sensitivity matrices and official
2022 offshore planning boundaries. Real calculations and map rendering have been
verified. See [local setup, usage and limitations](LOCAL-IMPORT.md). The original
35/69-band national production stacks remain reference files because their
authoritative band mapping and matching matrices are missing.

All 18 data/report downloads associated with this publication are retained,
including reference-only material. Separate publications under “Relaterade
publikationer” are outside this bundle. There are **780.8 MB of downloads** and
**3.469 GB (3.231 GiB) of original plus extracted payloads**, comprising 1,131
files. These totals count archived and extracted copies separately and exclude
small generated reports/configuration files.

## What is here

| Location | Contents | Use |
| --- | --- | --- |
| `rasters/Ekokomponenter-cm-prod.tif` | 35-band national ecosystem raster; 504,629,560 bytes | Published production raster for the backend |
| `rasters/Belastningar-cm-prod.tif` | 69-band national pressure raster; 994,839,044 bytes | Published production raster for the backend |
| `matrices/original/` | Three original May 2019 sensitivity CSVs | Regional pressure-to-ecosystem coefficients; not a direct match for the national stacks |
| `regional/bottniska-viken/` | 31 ecosystem + 41 pressure GeoTIFFs | Gulf of Bothnia source layers |
| `regional/vasterhavet/` | 32 ecosystem + 37 pressure GeoTIFFs | Skagerrak/Kattegat source layers |
| `regional/ostersjon/` | 32 ecosystem + 39 pressure GeoTIFFs | Baltic Sea source layers |
| `reference/metadata/` | 253-page metadata PDF and three regional interactive map PDFs | Component descriptions, processing, attribution, limitations and source information |
| `reference/process-logs/` | 50 original XLSX workbooks: 21 ecosystem and 29 pressure logs | Data-processing provenance |
| `reference/FULLTEXT01-report.pdf` | 74-page report 2018:1 | Symphony methodology |
| `reference/ATTACHMENT02-grona-kartan.pdf` | Nine-page “Gröna kartan” appendix | Ecological-value reference maps |
| `reference/results/` | Nine result-map PDFs, appendices 4a–6c | Published scenario outputs, not inputs to the backend |
| `source/` | Seven original ZIPs and a snapshot of the publication page | Original packages and provenance |
| `validation/` | Raster specifications/statistics, matrix inventories, PDF/workbook inventories | Evidence for the checks described below; extracted PDF text stays local |
| `manifest.json`, `SHA256SUMS` | Exact source URLs, sizes, purposes and file hashes | Audit and reproducible retrieval |

The 212 regional rasters retain their GIS sidecars: **212 world files (`.tfw`),
424 XML metadata/statistics files, and 206 overview files (`.ovr`)**. These are
single-band Float32 sources with several different extents, not drop-in
replacements for the two prepared national rasters. Number prefixes are local
to each regional package; they do not establish the national stack's order.

The processing workbooks contain sheets such as `CRS`, `Log`, `Flowchart` and
`Tool_Directory`; they are not application database import tables. The metadata
appendix also does not provide an authoritative ordinal mapping for all 104
bands in the two national files.

### Sensitivity matrices

| File | Region | Pressure rows | Ecosystem columns | Coefficients |
| --- | --- | ---: | ---: | ---: |
| `k_Matrix_North_Maj_2019.csv` | Gulf of Bothnia | 41 | 31 | 1,271 |
| `k_Matrix_West_Maj_2019.csv` | Skagerrak/Kattegat | 37 | 32 | 1,184 |
| `k_Matrix_East_maj_2019.csv` | Baltic Sea | 39 | 32 | 1,248 |

These counts exclude the `SENSITIVITY` header row and label column. All **3,703
coefficients** are numeric and in [0, 1]. Labels are English, delimiters are
semicolons, and the original CRLF line endings are preserved. The coefficients
and component ordering have not been changed, padded or extrapolated.

The named components cover marine mammals, birds, fish, reefs, benthic habitats,
vegetation and plankton. Pressures include fishing, habitat disturbance,
shipping/boating noise, contaminants, nutrients, anoxia, electromagnetic fields,
wind-power disturbance and climate-change scenarios. Exact names are listed in
[`validation/matrices.json`](validation/matrices.json).

### Published result maps

**The publication page's result-appendix labels disagree with the linked PDFs.**
Inspection of the covers and introductions found the following, for all three
regions in each group:

| Page's appendix labels | Page describes | Actual linked PDF cover |
| --- | --- | --- |
| 4a/4b/4c; attachments 03–05 | Current situation without plan | **S2 Nuläge plan**: current situation with plan |
| 5a/5b/5c; attachments 06–08 | Current situation with plan | **S3 Utblick 2030**: 2030 outlook |
| 6a/6b/6c; attachments 09–11 | 2030 outlook without plan | **S4 Utblick 2030 med plan**: 2030 outlook with plan |

Local filenames use the actual cover scenario; the manifest retains the page's
labels and the exact download URLs. These nine PDFs total 885 pages. No standalone
S1 result report was obtained through these nine links. The files are retained
for comparison and interpretation, not loaded as ecosystem or pressure data.
Layered PDF maps may require a reader with support for optional-content layers.

## National source raster paths (not the imported regional paths)

This repository does **not** automatically discover a data directory. Normally,
`DataLayerService.getComponentFilePath()` reads the paths stored in these fields
of the corresponding `symphony.baselineversion` record:

| Database field | File relative to the repository root |
| --- | --- |
| `bver_ecofilepath` | `data/hav-symphony-2019/rasters/Ekokomponenter-cm-prod.tif` |
| `bver_presfilepath` | `data/hav-symphony-2019/rasters/Belastningar-cm-prod.tif` |

Use **absolute paths visible to the WildFly process** when importing the baseline.
[`runtime-paths.local.json`](runtime-paths.local.json) contains this checkout's
absolute values. If the backend runs in a container or on another host, mount or
copy this directory there and use the paths as seen from that process. Do not
put the TIFFs in frontend assets or test resources.

The included [`symphony-global.local.properties`](symphony-global.local.properties)
sets `areas.countrycode=SWE`, `data.source.crs=EPSG:3035` and writable local cache
and summary-model directories. It is **not activated automatically**. A configured
WildFly instance can load it with this JVM property (replace `/absolute/repo`):

```text
-Dse.symphony.global=/absolute/repo/data/hav-symphony-2019/symphony-global.local.properties
```

Merge any existing deployment-specific settings before using it. The two
`data.localdev.*` raster overrides are provided as **commented lines**. Leave
them commented when using per-baseline database paths. They override the files
for every requested baseline, so enabling them against unrelated metadata could
silently pair the wrong components with the raster bands.

The regional import adds explicitly labelled unweighted arithmetic-mean summary
models. These are local exploratory models, not the official Green Map model. The config does not enable public
access, provide authentication, create the database or start any service.

## What is still required for a usable national baseline

1. **Band metadata for the national stacks**: the correct component name, theme,
   selection status and language for each of 35 ecosystem and 69 pressure bands.
   Neither TIFF has band descriptions. Guessing alphabetic order or copying a
   regional matrix's order would risk assigning data to the wrong component.
2. **Matrices aligned to those bands**, plus the regional/coastal coupling rules.
   The supplied regional matrices are 41×31, 37×32 and 39×32, not 69×35. A verified
   mapping/expansion rule or matching national matrices is needed; absent
   coefficients cannot safely be assumed to mean zero sensitivity.
3. **Calculation-area and boundary/national-area polygons** and their matrix
   assignments. No SHP, GeoPackage or GeoJSON polygon files, SQL dump or database
   backup occur in the downloaded archives. PDF map outlines are not an
   application-ready polygon dataset.
4. **Normalization/calibration settings** for the chosen areas, or completion of
   the application's calibration procedure once the baseline is otherwise usable.
5. **Runtime status**: the existing PostgreSQL/PostGIS and WildFly containers have
   now been restarted. The regional reconstructions are imported and tested; this
   does not resolve the missing national band/matrix correspondence.

Request the matching baseline metadata, matrices and area definitions from HaV
or the maintainer who supplied the original dataset recommendation.

For import tooling, the repository links to the upstream
[`symphony-import` setup tool](https://github.com/havochvatten/symphony-import).
Its documented compatibility currently covers MSP-Symphony 1.24/1.25; this
checkout identifies as 1.26.0-SNAPSHOT, so verify compatibility before writing to
the database. Its metadata input uses **1-based** `bandnumber` values, while the
application's internal band numbers are **0-based**.

Do not run the old import instructions verbatim. The repository's
[`DataImportREADME.md`](../../database/DataImportREADME.md) explicitly marks them
as outdated. In this checkout, `CreateNewBaseLineVersion.sql` repeats `bver_name`
where a locale field is intended, and `MatrixImport.sql` parses comma-separated
rows whereas the downloaded matrices use semicolons. No legacy SQL was run.

## Validation and source integrity

- Checked ZIP integrity and retained original download and extracted-file SHA-256
  hashes. Only macOS resource-fork/hidden entries were omitted during extraction.
- Preserved file contents; recovered UTF-8 filenames missing the ZIP encoding flag
  and normalized their spelling to Unicode NFC (45 filenames).
- Fully scanned both national rasters: **2,606 × 5,057 pixels**, approximately
  **250 × 250 m**, EPSG:3035, UInt8 and **256 × 256 tiles**, uncompressed. Their
  extents agree within floating-point precision. They do not need the repository's
  tiling/8-bit preprocessing script.
- Ecosystem values are 0–100. Pressure values are 0–100 **plus 255 in bands 18
  and 19 (1-based)**: 10,665,938 pixels per band. The source TIFF declares no
  NoData value. Confirm what 255 represents and its handling before calculations;
  it has not been silently changed to zero, clipped, or assigned a NoData tag.
- Opened all 212 regional rasters and checked their headers; validated every
  matrix cell, row width and uniqueness of row/column labels; opened all 50
  workbooks. Inventoried all 15 PDFs (1,230 pages), extracted the metadata/method
  documents and inspected each result report's cover/introduction. Every regional raster was subsequently fully scanned during conversion; details
  are in [the import report](LOCAL-IMPORT.md). Individual result-map pages were not
  exhaustively reviewed.
- Both national TIFFs also opened successfully using **GeoTools 29.6 from this
  backend's existing build dependencies**; dimensions, band counts and a sample
  read were confirmed. This checks the national source reader. The separate regional
  import was additionally verified against the database and calculation API.

The installed Homebrew GDAL command failed because its HDF5 library was missing.
Raster inspection used an isolated Rasterio environment instead, without changing
the machine's Homebrew installation.

## Restore or verify this local bundle

From the repository root, with Python 3.9 or newer:

```sh
python3 scripts/fetch-hav-symphony-data.py --verify-only
python3 scripts/fetch-hav-symphony-data.py
```

The first command verifies all payloads without writing anything. The second
downloads missing files, extracts missing members and generates checkout-specific
paths/configuration. Existing changed files cause verification to fail; they are
not silently overwritten. The script never connects to a database. Source URLs,
sizes and checksums are pinned in [`manifest.json`](manifest.json).

Large downloaded/extracted files are intentionally ignored by Git. The manifest,
checksums, documentation, small original matrix CSVs and JSON validation reports
can be versioned. No source-code license is assigned to the downloaded data:
preserve HaV/SGU and the individual data-provider attribution and usage conditions
in the metadata PDF and regional sidecars. For example, the coastal-birds metadata
specifies CC BY 4.0 and attribution to WSP/Lund University; consult each component's
own record rather than assuming a uniform license for every file.

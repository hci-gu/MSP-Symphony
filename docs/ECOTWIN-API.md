# Saved calculation inputs and simulations

All paths are relative to Symphony's `/symphony-ws/service` API. All endpoints
require the `GRP_SYMPHONY` role and authorize the calculation before raster work.
Input/read access follows calculation ownership or baseline-calculation visibility;
only the owner may attach a run. Public map routes do not expose this API.

| Method/path | Contract |
| --- | --- |
| `GET /calculation/all?all-baselines=true` | Read-only completed-calculation choices across the signed-in user's baselines. Omitting the parameter preserves existing history behavior. |
| `GET /calculation/{id}/inputs` | `calculation-input-v1` manifest with saved ID/date/name/baseline, WGS84 geometry, source CRS, suggested grid, selected bands/units/hashes, saved changes, operation, availability and notes. |
| `POST /calculation/{id}/input-grid` | Read-only export. Body: `{fingerprint, grid, bands:[{category,bandNumber}]}`. Each band must belong to this saved calculation. No result regeneration or database updates. |
| `PUT /calculation/{id}/simulations/{runId}` | Atomically save `ecotwin-run-v1` under a UUID. Same ID/content returns the existing summary; different content is 409. |
| `GET /calculation/{id}/simulations` | Lightweight `ecotwin-report-v1` summaries, ordered by completion timestamp and run ID. No tensor hydration. |
| `GET /calculation/{id}/simulations/{runId}` | Full saved metadata and base64 little-endian Float32 biomass for replay. |
| `GET /calculation/{id}/simulations/{runId}?view=report` | Report summary plus only the final tensor frame. All-frame totals/maxima already reside in the summary. |

A grid specifies `crs`, `[west,south,east,north]` extent, width, height and
`cellMetres`. The first implementation accepts EPSG:3035, 1 km cells, 3–60 cells
per side, aligned whole-kilometre boundaries, and 1–80 distinct selected bands.
Use `suggestedGrid`; it encloses both the saved vector geometry and native raster
rounding at its edges. Cropping the native calculation is rejected.

Grid arrays are row-major, **north first**. `domainCoverage` is the fraction of a
model cell inside the native calculation/planning domain. Band `coverage` is the
fraction of that domain with known support. Band `values` is the arithmetic mean
of supported effective native cells; `null` means no supported values, while a
supported zero remains zero. Global and ascending-area-ID changes are applied
before aggregation with Symphony's existing raster operations and matrix mask.
Saved coastal-excluded geometry is reused without reloading current exclusions.

Fingerprints use canonical JSON (including equivalent numeric encodings) and
SHA-256 of source assets. They include saved geometry, areas, changes, bands,
normalization/matrices, operation and suggested grid; names are display labels.
Historical baseline rasters were not archived with the calculation. Source hashes
identify export-time files. Missing/mismatched support assets produce 422;
a changed fingerprint produces 409. Invalid grids/bands/payloads produce 400,
missing calculations/runs 404, unauthorized owners 403 and absent sessions 401.

`ecotwin-run-v1` stores `runId`, `completedAt`, `model`, `config`, `input` and
`result`. The input includes its source manifest, native grid, model water mask,
prepared pressure levels/masks and assumptions. The result records ordered
species, sample steps, `units: "tonnes/cell"`, `order: "frame,row,column,species"`
and `biomassB64`. The current fixed configuration uses seed 42, a 0.25 day tick
and `max(4, ceil(maxSteps/50))` sampling plus the final frame.

Before persistence, the backend recomputes the native input export and validates
the mapped pressure masks/intensities against it. Tensor validation rejects
wrong shape/order/units, nonfinite/negative values and oversized payloads. Limits
are 8 MiB tensor, 16 MiB request and 2 MiB metadata. Totals and maxima are derived
from the validated tensor; submitted summary values are not trusted. This is a
storage/integration contract, not model attestation or scientific calibration.

Apply `database/scripts/SimulationRuns.sql` explicitly. `simulation_run` holds
summary metadata; `simulation_artifact` holds detailed metadata and binary tensor.
Both writes share one transaction. Foreign keys cascade on calculation/run deletion,
while native raster purging affects neither table. A calculation lock serializes
save retries with deletion. Saved reports require neither baseline files nor Eco-evo.

## Verification

Backend generated GeoTIFF fixtures cover source validity/zeros, north-first export,
multiple areas, holes, overlaps, saved changes, coastal exclusions and authorization.
`SimulationRunValidationTest` checks schema, identity, masks and tensor rejection.
The local REST lifecycle script creates and deletes only disposable calculations:

```sh
python3 scripts/verify-calculation-simulations.py \
  --credentials /path/to/private-credentials.json \
  --fixture data/poseidon/reference-calculation.json
```

Use a local test deployment with a saved run on the modified fixture; the script
also uses Docker/psql to exercise access loss and TIFF purging. It reuses a saved
tensor solely to verify persistence and removes all artificial records afterward.
It verifies idempotency, conflicts, rejection without orphan records, foreign-owner
and anonymous access, cross-calculation identities, single/bulk deletion and late
saves after deletion. This does not invoke Eco-evo or claim a new model experiment.

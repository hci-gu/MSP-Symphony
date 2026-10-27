# Saved calculation inputs and simulations

All paths are relative to Symphony's `/symphony-ws/service` API. All endpoints
require the `GRP_SYMPHONY` role and authorize the calculation before raster work.
Input/read access follows calculation ownership or baseline-calculation visibility;
only the owner may attach or delete a run. Public map routes do not expose this API.

| Method/path | Contract |
| --- | --- |
| `GET /extensions/ecotwin/calculations` (legacy alias: `/calculation/all?all-baselines=true`) | Read-only completed-calculation choices across the signed-in user's baselines. Omitting the parameter preserves existing history behavior. |
| `GET /calculation/{id}/inputs` | `calculation-input-v1` manifest with saved ID/date/name/baseline, WGS84 geometry, source CRS, suggested grid, selected bands/units/hashes, saved changes, operation, availability and notes. |
| `POST /calculation/{id}/input-grid` | Read-only export. Body: `{fingerprint, grid, bands:[{category,bandNumber}]}`. Each band must belong to this saved calculation. No result regeneration or database updates. |
| `PUT /calculation/{id}/simulations/{runId}` | Atomically save `ecotwin-run-v1` under a UUID. Same ID/content returns the existing summary; different content is 409. |
| `GET /calculation/{id}/simulations` | Lightweight `ecotwin-report-v1` / `ecotwin-report-v2` summaries, ordered by completion timestamp and run ID. No tensor hydration. |
| `GET /calculation/{id}/simulations/{runId}` | Full saved metadata and base64 little-endian Float32 biomass for replay. |
| `GET /calculation/{id}/simulations/{runId}?view=report` | Report summary plus only the final tensor frame. All-frame totals/maxima already reside in the summary. |
| `DELETE /calculation/{id}/simulations/{runId}` | Owner-only deletion of a saved run, its artifact/appendix and completed job record in one transaction. Returns 204, including retries after deletion. A run belonging to another calculation is 404; unfinished work is 409. Native calculation data is preserved. |

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
If a calculation changes or disappears while a mutation waits for its lock, the
adapter rolls the transaction back and returns 409. Ownership is checked again
after locking; an ownership change returns 403.

`ecotwin-run-v1` stores `runId`, `completedAt`, `model`, `config`, `input` and
`result`. The input includes its source manifest, native grid, model water mask,
prepared pressure levels/masks and assumptions. The result records ordered
species, sample steps, `units: "tonnes/cell"`, `order: "frame,row,column,species"`
and `biomassB64`. The legacy configuration uses seed 42, a 0.25 day tick
and `max(4, ceil(maxSteps/50))` sampling plus the final frame.

Before persistence, the backend recomputes the native input export and validates
the mapped pressure masks/intensities against it. Tensor validation rejects
wrong shape/order/units, nonfinite/negative values and oversized payloads. Limits
are 8 MiB tensor, 16 MiB request and 2 MiB metadata. Totals and maxima are derived
from the validated tensor; submitted summary values are not trusted. This is a
storage/integration contract, not model attestation or scientific calibration.

Apply `plugins/ecotwin/migrations/SimulationRuns.sql` explicitly. `simulation_run` holds
summary metadata; `simulation_artifact` holds detailed metadata and binary tensor.
Both writes share one transaction. Foreign keys cascade on calculation/run deletion,
while native raster purging affects neither table. A calculation lock serializes
save retries with deletion. Saved reports require neither baseline files nor Eco-evo.

## Installation capabilities

The native build omits all plugin resources. The enabled distribution exposes
`GET /extensions/ecotwin/capabilities` with `installed`, `mode`, `reporting`,
`execution`, `discovery` and `profile`. It is authenticated, does not read source
rasters and does not call the model. `mode` is `enabled` when execution is configured
and enabled, otherwise `reporting-only`. Disabling execution preserves queued jobs,
saved artifacts and report reads. `GET /extensions/ecotwin/models` discovers models
through the same server-owned endpoint used for execution. These routes require
`GRP_SYMPHONY`, just like saved calculation routes.

## Preview and ensemble jobs

Apply `plugins/ecotwin/migrations/SimulationJobs.sql` after `SimulationRuns.sql`. Configure
`ecotwin.api.url` / `ECOTWIN_API_URL` with the trusted model endpoint, and run one
enabled worker instance per model server. The deployment must allow outbound HTTP
to that endpoint and long-lived preview requests (up to the existing 30-minute cap).
The worker does no model work when the endpoint is unset or `ECOTWIN_EXECUTION_ENABLED=false` (Java property `ecotwin.execution.enabled=false`). Reporting remains available. Model discovery still
uses `GET /extensions/ecotwin/models` through that same backend endpoint. No browser-to-model proxy is required.

| Method/path | Contract |
| --- | --- |
| `POST /calculation/{id}/simulation-jobs/preview` | `ecotwin-preview-v1` request with UUID, input, model and config (`replicates:1`). Validates the native source, runs one seed and returns an Eco-evo result envelope. No persistence or appendix. Shares the worker lock with full runs; a busy worker returns 409. |
| `PUT /calculation/{id}/simulation-jobs/{runId}` | Owner-only `ecotwin-run-v2` frozen request (`runId`, `input`, `model`, `config`). Config includes `replicates:10`, integer base seed 0–2147483637, 1–10000 steps, existing sampling/tick/mapping fields. Same ID/request is idempotent, changed content is 409. One active job per calculation. Submission validates the native source before enqueuing. |
| `GET /calculation/{id}/simulation-jobs` | Authorized job summaries, newest first: status, completed seed count, frozen config/model and optional error. No tensor. |
| `POST /calculation/{id}/simulation-jobs/{runId}/retry` | Owner-only resume of a failed job; retains its frozen inputs, seed identities and completed checkpoints. Does not rerun completed seeds. |

Jobs transition `queued → running → completed` or `failed`; retry returns to
`queued`. A managed server worker processes one seed at a time outside a long
DB transaction. Each seed checkpoints a double-precision spatial sum and masked
per-species totals in one short transaction. Engine request IDs are deterministic
per job/seed/attempt. After interruption, the worker checks that engine request
before submitting another one; cached completed output is recovered, running output
is awaited, and only a confirmed failed attempt gets a fresh engine ID. A restarted
model server may require recomputing the one uncheckpointed seed.

After all ten seeds, the worker stores a single mean Float32 tensor and
`ensemble: {seeds, totals, mean, ciLow, ciHigh, confidenceLevel:0.95, ciMethod:"student-t"}`.
`totals` is `[seed][species][frame]`; mean/limits are `[species][frame]`. Totals use
exactly the saved model water mask. For ten seeds, the pointwise half-width is
`2.2621571627409915 * sampleSD / sqrt(10)` (9 degrees of freedom). Negative lower
limits are retained, not silently clipped. The backend derives the statistics and
checks their means against the mean map. Clients cannot PUT v2 results directly.

`ecotwin-report-v2` carries those statistics; full artifacts retain per-seed totals
for grouped/relative views. Legacy v1 reads remain unchanged. Final artifact save
and job completion share a transaction, so no partial ensemble becomes an appendix.
The accumulator is cleared after saving. Input/metadata requests are limited to
2 MiB; mean tensors to 8 MiB; checkpoint sums to 16 MiB. Full jobs and artifacts
cascade on calculation deletion, while native TIFF purging retains them.

The worker validates source ownership before every seed and revalidates native
inputs before final attachment. Calculation locking precedes job locking during
final save, matching native deletion and submission. Reports use persisted data
only; they do not depend on the worker, engine or baseline source files.

Preview and full-run callers must use distinct UUIDs. The existing engine cache
identity can collide if a caller deliberately reuses a preview UUID for a full
run. The browser generates separate identities; changing historical full-job
checkpoint identities is outside this restructuring.

## Verification

Backend generated GeoTIFF fixtures cover source validity/zeros, north-first export,
multiple areas, holes, overlaps, saved changes, coastal exclusions and authorization.
`SimulationRunValidationTest` checks schema, identity, masks and tensor rejection.
The local REST lifecycle script creates and deletes only disposable calculations:

```sh
python3 plugins/ecotwin/tools/verify-calculation-simulations.py \
  --credentials /path/to/private-credentials.json \
  --fixture examples/ecotwin/data/poseidon/reference-calculation.json
```

Use a local test deployment with a saved run on the modified fixture; the script
also uses Docker/psql to exercise access loss and TIFF purging. It reuses a saved
tensor solely to verify persistence and removes all artificial records afterward.
It verifies idempotency, conflicts, rejection without orphan records, foreign-owner
and anonymous access, cross-calculation identities, single/bulk deletion and late
saves after deletion. This does not invoke Eco-evo or claim a new model experiment.

Verify a completed real ensemble without starting another model run:

```sh
python3 plugins/ecotwin/tools/verify-simulation-ensemble.py --credentials /path/to/private-credentials.json --calculation 7
```

This independently recomputes intervals, checks mean maps against per-seed totals,
and exercises idempotency, conflicting/invalid submissions and anonymous access.
It does not modify calculation inputs or create artificial simulation output.

## Saved counterparts for implicit comparison baselines

Apply `plugins/ecotwin/migrations/SimulationBaselines.sql` in addition to the run/job
migrations. `simulation_baseline` links one scenario calculation to one private
saved baseline and records the scenario input fingerprint used for creation.

| Endpoint | Behaviour |
|---|---|
| `GET /calculation/{id}/simulation-baseline` | Read-only lookup. Returns the link or HTTP 204 when no counterpart exists. Checks access to both calculations. |
| `POST /calculation/{id}/simulation-baseline` | Owner-only, explicit creation. Returns `{scenarioCalculationId, baselineCalculationId, sourceFingerprint}`. Reuses an existing link; HTTP 409 if its source fingerprint has changed, 422 for unverified input sources. |

Creation locks the scenario calculation, materializes Symphony's existing implicit
baseline raster, and persists an independent snapshot with empty global and area
layer changes. Geometry, coastal exclusions, band selections, matrices,
normalization and calculation operation are preserved. The original calculation,
scenario and `latestCalculation` are not changed. The baseline remains user-owned,
not a shared regional baseline. No Eco-evo request is made. Concurrent retries are
serialized by the calculation lock and the scenario-keyed link.

Deleting either calculation removes the link. Deleting the scenario does not
remove the independent baseline calculation; it can be managed in normal history.
Deleting a baseline permits a new counterpart to be explicitly created. Historical
report links retain their run IDs and report unavailability rather than switching
runs. Native report APIs and native CSV/GeoTIFF output are unchanged.

Frontend comparison links extend the existing `/report/compare/...` routes with
`simBase`, `simBaselineRun`, and `simScenarioRun` query parameters. `reverse=true`
is supported for implied comparisons. The report resolves these IDs through saved
summary endpoints and validates their compatibility and calculation ownership;
it does not depend on an active simulation session or the external model service.

New comparison links include the generic `extensions=ecotwin` requirement. The
optional compatibility-only frontend build detects both that marker and historical
`simBase`/`simBaselineRun`/`simScenarioRun` parameters without shipping EcoTwin.
Unavailable contributions are explicit; pinned run IDs never silently switch.

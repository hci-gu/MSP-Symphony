# Optional EcoTwin simulations

Current workflow, implemented 2026-10-13. Internal `mareld-*` filenames, proxy settings
and feature flag remain for compatibility. EcoTwin is an optional operation on a
completed Symphony calculation.

## Review the workflow

1. Create a scenario and calculate normally. Areas, Ecosystem Components, Pressures,
   search, result display and native exports require no simulation service.
2. Open **EcoTwin**, choose a completed calculation and review its saved baseline,
   domain, selected inputs and compatibility. The picker includes your calculations
   across baselines; it does not change the native history's baseline filter.
3. Select a model, set the number of steps and click **Run simulation**. Start with
   40 or 80 steps for a quick technical check. The default remains 5,000 steps.
4. A successful run saves automatically. **Added to calculation report** confirms
   persistence. A storage error retains the result with **Retry saving**; this uses
   the same run ID without running the model again.
5. Explore species, biomass trends, time, pressure outlines and opacity. Leaving or
   collapsing the tab hides its layers and pauses playback. Returning preserves
   the session; it does not submit another run.
6. Open the calculation report using the link shown after saving or native history.
   The appendix contains every saved run, provenance, all-species time series,
   initial/final/change tables and final spatial figures. Native CSV/GeoTIFF exports
   continue to contain only Symphony output.

A scenario edit affects the next calculation. Selecting an older calculation uses
its frozen scenario changes. To reduce a pressure, edit Symphony and calculate
again. There are no independent demo pressure toggles or fixed MARELD raster inputs.

## Local review fixture

The Poseidon geography comes from [poseidon.md](../poseidon.md). Its surrounding
39 km square is the native scenario area; the park polygon remains reference data,
not a turbine layout or automatic pressure mask. The recorded local fixture is
[data/poseidon/reference-calculation.json](../data/poseidon/reference-calculation.json):

- **#7 — Poseidon — EcoTwin reference:** unchanged pressures; two saved runs.
- **#9 — Poseidon — 50% bottom trawling:** recalculated with native pressure 3 halved;
  one saved run. Shipping noise and the original calculation remain unchanged.
- **#8 — Poseidon — native regression (no simulation):** same native GeoTIFF and
  statistics as #7; useful for reviewing a report without an appendix.

These IDs identify this local database only. Recreate equivalents through the
normal APIs on another installation; do not insert fabricated calculation rows.

The exported grid is **40 × 40 at 1 km**, extent
`[4357000, 3858000, 4397000, 3898000]` in EPSG:3035. It includes the native
calculation's edge pixels, which integer raster rounding can place outside the
39 km vector square. The supported native domain is **1,143.875 km²**, represented
by 1,227 model water cells. Domain fractions are retained; model water cells are
not fractional. The raw geography audit and native calculation mask have different
boundaries; their area counts are not interchangeable.

## Startup and deployment

Apply [SimulationRuns.sql](../database/scripts/SimulationRuns.sql) to the Symphony
schema before deploying the backend. It creates separate metadata/artifact tables
with cascading calculation deletion. Automatic Hibernate schema updates are not
used. Take a database backup using your normal deployment procedure.

The generic input export needs verified support sidecars beside the baseline
rasters. For the local West 2019 import:

```sh
uv run scripts/prepare-poseidon-reference.py
uv run scripts/prepare-calculation-support.py
```

Use [LOCAL-IMPORT.md](../data/hav-symphony-2019/LOCAL-IMPORT.md) for the prerequisite
regional source files and native import. Copy `calculation-domain.tif`,
`ecosystems-support.tif`, `pressures-support.tif` and `calculation-input-support.json`
from `data/hav-symphony-2019/derived/vasterhavet/` beside the deployed West baseline
rasters. The manifests fingerprint the native stacks, sidecars and original sources;
changed or missing assets block preparation instead of manufacturing valid zeros.

Enable `environment.mareldPoc.enabled`. Development proxies use `MARELD_API_URL`
in `frontend/proxy.conf.js` (default from `mareld-shared/run-config.json`);
the current local target is port 8000. From the
separate Eco-evo checkout start:

```sh
uv run --locked python -u api.py --host 127.0.0.1 --port 8000 --project mareld_symphony_demo.yaml
```

Then start Symphony's backend and frontend as usual. The verified server advertised
`2026-10-08`, `default`, `worlds_1` and `worlds_3`; the fixture used `2026-10-08`.
Model availability is discovered on entering EcoTwin. A model ID/name is not an
immutable checkpoint version. The model configuration and scaling are described
in [ECO-EVO-DEMO-IMPACTS-HANDOFF.md](ECO-EVO-DEMO-IMPACTS-HANDOFF.md).

To create another fixture, supply a private JSON credentials file containing
`username` and `password`. Do not commit credentials:

```sh
python3 scripts/create-poseidon-reference.py --credentials /path/to/private-credentials.json
```

This creates the reference and modified calculations and writes their actual IDs
to `.local/symphony/poseidon-reference.json`. It refuses to overwrite an existing
manifest. Choose the new IDs in EcoTwin, run and save, and record the run IDs.

## Input profile and limitations

The initial profile `hav-west-native-v1` accepts `HAV_2019_WEST_LOCAL`, pressure 3
(Catch bottom trawl) and 13 (Noise 125Hz shipping), matching their original source
hashes and native relative-index units. Unsupported baselines or selected pressures
block a run. Pressure 4 (turbidity trawl), 7 (abrasion trawl) and 14 (wind noise) are
negative cases; they are never silently folded into shipping noise or catch.

Saved global and area changes are applied at native resolution before averaging
known input cells into the model grid. Native zero is kept distinct from unknown
source support. Any missing pressure support inside the native domain blocks a run.
The West support policy uses original source validity and the imported planning
boundary. For source layers with ambiguous background zeros it additionally uses
joint positive porpoise/plankton coverage or positive source cells, as documented
in the support manifest. This is an explicit regional-support proxy, not proof of
an observation at every pixel.

Positive indices are quantized to 16 levels, saturating above 100. Experimental
model intensities are noise `60 + 60 × level/16` and trawling `0.2 × level/16`.
They are not calibrated dB or measured fishing mortality. Exact exported values,
coverage and prepared masks are retained with each run.

The selected porpoise, plankton, cod, herring, sprat and benthic habitat bands are
context. The current model initializes biomass; native ecosystem layers and
sensitivity matrices do not initialize its species. Depth is synthetic zero.
Every 1 km cell with any native domain is a complete model water cell. Biomass
is summed across those cells in tonnes, without native-area weighting. These
assumptions are displayed in the tab and saved report.

Historical calculations did not archive immutable baseline source rasters. Export
hashes prove which files were used now, not what was present at calculation time.
Saved runs retain their prepared input/output, so their reports remain reproducible
even if baseline files or the model service later disappear.

## Storage, lifecycle and reports

Runs use a separate UUID and calculation foreign key. A PUT is idempotent for the
same content and rejects a conflicting ID. Symphony checks authorization, native
source provenance, effective input grids, mapped pressure masks, tensor dimensions,
finite/nonnegative values, sampling and units before an atomic save. Submitted
output is validated structurally; storage does not attest scientific validity.

Limits: 3–60 cells on each side at 1 km; 1–10,000 steps; up to 8 MiB per tensor,
16 MiB request body and 2 MiB metadata. Session retention is at most three contexts
and 16 MiB of tensors, with up to another 8 MiB transiently during a run. Saved
contexts can be evicted and restored from history; two unsaved results block further
runs/contexts instead of being discarded. Logout clears all user-scoped caches.
Map destruction invalidates unfinished work; tab hiding permits an already-submitted
run to finish. Aborting a browser request does not guarantee server cancellation.

Reports load only persisted Symphony data, independently of native report loading.
They work with Eco-evo stopped and with new simulation execution disabled. Empty
history adds no appendix. Errors show a local retry state and block modal printing
until all appendix figures load. New saves refresh existing same-origin reports;
focus/reload also refreshes. Public maps do not expose simulation runs.

Calculation deletion removes run metadata and artifacts. Native TIFF purging does
not remove simulations. Deleting a latest calculation also clears its scenario's
convenience reference, avoiding the former foreign-key error. Background run
recovery, separate simulation exports and per-run deletion remain future work.

See [ECOTWIN-API.md](ECOTWIN-API.md) for endpoint contracts and
[implementation-plan.md](../implementation-plan.md) for scope and verification.

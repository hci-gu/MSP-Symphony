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
3. Choose a model, preview duration, full duration and starting seed. **Run preview**
   produces one unsaved run (default 200 steps). Settings changes mark that preview
   outdated. Native calculation inputs remain fixed.
4. Inspect biomass on the map, use the floating bottom playback tray, and explore
   graphs in the collapsible right panel. Time selection in either place updates
   the same map frame. The tray includes speed, species, opacity and fit controls.
5. **Run full simulation · 10 seeds** freezes the settings and submits a server job
   (default 5,000 steps per seed). You can close/reload the browser, reopen EcoTwin,
   and select the calculation to recover progress. A failed job retains completed
   seeds; **Resume this run** retries only the unfinished work. An uncertain submit
   can be retried with the same identity without creating a second job.
6. A completed ensemble saves automatically and creates a report appendix. Its map
   shows the arithmetic mean; graphs show mean curves and pointwise 95% Student t
   confidence bands. These describe seed variability, not input/model uncertainty.
   Relative curves normalize each seed first; totals group species within each seed
   before calculating uncertainty, retaining covariance. Zero initial biomass is
   explicitly undefined in relative views.
7. Open the normal calculation report. It contains all completed ensembles, their
   seed lists/configuration, mean time series, final confidence intervals and mean
   spatial figures. Time-series graphs show each species as a percentage of its own
   initial biomass (100% at the start), with seeds normalized before computing the
   mean and confidence bands. Zero-initial species are explicitly omitted from these
   graphs. Older single-seed runs remain readable and labeled without CIs.
   Previews and incomplete jobs never create appendices. Native exports are unchanged.
8. The open saved simulation is highlighted and labeled **Selected** in the list.
   **Delete** asks for confirmation, then removes the saved result and its report
   appendix. Only the calculation owner can delete it. Deleting the open run also
   clears its map, graph and playback; other saved runs remain available.

A scenario edit affects the next calculation. Selecting an older calculation uses
its frozen scenario changes. To reduce a pressure, edit Symphony and calculate
again. There are no independent demo pressure toggles or fixed MARELD raster inputs.

## Local review fixture

The Poseidon geography comes from [poseidon.md](../poseidon.md). Its surrounding
39 km square is the native scenario area; the park polygon remains reference data,
not a turbine layout or automatic pressure mask. The recorded local fixture is
[data/poseidon/reference-calculation.json](../data/poseidon/reference-calculation.json):

- **#7 — Poseidon — EcoTwin reference:** unchanged pressures; two legacy single-seed runs and two
  ten-seed ensembles (40 steps with seeds 100–109; 80 steps with seeds 200–209).
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

Apply [SimulationRuns.sql](../database/scripts/SimulationRuns.sql), then
[SimulationJobs.sql](../database/scripts/SimulationJobs.sql), and
[SimulationBaselines.sql](../database/scripts/SimulationBaselines.sql), to the Symphony
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

Set Symphony's `ecotwin.api.url` Java system property or `ECOTWIN_API_URL` environment
variable to the same model server used for discovery. For the local Docker backend,
this is `http://host.docker.internal:8000`. No model work starts without that setting.
Previews and full runs share the backend worker to avoid concurrent RNG use. Enable
one Symphony worker instance per model server; the existing Eco-evo API's in-memory
run cache remains unchanged. Keep the configured model/checkpoints unchanged while
jobs are executing (the API does not expose immutable checkpoint hashes).

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
contexts can be evicted and restored from history; previews can be freely replaced
or evicted. Logout clears user-scoped browser caches. Full runs retain a durable
server checkpoint independently of the map or browser lifecycle. Map destruction
invalidates preview callbacks; aborting their HTTP request does not guarantee the
model computation stops, but a preview never creates an appendix.

Reports load only persisted Symphony data, independently of native report loading.
They work with Eco-evo stopped and with new simulation execution disabled. Empty
history adds no appendix. Errors show a local retry state and block modal printing
until all appendix figures load. New saves refresh existing same-origin reports;
focus/reload also refreshes. Public maps do not expose simulation runs.

Calculation deletion removes run metadata and artifacts. Native TIFF purging does
not remove simulations. Deleting a latest calculation also clears its scenario's
convenience reference, avoiding the former foreign-key error. Separate simulation exports and per-run deletion remain future work.
Completed/failed jobs are kept with their calculation for provenance and retry.

See [ECOTWIN-API.md](ECOTWIN-API.md) for endpoint contracts and
[implementation-plan.md](../implementation-plan.md) for scope and verification.

## Comparing scenario simulations

1. In **Compare calculations**, choose the two native calculations as usual, or use
   **Implied baseline** for a changed scenario.
2. Enable **Include simulation comparison**. This optional section fetches saved
   summaries only. The newest compatible ensemble pair is suggested; each dropdown
   also exposes older runs and legacy single-seed results.
3. For an implied baseline without a saved counterpart, click **Create baseline
   calculation**. This explicitly creates a private saved calculation with the same
   area, bands, matrices, normalization and operation, with global and area layer
   changes removed. It leaves the original scenario and its latest calculation
   unchanged. Retrying the action returns the same baseline.
4. If either side needs a simulation, use **Prepare baseline/scenario simulation in
   EcoTwin**. A new tab selects that calculation and copies the other selected run's
   model, duration and starting seed. Review the inputs and start the full run there.
   Return to Compare calculations; the saved runs refresh on focus, completion or
   **Refresh saved simulations**. Opening a comparison never starts a model run.
5. Choose compatible runs, then click **Compare Calculations**. Matching requires
   the same model, species, duration/sampling, seeds, input mapping, baseline source
   datasets, selected bands and calculation domain/grid. Native scenario pressure
   changes are intentionally allowed. Two legacy runs can be compared, but cannot
   be paired with an ensemble and have no confidence intervals.

The appendix presents one species per row, baseline and scenario side by side.
Both graphs use the same axes, `% of initial biomass`, and a 100% reference line.
Each seed is normalized against its own initial biomass before calculating the
mean and pointwise 95% Student t confidence interval. A zero initial biomass is
reported as undefined. Absolute tonnes are not shown in these comparison graphs.
Reversing an implied comparison also reverses its appendix columns.

The report URL pins both run IDs. Reopening it never substitutes a newer result.
Deleted or unavailable runs produce an explicit appendix error, while the native
comparison remains visible. The modal waits for the requested appendix before
allowing printing; the new-tab and A4 print views retain the pair and columns.
CSV/GeoTIFF downloads remain the native Symphony comparison exports.

Local Poseidon examples: compare reference **#7** against the 50% bottom-trawling
scenario **#9**, using the 80-step ensembles with seeds 200–209. The implied-baseline
workflow for #9 now has saved counterpart **#18** with a matching full ensemble.
See [poseidon.md](../poseidon.md) for run IDs and verification evidence.

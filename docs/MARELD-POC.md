# MARELD POC: review and operation

This is the authoritative guide to the current implementation. The integration
plan and dated verification entries preserve historical context.

Implemented 2026-09-30; live API connection verified 2026-10-06. This is a real
feature in Symphony's Angular sidebar and OpenLayers map. All simulations use
real Eco-evo inference; the Demo mode and source toggle have been removed. The
default API target is `http://localhost:8000`. The earlier Tailscale verification
is recorded below.

## Demo noise and trawling inputs (2026-10-12)

The **Demo impacts** section optionally connects the shipped shipping-noise and
bottom-trawl source rasters to simulation requests. Both default to off. Select
and capture **MARELD POC review area**, enable either impact, inspect its coverage
and preview, and choose **Show input on map** to see the exact banded field.
The example area is outside this dataset; enabling impacts there reports missing
coverage instead of silently simulating an empty pressure field.

Each source is aggregated from 250 m cells to the captured 1 km grid and encoded
as up to 16 binary masks with scalar intensities. Unknown source portions contribute
zero added pressure, explicitly labelled in the UI. Noise and trawling strength
controls range from 0 to 2. These are demo conversions, not measured dB or validated
fishing mortality. Map display selection/opacity does not change simulation inputs.
Prepared inputs and source metadata are retained with the result in memory; later
control changes apply only to the next run.

Use **Mask outlines** to toggle **Shipping noise outline** (solid cyan) and
**Bottom trawling outline** (dashed green) independently. Before a run, the controls
appear below Demo impacts; afterward, they appear under Explore the result.
They trace the combined footprint of cells with positive pressure, retaining
holes and disconnected patches without drawing internal band or cell boundaries.
Both can remain visible above biomass during playback, alongside the wind-park
outline. These toggles only change map display. Result outlines use the masks
saved with that run; **Show input on map** instead previews the prepared inputs
and their corresponding outlines. Zero-pressure inputs have no outline.

**Server integration is implemented in Eco-evo.** Start its API with
`--project mareld_symphony_demo.yaml` to enable both effects. The multipart parser
accepts the existing mask contract, and nonzero pressures without an active model
response are rejected. The original project remains the server's default.
[ECO-EVO-DEMO-IMPACTS-HANDOFF.md](ECO-EVO-DEMO-IMPACTS-HANDOFF.md) retains the exact
contract, scaling and implementation checklist; Eco-evo's `SYMPHONY_DEMO.md` is its
operating guide. Baseline runs with both impacts off retain the previous request
format and have zero pressure in the demo profile.

**Direct benthos response:** Eco-evo now applies bottom-trawling mortality to the
benthic community as well as the existing pelagic-fish proxy. In the demo range,
the benthic loss is `biomass * 0.02 * intensity` per library tick (six hours),
capped at 0.8% per tick: intensity 0.1 removes 0.2% locally. Existing benthic
regrowth and recolonisation still apply. This is an illustrative response, not
a calibrated estimate. It uses the same masks and request format. Restart the
Eco-evo API after updating its code and submit a new simulation; saved results
retain the old behavior.

## Review in the running app

Open <http://127.0.0.1:4200/map> and select the grid icon, **MARELD**, at the bottom
of the sidebar tabs.

1. Under **Area**, click **Try example area**. The example is a full 60×60
   synthetic water world: 3,600 cells at 1 km per cell. Runs default to 5,000 steps.
2. Under **Select model**, choose an available model (the current local server
   lists **Test**). Models load automatically from `http://localhost:8000`.
   If loading fails, the error includes a **Retry loading models** button.
3. Under **Simulation**, set the number of steps and click **Run simulation**.
   Running requires a captured area and an available model.
4. Scroll down to **Explore the result**. Change species, time and map opacity.
   The color scale stays fixed across all frames for that species.
   Use **Play / Pause** beside the timeline to replay two saved frames per second.
   Playback stops at the final frame; Play there starts again from the beginning.
   Moving the time slider or selecting a time in the population graph pauses replay.
   Clearing the result, changing the area, or starting a new run also stops replay.
5. **Population trends** graphs each species and their combined biomass over time.
   Switch between **Tonnes** and **% of initial**, toggle species in the legend,
   and use **Expand** for a larger graph. Hover for values; click the graph or use
   its arrow keys to change the map time. The values table follows the same time.
6. **Clear result** removes the biomass image, graphs and result controls. The captured
   area's outline remains available for another run.
7. To use your own shape, open **Areas**, use **Draw area** on the map, double-click
   to finish, and save it. Select the saved area, return to **MARELD**, and press
   **Use selected area**, then **Run simulation**.

One native user area, **MARELD POC review area**, was saved under the local `hav-local`
account during verification. On 2026-10-06 its boundary was updated to a **39 × 39 km
square** enclosing the five supplied wind-park corners near 58.1° N, 10.4° E. It is
aligned to the EPSG:3035 kilometre grid, with extent `[4326000, 3873000, 4365000,
3912000]`, and yields 39 × 39 cells (1,521 km²). It can be reused or removed through
Symphony's normal area tools. No baseline, environmental raster, sensitivity matrix
or scenario data is created by the feature itself.

### Wind-park pressure footprint

The **Pressures** tab includes **MARELD wind park**, a supplemental polygon layer
using the five supplied corner coordinates, in longitude/latitude order. Its
footprint is approximately **368.9 km²**, inside the square review area. The source
GeoJSON and attribution are stored in
[`mareld-windpark.json`](../frontend/src/assets/pressures/mareld-windpark.json).

Selecting **MARELD POC review area** in Areas automatically shows the footprint.
Capturing that area in MARELD also keeps it visible while working with that input.
The Pressures entry has a visibility toggle and participates in pressure search.
Manual visibility is respected until the review-area context changes. Changing
baseline or leaving the map clears the overlay; the feature flag also disables it.

This is a pressure **footprint**, with no assigned intensity or calibrated
ecological effect. It is displayed above the biomass overlay, but is not added to
the historical HaV raster bands, sensitivity matrices or Eco-evo pressure request.

The result renderer uses the captured input grid. Changing the ordinary map
selection alone does not move a result. Capturing another input clears
it. Switching baseline, leaving the map or logging out discards the POC session's
input/result; stale requests cannot bring an old result back. Switching sidebar tabs
keeps the result. There is no saved run history.

## Start locally

The existing local HaV installation and its database/application containers are
prerequisites for this checkout. Their setup and login details are documented in
[LOCAL-IMPORT.md](../data/hav-symphony-2019/LOCAL-IMPORT.md). The generated account
credentials remain in ignored `.local/symphony/hav-local-credentials.json`.

From the Symphony repository root, with Docker Desktop running and the existing
frontend dependencies installed:

```sh
./scripts/start-local-symphony.sh
```

This starts `msp-symphony-db` and `msp-symphony-wildfly`, then serves the frontend on
loopback port 4200.

From the Eco-evo repository, start the impact-capable demo on port 8000:

```sh
uv run --locked python -u api.py --host 127.0.0.1 --port 8000 \
  --project mareld_symphony_demo.yaml
```

Omit `--project` to use its original `mareld2.yaml` configuration, which does not
enable the demo effects. Both the normal frontend proxy
and the local startup script forward `/mareld-api` to `http://localhost:8000`,
removing the prefix. Both use `frontend/proxy.conf.js`; the startup script chooses
the existing HTTP Symphony backend through `SYMPHONY_API_URL`. Normal frontend
startup still honors `PROXY_TARGET`, unless `SYMPHONY_API_URL` overrides it.

Shared defaults live in `features/mareld-shared/run-config.json`: API prefix,
default inference target, discovery/run timeouts, proxy grace period, tick duration,
step limits and tensor budget. The client, proxy and day labels consume the same
settings. Model preference and feature enablement remain environment-specific.

Check API access before running a simulation:

```sh
curl --connect-timeout 10 --max-time 20 http://localhost:8000/v1/models
```

The server needs trained checkpoints compatible with its selected project and
biological library under `eco-evo/results/<model-id>/policy_<species>.pth`. The API
discovers directory names as model IDs. Discovery alone does not guarantee that
checkpoint loading will succeed.

Development prefers `allminussb` when available and otherwise selects the first
discovered model, currently `2026-10-08` on the local server. This checkpoint has
been verified with `mareld_symphony_demo.yaml`. Discovered folders can
belong to different training projects. During the earlier Tailscale verification,
`codex_api_smoke_20261006` contained only `policy_pelagic_fish.pth`, while that
server's project required policies for `gadoids`, `pelagic_fish`, `porpoises` and
`zooplankton`. It returned HTTP 422 `MODEL_CHECKPOINT_MISMATCH`; `allminussb` worked.
Such errors require choosing compatible checkpoints or serving the model with its
matching project; changing the request's output species does not fix missing policies.

To target a different service, set `MARELD_API_URL` when starting the frontend.
For example, to use an Eco-evo process on a different local port:

```sh
MARELD_API_URL=http://localhost:8001 ./scripts/start-local-symphony.sh
```

Restart the frontend after changing the proxy target. The frontend uses a relative
same-origin URL; it does not require browser CORS changes. This development proxy
is not an authenticated shared-service deployment.

## Delivered components

Simulation code and focused tests live under
[`frontend/src/app/features/mareld-poc/`](../frontend/src/app/features/mareld-poc/).
Environmental layer display code lives under `features/mareld-layers/`. Both use
`features/mareld-shared/` for projection/raster rendering, review-area recognition
and configuration. Layer display remains independent of the simulation session;
the impact loader reads the original noise/trawling assets directly.

| Component | Responsibility |
| --- | --- |
| `mareld-poc.module.ts`, `mareld-panel.component.*` | Native sidebar, input preview, API/model controls, frame/species/opacity controls and legend |
| `symphony-selection.adapter.ts` | Captures one selected record for simulation; shared review-area recognition has its own selector adapter |
| `mareld-input.ts` | Geometry snapshot, EPSG:3035 grid, cell-center mask, texture/depth PNGs and example geometry |
| `mareld-api.client.ts` | Model discovery and multipart submission to the existing Eco-evo API |
| `mareld-impacts.ts`, `mareld-impact-data.service.ts` | Source loading, area aggregation, demo scaling, disjoint bands and API mask metadata |
| `mareld-impact-controls.component.*` | Independent toggles/strength, coverage, exact input previews |
| `mareld-result.ts` | Response validation, little-endian float32 decoding, fixed scales and image generation |
| `mareld-biomass.ts`, `mareld-biomass-chart.component.*` | Per-species water-cell totals, Ecotwin colors, interactive biomass graph, relative view and expanded dialog |
| `mareld-session.service.ts` | Local state and protection against stale responses; no global result arrays in NgRx |
| `mareld-map.bridge.ts` | One `mareld-poc` layer group on the existing map, including reprojection and cleanup |
| `mareld-pressure-layer.*` | Supplemental wind-park pressure data, search/visibility controls and automatic review-area visibility |

The HTTP request uses exactly `POST /v1/runs`, with JSON in the `request` field and
both `texture.png` and `depth.png`. It supplies the seed in JSON and one replicate.
Baseline requests have an empty pressure list. Enabled demo impacts add two
whole-grid zero resets followed by ordered mask/scalar pressure entries and
repeated `mask` PNG file parts; see the handoff for the exact contract. No explicit multipart Content-Type is set: the browser
must provide the boundary. Responses must match the requested species, dimensions,
sampling schedule, float32 dtype, exact byte count and finite nonnegative values.

No new package dependencies, backend endpoints, database migrations, generic plugin
SDK or second map were added. The session sends every simulation to the live client
and displays its validated result on the map and population graph.

### Population graph interpretation

The graph adapts Ecotwin's `src/components/biomass-chart.tsx` and
`src/lib/species-colors.ts` from the local Ecotwin checkout. It sums the decoded
biomass tensor across the captured area's water cells for every returned frame;
masked cells and polygon holes are excluded. Units are **tonnes of biomass**,
rather than individual animal counts. The **Total** line sums only the species
enabled in the chart legend. Chart visibility is independent of the species shown
on the map.

In **% of initial**, each line starts at 100% and expresses its biomass relative
to its own initial value. Total is normalized after summing the selected species.
A zero initial value has no defined relative curve; the Tonnes view still shows
that species. One result contains one replicate, so the graph displays trajectories
without confidence bands. It uses the same sampled frames as the map: 51 points
at the default 5,000 steps, with simulation days on the horizontal axis. Totals
are calculated once per result; moving the map time does not rescan the tensor.

## State and rendering ownership

- `MareldSession` exposes read-only signals. Capture, discovery, run, model/species
  selection, step/opacity changes, seeking, playback and reset go through its methods.
  The session owns run eligibility, revision guards and browser-request abortion.
- `MareldLayers` owns selection, display settings and loading state. Its public
  actions preserve manual choices until the review context changes. The pressure
  module independently owns footprint visibility, including captured-input context.
- `mareld-shared/review-area.ts` recognizes the saved review area by its normalized
  name and user-area type. Environmental layers follow selected areas; a captured
  simulation input may keep the wind-park footprint available after deselection.
- `mareld-shared/map-raster.ts` registers EPSG:3035 and turns north-first RGBA pixels
  into a projected image source. Each map module owns and disposes its own layers.
  Environmental-layer opacity updates do not reload, decode or regenerate imagery,
  and do not invalidate an in-flight raster request.

## Limits and interpretation

- The polygon defines **enclosed synthetic water**. Holes and outside cells are
  inaccessible. This is not a coastline or observed habitat/biomass dataset.
- Cells are 1 km square in EPSG:3035. Row zero is north. The grid extent is retained
  with the captured geometry and used to reproject the image onto Symphony's map.
- Grids range from 3×3 to 60×60 cells. Oversized and sub-cell/narrow areas are rejected;
  the feature never silently resizes them to a different ecological scale.
- Polygon and MultiPolygon are supported, including holes. One selected record is
  accepted at a time, up to 20,000 vertices. Geometry checks cover type, coordinates,
  closed rings and raster coverage, not comprehensive topology repair.
- Default: 5,000 six-hour steps (1,250 days), with a map snapshot every 100 steps
  plus the initial state (51 frames). Every simulation step is computed. The output
  sampling interval is `max(4, ceil(steps / 50))`, so short runs retain the four-step
  interval and longer runs return at most 51 frames, always including the final step.
  Allowed range: 1–10,000 steps, one foreground run at a time, up to 8 MiB of raw
  float32 data. The default 60×60, six-species run uses about 4.2 MiB. The UI holds
  the tensor in memory.
- Depth is an all-zero PNG because this API requires the file but does not currently
  use it ecologically. Only the explicitly enabled noise and trawling demo inputs
  are connected; species initialization and other environmental layers remain synthetic.
- Model discovery times out after 15 seconds; a run after 30 minutes. The proxy
  allows 30 minutes and 10 seconds. A timed-out or discarded browser request may still be computing
  on the server. There is no automatic retry or server cancellation.
- The API profile is controlled in Eco-evo. In the 2026-10-12 checkout it enables
  natural mortality, migration and currents, and inherits mass-balanced growth.
  Verify the selected profile/checkpoint together; concurrent requests can share
  global RNG state. A live result remains an experimental model output, not a
  validated forecast for the captured geography.
- The native Symphony calculation toolbar continues to manage native calculations;
  use the POC panel's **Clear result** for the MARELD overlay.

See [MARELD-API-NOTES.md](MARELD-API-NOTES.md) for the underlying source review and
engine/API limitations, and [the agreed POC plan](MARELD-INTEGRATION-PLAN.md) for
deferred production work.

## Cleanup verification (2026-10-12)

- Created the pre-cleanup checkpoint `ae83fbf` on `codex/mareld-cleanup`.
- All 226 frontend tests pass (224 before cleanup), including added coverage for
  opacity during an in-flight load and the different selected/captured review-area
  rules. Lifecycle tests exercise public state actions instead of writing signals.
- Feature/environment ESLint and the production build pass. The existing initial
  bundle warning remains: 2.33 MB against a 2 MB warning threshold.
- Regenerated all six native regional TIFFs: the preparation report, including
  output hashes, is byte-identical. Importer SQL is also byte-identical.
- Regenerated all supplemental assets and their validation report byte-for-byte.
  All 212 overlap-audit datasets match; only the audit timestamp changes.
  Verified all 1,131 original/extracted source files against their pinned hashes.
- Shell/JavaScript syntax, Python lint and real HTTP proxy smoke checks pass,
  including target overrides, multipart forwarding and path rewriting.
- The local frontend and Eco-evo server were not running during this review;
  no new live inference or authenticated browser verification is claimed.
  Earlier live-run evidence remains in the dated entries below.

Cleanup logs are local under ignored `.local/symphony/cleanup/`.

## Disable or remove

For a quick disable, set `mareldPoc.enabled` to `false` in the relevant environment
file and restart/rebuild. Development enables it; production already disables it.
The disabled feature adds no sidebar tab, map layer or inference request. The public
map does not attach the feature's map bridge.

For complete removal, delete `features/mareld-poc`, `features/mareld-layers` and
`features/mareld-shared`, and remove these hooks:

1. `MareldPocModule` import in `map-view.module.ts` and the matching test import in
   `main-view.component.spec.ts` (including its disabled-feature test).
2. `mareldPocEnabled` in `main-view.component.ts` and the conditional tab in its template.
3. `MareldMapBridge` import/injection and guarded attach/reset/detach calls in
   `map/map.component.ts`.
4. The `mareldPoc` objects in the development and production environment files.
5. The `/mareld-api` route and shared-config import in `frontend/proxy.conf.js`,
   and the MARELD target message in `scripts/start-local-symphony.sh`.
6. The projected pressure control and search predicate in `main-view.component.*`,
   and `frontend/src/assets/pressures/mareld-windpark.json`. The generic projected
   content slot in `band-selection` can remain.
7. `MareldLayersComponent`/`MareldLayerLegendComponent` imports, projected controls,
   legend/search hooks and guarded `MareldLayersMap` calls, plus
   `frontend/src/assets/mareld-layers/`.

No migration rollback is necessary. Preserve unrelated local HaV data/import and
authentication work already present in this checkout.

## Population graph verification on 2026-10-06

- **30 feature tests passed**, including water-mask aggregation, tensor indexing,
  selected-species totals, normalization, zero initial biomass, uneven sample
  spacing, map-time events, series controls and the expanded dialog. ESLint passed.
- Production build passed, with the existing initial-bundle warning: 2.28 MB
  against a 2 MB warning threshold (below the 5 MB error threshold).
- Ran the local **Test** model in the browser for 5,000 steps on the full 60×60
  example world. `POST /mareld-api/v1/runs` returned HTTP 200; the graph displayed
  all six species plus their total across 51 frames. Confirmed graph clicks and
  keyboard controls update map time, species/total toggles, the relative view,
  hover values, and expanded-dialog open/close behavior.
- Reviewed screenshots of demo and live results. Live screenshots are retained
  locally at ignored `output/playwright/population-live-expanded.png` and
  `output/playwright/population-live-relative.png`.

## Long-run verification on 2026-10-06

- **18 feature tests passed**, including exact 60×60 rasterization after projection,
  the 5,000-step multipart request, six-species response decoding, memory limits,
  partial final sampling intervals, and demo/session/map behavior. ESLint passed.
- Restarted the frontend with the extended proxy timeout; development compilation
  and shell/JavaScript syntax checks passed.
- Ran the local `Test` model through the browser at `http://localhost:8000`: the
  full 60×60 water world completed 5,000 steps and returned HTTP 200. The client
  validated and rendered all six species and 51 frames, including day 1,250.
- Verified species switching and the final frame on the map. Screenshot:
  ignored `output/playwright/local-60x60-5000-steps.png`.

## Tailscale verification on 2026-10-06

- At this earlier verification, both proxy configurations used `http://tactik-pc.tail796302.ts.net:8001` by default;
  `MARELD_API_URL` still overrides the target. Checked the default, override, prefix
  removal and 190-second proxy timeout.
- Restarted the frontend with `./scripts/start-local-symphony.sh`; development
  compilation succeeded. Shell/JavaScript syntax and whitespace checks passed.
- Logged in through the browser using the existing `hav-local` credentials.
- `GET /mareld-api/v1/models` returned HTTP 200 with 77 models. The browser sent
  `POST /mareld-api/v1/runs` through the same proxy and received HTTP 200.
- `Allminussb` completed 48 steps on the 17×15 example domain (162 accessible cells).
  The live response passed client validation and displayed six species across 13
  frames. Verified the map overlay, switching species and the final day-12 frame.
- Screenshot: ignored `output/playwright/tactik-live-result.png`.
- Checkpoint-error follow-up: reproduced HTTP 422 for `codex_api_smoke_20261006`,
  then recovered in the browser by selecting `Allminussb` and completing 48 steps.
  Development now explicitly selects and labels `Allminussb` as the default.
  Checkpoint errors explain how to choose another model and retain server details.
  All nine focused API/session tests passed, including regression checks for the
  error guidance and default selection when discovery order changes.

This verifies connection and rendering with a real model, not ecological accuracy
for the selected geography. The synthetic-domain limitations still apply.

## Verification on 2026-09-30

- **188 frontend tests passed**, including 14 focused feature tests and a disabled-tab
  regression test. Checks cover holes, disconnected parts, rectangular orientation,
  species/frame indexing, PNG multipart inputs, malformed results, budget limits,
  stale responses, fixed scales and independent map-layer cleanup.
- Production build passed. It reports a 2.26 MB initial bundle against the repository's
  2 MB warning threshold; the 5 MB error threshold is not exceeded.
- ESLint passed for all feature TypeScript/templates, using the repository's existing
  `.eslintrc.json` configuration. No backend code was changed or backend tests needed.
- Browser review passed: login to the local instance, example domain with a hole,
  native drawing/save/select/capture, synthetic map rendering, species/time/opacity
  controls, clearing, baseline-switch cleanup, and real API discovery with the
  missing-checkpoint message. The original baseline was restored after this check.
- An Angular development-mode `NG0100` console error was observed when saving through
  the native drawing dialog (`MapComponent.drawIsActive`). The area was saved and
  successfully used by the POC. That drawing implementation was not modified.
- No real model inference completed because no compatible checkpoints are available
  locally. The live response path is covered by HTTP contract tests, not a claimed
  successful scientific model run.

Commands, from `frontend/` (set `CHROME_BIN` for your installed browser if needed):

```sh
npx ng test --watch=false --browsers=ChromeHeadless
npx ng build --configuration production
ESLINT_USE_FLAT_CONFIG=false npx eslint 'src/app/features/mareld-poc/*.{ts,html}'
```

Local browser screenshots are in ignored `output/playwright/`; test/build logs are
in ignored `.local/symphony/mareld-{tests,build}.log`.

### Demo impact verification — 2026-10-12

- All 51 focused MARELD tests passed, including spatial aggregation, source coverage,
  disjoint-band reconstruction, real PNG multipart encoding, saved input snapshots,
  stale preparation/reset handling and input/result map switching.
- Changed feature files passed ESLint. Repository-wide lint still reports 30 errors
  and two warnings in untouched files.
- Production build passed (2.35 MB initial bundle; existing 2 MB warning threshold).
- Full frontend suite: 237/238 passed. `AddScenarioAreasComponent should create`
  failed with a missing icon-button label in the combined run, then passed alone;
  its files were not changed in this task.
- Browser verification on the 39 × 39 review grid: noise covered 100% of accessible
  area with 1,447 positive cells; bottom trawling covered 48.9% with 754 positive cells.
  Both prepared overlays were inspected on the map.
- Before the Eco-evo changes, a four-step baseline run completed successfully. A request
  with both impacts reached the existing mask-parser failure, which now produces
  explicit setup guidance in Symphony. The subsequent Eco-evo implementation and
  verification are recorded below.

### Eco-evo implementation and end-to-end verification — 2026-10-12

- Patched Eco-evo's multipart mask parser, rejected invalid intensities and
  nonzero pressures without an active model response, and added optional server
  `--project` selection. The HTTP request and result formats are unchanged.
- Added `mareld_symphony_demo.yaml`, which enables non-observable noise and
  bottom-trawling effects with zero baseline maps. The original project and
  existing policy observation widths are preserved. Noise uses the porpoise
  energy-cost response; bottom trawling uses an illustrative pelagic-fish
  mortality response in `fgconfig/fg_library.yaml`.
- All 31 focused API tests passed, including repeated RGBA masks, exact field
  reconstruction, direct ecological effects and four real-engine HTTP scenarios.
  Full Eco-evo suite: 896 passed, 100 skipped, one unchanged Pygame tooltip test
  failure that also reproduces in isolation. A one-generation training smoke
  test completed for all four decision makers, with output outside the repository.
- Existing checkpoint `2026-10-08` passed sequential HTTP comparisons: baseline,
  noise-only, trawling-only and both had identical initial tensors and distinct
  final tensors. Direct terms were independently checked: porpoise metabolic
  multiplier 1.275 at noise 90, fish mortality `biomass * 0.0001` at trawling 0.1.
- Restarted local Eco-evo at port 8000 with the demo project. All four combinations
  also completed from Symphony's browser UI on the actual 39 x 39 review area,
  with 48 steps, 13 frames and six species (`[13, 39, 39, 6]`). Result input labels
  correctly reflected the toggles, including the no-added-impacts baseline.
- The running browser is left with a combined demo result. Demo scalings remain
  illustrative, and the existing policies do not have learned impact avoidance.

### Mask causality audit — 2026-10-12

Captured the exact multipart upload and response from a real browser run using
the review area, checkpoint `2026-10-08`, seed 42, strength 1.0, 1,000 steps
(250 days) and six species. Temporary observational wrappers recorded the maps
after `apply_uploaded_inputs`, the first actual impact-mortality call, and the
energy settlement returned before movement. Production source was not altered.

- Independently averaged aligned 4 x 4 source blocks and compared every band mask
  and Float32 engine-map cell: zero mismatches. The request contained four noise
  masks (1,447 positive cells; intensities 63.75-75) and ten trawling masks
  (754 positive cells; intensities 0.0125-0.125).
- Repeated baseline and an otherwise identical request with all masks black
  produced bitwise-identical complete tensors. All scenarios began identically.
- Browser baseline and combined results matched their HTTP replays bit for bit.
  Horizontally flipping only the uploaded masks flipped both reconstructed fields
  exactly and changed the final result.
- The first actual trawling mortality operation removed 0.251923 tonnes of pelagic
  fish across 327 occupied cells; loss outside its mask was exactly zero. Other
  decision makers had no direct trawling mortality.
- Noise increased porpoise metabolic multipliers up to 1.1125. Its first actual
  energy settlement consumed an additional 47.973 MJ across three occupied cells,
  with no additional cost outside its mask and no direct change to other species.
- At day 250, relative to the matched baseline, noise-only changed total porpoise
  biomass by -35.705% and trawling-only changed pelagic-fish biomass by -3.468%.
  With both inputs, the changes were +11.269% and -2.436%, respectively. These are
  single-seed experimental food-web outcomes, not calibrated forecasts; combined
  effects need not add or have the same sign. Movement and interactions propagate
  later differences outside the directly affected cells.

Local audit artifacts (ignored) are in `.local/symphony/mask-audit-20261012/`:
`audit_server.py`, `verify_masks.py`, original requests/masks, intermediate arrays,
result tensors, `audit-results.json`, and `mask-effects.png`. The regular demo API
is restored after capture; a fresh browser run without diagnostics was also
bitwise-identical to the audited combined result. This audit verifies the noise/trawling pressure masks;
the orange wind-park outline is still visual context, and the review domain is
synthetic water rather than a coastline/depth-derived habitat mask.

### Impact outline display — 2026-10-12

- `mareld-impact-outline.ts` traces and merges exposed cell edges; adjacent
  intensity bands share one footprint, while holes and separate patches remain.
- `mareld-impact-outlines.component.ts` provides the two independent display
  toggles and their line-style legend. Both default to off and reset with the session.
- `mareld-session.service.ts` selects saved result masks or prepared preview masks.
  `mareld-map.bridge.ts` projects and caches separate vector layers above the
  biomass image. Visibility/frame changes do not rebuild the outlines or call the API.
- All 55 focused MARELD tests passed, including footprint geometry, simultaneous
  overlays, input snapshots, preview switching, independent toggles and cleanup.
  Changed files passed ESLint; production build passed with the existing 2 MB
  bundle-budget warning (2.35 MB actual).
- Browser verification: enabled both prepared outlines, ran the real 1,000-step
  simulation, then checked each outline separately and together over the final
  biomass frame. The map retains the wind-park outline and result controls.

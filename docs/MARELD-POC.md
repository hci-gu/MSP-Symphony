# MARELD POC: review and operation

This is the authoritative guide to the current implementation. The integration
plan and dated verification entries preserve historical context.

Implemented 2026-09-30; live API connection verified 2026-10-06. This is a real
feature in Symphony's Angular sidebar and OpenLayers map. All simulations use
real Eco-evo inference; the Demo mode and source toggle have been removed. The
default API target is `http://localhost:8000`. The earlier Tailscale verification
is recorded below.

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

Run Eco-evo locally on port 8000. Both the normal frontend proxy
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

The server needs trained checkpoints compatible with its `mareld2.yaml` and
biological library under `eco-evo/results/<model-id>/policy_<species>.pth`. The API
discovers directory names as model IDs. Discovery alone does not guarantee that
checkpoint loading will succeed.

Development prefers `allminussb` when available and otherwise selects the first
discovered model, currently `test` on the local server. Discovered folders can
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
Map-only environmental layers live under `features/mareld-layers/`. Both use
`features/mareld-shared/` for projection/raster rendering, review-area recognition
and configuration. Environmental layers do not depend on the simulation session.

| Component | Responsibility |
| --- | --- |
| `mareld-poc.module.ts`, `mareld-panel.component.*` | Native sidebar, input preview, API/model controls, frame/species/opacity controls and legend |
| `symphony-selection.adapter.ts` | Captures one selected record for simulation; shared review-area recognition has its own selector adapter |
| `mareld-input.ts` | Geometry snapshot, EPSG:3035 grid, cell-center mask, texture/depth PNGs and example geometry |
| `mareld-api.client.ts` | Model discovery and multipart submission to the existing Eco-evo API |
| `mareld-result.ts` | Response validation, little-endian float32 decoding, fixed scales and image generation |
| `mareld-biomass.ts`, `mareld-biomass-chart.component.*` | Per-species water-cell totals, Ecotwin colors, interactive biomass graph, relative view and expanded dialog |
| `mareld-session.service.ts` | Local state and protection against stale responses; no global result arrays in NgRx |
| `mareld-map.bridge.ts` | One `mareld-poc` layer group on the existing map, including reprojection and cleanup |
| `mareld-pressure-layer.*` | Supplemental wind-park pressure data, search/visibility controls and automatic review-area visibility |

The HTTP request uses exactly `POST /v1/runs`, with JSON in the `request` field and
both `texture.png` and `depth.png`. It supplies the seed in JSON, an empty pressure
list and one replicate. No explicit multipart Content-Type is set: the browser
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
  use it ecologically. Environmental layers and pressure effects remain disconnected.
- Model discovery times out after 15 seconds; a run after 30 minutes. The proxy
  allows 30 minutes and 10 seconds. A timed-out or discarded browser request may still be computing
  on the server. There is no automatic retry or server cancellation.
- The inspected API disables natural mortality and uses mass balance off, unlike
  current CLI defaults. It also lacks complete seed isolation. A live result is an
  experimental model output, not a validated forecast for the captured geography.
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

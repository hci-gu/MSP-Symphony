# Symphony MARELD: first POC

**Historical plan, agreed 2026-09-29.** This records the original scope and tradeoffs,
not the current feature inventory. The implementation has since removed Demo mode,
added live inference, playback, population graphs and supplemental environmental layers.
Use [MARELD-POC.md](MARELD-POC.md) as the authoritative operation and implementation
guide, and [MARELD-LAYERS.md](MARELD-LAYERS.md) for map-data preparation and interpretation.
The original plan below is retained for context.

## Goal

Build a real feature inside Symphony: select or draw a map area, prepare a small simulation grid, and display biomass frames on the existing map through a MARELD panel.

The first delivery may use explicitly labeled synthetic results while the live API connection is completed separately. Both paths use the same input and result types. Native Symphony integration is the first milestone; a successful real model run is a second, separately verifiable milestone.

Keep the implementation in one feature directory with a few explicit host hooks. Extract a separately packaged plugin only after this flow works. The [API research notes](MARELD-API-NOTES.md) preserve the findings and verification from the repository review.

## What the first delivery contains

1. A **MARELD POC** tab in Symphony's existing sidebar, behind a configuration flag.
2. **Use selected area**, capturing a snapshot of a selected or drawn Polygon/MultiPolygon, including holes.
3. A small input preview showing the outline, rasterized domain, grid extent, and dimensions.
4. A clear **Demo / Live API** mode choice. Demo works without Eco-evo running; Live is enabled when the local service and model are configured.
5. A biomass overlay on Symphony's OpenLayers map, with species selection, a frame slider, opacity, and a fixed color scale.
6. Simple loading/error states and a clear-result action.

Use one captured study area at a time; a MultiPolygon can contain multiple parts. Start from the normal Areas selection flow. Scenario-specific selection and combining several separately selected records can follow later.

Changing the selection must not move an existing result. A new run gets a new snapshot. The result belongs to the grid that produced it.

## Deliberate POC shortcuts

| Concern | First POC | Later replacement |
| --- | --- | --- |
| Packaging | A feature module inside this repository | Independently versioned plugin package and a small host SDK, if still useful |
| API transport | Angular development proxy to a local Eco-evo process | Authenticated backend adapter for shared deployment |
| Geometry coupling | One adapter reads Symphony's selected feature | Generic selection/scenario context interface |
| Environmental data | Selected polygon becomes a synthetic enclosed domain | Actual coast/land/water rasters and model-specific environmental inputs |
| Depth | All-zero PNG, required by the API but currently unused | Real depth data when the model consumes it |
| Execution | One foreground request at a time; local state in memory | Durable background jobs, progress recovery, and concurrency controls |
| History | Current result only; refresh may discard it | Saved runs, input provenance, and database/file storage |
| Model configuration | One manually selected compatible checkpoint directory | Versioned model profiles with validated configuration and capabilities |
| Model correctness | Existing behavior documented as a technical demonstration | Calibration, scientific validation, and API/model fixes |
| Disconnected development | Explicit synthetic-data mode | Live inference through the same client interface |

These shortcuts are visible parts of the demonstration. A failed live request must show an error, never silently switch to demo data. Demo and live results carry their source label through the panel and legend.

## A small implementation boundary

Put the feature under:

```text
frontend/src/app/features/mareld-poc/
  mareld-poc.module.ts
  mareld-panel.component.*
  mareld-session.service.ts
  symphony-selection.adapter.ts
  mareld-api.client.ts
  mareld-demo.client.ts
  mareld-input.ts
  mareld-result.ts
  mareld-map.bridge.ts
```

The exact file split can stay small. The responsibilities are:

- **Selection adapter:** read Symphony's selected feature and produce a copied GeoJSON snapshot. Keep imports of core selectors here.
- **Input preparation:** turn that geometry into a metric grid and two PNGs. Keep this independent of Angular components.
- **Run clients:** a common `run(preparedInput, options)` boundary implemented by the synthetic-data client and the real HTTP client.
- **Session service:** hold the current input, mode, request state, result, selected species, and frame. Keep arrays and image objects out of the global NgRx store.
- **Map bridge:** own one OpenLayers layer group and its lifecycle. It attaches to the existing map and replaces only its own overlay.

No general extension registry, public SDK, new Java backend, database schema, job framework, or second map/framework is needed for this milestone.

### Explicit changes in Symphony

| Existing file/area | Small host change |
| --- | --- |
| [Main view template](../frontend/src/app/map-view/main-view.component.html) | Add one conditional `app-slide-view-tab` containing the POC panel. Keep the tab directly in the host template so the existing slide-view content query finds it. |
| [Map-view module](../frontend/src/app/map-view/map-view.module.ts) | Import the POC module. |
| [Map component](../frontend/src/app/map-view/map/map.component.ts) | Attach the feature's map bridge after map creation and detach it during teardown, when the feature is enabled. |
| [Development environment](../frontend/src/environments/environment.ts) and [production environment](../frontend/src/environments/environment.prod.ts) | Add a small POC configuration: enabled, mode, relative API URL, and optional model ID. Production stays disabled. |
| [Development proxy](../frontend/proxy.conf.js) | Add a separate `/mareld-api` route to the local inference service, preserving existing Symphony routes. |

Read selection via [the area selectors](../frontend/src/app/data/area/area.selectors.ts), especially `selectSelectedAreaData`. Opening the panel captures nothing automatically: the user presses **Use selected area** after using the existing drawing/selection tools.

Give the overlay its own ID and layer group; do not insert synthetic calculation IDs into Symphony's native results/history. Removing the feature should involve deleting its directory and reverting these host hooks, without touching core data or calculations.

## Geometry becomes a synthetic simulation domain

The first POC does not need an environmental data pipeline.

1. Copy the chosen geometry and transform it to a metric grid CRS already supported by Symphony, initially EPSG:3035.
2. Compute bounds snapped to 1,000 m cells. Keep at least 3×3 cells, matching the API minimum, and impose a configurable maximum of 60×60 for the first local demonstration.
3. Classify each cell center against the Polygon/MultiPolygon. Cells inside the geometry become black water; outside cells and polygon holes become white inaccessible cells.
4. Generate `texture.png` from that binary domain and a same-sized all-zero `depth.png`.
5. Retain the geometry snapshot, CRS, extent, affine/grid convention, width, height, and input mode together with the prepared input.

This is an intentional **enclosed synthetic domain**, not a claim about real coastlines. Mark the preview and result accordingly: “POC: the selected shape defines the simulation domain; environmental data are not connected.”

It changes movement boundaries and initial biomass distribution. That is acceptable for checking geometry → raster → simulation → overlay, without interpreting the output as a forecast for the real location.

Reject an oversized selection with a request to draw a smaller area; do not silently squeeze it into 60×60 cells. If the selected area contains no cell centers, explain that it is too small/narrow for the current grid. Preserve holes and island groups rather than dropping unsupported geometry.

Later, replace this one preparation function with a land/water provider. The panel, HTTP client, and result renderer should not need rewriting.

## Demo and live modes

### Demo: sufficient for the first integrated POC

Produce a small deterministic, explicitly synthetic tensor on the prepared grid, with two species and a few changing frames. Zero the inaccessible cells and return the same normalized result type as the HTTP client. This demonstrates selection, rasterization, species/frame controls, and the real map integration without requiring a working checkpoint.

Use a separate asymmetric test fixture with known corner values to check orientation and indexing. If a previously saved result is used instead, retain its original geometry/grid; never relabel it as a simulation of a newly selected area.

### Live: connect the real API next

Use a relative frontend URL such as `/mareld-api`. The development proxy targets the operator's local Eco-evo process, for example `http://127.0.0.1:8000`, and strips the prefix. This keeps the request same-origin for the browser without adding CORS handling to Eco-evo.

The client needs only:

- `GET /v1/models` to find an available model and its output species.
- `POST /v1/runs` with multipart `request`, `texture`, and `depth`.

Send the seed inside JSON, never as `?seed=`: the inspected API rejects that query-bearing route. Use `pressures: []`, one replicate, and no separate `mask`, `noise_impact`, or `trawl_map` uploads.

Start with 48 simulation steps, sampling every four steps and including the final frame. With the current six-hour tick this gives 12 days and 13 frames including frame zero. Set `tick_duration_days: 0.25`. Keep these as simple bounded POC settings rather than building a scheduling editor.

Allow a deliberately small maximum, for example 240 steps and an 8 MiB raw-tensor budget, and estimate it before submitting. A 60×60 grid, six output species, and 61 frames fits that raw budget; JSON/base64 and decoding need additional memory.

The request remains pending until the API returns its completed result. Show “Running” and disable another submission while it is pending. Use an explicit timeout appropriate to the small local run and matching proxy settings. A timeout is an uncertain outcome, not proof that computation stopped; do not automatically retry. Avoid recovery, polling, and cancellation features in this version.

Local processes may be started manually. A missing or incompatible checkpoint should produce a useful live-mode error while demo mode remains independently usable. The local proxy is a development arrangement, not a shared production deployment.

## Result display

Normalize both clients to a small result object containing:

- Source: demo or live; optional model/run ID.
- The original geometry and grid manifest.
- Species, sampled steps, six-hour tick interpretation, and `[frames, height, width, species]` shape.
- The decoded float32 values.

For live responses, validate dimensions, species/frame counts, finite nonnegative values, and exact byte length before rendering. The inspected API emits native-endian float32; use the locally verified little-endian profile for this POC. Unknown deployments need an encoding check.

Build a canvas image for the selected species/frame and use an OpenLayers static image layer with the grid's actual CRS and extent. Keep one fixed per-species scale across the run, with a legend and opacity control. Show modeled biomass as tonnes per cell; demo results also say **Synthetic example**.

A small in-memory tensor and synchronous canvas rendering are sufficient at the POC limits. Add a worker only if measurement shows the interface stalls. Playback animation, charts, confidence intervals, and comparisons can wait; a frame slider is enough.

Dispose object URLs and the overlay when clearing a result, leaving the map, switching baseline, or logging out. Guard against a late response recreating an overlay after that cleanup. Keep the existing Symphony map interactions and result layers usable.

## Delivery order

| Step | Deliverable | Completion check |
| --- | --- | --- |
| 1. Native panel and geometry | Feature flag, tab, selected-area snapshot, domain preview | A user-drawn Polygon/MultiPolygon with a hole produces the expected grid inside Symphony. |
| 2. Integrated demo | Synthetic client, actual map overlay, species/frame/opacity controls | The result aligns with its captured geometry, remains fixed after selection changes, and can be removed cleanly. **This is the first POC delivery.** |
| 3. Real API connection | Local proxy, model lookup, multipart client, response normalization | A small request reaches a compatible local checkpoint and its actual output appears through the same map renderer. Record this as a separately verified milestone. |
| 4. Local handoff | Short startup instructions, limits, known shortcuts, removal instructions | Another developer can enable the POC, run demo without Eco-evo, and run live mode with the documented local model setup. |

Steps 1–2 do not depend on fixing Eco-evo's pressure support or completing environmental data integration. Step 3 does require a working model/checkpoint; demonstrate failure clearly if that dependency is not yet available.

## Focused verification

Keep verification proportional to this POC:

- Geometry/raster checks for a hole, multiple parts, an empty raster, and a selection above the size limit.
- An asymmetric tensor verifies north/south orientation, species stride, frame selection, and map reprojection.
- One manual path from selection to demo result in Symphony; one real API smoke run when connecting live mode.
- Missing API, incompatible checkpoint, and malformed response show clear errors without replacing them with synthetic success.
- Feature disabled adds no panel, map layer, or inference request; cleanup does not remove native Symphony results.

Do not make a broad upstream compatibility matrix or a full model validation campaign a prerequisite for demonstrating the integration.

## Follow-up after the POC

Keep these as later work, rather than first-delivery requirements:

- Actual land/water and depth sources, scientifically meaningful initialization, and approved model geography/settings.
- Eco-evo fixes for multipart masks, effective pressure profiles, mass-balance configuration, complete seed control, and numerical-quality reporting.
- Pressure controls, scenario conversion, multiple study areas, playback, charts, and comparison.
- Server-side authentication, durable execution, saved results, cancellation/recovery, and multi-user deployment.
- Separately released frontend/backend plugin packages and a generic Symphony extension interface.

The existing API's disabled mass balance and inactive pressures remain documented in the research notes. They do not block a clearly labeled technical POC, and they must not be silently presented as solved by the integration.

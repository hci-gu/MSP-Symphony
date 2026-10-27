# Optional EcoTwin simulation of a saved Symphony calculation

Historical design/evidence. See [the current installation guide](../INSTALLATION.md) and [architecture](../ARCHITECTURE.md) for the supported plugin structure.

Status: implemented, including the preview/full-run extension below; final verification recorded on 2026-10-13.

Planning baseline: `e2c6d3a`, 2026-10-13. Paths are relative to the repository root. The pre-rewrite inventory below describes that baseline; proposed contracts and the checked implementation sequence have now been delivered. Implementation differences and test results are recorded at the end. EcoTwin is the user-facing integration discussed here; its current implementation uses `mareld-*` names and calls the Eco-evo API.

## Intended workflow and scope

A user creates a scenario, selects areas, ecosystem components and pressures, changes their values, and runs a Symphony calculation exactly as today. After viewing the normal result, they can open the dedicated simulation tab, choose that completed calculation, inspect the supported inputs, and explicitly run a simulation. A successfully completed and saved simulation then appears automatically as an appendix to that calculation's report, including when the report is reopened or printed.

```mermaid
flowchart LR
    A[Configure Symphony scenario] --> B[Calculate]
    B --> C[Normal result and report]
    C -. Optional .-> D[Simulation tab]
    D --> E[Choose saved calculation]
    E --> F[Review mapped inputs and model settings]
    F --> G[Run and explore simulation]
    G --> H[Save completed run against calculation]
    H --> I[Simulation appendix in calculation report]
```

The rewrite must satisfy these boundaries:

- No MARELD widgets, special search results, automatic wind-park overlays or supplemental raster previews in the normal Areas, Ecosystem components or Pressures workflow.
- No Eco-evo requests or simulation input preparation before the user opens the simulation workflow. Completing a calculation does not start a simulation or switch tabs.
- Simulation inputs belong to a specific saved calculation, not the current area selection, active scenario, visible layers or current baseline selector.
- Changes to a scenario after calculation do not alter the inputs associated with that calculation. Recalculating creates a new source calculation.
- Symphony retains ownership of scenario evaluation and its calculation result. The simulation feature owns model translation, run state and simulation output.
- Completed simulation results must be saved against their source calculation so the report appendix works after refresh, in a separate browser tab and without Eco-evo running. Durable completed-run storage is part of this delivery; background execution and recovery of unfinished runs remain follow-up work.
- The report appendix is the intentional addition outside the simulation tab. Existing Symphony report content and numerical results remain unchanged. With no saved simulations, there is no appendix or empty simulation section.

Keep the existing MARELD feature flag, module and proxy names initially. A broad rename or plugin framework would increase the patch without improving this boundary.

Use the Poseidon area defined in [poseidon.md](../../../../examples/ecotwin/poseidon.md) for the primary saved-calculation acceptance test, including relevant native data, a simulation and its persisted report appendix. The actual local reference is calculation #7, recorded with its sources, modified calculation #9 and saved run IDs in `examples/ecotwin/data/poseidon/reference-calculation.json`. IDs are local to this test deployment.

## Pre-rewrite implementation and consequences

| Concern | Current code | Consequence for the rewrite |
| --- | --- | --- |
| Normal calculation | [`CalculationService.calculate()`](../../../../frontend/src/app/data/calculation/calculation.service.ts) posts the scenario ID to `/calculation/sum`; [`CalculationEffects`](../../../../frontend/src/app/data/calculation/calculation.effects.ts) loads the result after success. | Preserve this path and the scenario editor, reports and comparison behaviour. |
| Saved source context | [`CalculationResult`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/entity/CalculationResult.java) owns a `ScenarioSnapshot`; [`CalcService.persistCalculation()`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/service/CalcService.java) saves it. | Use the existing snapshot rather than add simulation fields to the native calculation entity. |
| Snapshot contents | [`ScenarioSnapshot`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/entity/ScenarioSnapshot.java) records baseline ID, polygon, area records, included bands, global/area changes and matrix/normalization information. | Most calculation context exists server-side, but it is not a frozen copy of all source rasters. |
| Public calculation response | [`CalculationREST.getCalculation()`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/web/CalculationREST.java) returns [`CalculationResultSliceDto`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/dto/CalculationResultSliceDto.java); frontend [`CalculationSlice`](../../../../frontend/src/app/data/calculation/calculation.interfaces.ts) is a history summary. | Add a focused input export API; a history entry or report alone cannot supply the simulation inputs. |
| Current source selection | `SymphonySelectionAdapter.capture()` reads `selectSelectedAreaData`, requires one area and copies its geometry/name. | Replace it with a calculation adapter. |
| Current simulation domain | [`prepareInput()` and `rasterCanvas()`](../../frontend/workspace/ecotwin-input.ts) build 1 km cells, at most 60 × 60, treating the polygon as accessible synthetic water and using a zero depth PNG. | Preserve explicit grid limits; do not imply that selecting a calculation supplies bathymetry, coastlines or species biomass. |
| Current pressure data | `MareldImpactData.load()` loads fixed assets from `MARELD_CATALOG`; [`mareld-impacts.ts`](../../frontend/workspace/ecotwin-impacts.ts) maps shipping noise and bottom trawling through 16 intensity bands and demo scaling. | Replace fixed assets with the saved calculation's effective inputs. Separate raster conversion from experimental model scaling. |
| Intrusions into native tabs | [`main-view.component.html`](../../../../frontend/src/app/map-view/main-view.component.html) projects `app-mareld-layers` into both band panels, `app-mareld-pressure-layer` into Pressures, and adds a global legend. [`main-view.component.ts`](../../../../frontend/src/app/map-view/main-view.component.ts) adds search helpers. | Remove these host hooks. |
| Area-name coupling | `MareldReviewArea`, `MareldLayers` and `MareldPressureLayer` automatically activate content for the named review area. | Delete this runtime coupling; demo geography must not affect ordinary map use. |
| Map lifecycle | [`MapComponent`](../../../../frontend/src/app/map-view/map/map.component.ts) injects and attaches both MARELD map services, resets them on baseline changes and detaches them on teardown. [`MareldMapBridge.detach()`](../../frontend/workspace/ecotwin-map.bridge.ts) also resets the simulation session. | Separate visibility, map-resource cleanup and destructive session reset. |
| Tab lifecycle | [`SlideViewTabComponent`](../../../../frontend/src/app/shared/slide-view/slide-view.component.ts) conditionally projects content; [`MareldPanelComponent`](../../frontend/workspace/ecotwin-panel.component.ts) starts model discovery in a constructor effect. | Gate feature activation explicitly. Conditional content projection is not a sufficient guarantee of lazy component construction. |
| Result ownership | [`MareldSession`](../../frontend/workspace/simulation-workspace.ts) holds one input/result; [`MareldResult`](../../frontend/workspace/ecotwin-result.ts) has no calculation ID. | Add explicit calculation/run identity and protect against late responses crossing calculation selections. |
| Report loading | [`CalculationReportComponent`](../../../../frontend/src/app/report/calculation-report.component.ts) loads `/report/{calcId}` through [`ReportService`](../../../../frontend/src/app/report/report.service.ts). [`CalculationReportModalComponent`](../../../../frontend/src/app/shared/report-modal/calculation-report-modal.component.ts) opens the `/report/:calcId` route in an iframe. | The appendix must fetch saved data by calculation ID; it cannot read the map tab's session service. |
| Printing and new tabs | [`ReportModalComponent`](../../../../frontend/src/app/shared/report-modal/report-modal.component.ts) calls the iframe's `print()` and can open the report in a new window. CSV/GeoTIFF downloads use separate endpoints. | Render the appendix in the report route, support print layout/readiness and preserve existing native data exports. |
| Persistence setup | [`persistence.xml`](../../../../symphony-ws/src/main/resources/META-INF/persistence.xml) discovers entity classes but leaves automatic schema updates disabled. | Add an explicit database schema script for completed simulation runs and their artifacts. |

## Reference calculation: Poseidon

[poseidon.md](../../../../examples/ecotwin/poseidon.md) is the geographic reference for this test. Use its seven-corner Poseidon park boundary and its suggested surrounding study square. The square is the calculation/simulation domain; the park footprint is a separate reference geometry inside it. Do not treat the project envelope as turbine positions or automatically turn it into a pressure mask.

| Fixture field | Planned value |
| --- | --- |
| Study area | `Poseidon POC review area`, constructed from the exact EPSG:3035 square in `examples/ecotwin/poseidon.md` |
| Study extent | `[4358000, 3858000, 4397000, 3897000]` in EPSG:3035; 39 × 39 km |
| Simulation grid | 40 × 40 cells at 1 km, extent `[4357000, 3858000, 4397000, 3898000]`; includes native edge pixels beyond the 39 km vector square |
| Native data baseline | `HAV_2019_WEST_LOCAL`, with its matching West sensitivity matrix; verify its installed baseline ID and source fingerprints during setup |
| Proposed native scenario name | `Poseidon — EcoTwin reference` |
| Reference calculation | A completed normal Symphony cumulative-impact calculation of that scenario; record the real calculation ID after it succeeds |
| Modified comparison fixture | A separate completed calculation made after reducing the supported bottom-trawling pressure to 50% through normal Symphony controls |

Construct the park polygon from the original EPSG:3006 coordinates and the square from its exact EPSG:3035 extent, transforming/densifying edges as described in `examples/ecotwin/poseidon.md`. Do not copy rounded geographic corners as if they were an exact projected grid. Preserve both geometries and their provenance in the test fixture. No runtime behaviour may depend on the proposed area/scenario names, and no Poseidon widgets or auto-selection logic should be added to native tabs.

### Data to audit and select

The following candidates are grounded in [`regional-import-mapping.json`](../../../../examples/ecotwin/data/hav-symphony-2019/regional-import-mapping.json). Band numbers below are zero-based and specific to `HAV_2019_WEST_LOCAL`; verify them against the installed baseline metadata instead of embedding them as universal EcoTwin mappings. Their inclusion in the mapping proves availability in the regional package, not coverage or positive values at Poseidon.

| Native category / band | Data | Role in the reference calculation and simulation |
| --- | --- | --- |
| Pressure / 13 | Noise 125Hz shipping | Select for the initial calculation and map to the existing noise input after checking source coverage. It is a historical normalized index, not a measured dB value. |
| Pressure / 3 | Catch bottom trawl | Select for the initial calculation and map to the existing trawling input. The source is a swept-area proxy; model mortality conversion remains experimental. |
| Ecosystem / 1 | Porpoise north sea | Candidate ecosystem component for the native calculation and report context; not automatically a spatial biomass initializer. |
| Ecosystem / 8 | Plankton pelagic | Candidate ecological context based on the published chlorophyll/plankton proxy; do not treat it as separate measured phyto- and zooplankton biomass. |
| Ecosystem / 20, 21, 22 | Cod, Herring, Sprat | Candidate native fish components. Record any correspondence to model species/groups, but do not imply that the present API consumes their rasters as initial biomass. |
| Ecosystem / 10, 14, 17, 31 | Hard bottom aphotic, Transport bottom deep, Soft bottom deep, Rough bottom deep | Candidate benthic habitat context, subject to coverage/support checks. These are habitat indices rather than benthic biomass or bathymetry. |

Select the ecosystem candidates supported by the Poseidon coverage audit and record the exact final selection and any exclusions. For the first runnable fixture, select only the two supported pressure candidates above; do not rely on the baseline's default selection of all other pressures. Keep unsupported pressure cases as explicit negative tests. In particular, inspect Pressure / 4 (Turbidity bottom trawl), / 7 (Abrasion bottom trawl) and / 14 (Noise 125Hz wind power) as relevant contextual candidates without silently combining them into the two supported mappings. Catch and turbidity trawling reuse the same source intensity in the current MARELD preparation notes and must not be double-counted; shipping noise must not stand in for proposed wind-park noise.

Use the original Västerhavet regional sources to audit coverage/provenance, and use the saved calculation's effective native baseline values as simulation inputs. The [local import notes](../../../../examples/ecotwin/data/hav-symphony-2019/LOCAL-IMPORT.md) document UInt8 quantization, planning-boundary clipping and conversion of NoData/off-domain cells to zero. Therefore, a zero in the imported stack alone cannot establish valid absence. The input export must recover or explicitly report support using source/mask provenance; it must not silently replace the calculation's values with unquantized, extrapolated or off-boundary data.

`examples/ecotwin/poseidon.md` establishes that the existing cropped MARELD assets do not cover the Poseidon park footprint. Audit Poseidon afresh across both the study square and park footprint: valid coverage, positive/zero values, unknown cells, native boundary clipping, source units, source hashes and selected band IDs. Do not reuse MARELD coverage percentages, extrapolation settings or its cached pressure files. If required input support is insufficient, record the blocking data gap instead of manufacturing coverage or silently shrinking the chosen area.

### Saved fixture and end-to-end evidence

- [x] Audit the candidate layers and domain before creating the runnable reference scenario. Record grid/coverage evidence for the square and park separately, including which ecosystem candidates are supported.
- [x] Create or reuse the Poseidon user area through normal Symphony area handling, configure the reference scenario and run the ordinary calculation. Verify the matching baseline/matrix, native result and report before opening EcoTwin. Do not insert a fabricated calculation directly into the database.
- [x] Save a reproducible fixture manifest, proposed as `examples/ecotwin/data/poseidon/reference-calculation.json`, with geometry references, installed baseline/scenario/calculation IDs, calculation timestamp, selected bands, saved changes, matrix/operation/normalization, source fingerprints, coverage findings and later simulation run IDs. These IDs are local-instance identifiers; automated tests should recreate equivalent data and capture assigned IDs rather than assume fixed database IDs. Include no credentials or session tokens.
- [x] Open the EcoTwin tab, choose the completed reference calculation, inspect its exported Poseidon domain and supported inputs, run the model and persist the result. Confirm the appendix belongs to that calculation, survives refresh and appears in the printed report.
- [x] Change bottom trawling to 50% in Symphony and calculate again. Verify that the new calculation changes the effective native input before model quantization and that the first calculation/run/appendix retain their original inputs. Do not require the stochastic model's final biomass to change monotonically as an acceptance condition.
- [x] Use the same calculation to test a second saved simulation run and multiple appendix sections. Record the actual input/profile/model versions and output IDs used for the walkthrough.

The reference is a test of the integration on Poseidon geography and available data. It does not establish present-day environmental conditions, wind-park effects or scientific calibration. The saved fixture now includes the normal calculation, exported inputs and persisted simulations. `examples/ecotwin/poseidon.md`'s research findings remain unchanged.

## Target boundary and data contract

Use three small layers:

1. **Symphony input export:** reads a saved calculation, reconstructs effective native inputs and returns bounded, documented data. It knows nothing about Eco-evo pressure types or model coefficients.
2. **Simulation calculation adapter:** fetches that export, checks supported inputs and translates them for Eco-evo. It is the only feature entry point that reads native calculation state/services.
3. **Simulation session and presentation:** own configuration, requests, results, charts and their map overlays.

Keep `mareld-api.client.ts`, result decoding, biomass charts and the reusable projection/rendering helpers where practical. Do not put simulation tensors in Symphony's NgRx calculation state or give simulation runs native calculation IDs.

The cumulative-impact raster and report totals are not ecological initial conditions. Export the underlying effective inputs; do not convert the final Symphony impact score into biomass or treat its sensitivity matrix as Eco-evo model parameters.

### Proposed server contract

Add `CalculationInputService`, explicit DTOs and `CalculationInputREST` under the existing backend service/DTO/web packages. Reuse normal calculation access checks and `GRP_SYMPHONY` protection on every request. Do not serialize JPA entities directly.

| Proposed endpoint | Responsibility |
| --- | --- |
| `GET /calculation/{id}/inputs` | Read-only source manifest: calculation identity/date, snapshot identity/fingerprint, baseline identity, effective geometry with explicit CRS, included band metadata, saved changes, exclusions and input availability. |
| `POST /calculation/{id}/input-grid` | Read-only computation accepting a bounded target grid and requested included bands; returns aligned effective band values, validity/coverage masks and provenance. POST carries the structured grid request; it does not save or update a calculation. |

The manifest/grid contract must specify:

- Calculation ID and timestamp, snapshot fingerprint and baseline version. Name is a display label, not an identity or cache key.
- WGS84 longitude/latitude geometry for frontend use, plus source CRS and explicit target grid CRS, extent, cell size, dimensions, row order and cell alignment.
- Band identity scoped by baseline, category and native band number, with source units/scale. Do not match translated display names or assume numbers are stable across baselines.
- Selected native bands and effective values after saved global and area changes. Requesting an unselected band must not silently add it to the simulation.
- Distinct masks for the calculation domain and each band's valid source support. Preserve real zero values; missing data must not silently become zero pressure or accessible water.
- For the initial small grid, a versioned JSON response with row-major numeric arrays and separate validity arrays is sufficient. Serialize invalid cells as `null`, not JSON `NaN`; enforce server-side limits on dimensions, band count and response size.
- Source asset fingerprints and export version. Include the manifest fingerprint in grid requests and reject stale/mismatched exports instead of mixing metadata and values from different contexts.
- Explicit availability failures for missing/deleted calculations, unavailable baselines, unsupported geometry or excessive grids. A purged result TIFF alone is not a reason to reject an export if snapshot and source inputs remain available.

### Correctness requirements for export

[`CalcService.calculateCoverage()`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/service/CalcService.java) already loads baseline coverages through [`DataLayerService.getCoverage()`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/service/DataLayerService.java) and applies changes through [`ScenarioService.applyScenario()`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/service/ScenarioService.java). Reuse these semantics; do not reimplement multipliers, offsets or overlapping-area order in TypeScript.

Implementation details that require explicit tests:

- `calculateScenarioImpact()` stores `targetGeometry` in the source raster CRS. `ScenarioSnapshot.getGeometry()` only parses the stored polygon; it does not transform it. Convert it before passing anything to `prepareInput()`, which expects WGS84. Read the source CRS consistently with the calculation path and check it against the baseline coverage.
- `ScenarioSnapshot.getTmpAreas()` reconstructs areas and saved area changes; use the snapshot as `altScenario` for global changes. Preserve the original ascending area-ID order, because `ScenarioService.apply()` reduces the changes sequentially and snapshot areas originate from a map.
- Review `coastalComplement()`, `getROIForCalculation()` and `MatrixMask` semantics. The saved target polygon already reflects coastal exclusion, while snapshots also retain exclusion IDs. Derive the effective domain without applying exclusions twice or mixing projected snapshot coordinates with WGS84 area features. Reuse the calculation's actual validity/domain rules rather than just its bounding rectangle.
- Apply changes at native raster resolution before aggregation onto the simulation grid. Document resampling per input; arithmetic averaging of a relative index does not automatically justify averaging another physical quantity.
- Do not call `recreateCoverageFromResult()` merely to export inputs: it writes regenerated result data through `updateCalculationData()`. The new path must not recalculate, rename, normalize or overwrite the native result.
- Source rasters are currently loaded from files associated with a baseline. A snapshot alone does not prove those files are unchanged since calculation time. Fingerprint the sources used for export and record that limitation for existing calculations; require immutable/versioned baseline assets for a stronger historical reproducibility claim. A checksum collected now cannot prove what existed earlier.

Extract small shared preparation helpers from `CalcService` only where needed to avoid divergent calculation/export semantics. Characterize existing results before changing a shared helper.

### Proposed feature types

Introduce these responsibilities inside `features/mareld-poc/` (names are proposed):

- `symphony-calculation.adapter.ts`: lists saved calculations through existing selectors/actions and reads the new API. Replaces `symphony-selection.adapter.ts`.
- `calculation-input.ts`: typed, validated source manifest/grid contract and copied calculation provenance.
- `simulation-input-mapping.ts`: versioned mappings from supported native bands to model inputs, with coverage checks and explicit unsupported-input information.
- Extend `PreparedInput` with its immutable calculation source reference and validity information. Its existing random `id` remains an input-instance ID, not the calculation ID.
- Extend run/result metadata with calculation ID, snapshot/source fingerprints, mapping version, model ID/name, steps, sampling, seed, and the actual prepared inputs. Record a model/checkpoint version only if the server supplies one; the current `MareldModel` exposes only ID, name and species.

Use one selected calculation at a time, with bounded session caches keyed by calculation ID and run ID. Persist completed runs separately from the native calculation and load them on demand. Enforce a total memory budget in addition to the existing per-result budget. Refresh may discard unfinished requests and playback state, but must not discard saved results or their report appendices.

### Saved simulations and the report appendix

Add a feature-specific `SimulationRun` entity/service/REST resource and a frontend persistence client (all proposed). Keep the native `CalculationResult` raster, impact matrix and report statistics unchanged. A run belongs to exactly one calculation through a foreign key, with a unique calculation/run identity and immutable saved provenance.

Proposed API:

| Endpoint | Responsibility |
| --- | --- |
| `PUT /calculation/{id}/simulations/{runId}` | Validate and save a completed run and its report data atomically. Repeating the same run ID and content is idempotent; different content under the same ID is rejected. |
| `GET /calculation/{id}/simulations` | List saved completed runs and lightweight appendix summaries in stable completion order, without loading every tensor. Return an empty list when none exist. |
| `GET /calculation/{id}/simulations/{runId}` | Retrieve a saved run's detailed inputs/result or authorized artifact references for replay and report figures. |

The saved record includes calculation/snapshot/source fingerprints; run ID and completion time; model ID/name and version when available; seed, duration, sampling and mapping version; actual prepared inputs and assumptions; result species/steps/grid, units and validated output; and versioned report summaries. Store large tensors/artifacts separately from summary queries. Under the current bounded result size, a separate database artifact table is a reasonable first implementation; no new external object store is required.

Generate or validate summary values from the saved tensor and domain mask, using the same aggregation rules as [`aggregateBiomass()`](../../frontend/workspace/ecotwin-biomass.ts). Do not save an arbitrary screenshot of the live tab as the report result. A browser-submitted result must pass ownership, source-reference, dimensions, units/schema and payload-size validation; do not imply that storing it proves the external model's scientific validity.

Default appendix content:

- “Appendix — EcoTwin simulations”, with one dated subsection per saved completed run. Keep earlier runs when the user reruns a calculation; failed/incomplete requests do not replace or add completed-result sections.
- Calculation and run identity, model, simulated duration, grid, seed and a concise account of inputs, coverage and experimental assumptions.
- A static population/biomass time-series chart covering all output species, with units and time labels independent of current tab filters/playback.
- A species table with initial and final biomass, absolute change and percentage change. For zero initial biomass, show percentage change as not defined rather than infinity.
- Reproducible final-frame spatial figures for output species, with species labels, extent/domain, time and fixed legends. Use persisted output and a report renderer; do not depend on a live OpenLayers map or a running simulation service.

Append these sections after the normal report content in [`calculation-report.component.html`](../../../../frontend/src/app/report/calculation-report.component.html). Implement the appendix as a small report component/module that consumes saved data and pure presentation helpers; do not import the full `MareldPocModule`, session orchestration or model discovery into the report route. Reuse or extract pure chart/formatting logic where useful, with a static mode for print.

Load appendix data independently of the native report response. An appendix error must leave the core report readable and show a local retry/error state, not be mistaken for an empty appendix. Fetch saved data from Symphony only; report viewing must never prepare new inputs or call Eco-evo. Saved appendices remain readable when new simulation runs are disabled by the feature flag, subject to ordinary report permissions. Do not expose them on public maps.

Include appendices in browser printing / Save as PDF through the existing print action, with explicit page breaks and bounded figures. Keep native CSV and GeoTIFF downloads scoped to the Symphony calculation; simulation data exports are a separate future capability.

## Implementation sequence

### 1. Remove native-workflow intrusions and make activation explicit

- [x] Remove both `app-mareld-layers` insertions, the wind-park widget and global MARELD legend from `main-view.component.html`.
- [x] Remove `windparkMatchesSearch`, `mareldLayersMatch`, their bindings and the now-unneeded template references from `main-view.component.ts/html`.
- [x] Remove supplemental component imports from [`map-view.module.ts`](../../../../frontend/src/app/map-view/map-view.module.ts) and update [`main-view.component.spec.ts`](../../../../frontend/src/app/map-view/main-view.component.spec.ts).
- [x] Remove `hasAdditionalSearchMatches` and the extra content-projection slot from [`band-selection.component.ts`](../../../../frontend/src/app/map-view/band-selection/band-selection.component.ts) / [template](../../../../frontend/src/app/map-view/band-selection/band-selection.component.html) if a repository-wide caller check confirms they have no remaining consumers.
- [x] Remove `MareldLayersMap` injection and lifecycle calls from `MapComponent`. Remove the wind-park dependency and its separate vector layer from `MareldMapBridge`.
- [x] Remove `MareldPressureLayerComponent` from [`MareldPocModule`](../../frontend/workspace/workspace.module.ts) and delete the pressure-widget service/component/tests once references are gone. Remove `MareldReviewArea` runtime subscriptions.
- [x] Use `MainViewComponent.onNavigate()` and sidebar open/close state to gate the simulation panel itself in the host template. Add a small explicit active-state handoff to the map bridge; preserve the current native tab-selection behaviour.
- [x] Move model discovery out of an unconditional constructor effect into explicit feature activation. Treat injected map/session services as dormant until activated; no source loads or layers on native map startup.
- [x] Keep only feature-owned layers visible while the simulation tab is active and open. On tab exit/collapse, hide/remove them and pause playback without deleting input/results or changing native layer visibility. Do not automatically refit the map on every tab return.

**Interim dependency:** `MareldImpactData` and `mareld-impacts.ts` still import the supplemental raster catalogue/decoder. Remove UI first; retain their required data files until step 4 replaces those imports. Do not delete `features/mareld-layers/` or its assets wholesale in this step.

**Done when:** selecting the review area has no special effect; both native band panels behave normally; no Eco-evo requests or simulation layers appear before explicit feature entry, with the flag enabled or disabled.

### 2. Implement the saved-calculation input export

- [x] Add the proposed manifest/grid DTOs and endpoint/service pair, with authorization before expensive raster work.
- [x] Read the calculation's persisted snapshot and baseline, not the mutable scenario or current user baseline preference.
- [x] Implement geometry/CRS conversion, effective included-band preparation and domain/coverage masks using the shared backend semantics described above.
- [x] Return grid metadata, source units, fingerprints and explicit validity; bound request cost and release GeoTools resources after export.
- [x] Keep endpoints read-only in their effect on persisted calculations and isolated from the Eco-evo API.
- [x] Add backend fixtures for a saved calculation with global and area changes, multiple areas/holes, overlaps, exclusions and missing source coverage.
- [x] Use the Poseidon audit to verify export support masks against the original regional sources and imported boundary; retain the saved calculation's effective native values. Do not infer data validity from the imported zero values alone.

**Done when:** changing or deleting the live scenario after calculation does not alter its exported saved configuration; native input values agree with the calculation preparation path; exporting leaves the native result/report untouched.

### 3. Make the tab start from a completed calculation

- [x] Replace the selected-area adapter with `SymphonyCalculationAdapter`. Reuse [`CalculationSelectors.selectCalculations`](../../../../frontend/src/app/data/calculation/calculation.selectors.ts) and existing fetch actions; do not add a second native calculation store.
- [x] Replace the Area step and both “Use selected area” / “Try example area” actions in [`mareld-panel.component.html`](../../frontend/workspace/ecotwin-panel.component.html) with a calculation picker and saved-context summary. Keep example geometry only as test data if still useful.
- [x] Start with an explicit selection; loading the list does not prepare inputs or run a model. With no calculations, explain that the user must create one through Symphony first.
- [x] Show calculation name/date/baseline, domain size, selected inputs and compatibility inside this tab. Use the chosen calculation's baseline even when the native baseline selector differs.
- [x] Replace `MareldSession.capture()` / `useExample()` with selection/load actions. Preserve revision guards for context loads, grid preparation, model discovery and runs.
- [x] Reject oversized domains explicitly under the existing 1 km / 60 × 60 grid limit. Do not crop to the MARELD review square, silently coarsen the grid or use just the first area of a multi-area calculation.
- [x] Remove all production dependencies on `selectSelectedAreaData`, review-area names and the fixed wind-park geometry from this feature.
- [x] Create/record the Poseidon reference calculation through the normal Symphony workflow and verify that the new picker can select its actual saved ID without special-case names or geometry.

**Done when:** a completed calculation can be selected independently of map selection, and its saved context is stable while the user edits a scenario or changes native tabs.

### 4. Replace fixed demo assets with mapped calculation inputs

- [x] Replace `MareldImpactData.load(kind)` with calculation-scoped grid loading. Remove its dependency on `MARELD_CATALOG`, static `.bin` files and hard-coded review geography.
- [x] Implement a versioned mapping configuration keyed by baseline/category/band identity. Start with shipping noise and bottom trawling, which are the two pressure types supported by the current client. Verify their native source units and identities; the MARELD asset IDs are not native band identifiers.
- [x] Exercise the first profile on the Poseidon reference calculation using the audited West baseline bands. Verify the actual source coverage inside its saved domain and document ecosystem bands that remain contextual rather than model-initialization inputs.
- [x] Map only selected supported pressures, using effective values after saved changes. Remove independent demo toggles/strength controls from the default calculation-derived flow so the user cannot accidentally replace saved pressure choices. Any later model-specific scaling is a separately recorded simulation assumption, not a Symphony scenario edit.
- [x] Refactor `prepareImpact()` to accept exported grid data and explicit validity. Preserve zero/missing distinctions and replace the current rule that lets unknown coverage contribute zero without an explicit decision.
- [x] Reuse mask generation, multipart pressure encoding and outline rendering where valid. Test the 16-level quantization and its effect on small input changes; retain it only as a documented mapping choice required by the existing mask-based API path.
- [x] Show which selected inputs are mapped, unsupported or model-initialized. The current API request contains model/species, texture/depth and pressure masks, but no spatial ecosystem-biomass initialization field. Do not claim that selected ecosystem bands or Symphony sensitivity matrices initialize the model.
- [x] Initially block a run when a selected pressure lacks a mapping, required input coverage is missing or the selected baseline has no profile. This avoids silently running a materially different pressure scenario. Explicit partial-input runs, if later wanted, must record omitted inputs.
- [x] Keep synthetic geometry/depth and demo pressure conversion visibly identified if retained in the first technical delivery. Scientific calibration, real environmental inputs and spatial biomass initialization need their own validated profile/API work; moving data sources does not resolve them.
- [x] Once production imports are gone, remove the obsolete supplemental UI/map services, catalogue runtime and shipped preview assets. Preserve preparation/audit scripts and historical data unless a separate caller check shows they are safe to retire. Update imports/tests instead of leaving unused feature wiring.

**Done when:** changing a supported pressure in Symphony, calculating again and selecting the new calculation changes the exported/model input as expected; selecting an old calculation still uses its saved changes. The active model profile reports its actual supported scope.

### 5. Finish result identity and lifecycle isolation

- [x] Snapshot calculation provenance and all simulation settings before `MareldApiClient.run()`. Keep the currently fixed seed (`42`) in run metadata even if no seed control is added.
- [x] Retain model ID as well as display name in result metadata; keep the current result tensor validation, memory checks and fixed per-species colour scales.
- [x] Store results under their originating calculation/run, never whatever calculation happens to be selected when a response arrives.
- [x] After successful result validation, save the completed run through the persistence client before showing “Added to calculation report”. Keep computation state separate from save state. If saving fails, retain the result for retry and report that the appendix has not yet been saved; retry persistence with the same run ID without rerunning the simulation.
- [x] On switching calculation during a run, abort/discard the browser request using the existing revision/controller mechanism before loading the next context. Do not describe this as cancellation of server computation; the current API path does not guarantee that.
- [x] On tab exit, allow an already submitted foreground request to finish within the session without showing overlays or starting new preparation. Pause playback. Re-entry restores that calculation's state without submitting another run.
- [x] Split `MareldMapBridge.detach()` into map resource cleanup and explicit session disposal. Its current call to `session.reset()` must not erase results on a normal tab switch. Put simulation images, domain outlines and impact outlines under one feature-owned lifecycle.
- [x] Remove the current blanket simulation reset on native baseline changes. Hide/suspend presentation as appropriate, but never rebind a run to the new baseline. On map destruction release layers and abort requests; retained session results may be restored on re-entry. On logout clear user-scoped sessions and caches.
- [x] Handle calculation rename as a label update without changing run provenance. On deletion/access loss invalidate in-flight preparation/saves and clear inaccessible cached results; never attach them to another calculation.
- [x] Keep API errors, input errors and retries inside the simulation tab. Do not dispatch native `calculationFailed()` for a simulation failure.

**Done when:** repeated tab changes preserve simulation state without overlay leakage or duplicate requests; late responses cannot appear under another calculation; saved simulations are attributed correctly while native result visibility and report statistics remain unchanged.

### 6. Persist completed runs and add the calculation-report appendix

- [x] Add `SimulationRun` metadata and bounded artifact storage, with an explicit schema script under `database/scripts/`. Include a foreign key to the calculation, unique run identity, lookup indexes and deletion of child artifacts with their run. Test the schema on a fresh database and an existing populated database; do not rely on `hbm2ddl.auto`.
- [x] Implement the proposed save/list/detail endpoints with calculation access checks, source/run validation and atomic publication. A run must not be listed as report-ready until all required result data is stored. Interrupted/retried saves must not create duplicate or partial appendices.
- [x] Keep persistence independent of Eco-evo availability. Save metadata, actual prepared input and bounded result artifacts sufficient to reconstruct the appendix and replay after refresh. Summary queries must not eagerly materialize every saved tensor.
- [x] Ensure deletion through both single and bulk paths in [`CalculationREST`](../../../../symphony-ws/src/main/java/se/havochvatten/symphony/web/CalculationREST.java) cleans up associated runs/artifacts. Native TIFF purging must not remove saved simulation results. A save racing with calculation deletion must fail safely without recreating the parent or leaving orphan data.
- [x] Add `simulation-report-appendix.component.*` and its small read-only data service (proposed) and integrate them into [`CalculationReportModule`](../../../../frontend/src/app/report/calculation-report.module.ts), `CalculationReportComponent` and its template. Pass the route's calculation ID explicitly; cancel/ignore stale loads when that ID changes.
- [x] Render all completed runs in stable chronological order with run IDs/dates; use the stored inputs/settings rather than current model defaults or simulation controls. No new manual “attach” action is required after a successful save.
- [x] Refresh appendix data on report open/reload and window focus. For an already-open same-origin report iframe/tab, publish a small saved-run invalidation event keyed by calculation ID and have the report refetch; do not transmit tensors or use a message as the source of report content. Validate message origin/source and calculation ID, and clean up listeners.
- [x] Add static charts, summary tables and spatial figures using saved data. If any chart code is shared with `MareldBiomassChartComponent`, separate data/rendering from map/session controls; the report must not start model discovery or playback.
- [x] Extend [`report.component.scss`](../../../../frontend/src/app/report/report.component.scss) for multipage appendices and verify the existing fixed A4 print rules do not clip content. Hide interactive controls in print and preserve legends/units.
- [x] Keep the existing `calcReportLoaded` notification about the native report; add a separate report-print readiness signal that accounts for appendix loading and figure rendering. Update `ReportModalComponent.print()` so it does not silently print an incomplete appendix. In standalone browser printing, show an explicit incomplete/error state if appendix data has not loaded rather than implying there are no simulations.
- [x] Add a report link in the simulation tab after successful saving, using the existing report route/modal. Opening the report reads persisted output; it must work after the simulation session is gone or the model server is stopped.

**Done when:** run a simulation for calculation A, wait for saving, reopen `/report/A` in the modal and a new tab, refresh and print: the same appendix is present. Calculation B and reports with no saved runs remain unchanged. Reruns add distinct sections without replacing prior results.

### 7. Verify and update documentation

- [x] Update affected main-view, band-selection, panel, session, API-client and map-bridge tests; replace tests whose intended review-area automation is removed.
- [x] Retain meaningful coverage in `mareld-input.spec.ts`, `mareld-impacts.spec.ts`, result/biomass tests and impact-outline tests while changing their fixtures to calculation-based inputs.
- [x] Add export unit tests alongside [`ScenarioServiceTest`](../../../../symphony-ws/src/test/java/se/havochvatten/symphony/scenario/ScenarioServiceTest.java) and authorization/contract tests following [`CalculationRESTTest`](../../../../symphony-ws/src/test/java/se/havochvatten/symphony/calculation/CalculationRESTTest.java).
- [x] Add persistence/appendix tests for idempotent retries, invalid or mismatched result payloads, access checks, calculation deletion, multiple runs and native-TIFF purging. Extend [`calculation-report.component.spec.ts`](../../../../frontend/src/app/report/calculation-report.component.spec.ts) and [`ReportRESTTest`](../../../../symphony-ws/src/test/java/se/havochvatten/symphony/web/ReportRESTTest.java) where appropriate; include report-load isolation and print readiness.
- [x] Update [README](../../../../README.md), [MARELD-POC](../MARELD-POC.md), [MARELD-LAYERS](MARELD-LAYERS.md) and relevant API notes. Mark retired layer behaviour as historical and document completed-run persistence, report appendices, supported input mappings and remaining model assumptions.
- [x] Remove the old layer-removal instructions/import inventories that no longer apply. Keep the historical [original POC plan](MARELD-INTEGRATION-PLAN.md) clearly historical.

Steps 1–3 produce isolation and a saved-calculation handoff. Implement the persistence contract in step 6 before enabling automatic saving in step 5. The rewrite is not complete until steps 4–7 deliver and verify calculation-derived inputs, correct lifecycle behaviour and durable report appendices.

## Acceptance scenarios

| Scenario | Required evidence |
| --- | --- |
| Ordinary Symphony use with Eco-evo stopped | Configure and calculate a scenario, inspect result/report, use pressures/ecosystems/search/history/comparison: unchanged behaviour and no Eco-evo traffic. |
| Poseidon reference calculation | The area/grid from `examples/ecotwin/poseidon.md`, audited West-baseline inputs and actual completed calculation ID are recorded; selecting it in EcoTwin uses that saved context without any name-based behaviour or MARELD crop fallback. |
| Poseidon modified calculation | A second native calculation with 50% bottom-trawling pressure yields the expected effective input change; the first calculation's input, saved simulation and appendix remain unchanged. |
| Former review area selected | No automatic porpoise raster, wind-park footprint or MARELD legend. |
| Feature disabled or public map | No simulation execution panel, Eco-evo requests or simulation map layers. Existing saved appendices remain available in authorized calculation reports when execution is disabled; public maps expose no simulation data. |
| Saved context | Calculate A, change the live scenario and map selection: A's exported settings/values are unchanged. Calculate B: B reflects the changes. |
| Pressure derivation | Supported-band multiplier, offset, exclusion and deselection affect exported inputs correctly; fixtures account for model quantization rather than requiring every small change to alter an output mask. |
| Multi-area geometry | Holes, disconnected areas, overlaps and coastal exclusions retain the same domain/ordering semantics as the calculation; an oversized domain is rejected explicitly. |
| Data validity | Valid zero differs from no data; partial/missing coverage and unsupported inputs prevent an unqualified run. No fallback to fixed MARELD assets. |
| Calculation export | Unauthorized/missing IDs fail appropriately; a purged TIFF can still export if its sources are available; native result bytes and report values are not changed by export. |
| Tab and sidebar lifecycle | Opening the feature discovers models only when needed; switching away or collapsing hides every simulation overlay and pauses playback; returning restores state without rerunning. |
| Race conditions | Slow context A, grid A or run A cannot overwrite selected calculation B; logout/map teardown invalidates relevant in-flight work. |
| Failure isolation | Eco-evo outage, incompatible model, timeout and invalid tensor leave native calculation/report state intact. |
| Report attachment | A completed, saved run appears automatically only in its source calculation's report. No simulations means no appendix or empty heading. |
| Persistence and report independence | Reopen the report in its iframe, a new browser tab and after refresh with Eco-evo stopped: saved charts, tables, figures and provenance are identical. |
| Multiple runs and save failure | Successful reruns create separate dated sections. Failed runs add none. A save retry uses the same run ID and creates exactly one section without rerunning the model. |
| Existing report refresh | An already-open report refreshes after a saved-run notification or focus, fetching persisted data for the correct calculation. |
| Appendix failure | Slow/erroring appendix reads do not fail or replace native report content; unavailable appendices are not represented as an empty list. |
| Print and native exports | Modal print and standalone Save as PDF include complete appendix figures, tables, units and page breaks. Native CSV/GeoTIFF content and calculation statistics remain unchanged. |
| Access and deletion | Other users cannot read/write run data without calculation permission. Single/bulk calculation deletion removes child artifacts; TIFF purging preserves them; late saves cannot resurrect deleted data. |

Use small asymmetric raster fixtures to verify north/south orientation, CRS transformation, polygon holes, masks and aggregation. Add a regression fixture around any extracted native preparation helper so simulation work cannot change Symphony's numerical results.

## Verification commands and prerequisites

Commands used for verification, with results and infrastructure limits below.

From `frontend/`, use the existing Angular/Karma setup:

```sh
npm run test-headless -- --include='src/app/features/mareld-poc/**/*.spec.ts' --include='src/app/map-view/main-view.component.spec.ts' --include='src/app/map-view/map/map.component.spec.ts' --include='src/app/map-view/band-selection/**/*.spec.ts' --include='src/app/shared/slide-view/**/*.spec.ts' --include='src/app/report/**/*.spec.ts' --include='src/app/shared/report-modal/**/*.spec.ts'
npm run prod-build
ESLINT_USE_FLAT_CONFIG=false npx eslint 'src/app/features/mareld-poc/*.{ts,html}'
```

Include any newly created/changed host and shared files in the lint/test scope. Run the full frontend suite once the integrated changes pass focused checks. `test-headless` uses `ChromeCI`, whose base is `ChromiumHeadless` in [`frontend/src/karma.conf.js`](../../../../frontend/src/karma.conf.js); configure an installed browser executable if needed. Do not assume the older TSLint script is the current validation path.

From `symphony-ws/`:

```sh
mvn test -Pskip-apitests
mvn test -Ponly-apitests
```

Explicitly select `-Pskip-apitests` for the unit suite: the other automatically activated build profile can deactivate the default exclusion. The skip profile excludes REST tests; `only-apitests` is the actual API-test profile in [`pom.xml`](../../../../symphony-ws/pom.xml). REST tests need a running test backend, configured credentials and test data; follow [`RESTTest`](../../../../symphony-ws/src/test/java/se/havochvatten/symphony/web/RESTTest.java). Backend data tests may need the test-data submodule. Run against a test database, not a user's live calculations. If infrastructure is unavailable, record the unverified cases explicitly.

Use the Poseidon reference calculation for the final browser walkthrough: complete the normal calculation, then run a supported simulation while inspecting requests and map layers. Save the completed run, reopen its report in the iframe and a new tab, refresh with Eco-evo stopped, and visually inspect a printed PDF with the appendix. Also verify the modified Poseidon calculation, a no-simulation report and a multi-run report. Record actual IDs and coverage/profile evidence in the fixture manifest. Use [the local operation guide](../MARELD-POC.md) for startup, but verify the currently running Eco-evo model/project capabilities rather than assuming historical test results still apply.

## Follow-up work outside this delivery

- A richer simulation-history browser, explicit run comparison, per-run deletion/retention controls and separate simulation-data exports. Durable completed-run storage and automatic report appendices are already required by this plan.
- Validated profiles for additional baselines, pressures and ecosystem initialization. The initial mapping work must identify unsupported inputs; broader support may require changes in the separate Eco-evo service/model repository.
- Real bathymetry/coastline inputs and calibration of relative Symphony indices to model parameters. The existing experimental conversion must not be presented as a validated physical conversion.
- Larger domains, alternate resolution, background jobs and server-side cancellation.
- Optional “Simulate this calculation” shortcut in history/report, opening the same tab with an explicit calculation ID.
- A generic plugin registry or full `mareld-*` rename only if later integrations demonstrate a need.


## Delivery record — 2026-10-13

All seven implementation steps are delivered. The current operation guide is
[MARELD-POC.md](../MARELD-POC.md); contracts and lifecycle checks are documented
in [ECOTWIN-API.md](../ECOTWIN-API.md).

Implementation decisions established by running the code:

- The native calculation-history selector is scoped to the active baseline. The
  adapter reuses its labels/actions and adds a read-only `all-baselines=true`
  dropdown query, without changing the native store or default endpoint behavior.
- The Poseidon vector square remains 39 km. Native raster rounding includes edge
  pixels outside it, so `suggestedGrid` is 40 × 40 rather than the initially planned
  39 × 39. Export rejects grids that crop those pixels. The calculation mask and
  planning/source support yield 1,143.875 km² and 1,227 model water cells.
- `CalculationDomain` extracts the existing integer layout/grid helper unchanged.
  A repeated native calculation (#8) has the same GeoTIFF bytes and statistics as
  the pre-extraction reference (#7). Exporting and running simulations also leave
  #7's native result/report unchanged.
- Obsolete UI/runtime code is removed; preview assets are preserved under
  `examples/ecotwin/data/hav-symphony-2019/historical-mareld/`, outside shipped frontend assets.
- Deletion testing exposed an existing scenario foreign-key blocker. Generic
  `CalcService.delete()` now clears a scenario's latest-calculation reference
  before deleting that result; no EcoTwin dependency was added to native deletion.
- The native report now derives an edit's category from its saved category key,
  so API-created edits without a redundant `type` field display correctly. The
  modified report shows Catch bottom trawl −50% in its normal changes table.
- Numeric JSON encodings are canonicalized when validating/retrying saved inputs,
  so an equivalent `1000`/`1000.0` round trip does not invalidate a run.

Verification completed:

| Check | Evidence |
| --- | --- |
| Frontend suite | 231 passing tests, including native map/report components, isolation, races, cache limits, failed-save retry, report errors and print readiness |
| Backend unit/data suite | 102 tests: 101 passed, 1 existing skipped; generated real GeoTIFF fixtures exercise multi-area geometry, holes, overlap/global edits, saved coastal exclusion, valid zero/missing support, orientation and access |
| Build/lint | Backend WAR and frontend production build pass; changed frontend files pass ESLint; production bundle has a 2.32 MB initial-size warning against the existing 2 MB warning threshold |
| Fixture recreation | `create-poseidon-reference.py` created equivalent reference/modified calculations through normal APIs and validated snapshot stability; temporary records removed |
| Native live inputs | Old snapshot stays fixed after scenario edit; new trawling input changes; shipping noise/domain stay fixed; stale/unselected/oversized requests rejected; original TIFF/report unchanged |
| Live persistence API | Ten lifecycle checks pass: retry/idempotency, conflicting identity, malformed payload and forged inputs, authorization, cross-calculation references, TIFF purge, single/bulk deletion and late saves; disposable calculations/artifacts removed |
| Schema | Script applied to populated local database and a fresh isolated schema; both deletion cascades verified |
| Model runs | Reference #7 has saved 40- and 80-step runs; modified #9 has a 40-step run, model `2026-10-08`, mapping `hav-west-native-v1`; UUIDs recorded in the fixture |
| Reports | Two sections on #7; one on #9; no appendix heading on #8; automatic refresh observed; iframe/new-tab/reload work with Eco-evo stopped and make no model or input-export requests |
| Print | Complete 11-page A4 reference report generated; all six appendix pages visually reviewed for chart/table/figure/legend clipping |

Review artifacts: `output/playwright/poseidon-report.pdf` and the fixture manifest.
The model server was restarted after the offline-report check for interactive review.
Private credentials, logs, browser captures and generated build files remain ignored.

The legacy `only-apitests` suite was not run with an isolated copy of its complete
historic test fixture/admin credentials. An unconfigured default `mvn test` attempt
reported missing credentials; the explicit unit profile and the new live REST
lifecycle checks above passed. The listed new contracts are covered by these checks;
this does not claim every historical REST regression test passed.


## Delivered extension: previews, ensembles and map layout (2026-10-13)

This extension supersedes the original single-run/autosave workflow above.

- [x] Make **Run preview** an unsaved single-seed run with separate duration and
  configurable starting seed. Changing the draft settings marks its output outdated.
  New previews may replace old previews; only completed full runs create appendices.
- [x] Keep settings in `MareldPanelComponent`; host feature-owned
  `MareldResultsComponent` in the map area only while EcoTwin is active. Playback,
  speed, species, opacity and fit are in a non-blocking bottom tray; the right graph
  panel is collapsible. Graph/time controls share `MareldSession` state. Fit accounts
  for the result panels, keeping the mapped domain visible.
- [x] Add owner-authorized, idempotent full-job submission, progress and resume APIs.
  `SimulationJobService` freezes settings and native inputs; `SimulationJobWorker`
  executes ten consecutive seeds and checkpoints after each. Full jobs survive
  browser closure and reload. Failed jobs retain completed seeds. Request IDs allow
  recovery of an uncheckpointed model response after a server interruption.
- [x] Serialize previews through the same server worker, preventing concurrent
  Symphony requests from interfering with the model's process-global random state.
  The existing Eco-evo API's ensemble summary omits per-seed totals and uses a normal
  approximation, so Symphony instead validates each single-seed response and builds
  the ensemble. No edits to the separate Eco-evo checkout were needed.
- [x] Store one mean map tensor and ten per-seed biomass series. `SimulationEnsemble`
  derives 95% Student t intervals (9 degrees of freedom), checks mean-map agreement,
  and prevents partial ensembles from being published. Grouped/relative graph
  intervals use per-seed grouping/normalization. Legacy single-seed runs remain readable.
- [x] Extend report v2 with mean curves, confidence bands, final interval tables,
  exact seed lists and mean spatial figures. The report still reads persisted data
  only. The browser cannot submit a v2 result directly.
- [x] Show report time-series graphs as percentage of initial biomass per species,
  with a 100% baseline. Normalize each seed before computing the mean and confidence
  bands; explicitly omit species with zero initial biomass. This also applies to
  previously saved reports without rerunning simulations.
- [x] Allow owners to delete saved simulations with confirmation, removing the
  report artifact and completed job together. Clear selected playback and cached
  output, refresh open reports, and highlight the open run in the saved list.
  Verify deletion using disposable legacy/ensemble copies while retaining the
  original Poseidon fixtures.
- [x] Add `SimulationJobs.sql` and configure the local worker endpoint. Calculation
  deletion cascades to jobs; final persistence locks calculation before job to match
  deletion/submission. Input authorization and source verification remain enforced.

Verification:

| Check | Result |
| --- | --- |
| Frontend | 245 passing tests, including temporary previews, stale settings, grouped/relative uncertainty, submission ambiguity across navigation, resumed progress, ensemble reports, deletion/selection and clearing map pixels during animation |
| Backend | 122 unit/data tests: 121 passed, 1 existing skipped; ensemble math, malformed/partial ensembles, checkpoint accumulation, worker restart/failure recovery, ownership changes and saved-run deletion covered |
| Live Poseidon | A 12-step preview created no appendix. Two ten-seed ensembles completed: 40 steps, seeds 100–109; 80 steps, seeds 200–209. Run IDs are recorded in the fixture and `examples/ecotwin/poseidon.md`. |
| Reload | Reloaded during the 80-step run after 2 seeds; returning to #7 recovered progress at 8 seeds, then displayed the saved mean result and bands. |
| Numerical/API verification | `verify-simulation-ensemble.py` independently recomputed the saved intervals and mean-map totals; nine checks include identity conflicts, malformed/incomplete requests, anonymous writes and rejection of client-generated ensembles. |
| Native isolation | #7's native GeoTIFF still equals #8's regression copy; #8 still has no simulations, and #9 retains its original legacy run. |
| Report/print | #7 has four appendix sections (two legacy, two ensemble). The 17-page A4 PDF's six new pages were visually reviewed for chart/table/map clipping. |
| Build | Backend WAR and frontend production build pass. The existing 2 MB initial-bundle warning remains (2.33 MB). Changed TypeScript files pass ESLint. |

Review artifacts: `output/playwright/ecotwin-ensemble-layout.png` and
`output/playwright/poseidon-ensemble-report.pdf`. The migration and latest backend
are installed locally; the model service remains available for review. See
`plugins/ecotwin/docs/MARELD-POC.md` and `plugins/ecotwin/docs/ECOTWIN-API.md` for deployment and API contracts.

Operational scope: one enabled Symphony worker per model server; the model's
existing in-memory run cache and lack of immutable checkpoint identifiers remain
unchanged. These short Poseidon runs verify integration, not ecological calibration.
The historical REST suite limitation recorded above still applies.

## Simulation comparison integration — delivered 2026-10-13

- [x] Optional saved-run selection in native Compare calculations, with compatible
  ensemble suggestions, explicit run choices, actionable mismatch messages and
  refresh after completion/deletion. Native comparisons work without opting in.
- [x] Explicit, owner-authorized, idempotent creation of a saved counterpart for the
  implied baseline. `SimulationBaselineService` calls the native baseline engine;
  `ScenarioSnapshot.withoutLayerChanges` preserves the domain and calculation
  settings while removing all layer changes. The original scenario is unchanged.
  `SimulationBaselines.sql` adds the persistent link and deletion constraints.
- [x] Preparation links open EcoTwin with the selected calculation and matching
  model/duration/seeds. Preparation is asynchronous and guarded against stale
  responses. No model run starts until the user requests it.
- [x] A separate `features/simulation-comparison` module of standalone components
  loads persisted summaries, validates model/species/seeds/time/domain/mapping/data
  compatibility and renders paired per-species graphs. Intentional pressure changes
  are allowed. Both columns share axes and show percentages of initial biomass.
  Report math is shared with single-calculation appendices; confidence intervals
  are computed after normalizing each seed.
- [x] Report URLs pin exact runs, including new-tab links. Reversed implied reports
  swap both columns; print readiness verifies the iframe origin/source and pair.
  Deletion clears stale graphs and makes the selected appendix explicitly unavailable.
- [x] Poseidon: #7 vs #9 now has matching 80-step, ten-seed ensembles. #9's saved
  automatic baseline is #18; its ensemble reproduces #7 exactly. Native implicit
  versus persisted-baseline comparison statistics agree. The scenario still points
  to #9. A transient model timeout at nine seeds was resumed successfully.
- [x] Live iframe, new-tab, explicit and reversed implicit reports checked; the
  seven-page A4 comparison export has three visually reviewed appendix pages.

Implementation entry points: `SimulationBaselineREST`, `SimulationBaselineService`,
`SimulationComparisonPickerComponent`, `SimulationComparisonReportComponent`,
`simulation-comparison.ts`, and `MareldSession.prepareComparison`. Setup/API and
user workflow are documented in `plugins/ecotwin/docs/ECOTWIN-API.md` and `plugins/ecotwin/docs/MARELD-POC.md`.

Final comparison validation: 261 frontend tests passed; backend package passed
126 tests with one existing skip; changed TypeScript lint and production build
passed (the existing initial-bundle warning remains: 2.36 MB against 2 MB).
`python3 plugins/ecotwin/tools/verify-simulation-comparison.py --credentials .local/symphony/hav-local-credentials.json` repeats the read-only native-statistics,
matched-settings and identical-baseline-ensemble checks without starting any runs.

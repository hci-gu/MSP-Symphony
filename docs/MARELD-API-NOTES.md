# MARELD API research notes

Reference findings from 2026-09-29. These describe the inspected repositories and local probes, not requirements that must all be resolved before building a POC. The current delivery scope is the [Symphony MARELD POC plan](MARELD-INTEGRATION-PLAN.md).

## What the repositories establish

The inspection used the current working trees, including local modifications:

| Repository | HEAD at inspection | Relevant stack |
| --- | --- | --- |
| Symphony | `6e9a3f218b5a444ca12daae72fe91204a606c384` | Angular 21, NgRx, OpenLayers 10; Java 17, Jakarta EE, GeoTools, PostgreSQL |
| Ecotwin, at `../../work/gu/ecotwin` from Symphony's root | `fe4483040ade60080432b9690533c29e0222148e` | React, Jotai, Mapbox/deck.gl; PocketBase/Go; raster preparation worker |
| Eco-evo, at `../../work/gu/eco-evo` from Symphony's root | `38429e5695c11c768ae0a698052d2139fb47ed36` | Python standard-library HTTP API, NumPy, PyTorch; agent-based ecosystem engine |

Symphony and Ecotwin have uncommitted changes, so their commit IDs alone do not reproduce the inspected files. Eco-evo was clean before and after inspection. The findings below distinguish source behavior, local parser/environment probes, and deployment questions that code alone cannot answer. Eco-evo source takes precedence over Ecotwin's proposed inference requirements.

### Ecotwin's actual flow

1. The frontend calls `GET /simulation/{recordId}/run?format=base64` on PocketBase.
2. PocketBase loads the simulation, management plan, linked map tile, and activities. It saves a normalized input snapshot.
3. It reads `landcovers.color_100`, converts its palette into a grayscale land/water texture, and optionally reads `oceanData.depth`.
4. It rasterizes activity polygons into `noise_impact` and `trawl_map` images.
5. It discovers models with `GET /v1/models`, then sends a multipart `POST /v1/runs` to the configured inference service.
6. It converts the response into Ecotwin's result DTO and caches the JSON on the simulation record.
7. The frontend decodes the biomass tensor and draws the selected frame/species over the tile's geographic bounds. It also supplies playback and biomass charts.

The inference URL comes from `SIMULATION_INFERENCE_URL` or `MARELD_API_URL`, with a local default. The browser is insulated from the inference service by the application backend. See [the bridge documentation](../../../work/gu/ecotwin/pocketbase/API_DOCS.md), [Go implementation](../../../work/gu/ecotwin/pocketbase/main.go), and [map component](../../../work/gu/ecotwin/src/components/map-viewport.tsx).

### Confirmed differences between the client and API

| Area | What is present today | Integration consequence |
| --- | --- | --- |
| Input format | Eco-evo requires multipart JSON `request` **and both** `texture` and `depth`; missing depth returns HTTP 400 | Always send both same-sized PNGs. A documented depth placeholder is sufficient for this engine version. |
| Texture | Grayscale values below 0.5 after division by 255 mean water; water controls spawning, movement access, and biomass masking | Use black water/white land. The texture has a real spatial effect; it is not an arbitrary colored habitat map. |
| Depth | Stored as a normalized grid map after spawning, with no current ecological consumer | Do not present bathymetry-dependent effects or spend the first phase building a depth service. |
| Noise/trawling uploads | Ecotwin sends `noise_impact` and `trawl_map`; Eco-evo never reads either multipart field | They are silently ignored by this checkout. Use a repaired, tested pressure contract rather than cloning that client behavior. |
| Structured pressures | Ecotwin sends an empty list. Eco-evo accepts four static pressure names, but default `mareld2.yaml` mutes every impact | Accepted input does not prove ecological effect. Keep intervention controls disabled until the model profile demonstrates an effect. |
| Scoped pressures | `form.getlist("mask")` yields raw values, which the parser treats as file objects; a referenced valid upload produces HTTP 400 | Fix and regression-test multipart mask handling in Eco-evo before enabling polygon interventions. |
| Timing | The API runs the engine's default six-hour tick; `tick_duration_days` and dates are only echoed | Derive steps from six hours and send `tick_duration_days: 0.25`; reject contradictory UI date settings. |
| Spatial scale | `build_env` uses 1,000 m cells. API `grid.bbox` and `coordinate_system` are not consumed | Prepare a projected 1 km grid and retain its complete georeferencing in Symphony's plugin manifest. |
| Execution | POST blocks until completion and returns HTTP 200. GET can inspect an in-memory `RUNS` record | Own the durable queue in the Symphony adapter. Do not expect an upstream HTTP 202 queue or persistence. |
| Seed transport | Ecotwin adds `?seed=...`; Eco-evo compares the full request path with `/v1/runs` | Send seed only in JSON. A seed query string returns HTTP 404 with this API. |
| Geometry | The current activity rasterizer accepts bare Polygon geometries and handles their holes; it skips unsupported geometry | Support Symphony's Polygon and MultiPolygon features explicitly, with visible validation failures. |
| Activity timing | Eco-evo rejects partial-run windows and species-effort pressures with HTTP 422 | Static whole-run interventions are the first possible extension; schedules and fishing effort need engine support. |
| Results | Base64 float32 tensor, shape `[frames, height, width, species]` | Validate the complete contract before displaying a result. |
| Map placement | Ecotwin obtains geographic bounds from the linked tile, separately from the returned tensor | Persist the exact input grid with every run; never infer it from the current map view. |
| Display scale | Ecotwin normalizes each species against each frame's maximum and suppresses low values | Use a fixed scale across a run by default; frame-relative contrast must be explicitly labeled. |

Evidence: `parse_multipart_request`, `validate_pressures`, `_run_one_replicate`, `execute_run`, and `MareldApiHandler` in [Eco-evo's api.py](../../../work/gu/eco-evo/api.py); `build_env` in [inference.py](../../../work/gu/eco-evo/inference.py); [default project](../../../work/gu/eco-evo/mareld2.yaml); [Ecotwin's bridge](../../../work/gu/ecotwin/pocketbase/main.go) and [bitmap renderer](../../../work/gu/ecotwin/src/map-layers/biomass-screen-grid-layer.ts). Ecotwin's [inference requirements](../../../work/gu/ecotwin/INFERENCE_API_REQUIREMENTS.md) remain useful design context, but are not the implemented contract.

### Verified engine profile and remaining model issues

- **Model selection:** `/v1/models` discovers `results/<directory>/policy_*.pth`; the directory name is the model ID. Every discovered model currently uses the same `mareld2.yaml` and biological library, rather than a configuration saved alongside its checkpoint. An `agent_set` request property is not used. Discovery does not guarantee checkpoint compatibility; loading performs stricter checks.
- **Species:** the present project enables `codfish` (internal `gadoids`), `pelagicFish` (`pelagic_fish`), `porpoises`, `benthic_community`, `phytoplankton`, and `zooplankton`. Seals and seabirds are muted. The request's species list selects output channels, not which groups participate in the food web.
- **Grid/domain:** rectangular dimensions of at least 3×3 are accepted; a 5×3 local environment was constructed successfully. The reference calibration grid is 60×60 and cells represent 1 km. Grid acceptance is not evidence of calibration for arbitrary areas. With migration off, edges are closed to outward movement; texture land cells are inaccessible.
- **Initial state:** configured inference biomass totals are scaled by `H*W/(60*60)`, with a one-tonne floor, and distributed by configured spawn strategies over accessible cells. Scaling uses the full rectangle, not its water-cell count. The selected geography does not load observed local species biomass. Changing land fraction or grid bounds can therefore change the initial density.
- **Dynamics settings:** API calls explicitly disable natural mortality and inherit `migration=False`, no currents, and `mass_balance=False` from `build_env`. The CLI/training default and the library's current calibration use mass balance **on**. Resolve this API/default mismatch with the model maintainer and matching checkpoints before interpreting results as equivalent to trained/CLI runs; do not silently switch scientific settings in the plugin.
- **Randomness:** request seeds feed initial-state construction and are incremented for replicates, but the API does not seed/isolate all NumPy global randomness used by seasonal initialization and tick order. Two local environments with the same request seed had different seasonal phases. Do not promise repeatable paired runs yet, especially across concurrent requests.
- **Units/results:** internal biomass is tonnes per cell. The returned map tensor is the mean across replicates; summaries sum cells per replicate and then aggregate. `fitness` is only final total output biomass, not trainer fitness. Float32 bytes use NumPy's native byte order, which was little-endian in the local environment. Record the server profile and require an explicit encoding before supporting other hosts.
- **Deployment:** the handler has no authentication, authorization, cancellation, durable queue, or persistent result store. It defaults to loopback port 8000 and serves threaded synchronous requests, except debug visualization uses a single-threaded server. Keep it behind the Symphony backend/private service boundary and configure any deployment authentication separately.

Evidence: [API](../../../work/gu/eco-evo/api.py), [environment construction and checkpoint loading](../../../work/gu/eco-evo/inference.py), [configuration loader](../../../work/gu/eco-evo/lib/config/config_loader.py), [grid masks](../../../work/gu/eco-evo/lib/environments/ecosystem_env/grid_masks.py), [environment](../../../work/gu/eco-evo/lib/environments/ecosystem_env/environment.py), [mass-balance defaults](../../../work/gu/eco-evo/lib/environments/ecosystem_env/population_change.py), and [internal biomass units](../../../work/gu/eco-evo/lib/world/functional_group.py).

## Verification performed for this plan

Used Eco-evo's existing Python 3.12.9/NumPy 1.26.4 environment without installing dependencies or modifying source. The probes invoked the real parser/handler and constructed a small environment; they did not launch an inference server, load trained checkpoints, or run training.

| Local probe | Observed result |
| --- | --- |
| Multipart 5×3 texture and depth | Accepted, both arrays shaped `[3,5]`. |
| Same request without depth | HTTP 400 `MISSING_FILE`, naming `depth`. |
| Added `noise_impact` and `trawl_map` uploads | Parsing succeeded but neither input was returned/consumed. |
| Valid PNG `mask.png` referenced by `request.masks` | HTTP 400 `MISSING_FILE`: `Missing uploaded mask file referenced by request: mask.png`. |
| Handler called with `/v1/runs?seed=1` | HTTP 404 `NOT_FOUND`. |
| Environment built from the default project with one land cell | Six active groups, 1,000 m cells, six-hour ticks, zero land biomass; mass balance and natural mortality off, migration off, no currents. |
| Whole-grid noise intensity 140 | Pressure validation succeeded and the map contained 140, but all four decision-maker impact-table lists remained empty. |
| Partial-run noise window and species-effort pressure | Both rejected with HTTP 422 `UNSUPPORTED_PRESSURE`. |
| Two environment initializations with identical seed | Seasonal phases differed, confirming incomplete random-state control. |
| NumPy float32 encoding of `1.0` | `0000803f`, little-endian; the serializer uses native byte order. |
| Existing `tests/test_impact_loading.py` | **5 passed**; tests independently confirm muted defaults and the effect/layout change when noise is enabled in a temporary project. |

Test command, run from the Eco-evo root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYGAME_HIDE_SUPPORT_PROMPT=1 \
  .venv/bin/python -m pytest tests/test_impact_loading.py -q -p no:cacheprovider
```


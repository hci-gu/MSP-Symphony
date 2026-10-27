# Eco-evo handoff: Symphony noise and trawling demo

Historical design/evidence. See [the current installation guide](../INSTALLATION.md) and [architecture](../ARCHITECTURE.md) for the supported plugin structure.

## Implementation status (2026-10-12)

The work below has now been implemented directly in the local Eco-evo repository.
This document retains the agreed contract and checklist as a reference; it is no
longer a pending agent assignment. Changes are in `api.py`,
`fgconfig/fg_library.yaml`, `mareld_symphony_demo.yaml` and
`tests/test_api_demo_impacts.py`. Eco-evo's `SYMPHONY_DEMO.md` contains its operating
guide. Start it from that repository with:

```sh
uv run --locked python -u api.py --host 127.0.0.1 --port 8000 \
  --project mareld_symphony_demo.yaml
```

Checkpoint `2026-10-08` successfully loaded for sequential baseline, noise-only,
trawling-only and combined HTTP runs, with matching initial tensors and distinct
final tensors. All 31 focused API tests passed, including direct ecological terms
and full-field reconstruction. A one-generation training smoke test also passed.
The full Eco-evo suite reported 896 passed, 100 skipped and one failure in an
unchanged Pygame tooltip pixel test, which also fails in isolation.
All four scenarios also completed from Symphony's browser UI on the 39 x 39
review area (48 steps, 13 frames, six species). The local API now runs the demo
profile on port 8000.

## Task for the Eco-evo agent

**Historical scope:** the checklist below records the original fish-only demo.
The subsequent user-requested benthos extension is implemented in Eco-evo:
`apply_impact_mortality` includes non-decision makers, API validation accepts their
biomass-loss responses, and the library has a separate benthic bottom-trawling
table. It removes `biomass * 0.02 * intensity` per library tick within the demo's
0-0.4 intensity range (0.2% at 0.1), capped at 0.8% above it. Regrowth is unchanged.
This supersedes the original instruction below to exclude benthic impacts; the
HTTP contract and frontend scaling are unchanged. See `SYMPHONY_DEMO.md` in Eco-evo
and `MARELD-POC.md` here for current operation and assumptions.

Implement the smallest Eco-evo changes needed to consume Symphony's **existing multipart mask + scalar pressure contract**, and make those pressures affect a demo simulation. The Symphony frontend implementation is complete in the MSP-Symphony repository. Do not redesign the HTTP interface or add continuous raster uploads, queues, persistence, time schedules, new policy observation channels, or a new result format for this task.

This is an illustrative integration demo. The source spatial patterns come from Symphony; conversions into model intensities are explicit demo assumptions. They are not calibrated sound exposure, fishing mortality, or forecasts.

Read your repository's current AGENTS.md and inspect the current working tree before editing. Preserve existing local changes. The observations below were made on 2026-10-12; use current source as the authority. In particular, older `MARELD-API-NOTES.md` observations about inference defaults and random seeding are historical.

## What Symphony now does

- Uses `noise-125hz-shipping-source.bin` and `catch-bottom-trawl-source.bin` from its shipped HaV layer catalog.
- Both sources are 156 × 156 cells at 250 m, EPSG:3035, extent `[4326000, 3873000, 4365000, 3912000]`. They contain normalized 0–100 indices plus provenance. Noise is a historical shipping index, **not dB**. Bottom-trawl catch is a swept-area proxy, **not mortality**.
- Uses bottom trawling because the pelagic-trawl layer is almost absent in this area. The bottom-trawl turbidity layer is an identical field and is not sent a second time.
- Aggregates source indices by exact overlap area onto its captured 1 km grid. Means divide by the **whole target-cell area**, including uncovered portions; unknown and inferred portions contribute zero. Only source and recovered-source provenance is included. Reports the known-area percentage to the user. Completely uncovered enabled inputs block the run.
- Keeps inaccessible target cells zero. Uses north-to-south rows and west-to-east columns, exactly like texture and results. Source map visibility, opacity, hatch settings and display clipping do not affect the request.
- Quantizes each positive mean into one of 16 positive bands: `k = clamp(round(mean / 100 * 16), 1, 16)`. Exact zeros stay zero. Very small positive means therefore use band 1. Empty bands are omitted.
- Gives each impact an independent enable control and strength in `[0, 2]` (UI steps 0.1). Both default to off, strength 1. Zero strength creates no positive bands.
- Previews the actual banded field and lets the user show it on the map. Records settings, source IDs/files/hashes/grids, prepared values and masks with the in-memory result. Edited settings apply to the next run.
- Applies impacts for the entire run. No species scope or partial time window is sent.

### Exact demo intensity mapping: v1

For band `k`, `f = k / 16`, strength `s`:

| API type | Internal impact target | Nonzero band intensity |
|---|---|---|
| `noise_pressure` | `windfarm_noise` | `min(140, 60 + 60 * f * s)` |
| `trawling_pressure` | `bottom_trawling` | `0.2 * f * s` |

If `s == 0`, all intensities are zero and no masks are sent for that impact. At strength 1 the highest noise band is 120 and highest trawling band is 0.2. At strength 2 they are 140 and 0.4. Noise values occupy the existing response table's input scale, but must not be presented as measured shipping dB. The requested trawling table below gives at most 0.0002 biomass loss per library tick at strength 1 and 0.0004 at strength 2. These repeated small losses can accumulate over long runs; do not rescale 0.2 to 200 or 1000.

Do not repeat this scaling in the API. The JSON intensities are already converted.

## Existing wire contract (do not change)

`POST /v1/runs`, `multipart/form-data`:

- `request`: JSON text field.
- `texture`: file `texture.png`; black = accessible water, white = inaccessible.
- `depth`: file `depth.png`; current frontend sends zeros.
- `mask`: repeated file field, one binary PNG per nonempty band. The filenames match `request.masks[].file` exactly.

Each PNG is the full request grid size. Mask pixels are **black 0 = excluded, white 255 = included**, opaque, no grayscale interpolation. Frontend canvas PNGs may be RGBA; convert to `L` using the existing decoder. `/255` normalization followed by `> 0` is suitable for these binary masks. A mask is not an intensity image; intensity comes from its pressure entry.

With any impact enabled, the pressure list begins with **two whole-grid resets**, noise then trawling, both intensity 0. These reset even an unselected impact. Subsequent entries are nonempty noise bands in ascending band order, followed by trawling bands. Preserve order. The engine should overwrite cells for these entries, as it already does; do not sum band intensities.

Maximum: 32 mask files and 34 pressure entries. Bands of one impact are disjoint. Noise and trawling masks may overlap because they target different maps. With both controls off, Symphony preserves its existing request: `pressures: []`, no `masks` property and no mask uploads. With an enabled zero-strength input, it sends just the two reset entries.

Example JSON for two band-8 masks (dimensions illustrative):

```json
{
  "run_id": "symphony-demo-impacts-probe",
  "seed": 42,
  "model": { "id": "REPLACE_WITH_DISCOVERED_MODEL" },
  "grid": { "width": 3, "height": 3 },
  "time": { "max_steps": 4, "sample_every": 4, "include_final": true, "tick_duration_days": 0.25 },
  "species": ["pelagicFish", "porpoises"],
  "masks": [
    { "id": "noise-08", "file": "noise-08.png" },
    { "id": "trawling-08", "file": "trawling-08.png" }
  ],
  "pressures": [
    { "id": "noise-reset", "type": "noise_pressure", "scope": { "kind": "whole_grid" }, "parameters": { "intensity": 0 }, "time_window": { "start_step": 0, "end_step": 4 } },
    { "id": "trawling-reset", "type": "trawling_pressure", "scope": { "kind": "whole_grid" }, "parameters": { "intensity": 0 }, "time_window": { "start_step": 0, "end_step": 4 } },
    { "id": "noise-08", "type": "noise_pressure", "scope": { "kind": "mask", "mask_id": "noise-08" }, "parameters": { "intensity": 90 }, "time_window": { "start_step": 0, "end_step": 4 } },
    { "id": "trawling-08", "type": "trawling_pressure", "scope": { "kind": "mask", "mask_id": "trawling-08" }, "parameters": { "intensity": 0.1 }, "time_window": { "start_step": 0, "end_step": 4 } }
  ],
  "output": { "dtype": "float32", "tensor_order": "frame,row,column,species", "replicates": 1, "include_summary": false }
}
```

The response must continue to use the existing completed envelope and base64 Float32 biomass tensor. Do not require new request metadata or response fields. A missing mask must fail visibly rather than silently dropping a pressure.

## Required Eco-evo work

### 1. Repair multipart mask parsing in api.py

`parse_multipart_request()` currently uses `form.getlist("mask")` and then expects FieldStorage objects with `.filename` and `.file`. `getlist()` returns their values, so valid uploads are skipped and referenced filenames fail with `MISSING_FILE`.

Read the actual items instead. For example:

```python
uploaded_masks = []
if "mask" in form:
    item = form["mask"]
    uploaded_masks = item if isinstance(item, list) else [item]
```

Pass each file item through the existing PNG decoder. Do not use `if item` on FieldStorage; its truthiness can raise. Handle both one mask and repeated masks. Keep basename matching, size checks and helpful errors. Reject ambiguous duplicate filenames/IDs and missing references instead of allowing a silent overwrite. Keep texture/depth handling and no-mask requests compatible.

### 2. Keep the API's trawling mapping; align the demo model

The current mapping is:

```python
"noise_pressure": "windfarm_noise"
"trawling_pressure": "bottom_trawling"
```

Keep it. The current project defines muted `pelagic_trawling`, while its library has a usable pelagic-fish response under `pelagic_fish_impacted_by_pelagic_trawling`. Simply unmuting that impact will NOT make an uploaded bottom-trawling map work.

For the demo, add an active `bottom_trawling` project entry, range 0–1000, `observable: false`. Add `pelagic_fish_impacted_by_bottom_trawling` to the biological library's `interaction_definitions`, using the existing response shape:

```yaml
pelagic_fish_impacted_by_bottom_trawling:
  impact_affects: true
  impact_table:
    - value: 0.0
      biomass_factor: 0.0
      energy_factor: 0.0
    - value: 1000.0
      biomass_factor: 1.0
      energy_factor: 0.0
```

This is an explicitly illustrative fish-mortality proxy for the integration demo, not a validated bottom-trawling response. Keep the existing pelagic-trawling definition intact and muted unless separately needed. Do not add mortality to other species or benthic impacts as part of this task. Other species may respond indirectly through the food web. The existing impact code already evaluates these tables; engine dynamics do not need a rewrite.

### 3. Enable noise without widening policy inputs

Activate `windfarm_noise`, keep range 0–140, and set **`observable: false`**. Preserve its existing porpoise energy-cost response table (60 → 0; 80 → 0.15; 100 → 0.4; 120 → 0.8). Its biomass factors are zero, so noise does not directly kill porpoises. At intensity 90 the interpolated extra energy factor should be 0.275, giving metabolic multiplier 1.275.

Non-observable impacts still apply their configured energy/mortality effects. They are not explicit noise/trawling inputs to the trained policy, so do not claim learned avoidance. Keeping them non-observable is intended to preserve current checkpoint input widths. Verify against a real chosen checkpoint; do not bypass shape checks or fake missing weights. Retraining is not intended for this demo.

Prefer a clearly named demo project copied from the current project, preserving species, daylight, tick settings and all other defaults. The current API hardcodes `DEFAULT_PROJECT` during discovery. A small optional server `--project` setting (default unchanged) is reasonable to select the demo project for both discovery and execution. No per-request project selector or model registry redesign is needed. New bottom-trawling library entries are inert in projects that do not activate that impact.

### 4. Guarantee an explicit zero baseline

Inspect `inference.build_env()`: it can read configured `inference.impact_maps`. For the dedicated demo profile, ensure both noise and bottom-trawling maps begin as full-grid zeros, with no configured external maps or generated pressure fields. This must also hold for baseline requests with `pressures: []`.

For enabled runs, the two ordered reset entries then establish zero maps before mask assignments. Ensure new maps are read by both the impact-mortality and energy-cost paths. In the inspected code, those paths read `env.grid.get_map(...)` each time; verify this remains true. Zero/inaccessible cells must not receive unintended pressure.

### 5. Validate actual effect, not only HTTP acceptance

An accepted map can be ecologically inert when its project impact is muted or its response table is missing. In the demo profile, require the intended active impacts and nonempty relevant response tables. Return an explicit 422 error for a requested nonzero pressure that this model cannot apply, instead of accepting it as a no-op. Zero reset entries should remain harmless for compatibility. Reject NaN, infinity and negative intensities; Python float conversion alone currently allows non-finite numbers.

Preserve existing no-impact runs and other pressure types. Keep changes scoped to parsing, demo selection/configuration and the small validation needed to prevent silent failures.

## Tests and acceptance criteria

1. **Parser:** real multipart bodies with one and several `mask` files; black/white membership, RGBA PNGs, filename references and `[height,width]` orientation. Include missing file, duplicate ID/name, wrong dimensions and malformed PNG cases. No-mask requests still parse.
2. **Application:** prefill both maps with nonzero sentinels, apply the two reset entries and several disjoint bands, then compare the entire reconstructed arrays to expected Float32 values. Confirm cross-impact overlap does not interfere and outside-mask cells stay zero. Test noise-only, trawling-only, both, enabled strength zero, and empty-pressure baseline.
3. **Model:** construct demo env; confirm active `windfarm_noise` and `bottom_trawling`, porpoise noise response and pelagic-fish bottom-trawling response; assert all policy input widths match the original chosen checkpoint's layout. Load real checkpoints successfully.
4. **Direct effect:** check porpoise metabolic multiplier 1.275 at noise 90; check pelagic-fish requested impact loss `biomass * 0.0001` at trawling 0.1 in the library's six-hour calibration, zero elsewhere. Use the repository tick-time helpers if testing other tick lengths. Test these terms in isolation from predation/growth.
5. **HTTP smoke:** choose an ID from GET `/v1/models`, submit the example above with generated masks, and verify completed tensor shape `[2,3,3,2]`, steps `[0,4]`, finite nonnegative biomass. Use a small real-checkpoint run, not mock inference, for this check.
6. **Comparison:** run baseline, noise only, trawling only and both, sequentially with the same model/seed/initial state. Verify matching initial tensors and that intended direct terms differ. Do not require monotonic total biomass across complex food-web runs. Short runs need not produce a large visual difference. Check current global-RNG/threading behavior before treating concurrently executed requests as paired comparisons.
7. **Symphony acceptance:** start the patched API at port 8000 (or existing `MARELD_API_URL` target), select the saved **MARELD POC review area**, capture it, enable both impacts, preview each, and run. Existing synthetic example area is elsewhere and intentionally fails source coverage when impacts are enabled. Repeat with each impact disabled and both disabled. Confirm no mask-related 400, no checkpoint mismatch and no silent muted effects.

A minimal set of PNG probe files can be generated inside Eco-evo with its existing Pillow/NumPy dependencies. Save the JSON example as `request.json`, replacing the model ID, then run:

```python
from pathlib import Path
import numpy as np
from PIL import Image

out = Path("/tmp/symphony-impact-probe")
out.mkdir(exist_ok=True)
for name, arr in {
    "texture": np.zeros((3, 3), dtype=np.uint8),
    "depth": np.zeros((3, 3), dtype=np.uint8),
    "noise-08": np.array([[255, 0, 0], [0, 255, 0], [0, 0, 0]], dtype=np.uint8),
    "trawling-08": np.array([[0, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8),
}.items():
    Image.fromarray(arr).save(out / f"{name}.png")
```

```sh
curl --fail-with-body http://127.0.0.1:8000/v1/runs \
  --form 'request=</tmp/symphony-impact-probe/request.json' \
  --form 'texture=@/tmp/symphony-impact-probe/texture.png;type=image/png' \
  --form 'depth=@/tmp/symphony-impact-probe/depth.png;type=image/png' \
  --form 'mask=@/tmp/symphony-impact-probe/noise-08.png;type=image/png' \
  --form 'mask=@/tmp/symphony-impact-probe/trawling-08.png;type=image/png'
```

Existing focused engine tests include `tests/test_impact_loading.py`; retain their default-profile assumptions if the default project is unchanged. Add tests for the separate demo profile. Run appropriate existing API/defaults tests too. Do not change scientific inference defaults merely to make a test pass.

## Symphony implementation reference

Paths relative to MSP-Symphony:

| File | Responsibility |
|---|---|
| `plugins/ecotwin/frontend/workspace/ecotwin-impacts.ts` | v1 scaling, area aggregation, bands, masks, ordered JSON pressures, preview pixels |
| `plugins/ecotwin/frontend/workspace/mareld-impact-data.service.ts` | Source-only asset loading and decoding |
| `plugins/ecotwin/frontend/workspace/mareld-impact-controls.component.*` | Enable/strength controls, exact input previews, coverage |
| `plugins/ecotwin/frontend/workspace/mareld-session.service.ts` | Preparation lifecycle, input snapshots, stale-load protection |
| `plugins/ecotwin/frontend/workspace/ecotwin-api.client.ts` | Multipart PNG encoding and submission |
| `plugins/ecotwin/frontend/workspace/ecotwin-map.bridge.ts` | Input/result map overlays |
| `frontend/src/assets/mareld-layers/manifest.json` | Source provenance and geographic grid |

When finished, report exact API/config files changed, the launch command for the demo profile, verified checkpoint ID, tests run, live probe outcome, and any remaining limitation. Do not claim end-to-end ecological effects based solely on a 200 response.

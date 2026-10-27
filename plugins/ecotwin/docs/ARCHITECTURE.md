# Architecture and development

EcoTwin owns its Symphony compatibility work. Native Symphony exposes neutral UI
contribution hooks and a few native calculation helpers; it knows no simulation
domain types, model rules or report protocols. The enabled distribution composes
the two products. Base builds use empty contribution registration and omit all
backend plugin source.

## Module ownership

| Module | Responsibility | Dependency rule |
| --- | --- | --- |
| `frontend/workspace`, `shared`, `reports`, `comparison` | Preparation, previews, durable jobs, playback, statistics and persisted figures | Plugin contracts/ports, framework and profile only; no native state or environment imports |
| `frontend/integration/symphony` | Native state/lifecycle/navigation translation and host contribution wrappers | The only frontend module importing native implementation |
| `frontend/contracts.ts`, `ports.ts`, `config.ts` | Serializable shared types, required host operations and injected configuration | HTTP implementations do not own shared DTO definitions |
| `backend/core` | Validated requests/results, immutable seed execution, fingerprints, profiles and numerical rules | Independently compiled Java 17; no native, container, persistence or GeoTools dependency |
| `backend/adapter/.../integration/symphony` | Native authorization, calculation locks, source reconstruction and baseline materialization | The only backend module importing native implementation |
| `backend/adapter/.../integration/jakarta` | HTTP, persistence, transactional coordination and worker lifecycle | Plugin core plus high-level Symphony adapter operations |
| `backend/adapter/.../integration/ecoevo` | Engine discovery and run protocol | Uses immutable execution values; engine address is server-owned |
| `profiles`, `contracts/fixtures` | Reviewed scientific policy and shared numerical cases | Java and TypeScript check the same boundary cases independently |
| `distributions/symphony-ecotwin` | Registration, build composition, compatibility record and disposable verification | May know both host and plugin; owns their supported combination |
| `examples/ecotwin` | Research preparation, historical evidence and optional sample data | Excluded from ordinary builds, runtime artifacts and deterministic tests |

The workspace facade retains coordinated revision guards, uncertain submission
identity, cache ownership and deletion tombstones. These invariants are not split
across unrelated services. Reports query persisted artifacts without requiring
the workspace or model. Plugin notifications centralize same-tab/cross-tab
invalidation and disposal; notification messages never authorize access.

## Host contribution interface

`frontend/src/app/extensions` defines the small native interface:

- `HostExtension` registers workspace, map, comparison and report contributions.
- Workspace tab descriptors are rendered by the host so native projected-tab
  discovery works. Activation/visibility are distinct from destruction.
- `MapLease` supplies an owned overlay slot, projection access through OpenLayers
  and viewport padding. Plugin rendering removes and disposes its own layers.
- Comparison contributions receive native calculation context and return generic
  validity plus opaque report query state. Native calculation/exports do not
  interpret plugin run IDs.
- Report contributions receive a context and report loading/ready/error through
  callbacks. The host aggregates readiness and validates the current iframe,
  origin and `reportDocument` identity before printing.

The empty registration supports ordinary native reports. The enabled registration
is in the distribution. A third, compatibility-only registration recognizes legacy
extended links without importing EcoTwin implementation:

```sh
cd frontend
npm run build:ecotwin-absent
```

New extended URLs carry `extensions=ecotwin`. The compatibility-only registration
also recognizes legacy `simBase`, `simBaselineRun` and `simScenarioRun` fields, and
shows an unavailable extension explicitly. The completely bare base has no legacy
EcoTwin metadata. Selected-but-failed appendices are not treated as empty success.
Native CSV/GeoTIFF query construction keeps only native parameters.

## Native calculation interface

The plugin's Symphony adapter supplies owned calculation choices, manifests and
grids; authorization/locking/verification inside the caller's transaction; and
explicit creation of a private saved counterpart to an implicit baseline.

The core never receives a native entity, entity manager or lock handle. The adapter
tracks native raster interpretation: saved coast-excluded ROI, integer rounding,
area edit ordering, matrix masks, band selection, valid zeros versus unknown
support, native CRS and source fingerprints. Compatibility tests must change when
upstream semantics change; Symphony is not required to preserve the old behavior
for the plugin.

The small native helper patch retains shared raster geometry, source access and
explicit snapshot copying where the native public interface needs them. The
cross-baseline native history query remains a backward-compatible generic alias;
new EcoTwin callers use `/extensions/ecotwin/calculations`. Native login/report
fixes and history deletion cleanup remain native responsibilities.

## Persistence and lifecycle

The composed WAR reuses Symphony's authentication, data source and JTA. It locks
the native calculation before the plugin job, verifies ownership/source identity,
and attaches run summary, artifact and completed job atomically. Network model
work is outside database transactions; checkpoints are short transactions.

Pure core validation failures are translated to HTTP responses and declared as
rollback application exceptions by the optional deployment descriptor. Native
bean-managed and plugin container-managed transaction interaction is tested in
the disposable WildFly deployment, not assumed from unit mocks.

One enabled worker may use a model server. The EJB lock does not coordinate
multiple WARs or machines. Installed reporting-only mode preserves saved artifacts
and queued work while disabling execution/discovery. Removing the plugin does not
purge its data. Existing outward foreign keys retain native deletion semantics.

## Build composition

Frontend enabled commands prepare an ignored local `node_modules` link to the
host dependency installation. This allows plugin-owned source outside the native
source root to resolve the same Angular/OpenLayers packages. There is one runtime
and one lockfile; there is no independent install of a second framework. The
preparation script refuses to overwrite an existing unrelated path. Base commands
never prepare or resolve plugin source.

The backend core is a separate artifact. Adapter sources are included only by the
explicit Maven profile in the distribution reactor. This avoids a WAR/JAR circular
dependency while keeping source ownership separate. Base and enabled output
directories are isolated to prevent stale class leakage. A future separately
published adapter JAR needs a native classes/API artifact or third assembly layer;
it is not necessary for current optionality.

## Checks and upstream changes

```sh
python3 distributions/symphony-ecotwin/compatibility/check_architecture.py
python3 distributions/symphony-ecotwin/compatibility/test_architecture.py
python3 distributions/symphony-ecotwin/compatibility/test_upstream.py
python3 distributions/symphony-ecotwin/compatibility/verify_absent.py
python3 distributions/symphony-ecotwin/compatibility/rehearse_upstream.py --build
```

`adapter-imports.json` records exact allowed native dependencies. The guard rejects
native references outside adapters, including Java static/fully qualified uses,
and rejects plugin vocabulary in native implementation. Artifact scans catch
accidental plugin classes or frontend implementation in base outputs.

`host.patch` records native hooks, build registration, helpers and independently
useful fixes relative to the supported original Symphony revision. `host-files.json`
lists that patch's exact files. The rehearsal applies the patch to pristine upstream,
checks that it reproduces the current native files (including deletions), then
optionally builds/tests both distributions. Native test data is materialized from
the requested revision's exact submodule commit, not substituted from the working
tree. No example bundle is copied into the rehearsal.

To evaluate an incoming revision already fetched into Git:

```sh
python3 distributions/symphony-ecotwin/compatibility/rehearse_upstream.py \
  --revision <upstream-commit> --build
```

Repair differences in the plugin adapters and the documented neutral hook patch.
Review any new native import or host change before explicitly refreshing the
records with `check_architecture.py --record-imports` and
`rehearse_upstream.py --record-patch`. Advance `manifest.json` only after the
compatibility/deployment lanes pass. An incompatible plugin release does not block
native Symphony development. Native CI runs base builds; the separate EcoTwin
workflow owns enabled, absent-source and deployment verification.

The current upstream head equals the pinned source revision. Recomposition proves
the supported revision can be rebuilt independently; it is not a claim of support
for a future upstream revision that has not yet been released.

Internal frontend types, files, selectors and map-layer identities use EcoTwin names.
The Symphony adapter intentionally retains `tab=mareld-poc` for saved preparation links.
The optional development distribution retains `/mareld-api/v1/models` as a discovery alias
to the authenticated plugin endpoint. In `frontend/shared/run-config.json`, `apiPath`,
`defaultApiTarget` and `proxyGraceMs` are compatibility-only legacy fields; current discovery
and execution do not read them. The adapter supplies `apiBaseUrl`, and the backend alone
uses `ECOTWIN_API_URL`. No persisted simulation schema, run identifier or numeric policy
changed during the internal rename. Historical documents keep their original terminology.

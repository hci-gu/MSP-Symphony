# EcoTwin restructuring: implementation and review

Implementation date: 2026-10-27. This records the delivered architecture from the
[approved plan](ECOTWIN-PLUGIN-PLAN.md). The original change inventory remains a
record of the pre-refactor branch; its source links are pinned to `9243932`.

EcoTwin is now an optional in-process plugin. Default Symphony frontend and WAR
builds omit it. Plugin-owned adapters absorb native dependencies; the distribution
owns the explicit, reviewed native integration patch. Installation does not require
putting simulation rules back into native business logic.

## Review order

1. [Architecture and dependency rules](../plugins/ecotwin/docs/ARCHITECTURE.md):
   source ownership, contribution interfaces, transactions and upstream updates.
2. [Native patch ownership](../distributions/symphony-ecotwin/compatibility/host-changes.json):
   the reason and owner for every native frontend/backend file differing from supported upstream.
   [The patch](../distributions/symphony-ecotwin/compatibility/host.patch) includes
   neutral integration hooks, optional build composition, native helpers and
   separately justified native fixes. It contains 49 files, including tests and
   new neutral extension modules; these are not 49 plugin-specific business rules.
3. [Frontend entry point](../plugins/ecotwin/frontend/public-api.ts) and
   [backend core](../plugins/ecotwin/backend/core/pom.xml): follow the owned
   Symphony adapters outward from these modules.
4. [Installation and operation](../plugins/ecotwin/docs/INSTALLATION.md) and
   [HTTP/data contracts](../plugins/ecotwin/docs/ECOTWIN-API.md).
5. [Disposable acceptance harness](../distributions/symphony-ecotwin/verification/README.md)
   and the compatibility scripts for reproducible verification.

## Delivered changes

| Plan area | Implementation |
| --- | --- |
| Source ownership | Plugin frontend, backend, migrations, profile, contracts, tools and documentation live under `plugins/ecotwin`. Optional composition and compatibility checks live under `distributions/symphony-ecotwin`. Research data and import/preparation examples live under `examples/ecotwin`. |
| Frontend integration | Native workspace, map, comparison and report code use neutral contribution interfaces with an empty default registration. Native imports are confined to the plugin's Symphony adapter. `SimulationWorkspace` retains lifecycle, cache, cancellation, uncertain-submit and deletion invariants. Notifications centralize local and cross-tab invalidation. |
| Backend integration | A standalone Java 17 core owns validation, immutable execution values, fingerprints and ensemble mathematics. Symphony adaptation owns source reconstruction, native authorization/locking and saved-baseline creation. Jakarta integration owns REST, persistence and short transactions; model requests remain outside database transactions. |
| Optional packaging | Base and enabled WAR outputs are isolated. The enabled Maven reactor builds the independent core before composing adapter sources into the WAR, avoiding a host-WAR/adapter-JAR cycle. Frontend variants share one Angular/OpenLayers installation. No example dataset is needed to build either distribution. |
| Capability modes | Base has no plugin endpoints, entities or timers. Reporting-only mode reads saved results while disabling preparation, discovery and execution. Enabled mode uses one backend-owned model URL for discovery and execution. |
| Reports and comparisons | Generic document identity, iframe/origin checks and contribution readiness replace simulation-specific host protocols. Native metadata, fonts and images must finish before printing. Missing requested extensions remain explicit errors. Pinned simulation selection survives reversal. Saved report figures load independently of the workspace and model server. |
| Compatibility | Existing migrations, table names, wire versions, saved UUIDs and legacy routes remain intact. New extended links carry `extensions=ecotwin`. The metadata-only distribution also recognizes old simulation query parameters when the plugin implementation is absent. |
| Scientific profile | `hav-west-native-v1` owns source identities, restrictions, quantization and assumptions. Java and TypeScript exercise the same 22 boundary fixtures through their actual mapping functions. All 1,131 downloaded/extracted example checksums were verified after relocation. |
| Maintenance | Source/artifact guards, exact adapter import records, native patch ownership, absent-source builds, disposable container checks and pristine-upstream recomposition are available locally and in the separate EcoTwin workflow. Native CI builds the base application. |

Implementation module names use EcoTwin. The adapter retains `tab=mareld-poc` and
documented compatibility configuration/proxy aliases. Layout keeps cohesive
`workspace`, `shared`, `comparison` and `reports` frontend modules instead of
splitting coordinated state among many small domain/application/UI directories.
Backend adapter sources remain in the composed WAR; only the independent core is
a separately built JAR, as allowed by the plan's packaging decision.

## Verification

Local checks on the final source:

| Check | Result |
| --- | --- |
| Base frontend | Production build; 186 tests passed. |
| Enabled frontend | Production build; 308 tests passed, including the native tests. |
| Independent frontend core | 117 tests passed; its TypeScript graph contains zero native application sources. |
| Compatibility-only frontend | Production build and artifact scan passed; legacy and new requested-extension links show explicit unavailable content with no plugin requests. |
| Backend core | Standalone package; 10 tests passed. |
| Base backend | Package; 99 tests run, one existing skip, no failures. |
| Enabled backend | Package; 129 tests run, one existing skip, no failures. |
| Physically absent plugin | A temporary tree containing only `frontend` and `symphony-ws` built and tested successfully; WAR and browser bundles contain no plugin implementation. |
| Upstream recomposition | The recorded patch applied to pristine `6e9a3f2`; base and enabled frontend/backend builds and tests passed. Native test data came from that revision's exact submodule commit. No research examples were copied. |
| Real container acceptance | All 20 groups passed on WildFly 36.0.1 / Java 17 and PostGIS. Fresh disposable containers/network were cleaned afterward. |
| Guard/tooling checks | Seven architecture-guard regressions and the patch addition/deletion regression passed; source dependency checks, TypeScript lint, Python/shell/Node syntax checks, local documentation links and `git diff --check` passed. |
| Research data | All 1,131 original/downloaded checksums verified after relocation. The three SQL migrations are byte-identical to their pre-refactor contents. |

The final disposable-container evidence is
`.local/ecotwin-acceptance-2d6fb590b2/evidence.json`. It records artifact hashes,
native workflows, authorization, input export, baseline creation, v1/v2 data,
injected baseline/final-save failures, controlled concurrent submission/deletion,
worker restart/retry, offline reports and application removal/reinstallation with
exact saved-table preservation. The tested enabled WAR SHA256 is
`487aaa0cc28a8fc8217a98a891a9dcf7a947e3b950f0bc5ab91693a9ce9ec17d`.
Other local evidence is under `.local/plugin-verification/`, including the final
absent-source and upstream results and browser review server addresses. Full
build logs are `.local/ecotwin-absent-build.log` and
`.local/ecotwin-upstream-rehearsal.log`.

Browser checks covered native login/history/report printing with no plugin
requests; anonymous public maps in both distributions (including a query-bearing
public URL); enabled tab registration, saved-run map display and charts;
reporting-only controls and legacy/ensemble appendices; missing-extension links;
and explicit/reversed implied comparison reports with pinned runs. All ten pages
of a native report with two appendices and all four pages of a reversed comparison
were rendered to PDF and visually inspected. Artifacts are in ignored
`output/playwright/`; reproducible commands and fixture limitations are in the
verification guide.

The acceptance work caught and fixed stale appendix figures after a failed
refresh, public-route plugin attachment, early/stale print readiness, lost
comparison selection on reversal, and a deletion-race HTTP 500. The last case now
returns rollback-marked 409 and rechecks ownership after acquiring the native
calculation lock. These changes have regression coverage.

Builds retain the existing 2 MB frontend budget warning (about 2.23 MB base and
2.38 MB enabled). Local Maven compilation enforced Java 17 APIs using `--release
17`; real deployments ran on Java 17. The configured GitHub workflows were not
executed remotely during this local implementation.

## Review the application

Run the [disposable harness](../distributions/symphony-ecotwin/verification/README.md)
with `--keep` to obtain isolated base, reporting-only and enabled API URLs. Its
evidence file records ports and cleanup instructions. The fixture account is
`acceptance` / `disposable-acceptance-only`; it has no access to a real installation.
Point the frontend launcher at the selected API server origin:

```sh
SYMPHONY_API_URL=http://127.0.0.1:<enabled-server-port> \
  bash distributions/symphony-ecotwin/start-local.sh
```

Open EcoTwin, select the retained calculation with saved simulations, and inspect
the legacy run, ten-seed result, map playback and calculation report. The harness
labels all inputs/results synthetic. Use ordinary native history and comparison
on the base frontend (`cd frontend && npm start`) with its matching backend.

## Limits retained deliberately

- This is an optional in-process extension, not a separate service or a sandbox
  for untrusted code. A future separate repository/deployment remains possible.
- One enabled worker owns a model server. Distributed leases were outside this
  restructuring. Original inputs were not archived with every native calculation;
  fingerprints still identify files available at export time. Model display IDs
  still do not attest immutable checkpoint weights.
- Caller-supplied preview and full-run UUIDs must remain distinct. Reusing the same
  UUID can collide with the engine's existing idempotency cache. This pre-existing
  protocol limitation was reproduced during the audit; changing persisted engine
  identities is a separate compatibility change. The UI generates separate IDs.
- The disposable rasters and model stub establish integration/transaction behavior,
  not ecological validity. The harness bootstraps a fresh core schema using a copy
  of the base WAR; it does not replace production schema-upgrade testing. Removal
  and reinstall verification uses the current base/enabled artifact pair, not a
  historical enabled binary or destructive schema downgrade. Running-job
  checkpoint recovery and the documented concurrency orderings are tested;
  zero-seed queued-job deployment recovery is not a separate acceptance case.
- Supported upstream remains `6e9a3f218b5a444ca12daae72fe91204a606c384`.
  Upstream `develop` still equals that revision when checked on 2026-10-27.
  Recomposition tests the current supported revision. The incoming-revision
  command is ready for a future update; no untested revision is declared supported.

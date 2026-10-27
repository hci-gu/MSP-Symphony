# Installation and operation

Run all commands from the repository root unless a working directory is stated.
Use the Java, Node, database and WildFly requirements in the native README and the
[compatibility manifest](../../../distributions/symphony-ecotwin/compatibility/manifest.json).
The frontend and backend must be built for the same installation mode.

## Base Symphony

```sh
cd frontend
npm ci --include=optional
npm run build:base
npm run test:base
cd ..
mvn -f symphony-ws/pom.xml -Pskip-apitests package
```

The base WAR is `symphony-ws/target/base/symphony-ws-1.26.0-SNAPSHOT.war`.
It contains no plugin REST resources, entities, core JAR or worker. No EcoTwin
tables, sidecars, model endpoint or example data are required. Native authentication,
calculation, comparison, reports and exports retain their normal behavior.

## EcoTwin distribution

```sh
cd frontend
npm ci --include=optional
npm run test:ecotwin
npm run build:ecotwin
cd ..
mvn -f distributions/symphony-ecotwin/backend/pom.xml -Pecotwin,skip-apitests package
```

The enabled WAR is `symphony-ws/target/ecotwin/symphony-ws-1.26.0-SNAPSHOT.war`.
Separate output directories prevent an earlier enabled build from leaking plugin
classes into a later base build. The distribution reactor builds the standalone
core before composing the adapter sources with native Symphony.

Apply these migrations, in order, using your normal database deployment process:

1. `plugins/ecotwin/migrations/SimulationRuns.sql`
2. `plugins/ecotwin/migrations/SimulationJobs.sql`
3. `plugins/ecotwin/migrations/SimulationBaselines.sql`

Existing installations already using those migrations retain their tables and
records. Source/package relocation requires no data rewrite. Keep native schema
migrations under Symphony ownership. Automatic ORM schema creation is not part of
plugin installation; the disposable verification harness uses it only for its
fresh synthetic database.

Deploy the matching frontend and WAR. Set `ECOTWIN_API_URL` (or Java property
`ecotwin.api.url`) to the trusted Eco-evo endpoint reachable from the server.
Discovery and execution use that one server-owned address; the browser does not
need a separate model proxy or model credentials. Do not accept this address from
an end-user request.

The capabilities endpoint `/symphony-ws/service/extensions/ecotwin/capabilities`
reports installed/reporting/execution/discovery capability. Model discovery is
`/extensions/ecotwin/models`; calculation discovery is
`/extensions/ecotwin/calculations`, relative to the same service prefix. Existing
calculation-scoped input, simulation, job and baseline URLs remain supported.

## Reporting only and upgrades

An installed plugin with execution disabled can read saved artifacts with native
authorization, even when model servers or original TIFFs are unavailable. Preserve
plugin tables and deploy the plugin implementation for that mode. Set `ECOTWIN_EXECUTION_ENABLED=false` or Java property
`ecotwin.execution.enabled=false` to disable execution explicitly, including
when the model URL remains configured. The API guide details endpoint behavior.

Before replacing an executing deployment, stop admitting new work and let the
current request finish or stop the worker through the deployment's execution
configuration. Preserve queued/checkpointed jobs. Restart exactly one enabled
deployment per model server. The EJB lock is local to a deployment; it is not a
distributed lease. Never run old and new enabled workers together during migration.

Existing v1/v2 records, UUIDs, fingerprints and report links retain their meaning.
Rolling application artifacts back does not require rolling data back because the
restructuring preserves schemas and wire formats. Keep a database backup through
your normal deployment process. Removing the plugin application does not delete
saved data; deliberately purging its tables is a separate operation. Outward
foreign keys still clean dependent records when native calculations are deleted.

## Scientific profile installation

The installed profile specification is
[`hav-west-native-v1/profile.json`](../profiles/hav-west-native-v1/profile.json).
It preserves the reviewed baseline, source identities, grid and pressure mapping.
Changing a display name does not make an unrelated baseline compatible.

For prepared HaV example data, generate support sidecars with:

```sh
uv run plugins/ecotwin/tools/prepare-calculation-support.py \
  --data examples/ecotwin/data/hav-symphony-2019
```

Copy the resulting `calculation-domain.tif`, `ecosystems-support.tif`,
`pressures-support.tif` and `calculation-input-support.json` beside the deployed
baseline rasters. The original normalized sources and support policy are described
in the [example import guide](../../../examples/ecotwin/data/hav-symphony-2019/LOCAL-IMPORT.md).
Missing or mismatched support blocks input preparation. Saved reports do not
require those sidecars. Hashes identify export-time files, not archived inputs from
the time a historical calculation was made.

## Local frontend

```sh
SYMPHONY_API_URL=http://127.0.0.1:8080 \
  bash distributions/symphony-ecotwin/start-local.sh
```

The launcher starts the enabled frontend on port 4200. It starts Docker services
only when `SYMPHONY_DB_CONTAINER` and/or `SYMPHONY_APP_CONTAINER` explicitly name
them. `SYMPHONY_FRONTEND_PORT` selects another frontend port. Configure the model
endpoint on the backend, not in this launcher.

## Verification

```sh
python3 distributions/symphony-ecotwin/compatibility/check_architecture.py
python3 distributions/symphony-ecotwin/compatibility/verify_absent.py
python3 distributions/symphony-ecotwin/compatibility/rehearse_upstream.py --build
python3 distributions/symphony-ecotwin/verification/run.py \
  --base-war symphony-ws/target/base/symphony-ws-1.26.0-SNAPSHOT.war \
  --enabled-war symphony-ws/target/ecotwin/symphony-ws-1.26.0-SNAPSHOT.war
```

The absent check copies only native source into a temporary tree. The upstream
rehearsal applies the recorded host patch to pristine supported upstream before
rebuilding. The container harness requires Docker and `uv`; it creates uniquely
named disposable WildFly/PostGIS/model containers and tiny artificial inputs.
It does not read or mount existing databases or local credentials. Its output is
protocol/transaction evidence, not ecological validation. See the verification
directory for `--keep` and explicit cleanup options when reviewing in a browser.

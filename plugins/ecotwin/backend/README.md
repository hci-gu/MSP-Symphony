# EcoTwin backend

The core is an independent Java 17 library. It contains request/result contracts, profile validation, fingerprints, frame schedules and ensemble statistics. It has no Symphony, GeoTools, Jakarta or persistence dependency. Its packaged scientific specification comes from `../../profiles/hav-west-native-v1/profile.json`; shared cross-language fixtures come from `../../contracts/fixtures`.

The adapter is an optional source set, compiled only into the enabled Symphony distribution. This avoids a circular dependency between an adapter artifact and the native WAR:

- `integration/symphony` owns native entities, source files, raster semantics, access checks/locks and saved-baseline creation. Only this package imports native Symphony classes.
- `integration/jakarta` owns HTTP resources, plugin persistence, transactional orchestration and the worker lifecycle.
- `integration/ecoevo` translates immutable `SeedExecution` values into the engine protocol. It does not consume ORM records.

From the repository root:

```sh
mvn -f plugins/ecotwin/backend/core/pom.xml test
mvn -f symphony-ws/pom.xml -Pskip-apitests package
mvn -f distributions/symphony-ecotwin/backend/pom.xml -Pecotwin,skip-apitests package
```

The base WAR is `symphony-ws/target/base/symphony-ws-1.26.0-SNAPSHOT.war`. The enabled WAR is `symphony-ws/target/ecotwin/symphony-ws-1.26.0-SNAPSHOT.war`. Separate output directories prevent stale plugin classes from contaminating a later base build. The base build requires neither the core artifact nor profile resources. Use the distribution reactor for enabled builds so the core does not need a separate local installation.

For an installation using an older JDK location, set `JAVA_HOME` to a valid supported JDK. Main code and tests compile against the Java 17 API using the compiler release setting, including when building with a newer JDK.

## Configuration and capabilities

The enabled distribution retains all existing calculation-scoped input, run, job and baseline URLs and stored JSON/table names. New routes, relative to `/symphony-ws/service`, are:

| Route | Behavior |
| --- | --- |
| `GET /extensions/ecotwin/capabilities` | Authenticated capability metadata, with no model call or raster read. |
| `GET /extensions/ecotwin/models` | Model discovery through the same configured server used for execution. |
| `GET /extensions/ecotwin/calculations` | Owned calculation history across baselines, with the existing calculation-choice JSON shape. |

Capabilities have `{installed,mode,reporting,execution,discovery,profile}`. A base WAR has no such resource. An enabled WAR with an empty model URL is `reporting-only`; saved reports remain available. `ECOTWIN_EXECUTION_ENABLED=false` (or `-Decotwin.execution.enabled=false`) explicitly disables model discovery, previews, submissions, retries and worker processing, while preserving stored jobs. `ECOTWIN_API_URL` (or `-Decotwin.api.url=...`) supplies the one trusted model endpoint. Clients cannot supply arbitrary model URLs. Re-enabling execution resumes existing queued/running checkpoints; drain or pause before deployment and never overlap workers.

The generic native `GET /calculation?all-baselines=true` behavior remains as a backwards-compatible history capability. EcoTwin no longer depends on it. New plugin clients use its own calculation-discovery route.

Install `../migrations/SimulationRuns.sql`, `SimulationJobs.sql` and `SimulationBaselines.sql` in that order before deploying the enabled WAR. Their table names and outward foreign keys are unchanged. Source support sidecars are required to prepare the reviewed scientific profile, but not to read saved reports. Removing the plugin does not delete stored artifacts; destructive database cleanup is a separate operation.

## Transaction and deployment contracts

Native calculation locking/authorization is provided by the Symphony adapter inside the caller's JTA transaction. Plugin persistence coordinates calculation-before-job locking and atomic final result/job publication. The core makes no transaction claims. Model HTTP calls run outside DB transactions; checkpoints use short transactions. The optional `WEB-INF/ejb-jar.xml` declares the core validation exception as an application exception with rollback, keeping Jakarta annotations out of the core while preserving its HTTP 400 mapping.

Run one enabled worker per model server. The EJB singleton lock is process-local, not a distributed lease. Do not deploy the old and new worker simultaneously. Native calculation deletion continues to cascade through existing plugin foreign keys, and late attachment revalidates source ownership and existence.

A package build is not sufficient deployment validation. Test actual WildFly discovery of EJBs, JPA entities, HTTP resources/error mappers and the optional deployment descriptor. The compatibility harness belongs to the enabled distribution. Existing saved v1/v2 runs, baseline links and checkpoints must survive upgrade and rollback without rewriting stored JSON.

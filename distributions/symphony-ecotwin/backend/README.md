# Optional backend composition

From repository root run:

```sh
mvn -f distributions/symphony-ecotwin/backend/pom.xml -Pecotwin,skip-apitests package
```

The reactor builds the independent EcoTwin core and the native WAR with the explicit `ecotwin` source profile. The native application remains buildable without either module. See [backend ownership, configuration and migration contracts](../../../plugins/ecotwin/backend/README.md).

Outputs are isolated under `symphony-ws/target/base` and `symphony-ws/target/ecotwin`; deploy exactly one variant. Preserve context root and data-source/security-domain configuration when switching variants. The enabled WAR requires the plugin migrations, while the base WAR requires no plugin schema, source sidecars or model URL.

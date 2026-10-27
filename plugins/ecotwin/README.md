# EcoTwin for Symphony

EcoTwin is an optional ecosystem simulation plugin. It prepares inputs from saved
Symphony calculations, runs previews or ten-seed ensembles, and renders persisted
results in maps and report appendices. Symphony's default builds omit the plugin.

- [Installation and operation](docs/INSTALLATION.md)
- [Architecture and development](docs/ARCHITECTURE.md)
- [HTTP and saved-data contracts](docs/ECOTWIN-API.md)
- [User workflow and scientific limitations](docs/MARELD-POC.md)
- [Optional data and Poseidon examples](../../examples/ecotwin/README.md)
- [Supported Symphony revision and formats](../../distributions/symphony-ecotwin/compatibility/manifest.json)
- [Full restructuring plan](../../docs/ECOTWIN-PLUGIN-PLAN.md)
- [Implementation review and verification](../../docs/ECOTWIN-PLUGIN-IMPLEMENTATION.md)

The frontend uses the host's Angular and OpenLayers installation. The independent
backend core has no Symphony, JPA, EJB or GeoTools dependency. Native adaptation
lives in plugin-owned integration code, compiled into the enabled WAR. The plugin
uses the existing authenticated session and same-database transactions.

This is an in-process extension, not a sandbox for untrusted code. One enabled
worker may use a model server at a time. The reviewed `hav-west-native-v1` profile
is experimental and accepts only its documented source data and settings.

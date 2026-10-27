# EcoTwin examples and research data

This optional bundle contains the HaV 2019 preparation pipeline, provenance and
historical MARELD exploration, plus the [Poseidon example](poseidon.md). It is not
required to build or run native Symphony, compile EcoTwin, or run its contract tests.

- [Dataset and source provenance](data/hav-symphony-2019/README.md)
- [Regional import](data/hav-symphony-2019/LOCAL-IMPORT.md)
- [Poseidon fixture record](data/poseidon/reference-calculation.json)
- [Current plugin installation](../../plugins/ecotwin/docs/INSTALLATION.md)

Data scripts live in `examples/ecotwin/scripts`. Their `data/` paths are relative
to this bundle, so the original checksums and recorded source paths remain valid.
Downloaded/extracted material remains ignored. Previously recorded JSON evidence
retains its original path strings and IDs; those are historical records, not
portable database identifiers. The source data and ignored local downloads were
preserved when the bundle moved.

```sh
uv run examples/ecotwin/scripts/fetch-hav-symphony-data.py --verify-only
uv run examples/ecotwin/scripts/prepare-hav-symphony-regions.py
python3 examples/ecotwin/scripts/import-hav-symphony-regions.py
```

The importer generates reviewable SQL by default. Applying it is a distinct action
using `--apply`, native schema and local Docker infrastructure. Select container
names through `SYMPHONY_DB_CONTAINER` and `SYMPHONY_APP_CONTAINER`; the historical
local defaults remain for compatibility. This is example setup tooling, not the
general plugin installer. Credentials stay outside the repository.

Profile support installation and live verification scripts are in
`plugins/ecotwin/tools`. The live lifecycle checks create disposable calculations;
ensemble/comparison verification requires already completed fixture runs. Use the
isolated container harness for ordinary integration testing without research data.

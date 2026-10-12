#!/usr/bin/env python3
"""Import prepared HaV regional data into the existing local Docker instance.
Default: generate reviewable SQL only. --apply: backup DB/config, copy rasters,
import in one transaction, merge local settings and restart WildFly.
Existing baselines and scenarios are retained. Re-running skips imported baselines.
"""

import argparse
from hav_io import load_json, sha256
import csv
from datetime import datetime
import json
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/hav-symphony-2019"
STATE = ROOT / ".local/symphony"
DB = "msp-symphony-db"
APP = "msp-symphony-wildfly"


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (float, int)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def j(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def insert(table, values, returning=None):
    return (
        "INSERT INTO symphony."
        + table
        + " ("
        + ",".join(values)
        + ") VALUES ("
        + ",".join(map(q, values.values()))
        + ")"
        + (" RETURNING " + returning if returning else "")
        + ";"
    )


def build_sql():
    spec = load_json(DATA / "regional-import-mapping.json")
    reports = load_json(DATA / "validation/regional-import-preparation.json")
    bounds = load_json(DATA / "derived/boundaries.json")
    sql = [
        "BEGIN;",
        "SET LOCAL search_path = symphony, public;",
        "SELECT pg_advisory_xact_lock(hashtext('hav-regional-local-import'));",
        "DO $hav$ DECLARE b integer; m integer; a integer; t integer; x integer; BEGIN",
    ]
    # Fixtures in existing installations sometimes use explicit IDs without advancing identities.
    tables = {
        "baselineversion": "bver_id",
        "meta_bands": "metaband_id",
        "meta_values": "metaval_id",
        "sensitivitymatrix": "sensm_id",
        "sensitivity": "sens_id",
        "areatype": "atype_id",
        "calculationarea": "carea_id",
        "capolygon": "cap_id",
        "calcareasensmatrix": "casen_id",
        "nationalarea": "narea_id",
    }
    seq = ["DO $seq$ DECLARE s text; n bigint; m bigint; BEGIN"]
    for table, pk in tables.items():
        seq += [
            f"LOCK TABLE symphony.{table} IN SHARE ROW EXCLUSIVE MODE;",
            f"s := pg_get_serial_sequence('symphony.{table}', '{pk}');",
            "EXECUTE format('SELECT last_value FROM %s', s) INTO n;",
            f"SELECT COALESCE(max({pk}), 1) INTO m FROM symphony.{table};",
            "PERFORM setval(s, greatest(n,m), true);",
        ]
    seq.append("END $seq$;")
    sql[3:3] = seq
    type_name = "HaV 2022 planning regions (local reconstruction)"
    sql += [
        f"SELECT atype_id INTO t FROM areatype WHERE atype_name={q(type_name)};",
        "IF t IS NULL THEN "
        + insert(
            "areatype",
            {"atype_name": type_name, "atype_coastalarea": False},
            "atype_id INTO t",
        )
        + " END IF;",
    ]
    for index, region in enumerate(spec["regions"]):
        report = next(r for r in reports if r["baseline"] == region["baseline_name"])
        for f in report["outputs"]:
            p = DATA / f["path"]
            actual = sha256(p)
            if actual != f["sha256"]:
                raise ValueError(f"Prepared raster changed: {p}")
        name = region["baseline_name"]
        bands = region["bands"]
        sql += [
            f"SELECT bver_id INTO b FROM baselineversion WHERE bver_name={q(name)};",
            "IF b IS NULL THEN",
        ]
        container = f"/app/data/symphony/hav2019/{region['slug']}"
        sql.append(
            insert(
                "baselineversion",
                {
                    "bver_name": name,
                    "bver_title": region["region"]
                    + " · HaV 2019 · local reconstruction",
                    "bver_desc": "Published regional layers and May 2019 matrix; 2022 offshore plan boundary. Local reconstruction, not official national baseline. 2050 climate unselected.",
                    "bver_locale": "en",
                    "bver_validfrom": f"2019-05-{index + 1:02}",
                    "bver_ecofilepath": container + "/ecosystems.tif",
                    "bver_presfilepath": container + "/pressures.tif",
                },
                "bver_id INTO b",
            )
        )
        # q() quotes literals, so INSERT ... SELECT handles PL/pgSQL IDs separately.
        for cat, components in bands.items():
            for band in components:
                sql.append(
                    f"INSERT INTO meta_bands (metaband_bver_id,metaband_category,metaband_number,metaband_default_selected) VALUES (b,{q(cat)},{band['band_number']},{q(band['default_selected'])}) RETURNING metaband_id INTO x;"
                )
                meta = {
                    "title": band["title"],
                    "symphonytheme": band["theme"],
                    "methodsummary": f"Published normalized regional {cat.lower()} layer. See Symphony Metadata March 2019, PDF page {band['metadata_pdf_page']}, for the component's methods and original providers.",
                    "limitationsforsymphony": "Local reconstruction using 2019 layers and a 2022 offshore planning boundary. Missing/outside-domain pixels are zero. Not an official calibrated HaV baseline.",
                    "valuerange": "0–100 intensity (published 0–1 values multiplied by 100 and rounded). Zero may also represent no observation or NoData; consult the source metadata.",
                    "dataprocessing": "250 m EPSG:3035. Aligned grid cropped to region; offshore plan polygon mask; UInt8 tiled lossless GeoTIFF. "
                    + (
                        "2050 projection, unselected by default."
                        if not band["default_selected"]
                        else ""
                    ),
                    "datasources": f"Havs- och vattenmyndigheten / SGU and original providers;{Path(band['source']).name};Symphony Metadata March 2019, PDF page {band['metadata_pdf_page']}",
                    "mapAcknowledgement": "Havs- och vattenmyndigheten / SGU; original providers and conditions: Symphony Metadata March 2019.",
                }
                assert all(len(v) <= 255 for v in meta.values())
                for field, value in meta.items():
                    sql.append(
                        f"INSERT INTO meta_values (metaval_band_id,metaval_language,metaval_field,metaval_value) VALUES (x,'en',{q(field)},{q(value)});"
                    )
        sql.append(
            f"INSERT INTO sensitivitymatrix (sensm_name,sensm_bver_id,sensm_owner) VALUES ({q('Published May 2019 – ' + region['region'])},b,NULL) RETURNING sensm_id INTO m;"
        )
        rows = list(csv.reader((DATA / region["matrix"]).open(), delimiter=";"))
        assert rows[0][1:] == [v["title"] for v in bands["Ecosystem"]]
        assert [r[0] for r in rows[1:]] == [v["title"] for v in bands["Pressure"]]
        values = ",".join(
            f"({pi},{ei},{float(value)})"
            for pi, row in enumerate(rows[1:])
            for ei, value in enumerate(row[1:])
        )
        sql.append(
            "INSERT INTO sensitivity (sens_pres_band_id,sens_eco_band_id,sens_sensm_id,sens_value) SELECT p.metaband_id,e.metaband_id,m,v.k FROM (VALUES "
            + values
            + ") AS v(p,e,k) JOIN meta_bands p ON p.metaband_bver_id=b AND p.metaband_category='Pressure' AND p.metaband_number=v.p JOIN meta_bands e ON e.metaband_bver_id=b AND e.metaband_category='Ecosystem' AND e.metaband_number=v.e;"
        )
        sql.append(
            f"INSERT INTO calculationarea (carea_name,carea_default,carea_maxvalue,carea_default_sensm_id,carea_atype_id) VALUES ({q(region['region'] + ' (2022 offshore extent / 2019 data)')},true,{report['local_calibration']['percentile95']},m,t) RETURNING carea_id INTO a;"
        )
        polygon = next(
            a["polygon"] for a in bounds["regions"] if a["name"] == region["region"]
        )
        sql.append(
            f"INSERT INTO capolygon (cap_carea_id,cap_polygon,pg_polygon) VALUES (a,{q(j(polygon))},ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON({q(j(polygon))}),4326)));"
        )
        sql.append(
            "INSERT INTO calcareasensmatrix (casen_carea_id,casen_sensm_id,casen_comment) VALUES (a,m,'Published regional matrix; uniform regional assignment for local exploration.');"
        )
        sql += [
            "ELSE",
            f"IF (SELECT count(*) FROM meta_bands WHERE metaband_bver_id=b) <> {sum(map(len, bands.values()))} THEN RAISE EXCEPTION 'Existing imported baseline has unexpected band count'; END IF;",
            "END IF;",
        ]
    sql.append("END $hav$;")
    types = {
        "HAV2022PLAN": ("Planning regions (2022)", "regions"),
        "HAV2022SEA": ("Sea areas (2022)", "seas"),
        "HAV2022AREA": ("Named planning areas (2022)", "areas"),
    }

    def area_json(a):
        return {k: a[k] for k in ["name", "polygon", "areaKm2"]} | {
            "searchdata": a["name"] + " " + j(a["properties"])
        }

    for code, (label, key) in types.items():
        obj = {
            "type": code,
            "en": label,
            "sv": label,
            "groups": [
                {
                    "en": "Havs- och vattenmyndigheten",
                    "sv": "Havs- och vattenmyndigheten",
                    "areas": [area_json(a) for a in bounds[key]],
                }
            ],
        }
        sql.append(
            f"INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas) SELECT 'SWE',{q(code)},{q(j(obj))} WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type={q(code)});"
        )
    union = unite_boundary(bounds)
    sql.append(
        f"INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas) SELECT 'SWE','BOUNDARY',{q(j({'areas': [{'name': 'Swedish offshore planning areas (2022)', 'polygon': union}]}))} WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type='BOUNDARY');"
    )
    sql.append(
        "INSERT INTO nationalarea (narea_countryiso3,narea_type,narea_areas,narea_types) SELECT 'SWE','TYPES','{}','[]' WHERE NOT EXISTS (SELECT 1 FROM nationalarea WHERE narea_countryiso3='SWE' AND narea_type='TYPES');"
    )
    for code in types:
        sql.append(
            f"UPDATE nationalarea SET narea_types=(narea_types::jsonb || {q(j([code]))}::jsonb)::text WHERE narea_countryiso3='SWE' AND narea_type='TYPES' AND NOT narea_types::jsonb @> {q(j([code]))}::jsonb;"
        )
    sql.append(
        "INSERT INTO usersettings (\"user\",settings) SELECT 'hav-local',jsonb_build_object('activeBaselineId',bver_id) FROM baselineversion WHERE bver_name='HAV_2019_WEST_LOCAL' ON CONFLICT (\"user\") DO UPDATE SET settings=usersettings.settings || EXCLUDED.settings;"
    )
    sql.append("COMMIT;")
    return "\n".join(sql) + "\n"


def unite_boundary(bounds):
    # Region polygons do not overlap; concatenate their MultiPolygon coordinates.
    return {
        "type": "MultiPolygon",
        "coordinates": [
            p for a in bounds["regions"] for p in a["polygon"]["coordinates"]
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    sql = build_sql()
    (STATE / "import-hav.sql").write_text(sql)
    if not args.apply:
        print("Prepared SQL:", STATE / "import-hav.sql")
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    with (STATE / f"before-hav-{stamp}.dump").open("wb") as f:
        run(
            [
                "docker",
                "exec",
                DB,
                "pg_dump",
                "-U",
                "symphony",
                "-d",
                "symphony",
                "-Fc",
            ],
            stdout=f,
        )
    config = STATE / f"before-hav-{stamp}.properties"
    run(
        [
            "docker",
            "cp",
            APP + ":/app/config/symphony/symphony-global.properties",
            str(config),
        ]
    )
    if any(
        line.strip().startswith(
            ("data.localdev.ecosystems=", "data.localdev.pressures=")
        )
        for line in config.read_text().splitlines()
    ):
        raise ValueError(
            "Global raster override present: remove it before activating regional baselines."
        )
    credentials = STATE / "hav-local-credentials.json"
    if not credentials.exists():
        credentials.write_text(
            json.dumps(
                {"username": "hav-local", "password": secrets.token_urlsafe(18)},
                indent=2,
            )
            + "\n"
        )
    credentials.chmod(0o600)
    account = json.loads(credentials.read_text())
    run(
        [
            "docker",
            "exec",
            APP,
            "/opt/jboss/wildfly/bin/add-user.sh",
            "-a",
            "-u",
            account["username"],
            "-p",
            account["password"],
            "-g",
            "GRP_SYMPHONY,GRP_SYMPHONY_ADMIN",
            "--silent",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for backup in STATE.glob("*.dump"):
        backup.chmod(0o600)
    run(
        [
            "docker",
            "exec",
            APP,
            "mkdir",
            "-p",
            "/app/data/symphony/hav2019",
            "/app/data/symphony/summary-models",
            "/app/data/symphony/cache",
        ]
    )
    run(
        [
            "docker",
            "cp",
            str(DATA / "derived") + "/.",
            APP + ":/app/data/symphony/hav2019/",
        ]
    )
    for folder in (DATA / "summary-models").glob("hav_2019_*_local"):
        run(["docker", "cp", str(folder), APP + ":/app/data/symphony/summary-models/"])
    run(
        [
            "docker",
            "exec",
            "-i",
            DB,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "symphony",
            "-d",
            "symphony",
        ],
        input=sql,
        text=True,
    )
    # Preserve unrelated settings and replace only the country/paths needed here.
    replacements = {
        "areas.countrycode": "SWE",
        "data.cache_dir": "/app/data/symphony/cache",
        "data.summary_models_dir": "/app/data/symphony/summary-models",
    }
    lines = [
        line
        for line in config.read_text().splitlines()
        if line.partition("=")[0].strip() not in replacements
    ]
    merged = STATE / "hav-global.properties"
    merged.write_text(
        "\n".join(
            lines
            + ["# HaV local regional import"]
            + [k + "=" + v for k, v in replacements.items()]
        )
        + "\n"
    )
    run(
        [
            "docker",
            "cp",
            str(merged),
            APP + ":/app/config/symphony/symphony-global.properties",
        ]
    )
    run(["docker", "restart", APP])
    print(
        "Imported all prepared regional baselines; DB and configuration backups:", STATE
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Restore or verify the public HaV Symphony data bundle; never alter a database."""

import argparse
from hav_io import sha256
import json
import shutil
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "hav-symphony-2019"


def contained_path(relative):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError(f"Path escapes the data directory: {relative}")
    return path


def member_name(member):
    name = member.filename
    # Some source ZIPs contain UTF-8 filenames without setting ZIP's UTF-8 flag.
    if not member.flag_bits & 0x800:
        try:
            name = name.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return unicodedata.normalize("NFC", name)


def verify(path, expected):
    if not path.is_file() or sha256(path) != expected:
        raise ValueError(f"Missing or changed file: {path}")


def restore(source):
    path = contained_path(source["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        print(f"Downloading {source['title']}", flush=True)
        temporary = path.with_name(path.name + ".part")
        try:
            with urllib.request.urlopen(source["url"], timeout=120) as response:
                with temporary.open("wb") as output:
                    shutil.copyfileobj(response, output)
            verify(temporary, source["sha256"])
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    verify(path, source["sha256"])
    if "extract_to" not in source:
        return
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            name = member_name(member)
            if member.is_dir() or any(
                part.startswith(".") or part == "__MACOSX" for part in Path(name).parts
            ):
                continue
            target = contained_path(str(Path(source["extract_to"]) / name))
            if target.exists():
                # The final checksum pass verifies existing extracted files.
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".part")
            try:
                with archive.open(member) as stream, temporary.open("wb") as output:
                    shutil.copyfileobj(stream, output)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)


def configure():
    def property_path(path):
        # Java Properties.load(InputStream) needs non-ASCII characters as \u escapes.
        return json.dumps(str(path).replace("\\", "/"), ensure_ascii=True)[1:-1]

    for directory in ("cache", "summary-models"):
        (ROOT / directory).mkdir(exist_ok=True)
    paths = {
        "bver_ecofilepath": str(ROOT / "rasters/Ekokomponenter-cm-prod.tif"),
        "bver_presfilepath": str(ROOT / "rasters/Belastningar-cm-prod.tif"),
    }
    (ROOT / "runtime-paths.local.json").write_text(
        json.dumps(paths, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    properties = (
        "# Optional local configuration; not activated automatically.\n"
        "# Raster paths normally belong to each database baselineversion record.\n"
        "# Uncomment BOTH localdev overrides only for a matching 35/69-band baseline.\n"
        "# Overrides affect EVERY baseline served by this process. See README.md.\n"
        "areas.countrycode=SWE\n"
        "data.source.crs=EPSG:3035\n"
        f"data.cache_dir={property_path(ROOT / 'cache')}\n"
        f"data.summary_models_dir={property_path(ROOT / 'summary-models')}\n"
        f"#data.localdev.ecosystems={property_path(Path(paths['bver_ecofilepath']))}\n"
        f"#data.localdev.pressures={property_path(Path(paths['bver_presfilepath']))}\n"
    )
    config = ROOT / "symphony-global.local.properties"
    if not config.exists():
        config.write_text(properties, encoding="ascii")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify every payload checksum without downloading or writing files",
    )
    args = parser.parse_args()
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if not args.verify_only:
        for source in manifest["downloads"]:
            restore(source)
    count = 0
    for line in (ROOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        expected, relative = line.split("  ", 1)
        verify(contained_path(relative), expected)
        count += 1
    if not args.verify_only:
        configure()
    print(f"Verified {count} original and extracted files. No database changes made.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        sys.exit(str(error))

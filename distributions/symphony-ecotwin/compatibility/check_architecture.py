#!/usr/bin/env python3
"""Check dependency direction and optionally inspect a base distribution's artifacts.

No npm, Maven, model service, database or research dataset is needed for source checks.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]


def check(root: Path, base_war: Path | None = None, base_frontend: Path | None = None):
    errors = []
    native_imports = {}
    plugin = root / 'plugins/ecotwin'
    host_names = re.compile(r'(?i)mareld|ecotwin|simulationAppendixState|simulationComparisonState|simBaselineRun|simScenarioRun|simBase\b')
    for folder in ['frontend/src/app', 'frontend/src/environments', 'symphony-ws/src/main/java']:
        for path in (root / folder).rglob('*'):
            if path.suffix not in {'.ts', '.html', '.scss', '.java'}:
                continue
            text = path.read_text()
            if host_names.search(text):
                errors.append(f'{path.relative_to(root)}: native implementation contains plugin-specific vocabulary')
    for path in (plugin / 'frontend').rglob('*.ts'):
        imports = re.findall(r'(?:from\s+|import\s*\(?|require\s*\()[\'\"]([^\'\"]+)[\'\"]', path.read_text())
        native = [i for i in imports if i.startswith(('@data/', '@shared/', '@src/')) or '/frontend/src/' in i]
        if native:
            rel = str(path.relative_to(root))
            native_imports[rel] = sorted(set(native))
            if '/integration/symphony/' not in rel:
                errors.append(f'{rel}: native imports outside Symphony adapter: {native}')
    for path in (plugin / 'backend').rglob('*.java'):
        text = path.read_text()
        # Include static imports and fully qualified uses; both create the same dependency.
        native = re.findall(r'\bse\.havochvatten\.symphony(?:\.[A-Za-z_$][\w$]*)+(?:\.\*)?', text)
        rel = str(path.relative_to(root))
        if native:
            native_imports[rel] = sorted(set(native))
            if '/integration/symphony/' not in rel:
                errors.append(f'{rel}: native imports outside Symphony adapter: {native}')
        if '/core/' in rel and re.search(r'\b(?:jakarta\.|javax\.persistence\.|org\.geotools\.|se\.havochvatten\.symphony\.)', text):
            errors.append(f'{rel}: core depends on host/container/geospatial implementation')
    allowed_file = root / 'distributions/symphony-ecotwin/compatibility/adapter-imports.json'
    if allowed_file.exists():
        allowed = json.loads(allowed_file.read_text())
        for path, imports in native_imports.items():
            unexpected = sorted(set(imports) - set(allowed.get(path, [])))
            if unexpected:
                errors.append(f'{path}: unreviewed native dependencies: {unexpected}')
    elif plugin.exists():
        errors.append('Missing reviewed adapter import manifest: adapter-imports.json')
    for path in [root / 'frontend/proxy.conf.js', root / 'frontend/src/environments/environment.ts', root / 'frontend/src/environments/environment.prod.ts']:
        if path.exists() and host_names.search(path.read_text()):
            errors.append(f'{path.relative_to(root)}: base configuration imports/knows plugin implementation')
    if base_war:
        with zipfile.ZipFile(base_war) as war:
            leaked = [name for name in war.namelist() if re.search(r'(?i)(?:org/ecotwin/|ecotwin.*\.jar|/Simulation(?:Job|Run|Artifact|Baseline))', name)]
            if leaked:
                errors.append(f'Base WAR includes plugin classes/artifacts: {leaked[:10]}')
    if base_frontend:
        needles = ['ecotwin-run-v', 'symphony-simulation-reports', 'app-mareld-panel', 'app-ecotwin-panel', 'hav-west-native-v1']
        for path in base_frontend.rglob('*.js'):
            found = [needle for needle in needles if needle in path.read_text()]
            if found:
                errors.append(f'Base bundle {path.name} includes plugin implementation: {found}')
    return errors, native_imports


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--base-war', type=Path)
    parser.add_argument('--base-frontend', type=Path)
    parser.add_argument('--record-imports', action='store_true', help='Review operation: record exact adapter imports after source checks')
    args = parser.parse_args()
    errors, native_imports = check(args.root.resolve(), args.base_war, args.base_frontend)
    if args.record_imports:
        structural_errors = [e for e in errors if 'unreviewed native dependencies' not in e and 'Missing reviewed adapter import manifest' not in e]
        if not structural_errors:
            target = args.root / 'distributions/symphony-ecotwin/compatibility/adapter-imports.json'
            target.write_text(json.dumps(native_imports, indent=2, sort_keys=True) + '\n')
            errors = []
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        sys.exit(1)
    print(f'Architecture checks passed; {len(native_imports)} adapter files use reviewed native dependencies.')

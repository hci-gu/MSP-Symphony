#!/usr/bin/env python3
"""Build native Symphony in a temporary tree containing no plugin or example source.

Install frontend dependencies first. Existing node_modules and native test data are
reused; generated outputs stay in the temporary tree. No user files are removed.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-only', action='store_true')
    parser.add_argument('--backend-only', action='store_true')
    parser.add_argument('--evidence', type=Path, default=ROOT / '.local/plugin-verification/absent.json')
    args = parser.parse_args()
    if args.frontend_only and args.backend_only:
        parser.error('Choose at most one build restriction.')
    spec = importlib.util.spec_from_file_location('architecture', Path(__file__).with_name('check_architecture.py'))
    architecture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(architecture)
    results = {}
    with tempfile.TemporaryDirectory(prefix='symphony-without-plugin-') as folder:
        tree = Path(folder)
        for name in ['frontend', 'symphony-ws']:
            shutil.copytree(ROOT / name, tree / name,
                            ignore=shutil.ignore_patterns('node_modules', 'target', 'dist', 'out-tsc', '.angular', 'coverage', '.git'),
                            symlinks=True)
        assert not (tree / 'plugins').exists()
        assert not (tree / 'examples').exists()
        if not args.backend_only:
            modules = ROOT / 'frontend/node_modules'
            if not modules.exists():
                parser.error('Run npm ci in frontend before this verification.')
            (tree / 'frontend/node_modules').symlink_to(modules, target_is_directory=True)
            subprocess.run(['npm', 'run', 'build:base'], cwd=tree / 'frontend', check=True)
            subprocess.run(['npm', 'run', 'test:base'], cwd=tree / 'frontend', check=True)
            errors, _ = architecture.check(tree, base_frontend=tree / 'frontend/dist')
            if errors:
                raise RuntimeError('\n'.join(errors))
            results['frontend'] = 'Build, tests and bundle scan passed with plugin and examples absent.'
        if not args.frontend_only:
            subprocess.run(['mvn', '-B', '-Pskip-apitests', 'package'], cwd=tree / 'symphony-ws', check=True)
            wars = list((tree / 'symphony-ws/target').rglob('*.war'))
            if len(wars) != 1:
                raise RuntimeError(f'Expected one base WAR, found {wars}')
            errors, _ = architecture.check(tree, base_war=wars[0])
            if errors:
                raise RuntimeError('\n'.join(errors))
            results['backend'] = 'Package, tests and WAR scan passed with plugin and examples absent.'
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps({'passed': True, 'checks': results}, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Apply the reviewed host patch to pristine upstream and optionally build it.

The default is a non-mutating patch applicability/recomposition check. --build
also runs base and enabled packages/tests in the disposable tree. --revision
tests another upstream commit without changing the supported revision manifest.
"""
import argparse
import difflib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def native_paths():
    values = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend', 'symphony-ws'], cwd=ROOT, text=True)
    return sorted(set(values.splitlines()))


def native_changes(base):
    """Include tracked deletions; exclude gitlinks rather than silently restoring them."""
    entries = subprocess.check_output(['git', 'ls-tree', '-r', base, '--', 'frontend', 'symphony-ws'], cwd=ROOT, text=True)
    gitlinks = {line.split('\t', 1)[1] for line in entries.splitlines() if line.startswith('160000 ')}
    changes = set()
    for name in native_paths():
        if name in gitlinks:
            continue
        path = ROOT / name
        previous = subprocess.run(['git', 'show', f'{base}:{name}'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if path.is_file():
            if previous.returncode or previous.stdout != path.read_bytes():
                changes.add(name)
        elif previous.returncode == 0:
            changes.add(name)
    return changes


def record_patch(base):
    patch = []
    manifest = []
    for name in native_paths():
        path = ROOT / name
        previous = subprocess.run(['git', 'show', f'{base}:{name}'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        before = previous.stdout if previous.returncode == 0 else b''
        after = path.read_bytes() if path.is_file() else b''
        if before == after:
            continue
        # Native test-data submodule and generated files are never patch content.
        if path.is_dir() or b'\x00' in before or b'\x00' in after:
            continue
        if not after and previous.returncode:
            continue
        old_name = 'a/' + name if previous.returncode == 0 else '/dev/null'
        new_name = 'b/' + name if path.is_file() else '/dev/null'
        diff = list(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True), fromfile=old_name, tofile=new_name))
        if diff:
            patch.append(f'diff --git a/{name} b/{name}\n')
            if previous.returncode:
                patch.append('new file mode 100644\n')
            elif not path.is_file():
                patch.append('deleted file mode 100644\n')
            for line in diff:
                patch.append(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n')
            manifest.append(name)
    (HERE / 'host.patch').write_text(''.join(patch))
    (HERE / 'host-files.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Recorded {len(manifest)} native files in the reviewable host patch.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', help='Upstream commit available in local Git object database')
    parser.add_argument('--record-patch', action='store_true', help='Explicit review step: refresh host patch from the working tree')
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--test-data', type=Path, default=ROOT / 'symphony-ws/src/test/resources',
                        help='Local native test-data Git checkout containing the upstream gitlink revision')
    parser.add_argument('--evidence', type=Path, default=ROOT / '.local/plugin-verification/upstream.json')
    args = parser.parse_args()
    supported = json.loads((HERE / 'manifest.json').read_text())['supportedSymphony']['commit']
    if args.record_patch:
        record_patch(supported)
    revision = subprocess.check_output(['git', 'rev-parse', '--verify', (args.revision or supported) + '^{commit}'], cwd=ROOT, text=True).strip()
    owners = json.loads((HERE / 'host-changes.json').read_text())
    recorded_paths = set(json.loads((HERE / 'host-files.json').read_text()))
    if set(owners) != recorded_paths or any(not all(record.get(key) for key in ['owner', 'reason', 'category']) for record in owners.values()):
        raise RuntimeError('Every recorded native patch path needs an explicit owner, category and reason in host-changes.json.')
    with tempfile.TemporaryDirectory(prefix='symphony-upstream-') as directory:
        tree = Path(directory)
        archive = subprocess.check_output(['git', 'archive', revision], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(tree, filter='data')
        subprocess.run(['git', 'apply', '--check', str(HERE / 'host.patch')], cwd=tree, check=True)
        subprocess.run(['git', 'apply', str(HERE / 'host.patch')], cwd=tree, check=True)
        if revision == supported:
            # Detect drift: updating native files without refreshing the reviewed patch fails.
            for name in json.loads((HERE / 'host-files.json').read_text()):
                actual, expected = tree / name, ROOT / name
                if actual.exists() != expected.exists() or (actual.is_file() and actual.read_bytes() != expected.read_bytes()):
                    raise RuntimeError(f'Host patch is stale for {name}; review and record it explicitly.')
            current_changes = native_changes(supported)
            unexpected = current_changes - set(json.loads((HERE / 'host-files.json').read_text()))
            if unexpected:
                raise RuntimeError(f'Native integration changes are not recorded: {sorted(unexpected)}')
        if args.build:
            for name in ['plugins/ecotwin', 'distributions/symphony-ecotwin']:
                shutil.copytree(ROOT / name, tree / name, ignore=shutil.ignore_patterns('node_modules', 'target', '__pycache__'))
            (tree / 'frontend/node_modules').symlink_to(ROOT / 'frontend/node_modules', target_is_directory=True)
            target = tree / 'symphony-ws/src/test/resources'
            entry = subprocess.check_output(['git', 'ls-tree', revision, '--', 'symphony-ws/src/test/resources'], cwd=ROOT, text=True).strip()
            if not entry.startswith('160000 commit '):
                raise RuntimeError('Requested upstream has no expected native test-data gitlink; review the adapter fixture setup.')
            fixture_revision = entry.split()[2]
            available = subprocess.run(['git', 'cat-file', '-e', fixture_revision + '^{commit}'], cwd=args.test_data,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if available.returncode:
                raise RuntimeError(f'Native test-data checkout does not contain upstream fixture {fixture_revision}. '
                                   'Fetch that revision into a test-data checkout and pass --test-data; do not substitute current fixtures.')
            fixture_archive = subprocess.check_output(['git', 'archive', fixture_revision], cwd=args.test_data)
            target.mkdir(parents=True, exist_ok=True)
            with tarfile.open(fileobj=io.BytesIO(fixture_archive)) as source:
                source.extractall(target, filter='data')
            for command, folder in [
                (['npm', 'run', 'build:base'], 'frontend'),
                (['npm', 'run', 'test:base'], 'frontend'),
                (['npm', 'run', 'build:ecotwin'], 'frontend'),
                (['npm', 'run', 'test:ecotwin'], 'frontend'),
                (['mvn', '-B', '-Pskip-apitests', 'package'], 'symphony-ws'),
                (['mvn', '-B', '-Pecotwin,skip-apitests', 'package'], 'distributions/symphony-ecotwin/backend'),
            ]:
                subprocess.run(command, cwd=tree / folder, check=True)
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps({'passed': True, 'upstreamRevision': revision, 'supportedRevision': supported,
                                            'patchApplied': True, 'buildsAndTestsRun': args.build}, indent=2) + '\n')
        print(f'Upstream {revision[:12]} recomposed successfully' + ('; base/enabled checks passed.' if args.build else '.'))


if __name__ == '__main__':
    main()

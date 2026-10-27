"""The upstream gate must test the working tree, including native deletions."""
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('upstream', Path(__file__).with_name('rehearse_upstream.py'))
upstream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upstream)


class UpstreamGateTest(unittest.TestCase):
    def test_deleted_native_file_is_a_review_required_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'frontend/src/native.ts'
            source.parent.mkdir(parents=True)
            source.write_text('export const native = true;\n')
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL, text=True).strip()
            git('init')
            git('add', '.')
            git('-c', 'user.name=Compatibility test', '-c', 'user.email=compatibility@example.invalid', 'commit', '-m', 'Native fixture')
            base = git('rev-parse', 'HEAD')
            original, original_here = upstream.ROOT, upstream.HERE
            upstream.ROOT = root
            upstream.HERE = root / 'compatibility'
            upstream.HERE.mkdir()
            try:
                self.assertEqual(set(), upstream.native_changes(base))
                source.unlink()
                self.assertEqual({'frontend/src/native.ts'}, upstream.native_changes(base))
                new = root / 'frontend/src/new.ts'
                new.write_text('export const additional = true;\n')
                self.assertEqual({'frontend/src/native.ts', 'frontend/src/new.ts'}, upstream.native_changes(base))
                upstream.record_patch(base)
                with tempfile.TemporaryDirectory() as pristine:
                    archive = subprocess.check_output(['git', 'archive', base], cwd=root)
                    with tarfile.open(fileobj=io.BytesIO(archive)) as source_archive:
                        source_archive.extractall(pristine, filter='data')
                    subprocess.run(['git', 'apply', str(upstream.HERE / 'host.patch')], cwd=pristine, check=True)
                    self.assertFalse((Path(pristine) / 'frontend/src/native.ts').exists())
                    self.assertEqual(new.read_text(), (Path(pristine) / 'frontend/src/new.ts').read_text())
            finally:
                upstream.ROOT = original
                upstream.HERE = original_here


if __name__ == '__main__':
    unittest.main()

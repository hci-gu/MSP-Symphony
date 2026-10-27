"""Regression checks for the dependency rules used by the upstream update gate."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('architecture', Path(__file__).with_name('check_architecture.py'))
architecture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(architecture)


class ArchitectureGateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def test_host_cannot_reintroduce_concrete_plugin_knowledge(self):
        self.write('frontend/src/app/report/report.ts', "import { SimulationWorkspace } from '@ecotwin/workspace';")
        self.assertTrue(any('plugin-specific vocabulary' in e for e in architecture.check(self.root)[0]))

    def test_native_state_dependency_must_stay_in_reviewed_adapter(self):
        self.write('plugins/ecotwin/frontend/workspace/session.ts', "import { UserActions } from '@data/user';")
        self.assertTrue(any('outside Symphony adapter' in e for e in architecture.check(self.root)[0]))

    def test_an_upstream_adapter_change_requires_an_explicit_import_review(self):
        name = 'plugins/ecotwin/frontend/integration/symphony/calculations.ts'
        self.write(name, "import { CalculationSelectors } from '@data/calculation';")
        self.write('distributions/symphony-ecotwin/compatibility/adapter-imports.json', '{}')
        self.assertTrue(any('unreviewed native dependencies' in e for e in architecture.check(self.root)[0]))
        self.write('distributions/symphony-ecotwin/compatibility/adapter-imports.json', json.dumps({name: ['@data/calculation']}))
        self.assertEqual([], architecture.check(self.root)[0])

    def test_core_cannot_acquire_persistence_dependency(self):
        self.write('plugins/ecotwin/backend/core/src/main/java/Core.java', 'import jakarta.persistence.EntityManager;')
        self.assertTrue(any('core depends' in e for e in architecture.check(self.root)[0]))

    def test_static_and_fully_qualified_native_references_are_dependencies(self):
        self.write('plugins/ecotwin/backend/core/src/main/java/Core.java',
                   'import static se.havochvatten.symphony.service.CalcService.run;\n'
                   'class Core { jakarta.persistence.EntityManager em; }')
        errors = architecture.check(self.root)[0]
        self.assertTrue(any('outside Symphony adapter' in e for e in errors))
        self.assertTrue(any('core depends' in e for e in errors))

    def test_deleting_import_manifest_does_not_disable_the_gate(self):
        self.write('plugins/ecotwin/frontend/integration/symphony/native.ts', "import { Store } from '@data/store';")
        self.assertTrue(any('Missing reviewed adapter import manifest' in e for e in architecture.check(self.root)[0]))

    def test_base_artifact_gate_rejects_plugin_leakage(self):
        war = self.root / 'base.war'
        with zipfile.ZipFile(war, 'w') as archive:
            archive.writestr('WEB-INF/lib/ecotwin-core.jar', b'')
        self.assertTrue(any('Base WAR includes' in e for e in architecture.check(self.root, base_war=war)[0]))
        self.write('dist/main.js', 'const version="ecotwin-run-v2";')
        self.assertTrue(any('Base bundle' in e for e in architecture.check(self.root, base_frontend=self.root / 'dist')[0]))


if __name__ == '__main__':
    unittest.main()

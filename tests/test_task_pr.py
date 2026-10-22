import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('task_pr', Path(__file__).parents[1] / 'scripts/task_pr.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CompletedPublicSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.file = self.root / 'core/lib/example.mjs'
        self.file.parent.mkdir(parents=True)
        self.file.write_text('export const value = "fixture";\n')
        self.row = {'path': 'core/lib/example.mjs', 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}

    def test_fixed_source_bytes_and_explicit_topic(self):
        manifest = {'schema': 'completed-public-topic/v1', 'topic': 'fixture-fix', 'files': [self.row]}
        self.assertEqual(m.validate_manifest(self.root, manifest)[0][1], self.file.read_bytes())
        self.file.write_text('concurrent change')
        with self.assertRaisesRegex(ValueError, 'SHA_CHANGED'):
            m.validate_manifest(self.root, manifest)

    def test_private_paths_and_config_never_enter_export(self):
        for path in ['config/accounts.json', '../outside.mjs', '.env', 'data/state.json',
                     'output/result.json', 'lib/credentials.mjs', '.github/workflows/deploy.yml']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                m.screened_source(self.root, {'path': path, 'sha256': '0' * 64})
        self.file.write_text('const location = "/' + 'Users' + '/fixture/private";')
        row = {**self.row, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}
        with self.assertRaisesRegex(ValueError, 'PRIVATE_OR_NONPORTABLE'):
            m.screened_source(self.root, row)

    def test_empty_duplicate_and_invalid_topic_rejected(self):
        for topic, files in [('fixture', []), ('../fixture', [self.row]), ('fixture', [self.row, self.row])]:
            with self.subTest(topic=topic, count=len(files)), self.assertRaises(ValueError):
                m.validate_manifest(self.root, {'schema': 'completed-public-topic/v1', 'topic': topic, 'files': files})


if __name__ == '__main__':
    unittest.main()

"""Synthetic Git/runtime fixtures only. No browser, platform, publishing or network."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('managed_core', Path(__file__).parents[1] / 'scripts/reviewed_core_update.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ManagedCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.runtime = self.root / 'runtime'
        self.repo.mkdir()
        self.runtime.mkdir()
        self.git('init', '-q')
        self.files = []
        for name in ['a', 'b']:
            source = self.repo / ('core/lib/' + name + '.mjs')
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('export const value = "new";\n')
            target = self.runtime / ('lib/' + name + '.mjs')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('export const value = "old";\n')
            self.files.append({'source': source.relative_to(self.repo).as_posix(),
                               'target': str(target), 'expected_sha256': m.digest(target.read_bytes())})
        self.git('add', 'core')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.merge = {'repository': 'example/publisher', 'pr': 1, 'head': self.sha, 'merge': self.sha}
        self.private = self.runtime / 'private.json'
        self.private.write_text('{"fixture":"keep"}')
        self.bindings = {'schema': 'publisher-local-core-bindings/v1', 'repo': 'example/publisher',
                         'runtime_root': str(self.runtime), 'files': self.files,
                         'protected': [{'path': str(self.private), 'sha256': m.digest(self.private.read_bytes())}]}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def plan(self):
        return m.build_plan(self.repo, self.bindings, self.merge, self.root / 'backups')

    def test_update_backups_readback_and_original_refs(self):
        before_head = self.git('rev-parse', 'HEAD')
        before_remote = self.git('remote', '-v')
        plan = self.plan()
        self.assertIn('old', Path(self.files[0]['target']).read_text())
        result = m.apply_plan(plan, verify=lambda *args: self.merge)
        self.assertEqual(result['updated'], 2)
        self.assertFalse(result['publicationPerformed'])
        for row in self.files:
            self.assertIn('new', Path(row['target']).read_text())
            self.assertIn('old', (Path(result['backup']) / row['source']).read_text())
        self.assertEqual(self.private.read_text(), '{"fixture":"keep"}')
        self.assertEqual(before_head, self.git('rev-parse', 'HEAD'))
        self.assertEqual(before_remote, self.git('remote', '-v'))

    def test_runtime_drift_fails_before_backup_or_writes(self):
        plan = self.plan()
        Path(self.files[1]['target']).write_text('concurrent local edit')
        with self.assertRaisesRegex(ValueError, 'RUNTIME_CHANGED'):
            m.apply_plan(plan, verify=lambda *args: self.merge)
        self.assertIn('old', Path(self.files[0]['target']).read_text())
        self.assertFalse((self.root / 'backups').exists())

    def test_public_config_private_config_and_symlink_are_not_update_inputs(self):
        for source in ['config/accounts.json', 'core/lib/config.mjs', 'core/lib/school-account.mjs', '../private.json']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                m.source_bytes(self.repo, self.sha, source)
        original = Path(self.files[0]['target'])
        original.unlink()
        try:
            original.symlink_to(self.private)
        except OSError:
            self.skipTest('symlink unavailable on this platform')
        with self.assertRaisesRegex(ValueError, 'SYMLINK'):
            self.plan()

    def test_duplicate_outside_layout_and_protected_targets_rejected(self):
        original = copy.deepcopy(self.bindings)
        for fault in ['duplicate', 'outside', 'layout', 'protected']:
            self.bindings = copy.deepcopy(original)
            if fault == 'duplicate':
                self.bindings['files'].append(copy.deepcopy(self.files[0]))
            elif fault == 'outside':
                self.bindings['files'][0]['target'] = str(self.root / 'external.mjs')
            elif fault == 'layout':
                self.bindings['files'][0]['target'] = str(self.runtime / 'elsewhere.mjs')
            else:
                self.bindings['protected'].append({'path': self.files[0]['target'], 'sha256': self.files[0]['expected_sha256']})
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.plan()

    def test_changed_review_and_changed_source_stop_apply(self):
        plan = self.plan()
        with self.assertRaisesRegex(ValueError, 'REVIEW_OR_MERGE'):
            m.apply_plan(plan, verify=lambda *args: {**self.merge, 'head': '0' * 40})
        with patch.object(m, 'source_bytes', return_value=b'changed committed result'):
            with self.assertRaisesRegex(ValueError, 'PLAN_CHANGED'):
                m.apply_plan(plan, verify=lambda *args: self.merge)
        self.assertIn('old', Path(self.files[0]['target']).read_text())

    def test_private_backup_cannot_be_written_into_public_checkout(self):
        with self.assertRaisesRegex(ValueError, 'BACKUP_MUST_BE_OUTSIDE'):
            m.build_plan(self.repo, self.bindings, self.merge, self.repo / 'private-backups')

    def test_plan_and_binding_artifacts_must_stay_outside_checkout(self):
        for path in [self.repo / 'plan.json', self.repo / 'bindings.json']:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'PRIVATE_ARTIFACT'):
                m.external_artifacts(self.repo, path)
        m.external_artifacts(self.repo, self.root / 'private-plan.json')

    def test_replacement_refs_cannot_substitute_unreviewed_git_bytes(self):
        source = self.repo / self.files[0]['source']
        source.write_text('export const value = "unreviewed replacement";\n')
        self.git('add', 'core')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'replacement')
        replacement = self.git('rev-parse', 'HEAD').strip()
        self.git('replace', self.sha, replacement)
        self.assertIn('unreviewed replacement', self.git('show', self.sha + ':' + self.files[0]['source']))
        self.assertEqual(m.source_bytes(self.repo, self.sha, self.files[0]['source']), b'export const value = "new";\n')

    def test_registered_core_writers_cannot_overlap_adoption(self):
        plan = self.plan()
        with m.runtime_lock(self.runtime):
            with self.assertRaisesRegex(ValueError, 'RUNTIME_UPDATE_LOCKED'):
                m.apply_plan(plan, verify=lambda *args: self.merge)
            self.assertIn('old', Path(self.files[0]['target']).read_text())
        self.assertFalse((self.runtime / '.publisher-core-update.lock').exists())
        self.assertEqual(m.apply_plan(plan, verify=lambda *args: self.merge)['updated'], 2)

    def test_mid_update_failure_rolls_back_and_keeps_backup(self):
        plan = self.plan()
        real = m.source_bytes
        calls = []

        def fail_later(*args):
            calls.append(args)
            if len(calls) == 4:
                raise OSError('fixture interrupted second copy')
            return real(*args)

        with patch.object(m, 'source_bytes', side_effect=fail_later):
            with self.assertRaises(OSError):
                m.apply_plan(plan, verify=lambda *args: self.merge)
        self.assertTrue(list((self.root / 'backups').glob('*/core/lib/a.mjs')))
        self.assertTrue(all('old' in Path(row['target']).read_text() for row in self.files))

    def test_wrong_plan_sha_cannot_enter_github_or_runtime(self):
        plan = self.root / 'plan.json'
        plan.write_text(json.dumps(self.plan()))
        process = subprocess.run([sys.executable, str(Path(m.__file__)), 'apply', '--plan', str(plan),
                                  '--expected-plan-sha256', '0' * 64], capture_output=True, text=True)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('EXACT_PLAN_SHA_REQUIRED', process.stderr)
        self.assertFalse((self.root / 'backups').exists())


class ReviewGateTests(unittest.TestCase):
    def test_only_exact_completed_head_and_clean_checks_are_accepted(self):
        head = 'a' * 40
        review = {'commit_sha': head, 'has_any_findings': False, 'has_unresolved_findings': False, 'status': 'completed'}
        thread = {'headRefOid': head, 'reviewDecision': '', 'reviewThreads': {'pageInfo': {'hasNextPage': False}, 'nodes': []}}
        for fault in [None, 'running', 'old-head', 'findings', 'unresolved', 'checks', 'not-merged', 'history', 'duplicate']:
            r, t = copy.deepcopy(review), copy.deepcopy(thread)
            if fault == 'running': r['status'] = 'running'
            if fault == 'old-head': r['commit_sha'] = 'b' * 40
            if fault == 'findings': r['has_any_findings'] = True
            if fault == 'unresolved': t['reviewThreads']['nodes'] = [{'isResolved': False}]

            def fixture(*args):
                endpoint = args[1]
                if endpoint.endswith('/pulls/1'):
                    return {'merged': fault != 'not-merged', 'head': {'sha': head}, 'merge_commit_sha': 'c' * 40,
                            'base': {'repo': {'full_name': 'example/publisher'}}}
                if '/comments?' in endpoint:
                    rows = [{'user': {'login': 'chatgpt-codex-connector[bot]'},
                             'body': '<!-- codex-review-state:v1 ' + json.dumps({'code_review': r}) + ' -->'}]
                    if fault in {'history', 'duplicate'}:
                        old = {**review, 'commit_sha': 'b' * 40 if fault == 'history' else head, 'has_any_findings': True}
                        rows.insert(0, {'user': {'login': 'chatgpt-codex-connector[bot]'}, 'body': '<!-- codex-review-state:v1 ' + json.dumps({'code_review': old}) + ' -->'})
                    return rows
                if endpoint == 'graphql': return {'data': {'repository': {'pullRequest': t}}}
                if '/check-runs?' in endpoint:
                    return {'total_count': 1 if fault == 'checks' else 0, 'check_runs':
                            [{'status': 'completed', 'conclusion': 'failure'}] if fault == 'checks' else []}
                return {'total_count': 0, 'statuses': []}

            with self.subTest(fault=fault), patch.object(m, 'gh', side_effect=fixture):
                if fault and fault != 'history':
                    with self.assertRaises(ValueError): m.verified_merge('example/publisher', 1)
                else:
                    self.assertEqual(m.verified_merge('example/publisher', 1)['head'], head)


if __name__ == '__main__':
    unittest.main()

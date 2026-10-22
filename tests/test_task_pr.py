import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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
                     'Config/accounts.json', 'SESSIONS/session.json', '.ENV.json', 'config\\accounts.json',
                     '.Git/config.json', '.GITHUB/WORKFLOWS/deploy.yml',
                     'output/result.json', 'lib/credentials.mjs', '.github/workflows/deploy.yml']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                m.screened_source(self.root, {'path': path, 'sha256': '0' * 64})
        self.file.write_text('const location = "/' + 'Users' + '/fixture/private";')
        row = {**self.row, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}
        with self.assertRaisesRegex(ValueError, 'PRIVATE_OR_NONPORTABLE'):
            m.screened_source(self.root, row)

    def test_https_sources_are_not_mistaken_for_windows_drives(self):
        self.file.write_text('https://github.com/example/publisher')
        row = {**self.row, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}
        self.assertEqual(m.screened_source(self.root, row)[1], self.file.read_bytes())

    def test_cross_platform_private_absolute_paths_are_rejected(self):
        private_paths = ['C:' + chr(92) + 'Users' + chr(92) + 'Fixture' + chr(92) + 'private',
                         'C:' + '/Users' + '/Fixture/private', '/' + 'Volumes/PrivateDrive/work',
                         chr(92) * 2 + 'server' + chr(92) + 'private',
                         'file:' + '///' + 'private/private-file', '/' + 'mnt/private-volume/source']
        for text in private_paths:
            with self.subTest(kind=text[:2]):
                self.file.write_text(text)
                row = {**self.row, 'sha256': hashlib.sha256(self.file.read_bytes()).hexdigest()}
                with self.assertRaisesRegex(ValueError, 'PRIVATE_OR_NONPORTABLE'):
                    m.screened_source(self.root, row)

    def test_permission_authenticated_collaborator_marker_prevents_duplicate_request(self):
        head = 'a' * 40
        comments = [{'user': {'login': 'collaborator'}, 'body': '<!-- managed-public-review-head:' + head + ' -->'}]
        for permission in ['admin', 'maintain', 'write', 'read', 'none']:
            with self.subTest(permission=permission), patch.object(m, 'gh', side_effect=[{'head': {'sha': head}}, comments, {'permission': permission}]) as api, patch.object(m, 'run') as send:
                should_send = permission not in {'admin', 'maintain', 'write'}
                self.assertEqual(m.request_review_once('organization/publisher', 'https://github.com/organization/publisher/pull/1', head), should_send)
                self.assertEqual(send.call_count, int(should_send))
                self.assertEqual(api.call_args.args[-1], 'repos/organization/publisher/collaborators/collaborator/permission')

    def test_empty_duplicate_and_invalid_topic_rejected(self):
        for topic, files in [('fixture', []), ('../fixture', [self.row]), ('fixture', [self.row, self.row])]:
            with self.subTest(topic=topic, count=len(files)), self.assertRaises(ValueError):
                m.validate_manifest(self.root, {'schema': 'completed-public-topic/v1', 'topic': topic, 'files': files})

    def test_review_is_requested_once_per_current_head(self):
        import json
        head = 'a' * 40
        for mode in ['absent', 'running', 'completed', 'requested', 'impersonated', 'old-head']:
            comments = []
            if mode in {'requested', 'impersonated'}:
                comments = [{'user': {'login': 'example' if mode == 'requested' else 'stranger'}, 'body': '<!-- managed-public-review-head:' + head + ' -->'}]
            elif mode not in {'absent'}:
                comments = [{'user': {'login': 'chatgpt-codex-connector[bot]'}, 'body':
                             '<!-- codex-review-state:v1 ' + json.dumps({'code_review':
                             {'commit_sha': 'b' * 40 if mode == 'old-head' else head,
                              'status': 'running' if mode == 'old-head' else mode}}) + ' -->'}]
            with self.subTest(mode=mode), patch.object(m, 'gh', side_effect=[{'head': {'sha': head}}, comments] + ([{'permission': 'read'}] if mode == 'impersonated' else [])), patch.object(m, 'run') as send:
                self.assertEqual(m.request_review_once('example/publisher', 'https://github.com/example/publisher/pull/1', head), mode in {'absent', 'old-head', 'impersonated'})
                self.assertEqual(send.call_count, int(mode in {'absent', 'old-head', 'impersonated'}))

    def test_unchanged_pr_retries_missing_review_without_pushing(self):
        opened = [{'url': 'https://github.com/example/publisher/pull/1'}]
        for requested in [True, False]:
            with self.subTest(requested=requested), patch.object(m, 'request_review_once', return_value=requested) as review, patch.object(m, 'run') as run:
                result = m.unchanged_topic_result('example/publisher', opened, 'a' * 40, True)
                self.assertFalse(result['changed'])
                self.assertEqual(result['review_request_state'], 'REQUESTED' if requested else 'EXISTING_REVIEW_OR_TRUSTED_REQUEST')
                review.assert_called_once_with('example/publisher', opened[0]['url'], 'a' * 40)
                run.assert_not_called()
        with patch.object(m, 'request_review_once') as review:
            m.unchanged_topic_result('example/publisher', opened, 'a' * 40, False)
            m.unchanged_topic_result('example/publisher', [], 'a' * 40, True)
            review.assert_not_called()

    def test_lagging_pr_projection_does_not_repeat_push_or_request(self):
        head = 'a' * 40
        for converges in [False, True]:
            values = [{'head': {'sha': 'b' * 40}}, {'head': {'sha': head if converges else 'b' * 40}}]
            if converges: values.append([])
            with self.subTest(converges=converges), patch.object(m, 'gh', side_effect=values), patch.object(m.time, 'sleep') as sleep, patch.object(m, 'run') as send:
                if converges:
                    self.assertTrue(m.request_review_once('example/publisher', 'https://github.com/example/publisher/pull/1', head))
                else:
                    with self.assertRaisesRegex(ValueError, 'REVIEW_HEAD_CHANGED'):
                        m.request_review_once('example/publisher', 'https://github.com/example/publisher/pull/1', head)
                sleep.assert_called_once_with(3)
                self.assertEqual(send.call_count, int(converges))

    def test_fetched_branch_drift_stops_before_copy_tests_or_push(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp).resolve()
            manifest = folder / 'manifest.json'
            manifest.write_text(json.dumps({'schema': 'completed-public-topic/v1', 'topic': 'fixture',
                                           'files': [self.row], 'expected_pr_head': 'a' * 40}))
            calls = []

            def fixture(args, cwd=None):
                calls.append(args)
                if args[:2] == ['git', 'clone']:
                    Path(args[-1]).mkdir()
                if 'rev-parse' in args:
                    return 'b' * 40
                return ''

            argv = ['task_pr', '--source', str(self.root), '--manifest', str(manifest),
                    '--work-root', str(folder / 'work'), '--repository', 'example/publisher', '--message', 'fixture', '--pr']
            metadata = {'private': False, 'full_name': 'example/publisher', 'default_branch': 'main'}
            opened = [{'url': 'https://example.invalid/pr/1', 'headRefOid': 'a' * 40}]
            with patch.object(m, 'gh', side_effect=[metadata, opened]), patch.object(m, 'run', side_effect=fixture), patch.object(m, '__name__', 'fixture'), patch('sys.argv', argv):
                with self.assertRaisesRegex(ValueError, 'EXISTING_PR_CHANGED_DURING_FETCH'):
                    m.main()
            self.assertFalse(any('push' in args or 'add' in args or args[0] == 'npm' for args in calls))


if __name__ == '__main__':
    unittest.main()

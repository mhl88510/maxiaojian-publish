import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('offline_checks', Path(__file__).parents[1] / 'scripts/offline_checks.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class OfflineChecksTests(unittest.TestCase):
    def test_environment_is_allowlisted_not_inherited(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'GITHUB_TOKEN': 'fixture-secret', 'SSH_AUTH_SOCK': '/fixture/socket'}):
            env = m.clean_environment(root)
            self.assertNotIn('GITHUB_TOKEN', env)
            self.assertNotIn('SSH_AUTH_SOCK', env)
            self.assertEqual(env['HOME'], str(Path(root) / 'home'))
            self.assertEqual(env['NPM_CONFIG_IGNORE_SCRIPTS'], 'true')

    def test_candidate_checks_have_no_network_or_source_write_permission(self):
        profile = m.sandbox_profile('/fixture/source', '/fixture/scratch')
        self.assertIn('(deny default)', profile)
        self.assertNotIn('(allow network', profile)
        writes = [line for line in profile.splitlines() if '(allow file-write' in line]
        self.assertEqual(len(writes), 1)
        self.assertNotIn('/fixture/source', writes[0])
        install = m.sandbox_profile('/fixture/source', '/fixture/scratch', network=True)
        self.assertIn('(allow network*)', install)
        self.assertIn('/fixture/source/node_modules', install)

    def test_unsupported_host_has_no_unsandboxed_fallback(self):
        with patch.object(m.platform, 'system', return_value='Linux'), patch.object(m.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'NO_HOST_FALLBACK'):
                m.run_sandbox_command(['node', '--version'], '/fixture/source', '/fixture/scratch')
            run.assert_not_called()

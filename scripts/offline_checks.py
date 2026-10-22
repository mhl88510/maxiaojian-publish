#!/usr/bin/env python3
"""Credential-free macOS sandbox for task checks; unsupported hosts fail closed."""
import json
from pathlib import Path
import platform
import subprocess
import tempfile


def clean_environment(scratch):
    scratch = Path(scratch)
    home, temp = scratch / 'home', scratch / 'tmp'
    home.mkdir(exist_ok=True)
    temp.mkdir(exist_ok=True)
    config = home / 'empty-config'
    config.touch()
    return {'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'HOME': str(home), 'TMPDIR': str(temp), 'TMP': str(temp), 'TEMP': str(temp),
            'XDG_CONFIG_HOME': str(home / 'config'), 'LANG': 'en_US.UTF-8',
            'NPM_CONFIG_USERCONFIG': str(config), 'NPM_CONFIG_GLOBALCONFIG': str(home / 'empty-global'),
            'NPM_CONFIG_CACHE': str(scratch / 'npm-cache'), 'NPM_CONFIG_IGNORE_SCRIPTS': 'true',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': str(config),
            'PUBLISHER_OFFLINE_SANDBOX': '1'}


def sandbox_profile(checkout, scratch, network=False):
    paths = [str(Path(checkout).resolve()), str(Path(scratch).resolve()),
             '/System', '/usr', '/bin', '/sbin', '/opt/homebrew', '/Library/Developer',
             '/private/etc/ssl', '/private/var/db/dyld']
    lines = ['(version 1)', '(deny default)', '(allow process-exec)', '(allow process-fork)', '(allow signal (target self) (target children))',
             '(allow sysctl-read)', '(allow file-read-metadata)',
             # libignition opens / as an openat root; dyld maps installed libraries.
             '(allow file-read* (literal "/"))',
             '(allow file-map-executable ' + ' '.join('(subpath ' + json.dumps(p) + ')' for p in paths) + ')',
             '(allow file-read* ' + ' '.join('(subpath ' + json.dumps(p) + ')' for p in paths) + ')',
             '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/private/etc/localtime") (literal "/private/etc/hosts") (literal "/private/etc/resolv.conf"))',
             '(allow file-write* (subpath ' + json.dumps(str(Path(scratch).resolve())) + ')(literal "/dev/null"))']
    if network:
        # Only npm ci --ignore-scripts receives network. No candidate tests run
        # here; HOME/config/environment are isolated and .git/source read-only.
        lines.extend(['(allow network*)', '(allow mach-lookup)',
                      '(allow file-write* (subpath ' + json.dumps(str(Path(checkout).resolve() / 'node_modules')) + '))'])
    return '\n'.join(lines) + '\n'


def run_sandbox_command(args, checkout, scratch, *, network=False):
    if platform.system() != 'Darwin' or not Path('/usr/bin/sandbox-exec').is_file():
        raise RuntimeError('OFFLINE_SANDBOX_UNAVAILABLE_NO_HOST_FALLBACK')
    checkout, scratch = Path(checkout).resolve(), Path(scratch).resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    profile = scratch / ('install.sb' if network else 'offline.sb')
    profile.write_text(sandbox_profile(checkout, scratch, network))
    env = clean_environment(scratch)
    result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(profile), *args],
                            cwd=checkout, env=env, capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, output=result.stdout + result.stderr)
    return result.stdout + result.stderr


def run_offline_checks(checkout, logs):
    logs = Path(logs)
    logs.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='publisher-offline-checks-') as temporary:
        scratch = Path(temporary).resolve()
        commands = [(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], True),
                    (['npm', 'run', 'check'], False), (['npm', 'test'], False),
                    (['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], False)]
        for index, (args, network) in enumerate(commands):
            output = logs / (str(index) + '.log')
            try:
                output.write_text(run_sandbox_command(args, checkout, scratch, network=network))
            except subprocess.CalledProcessError as error:
                output.write_text(error.output)
                raise RuntimeError('OFFLINE_CHECK_FAILED: ' + str(output)) from error

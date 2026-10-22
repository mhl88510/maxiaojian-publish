#!/usr/bin/env python3
"""Publish one completed, SHA-pinned public-source topic; no watcher or deployment."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid


def run(args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT, text=True)


def gh(*args):
    return json.loads(run(['gh', *args]))


def screened_source(source, row):
    relative = Path(row['path'])
    if (relative.is_absolute() or '..' in relative.parts or not relative.parts
            or '\\' in row['path']
            or any(part.casefold() in {'.git', 'node_modules', 'config', 'data', 'output', 'backups', 'sessions', 'profiles'} for part in relative.parts)
            or relative.as_posix().casefold().startswith('.github/workflows/')
            or relative.name.casefold().startswith('.env')
            or relative.suffix.casefold() not in {'.py', '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.txt'}
            or re.search(r'cookie|credential|secret|storage.?state|\.bak$|\.backup$', relative.name, re.I)):
        raise ValueError('PUBLIC_SOURCE_PATH_FORBIDDEN')
    path = source / relative
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise ValueError('PLAIN_SOURCE_FILE_REQUIRED')
    raw = path.read_bytes()
    if len(raw) > 4 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError('COMPLETED_SOURCE_SHA_CHANGED')
    text = raw.decode('utf-8')
    if (re.search(r'/(?:Users|home|Volumes|mnt|media|root|srv)/|/private/var/(?:folders|tmp)/|(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[A-Za-z0-9_.-]+\\|file:[/]{2}', text, re.I)
            or re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh_[a-z0-9]{8,}', text)):
        raise ValueError('PRIVATE_OR_NONPORTABLE_SOURCE')
    return relative, raw


def validate_manifest(source, manifest):
    if manifest.get('schema') != 'completed-public-topic/v1' or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,70}', manifest.get('topic', '')):
        raise ValueError('COMPLETED_TOPIC_REQUIRED')
    rows = manifest.get('files', [])
    if not rows or len({r['path'] for r in rows}) != len(rows):
        raise ValueError('NONEMPTY_UNIQUE_SOURCE_LIST_REQUIRED')
    return [screened_source(source, row) for row in rows]


def request_review_once(repository, url, head):
    match = re.fullmatch(r'https://github\.com/' + re.escape(repository) + r'/pull/([0-9]+)', url)
    if not match:
        raise ValueError('REVIEW_REPOSITORY_URL_MISMATCH')
    number = int(match.group(1))
    # PR projections can lag a successful Git ref update; bounded fresh reads
    # are not repeated review requests and never authorize another push.
    for attempt in range(2):
        pr = gh('api', f'repos/{repository}/pulls/{number}')
        if pr['head']['sha'] == head:
            break
        if attempt == 0:
            time.sleep(3)
    if pr['head']['sha'] != head:
        raise ValueError('REVIEW_HEAD_CHANGED')
    comments = gh('api', f'repos/{repository}/issues/{number}/comments?per_page=100')
    if len(comments) >= 100:
        raise ValueError('REVIEW_REQUEST_PAGINATION_REQUIRED')
    marker = '<!-- managed-public-review-head:' + head + ' -->'
    permissions = {}
    for comment in comments:
        author = comment.get('user', {}).get('login', '')
        if marker in comment['body']:
            if author == repository.split('/')[0]:
                return False
            if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?', author):
                if author not in permissions:
                    permissions[author] = gh('api', f'repos/{repository}/collaborators/{author}/permission').get('permission')
                if permissions[author] in {'admin', 'maintain', 'write'}:
                    return False
        match = re.search(r'codex-review-state:v1 (\{.*?\}) -->', comment['body'])
        if comment['user']['login'] == 'chatgpt-codex-connector[bot]' and match:
            review = json.loads(match.group(1)).get('code_review', {})
            if review.get('commit_sha') == head and review.get('status') in {'running', 'completed'}:
                return False
    run(['gh', 'pr', 'comment', url, '--body', '@codex review\n\n' + marker +
         '\nReview this completed public-source head. No runtime deployment or business publishing.'])
    return True


def unchanged_topic_result(repository, opened, head, request):
    result = {'changed': False, 'pull_request': opened[0]['url'] if opened else None}
    if request and opened:
        sent = request_review_once(repository, opened[0]['url'], head)
        result['head'] = head
        result['review_request_state'] = 'REQUESTED' if sent else 'EXISTING_REVIEW_OR_TRUSTED_REQUEST'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--repository', default='mhl88510/maxiaojian-publish')
    parser.add_argument('--message', required=True)
    parser.add_argument('--pr', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        raise ValueError('REPOSITORY_INVALID')
    source = args.source.resolve()
    if args.manifest.resolve().is_relative_to(source) or args.work_root.resolve().is_relative_to(source):
        raise ValueError('PRIVATE_MANIFEST_AND_WORK_AREA_MUST_BE_OUTSIDE_SOURCE')
    manifest_raw = args.manifest.read_bytes()
    manifest = json.loads(manifest_raw)
    files = validate_manifest(source, manifest)
    metadata = gh('api', 'repos/' + args.repository)
    if metadata['private'] or metadata['full_name'] != args.repository:
        raise ValueError('REGISTERED_PUBLIC_REPOSITORY_REQUIRED')
    base = metadata['default_branch']
    branch = 'codex/public-' + manifest['topic']
    opened = gh('pr', 'list', '-R', args.repository, '--state', 'open', '--head', branch,
                '--json', 'url,headRefName,headRefOid', '--limit', '100')
    if len(opened) > 1:
        raise ValueError('DUPLICATE_TOPIC_PRS')
    if opened and manifest.get('expected_pr_head') != opened[0]['headRefOid']:
        raise ValueError('EXISTING_PR_CHANGED_RECONCILE_REVIEWED_FIXES_FIRST')
    args.work_root.mkdir(parents=True, exist_ok=True)
    checkout = args.work_root / ('public-topic-' + uuid.uuid4().hex)
    run(['git', 'clone', '--no-hardlinks', 'https://github.com/' + args.repository + '.git', str(checkout)])
    if opened:
        run(['git', '-C', str(checkout), 'fetch', 'origin', branch])
        run(['git', '-C', str(checkout), 'checkout', '-b', branch, 'FETCH_HEAD'])
        if run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).strip() != manifest['expected_pr_head']:
            raise ValueError('EXISTING_PR_CHANGED_DURING_FETCH')
    else:
        run(['git', '-C', str(checkout), 'checkout', '-b', branch, 'origin/' + base])
    for relative, raw in files:
        target = checkout / relative
        if any(p.is_symlink() for p in (target, *target.parents)):
            raise ValueError('DESTINATION_SYMLINK_FORBIDDEN')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    if args.manifest.read_bytes() != manifest_raw or validate_manifest(source, manifest) != files:
        raise ValueError('SOURCE_CHANGED_DURING_EXPORT')
    run(['git', '-C', str(checkout), 'add', '--', *(str(relative) for relative, _ in files)])
    changed = subprocess.run(['git', '-C', str(checkout), 'diff', '--cached', '--quiet']).returncode
    if changed == 0:
        head = run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).strip()
        print(json.dumps(unchanged_topic_result(args.repository, opened, head, args.pr)))
        return
    if changed != 1:
        raise ValueError('GIT_DIFF_FAILED')
    from offline_checks import run_offline_checks
    run_offline_checks(checkout, args.work_root / (checkout.name + '-checks'))
    if validate_manifest(source, manifest) != files:
        raise ValueError('SOURCE_CHANGED_DURING_CHECKS')
    allowed = {str(relative): hashlib.sha256(raw).hexdigest() for relative, raw in files}
    staged = run(['git', '-C', str(checkout), 'diff', '--cached', '--name-only']).splitlines()
    if not set(staged).issubset(allowed):
        raise ValueError('UNEXPECTED_STAGED_FILE_AFTER_CHECKS')
    for relative, expected in allowed.items():
        staged_bytes = subprocess.check_output(['git', '--no-replace-objects', '-C', str(checkout), 'show', ':' + relative])
        if hashlib.sha256(staged_bytes).hexdigest() != expected:
            raise ValueError('STAGED_SOURCE_CHANGED_DURING_CHECKS')
    run(['git', '-C', str(checkout), 'diff', '--cached', '--check'])
    run(['git', '-C', str(checkout), '-c', 'user.name=maintainer', '-c',
         'user.email=maintainer@users.noreply.github.com', 'commit', '-m', args.message])
    with tempfile.TemporaryDirectory(prefix='public-source-screen-') as temp:
        config = Path(temp) / 'scanner.toml'
        config.write_text('[extend]\nuseDefault = true\n')
        ignore = Path(temp) / 'empty-ignore'
        ignore.mkdir()
        run(['gitleaks', 'git', str(checkout), '--config', str(config), '--no-banner',
             '--redact=100', '--ignore-gitleaks-allow', '--gitleaks-ignore-path', str(ignore)])
    head = run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).strip()
    url = opened[0]['url'] if opened else None
    result = {'changed': True, 'head': head, 'checkout': str(checkout), 'pull_request': url,
              'files': [str(relative) for relative, _ in files], 'deployed': False,
              'pushed': False, 'review_request_state': 'NOT_REQUESTED'}
    receipt = args.work_root / (checkout.name + '-RESULT.json')
    if args.pr:
        run(['git', '-C', str(checkout), 'push', 'origin', 'HEAD:refs/heads/' + branch])
        result['pushed'] = True
        receipt.write_text(json.dumps(result, indent=2))
        if not url:
            url = run(['gh', 'pr', 'create', '-R', args.repository, '--base', base, '--head', branch,
                       '--title', args.message, '--body',
                       'One completed SHA-pinned public-source topic. Affected offline checks and full public-history secret scan passed. Review this exact head; fixes stay in this PR. No private configuration, runtime replacement, timers or business publishing.']).strip()
        result['pull_request'] = url
        try:
            sent = request_review_once(args.repository, url, head)
            result['review_request_state'] = 'REQUESTED' if sent else 'EXISTING_REVIEW_OR_TRUSTED_REQUEST'
        except Exception as error:
            result['review_request_state'] = 'PENDING_READBACK_OR_REQUEST'
            result['error_type'] = type(error).__name__
            receipt.write_text(json.dumps(result, indent=2))
            raise
    receipt.write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Explicit, two-phase update of registered shared core; never invokes a publisher."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import uuid


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd)


def gh(*args):
    return json.loads(command('gh', *args))


def plain_path(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('ABSOLUTE_PLAIN_PATH_REQUIRED')
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('SYMLINK_FORBIDDEN')
    return path


def verified_merge(repository, number):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('REPOSITORY_INVALID')
    pr = gh('api', f'repos/{repository}/pulls/{number}')
    if not pr['merged'] or pr['base']['repo']['full_name'] != repository:
        raise ValueError('MERGED_PR_REQUIRED')
    head = pr['head']['sha']
    comments = gh('api', f'repos/{repository}/issues/{number}/comments?per_page=100')
    if len(comments) >= 100:
        raise ValueError('REVIEW_PAGINATION_REQUIRED')
    reviews = []
    for comment in comments:
        match = re.search(r'codex-review-state:v1 (\{.*?\}) -->', comment['body'])
        if comment['user']['login'] == 'chatgpt-codex-connector[bot]' and match:
            reviews.append(json.loads(match.group(1))['code_review'])
    if len(reviews) != 1 or reviews[0] != {
        'commit_sha': head, 'has_any_findings': False,
        'has_unresolved_findings': False, 'status': 'completed',
    }:
        raise ValueError('SAME_HEAD_COMPLETED_CLEAN_REVIEW_REQUIRED')
    owner, name = repository.split('/')
    query = '''query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){headRefOid reviewDecision reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}'''
    state = gh('api', 'graphql', '-f', 'query=' + query, '-f', 'owner=' + owner,
               '-f', 'name=' + name, '-F', 'n=' + str(number))['data']['repository']['pullRequest']
    if (state['headRefOid'] != head or state['reviewDecision'] == 'CHANGES_REQUESTED'
            or state['reviewThreads']['pageInfo']['hasNextPage']
            or any(not row['isResolved'] for row in state['reviewThreads']['nodes'])):
        raise ValueError('UNRESOLVED_OR_INCOMPLETE_REVIEW')
    checks = gh('api', f'repos/{repository}/commits/{head}/check-runs?per_page=100')
    statuses = gh('api', f'repos/{repository}/commits/{head}/status?per_page=100')
    if (checks['total_count'] >= 100 or statuses['total_count'] >= 100
            or any(row['status'] != 'completed' or row['conclusion'] not in
                   {'success', 'neutral', 'skipped'} for row in checks['check_runs'])
            or any(row['state'] != 'success' for row in statuses['statuses'])):
        raise ValueError('CHECKS_NOT_SUCCESSFUL')
    return {'repository': repository, 'pr': number, 'head': head,
            'merge': pr['merge_commit_sha']}


def source_bytes(checkout, commit, relative):
    relative_path = Path(relative)
    if (relative_path.is_absolute() or '..' in relative_path.parts
            or not relative.startswith('core/') or relative_path.suffix != '.mjs'
            or 'tests' in relative_path.parts
            or relative_path.name in {'config.mjs', 'school-account.mjs'}):
        raise ValueError('SHARED_SOURCE_SCOPE_INVALID')
    entry = command('git', '-C', str(checkout), 'ls-tree', commit, '--', relative).decode().strip()
    if not entry.startswith('100644 blob ') and not entry.startswith('100755 blob '):
        raise ValueError('REGULAR_COMMITTED_SOURCE_REQUIRED')
    data = command('git', '-C', str(checkout), 'show', commit + ':' + relative)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('SOURCE_TOO_LARGE')
    data.decode('utf-8')
    return data


def write_new(path, data):
    path = plain_path(path)
    with path.open('xb') as stream:
        os.chmod(path, 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def build_plan(checkout, bindings, merge, backup_root):
    checkout, backup_root = plain_path(checkout), plain_path(backup_root)
    root = plain_path(bindings['runtime_root'])
    if bindings.get('schema') != 'publisher-local-core-bindings/v1' or bindings['repo'] != merge['repository']:
        raise ValueError('BINDINGS_SCOPE_INVALID')
    if backup_root == root or backup_root.is_relative_to(root):
        raise ValueError('BACKUP_MUST_BE_OUTSIDE_RUNTIME')
    rows, targets, sources = [], set(), set()
    for row in bindings['files']:
        target = plain_path(row['target'])
        if not target.is_relative_to(root) or target == root or target in targets or row['source'] in sources:
            raise ValueError('DUPLICATE_OR_OUTSIDE_TARGET')
        if target.relative_to(root).as_posix() != row['source'].removeprefix('core/'):
            raise ValueError('SOURCE_TARGET_LAYOUT_MISMATCH')
        targets.add(target)
        sources.add(row['source'])
        before = target.read_bytes()
        if digest(before) != row['expected_sha256']:
            raise ValueError('RUNTIME_CHANGED_PRESERVE_LOCAL_EDITS')
        after = source_bytes(checkout, merge['merge'], row['source'])
        rows.append({**row, 'reviewed_sha256': digest(after), 'before_mode': stat.S_IMODE(target.stat().st_mode)})
    if not rows:
        raise ValueError('EMPTY_BINDINGS')
    protected = bindings.get('protected', [])
    for row in protected:
        if digest(plain_path(row['path']).read_bytes()) != row['sha256']:
            raise ValueError('PROTECTED_SOURCE_CHANGED')
    if targets.intersection(plain_path(row['path']) for row in protected):
        raise ValueError('PROTECTED_TARGET_OVERLAP')
    return {'schema': 'reviewed-core-update-plan/v1', 'merge': merge,
            'checkout': str(checkout), 'runtime_root': str(root),
            'backup_root': str(backup_root), 'files': rows, 'protected': protected,
            'publicationPerformed': False}


def apply_plan(plan, verify=verified_merge):
    if plan.get('schema') != 'reviewed-core-update-plan/v1':
        raise ValueError('PLAN_SCHEMA_INVALID')
    merge = plan['merge']
    if verify(merge['repository'], merge['pr']) != merge:
        raise ValueError('REVIEW_OR_MERGE_CHANGED')
    bindings = {'schema': 'publisher-local-core-bindings/v1', 'repo': merge['repository'],
                'runtime_root': plan['runtime_root'], 'files': plan['files'],
                'protected': plan['protected']}
    current = build_plan(plan['checkout'], bindings, merge, plan['backup_root'])
    if current != plan:
        raise ValueError('PLAN_CHANGED')
    backup = plain_path(plan['backup_root']) / uuid.uuid4().hex
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    write_new(backup / 'PLAN.json', json.dumps(plan, indent=2).encode())
    changed = []
    try:
        for row in plan['files']:
            target = plain_path(row['target'])
            before = target.read_bytes()
            if digest(before) != row['expected_sha256']:
                raise ValueError('RUNTIME_CHANGED_DURING_UPDATE')
            saved = backup / row['source']
            saved.parent.mkdir(parents=True, exist_ok=True)
            write_new(saved, before)
            after = source_bytes(plan['checkout'], merge['merge'], row['source'])
            if digest(after) != row['reviewed_sha256']:
                raise ValueError('REVIEWED_SOURCE_CHANGED')
            if before != after:
                temporary = target.with_name(target.name + '.managed-' + uuid.uuid4().hex)
                try:
                    write_new(temporary, after)
                    temporary.chmod(row['before_mode'])
                    if target.read_bytes() != before:
                        raise ValueError('RUNTIME_CHANGED_DURING_UPDATE')
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
                changed.append(row)
        for row in plan['files']:
            if digest(plain_path(row['target']).read_bytes()) != row['reviewed_sha256']:
                raise ValueError('ADOPTION_READBACK_FAILED')
        for row in plan['protected']:
            if digest(plain_path(row['path']).read_bytes()) != row['sha256']:
                raise ValueError('PROTECTED_SOURCE_CHANGED')
        result = {'schema': 'reviewed-core-adoption/v1', 'merge': merge,
                  'backup': str(backup), 'checked': len(plan['files']),
                  'updated': len(changed), 'publicationPerformed': False}
        write_new(backup / 'RESULT.json', json.dumps(result, indent=2).encode())
    except BaseException:
        for row in reversed(changed):
            target = plain_path(row['target'])
            if digest(target.read_bytes()) != row['reviewed_sha256']:
                continue  # Keep concurrent edits; the original remains in backup.
            temporary = target.with_name(target.name + '.rollback-' + uuid.uuid4().hex)
            try:
                write_new(temporary, (backup / row['source']).read_bytes())
                temporary.chmod(row['before_mode'])
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        raise
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'apply'])
    parser.add_argument('--checkout', type=Path)
    parser.add_argument('--bindings', type=Path)
    parser.add_argument('--backup-root', type=Path)
    parser.add_argument('--pr', type=int)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--expected-plan-sha256')
    args = parser.parse_args()
    if args.action == 'plan':
        if not all([args.checkout, args.bindings, args.backup_root, args.pr]):
            parser.error('plan needs checkout, bindings, backup-root and pr')
        bindings = json.loads(plain_path(args.bindings).read_bytes())
        plan = build_plan(args.checkout, bindings, verified_merge(bindings['repo'], args.pr), args.backup_root)
        raw = json.dumps(plan, indent=2).encode()
        write_new(args.plan, raw)
        print(json.dumps({'planSha256': digest(raw), 'files': len(plan['files'])}))
    else:
        raw = plain_path(args.plan).read_bytes()
        if not args.expected_plan_sha256 or digest(raw) != args.expected_plan_sha256:
            raise ValueError('EXACT_PLAN_SHA_REQUIRED')
        print(json.dumps(apply_plan(json.loads(raw))))


if __name__ == '__main__':
    main()

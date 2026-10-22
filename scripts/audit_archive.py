#!/usr/bin/env python3
"""Audit the actual npm tarball against an exact file allowlist. Offline only."""
import argparse, gzip, hashlib, io, json, pathlib, re, tarfile

PATTERNS = {
    'personal_absolute_path': re.compile(r'(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s\x00]+'),
    'private_key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider_secret': re.compile(r'(?:sk-proj-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{24,})'),
    'credential_url': re.compile(r'https?://[^\s\x22\x27/]+:[^\s\x22\x27/]+@'),
    'local_business_service': re.compile(r'https?://(?:127\.0\.0\.1|localhost):1890[12]'),
}
REQUIRED = {'package.json','npm-shrinkwrap.json','README.md','NOTICE.md','LICENSE.upstream-MIT','bin/maxiaojian-publish.mjs','lib/publication-guard.mjs','lib/wrapper/content-packet.mjs'}

def audit_bytes(blob, allowed, expected=None, private_tokens=()):
    issues=[]; checked=[]; names=set(); total=0
    def issue(code,path=''):
        # No matched values or credential-like text is emitted.
        issues.append({'code':code,'path':path})
    try:
        if len(blob)>32*1024*1024:raise ValueError('archive size')
        with gzip.GzipFile(fileobj=io.BytesIO(blob)) as stream:raw_tar=stream.read(32*1024*1024+1)
        if len(raw_tar)>32*1024*1024:raise ValueError('decompressed size')
        archive=tarfile.open(fileobj=io.BytesIO(raw_tar),mode='r:')
        members=archive.getmembers()
    except (tarfile.TarError, OSError, EOFError, ValueError):
        return {'ok':False,'issues':[{'code':'INVALID_ARCHIVE','path':''}],'filesChecked':0}
    if len(members)>512:issue('TOO_MANY_ENTRIES')
    for member in members:
        raw=member.name;name=pathlib.PurePosixPath(raw)
        if name.is_absolute() or '\\' in raw or '..' in name.parts or not name.parts or name.parts[0]!='package':issue('UNSAFE_ARCHIVE_PATH');continue
        if not member.isfile():issue('NON_REGULAR_ARCHIVE_ENTRY');continue
        rel='/'.join(name.parts[1:])
        if rel in names:issue('DUPLICATE_ENTRY',rel);continue
        names.add(rel)
        if rel not in allowed:issue('NOT_ALLOWLISTED',rel);continue
        if member.size>4*1024*1024:issue('FILE_TOO_LARGE',rel);continue
        total+=member.size
        if total>16*1024*1024:issue('ARCHIVE_TOO_LARGE');break
        if member.mode & 0o6022:issue('UNSAFE_FILE_MODE',rel)
        if member.mode & 0o111 and rel!='bin/maxiaojian-publish.mjs':issue('UNEXPECTED_EXECUTABLE',rel)
        data=archive.extractfile(member).read()
        if expected is not None and expected.get(rel)!=hashlib.sha256(data).hexdigest():issue('SOURCE_BYTES_MISMATCH',rel)
        try:text=data.decode('utf-8')
        except UnicodeDecodeError:issue('NON_TEXT_PAYLOAD',rel);continue
        if rel.endswith(('.log','.jsonl','.ndjson','.bak','.tgz')) or any(x in name.parts for x in ['node_modules','profiles','cookies','logs','.git']):issue('STATE_OR_LOG_FILE',rel)
        for code,pattern in PATTERNS.items():
            if pattern.search(text):issue(code,rel)
        if any(token and token in text for token in private_tokens):issue('PRIVATE_SOURCE_TOKEN',rel)
        if rel.endswith('.json'):
            try:
                value=json.loads(text)
                if rel=='config/accounts.json' and value!={'platforms':{}}:issue('NONEMPTY_ACCOUNT_MAPPING',rel)
                if rel=='config/article-contracts.json':
                    def forbidden_keys(obj):
                        if isinstance(obj,dict):
                            return any(any(t in k.lower() for t in ['evidence','verification','verified_at','legacy']) or k.lower() in ['accountid','accountname'] or forbidden_keys(v) for k,v in obj.items())
                        if isinstance(obj,list):return any(forbidden_keys(v) for v in obj)
                        return False
                    if forbidden_keys(value):issue('PRIVATE_CONTRACT_METADATA',rel)
                if rel=='config/readback-routes.json' and value!={'routes':[]}:issue('NONEMPTY_READBACK_ROUTES',rel)
            except (ValueError,TypeError):issue('INVALID_JSON',rel)
        checked.append({'path':rel,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
    for rel in sorted(REQUIRED-names):issue('REQUIRED_FILE_MISSING',rel)
    for rel in sorted(set(allowed)-names):issue('ALLOWLISTED_FILE_MISSING',rel)
    archive.close()
    return {'ok':not issues,'issues':issues,'filesChecked':len(checked),'uncompressedBytes':total,'files':checked,'scanScope':['every archived UTF-8 payload','exact allowlist','archive path/type/mode/duplicate checks','private paths/tokens/known names/key patterns','empty real account/readback mappings; structural article contracts without private evidence','exact candidate-byte comparison'],'limits':['pattern and denylist coverage is finite; not a proof of absence of every possible secret or personal fact','source semantics/builders require code review; scans do not validate platform behavior','synthetic tests do not establish account identity, media truth, rights, or platform approval']}

def main():
    p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('--source',required=True);p.add_argument('--private-denylist');p.add_argument('--output',required=True);args=p.parse_args()
    source=pathlib.Path(args.source);pkg=json.loads((source/'package.json').read_text());allowed=set(pkg['files'])|{'package.json'}
    expected={}
    for rel in allowed:
        f=source/rel
        if not f.is_file() or f.is_symlink():raise SystemExit('non-regular allowlisted source')
        expected[rel]=hashlib.sha256(f.read_bytes()).hexdigest()
    tokens=json.loads(pathlib.Path(args.private_denylist).read_text()) if args.private_denylist else []
    blob=pathlib.Path(args.archive).read_bytes();result=audit_bytes(blob,allowed,expected,tokens);result['archiveSha256']=hashlib.sha256(blob).hexdigest();result['privateTokenCount']=len(tokens)
    pathlib.Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['ok','filesChecked','archiveSha256','privateTokenCount']}));raise SystemExit(0 if result['ok'] else 1)
if __name__=='__main__':main()

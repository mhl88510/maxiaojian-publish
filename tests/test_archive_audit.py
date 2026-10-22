import importlib.util,io,json,pathlib,tarfile,unittest
spec=importlib.util.spec_from_file_location('audit',pathlib.Path(__file__).resolve().parents[1]/'scripts/audit_archive.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def archive(entries):
    buf=io.BytesIO()
    with tarfile.open(fileobj=buf,mode='w:gz') as tar:
        for name,data,kind in entries:
            entry=tarfile.TarInfo(name);entry.mode=0o644
            if kind=='symlink':entry.type=tarfile.SYMTYPE;entry.linkname='../../outside';tar.addfile(entry)
            else:entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
    return buf.getvalue()
class AuditTests(unittest.TestCase):
    def check_code(self,entries,code,allowed={'README.md'}):
        r=module.audit_bytes(archive(entries),allowed);self.assertFalse(r['ok']);self.assertIn(code,[i['code'] for i in r['issues']]);return r
    def test_traversal(self):self.check_code([('package/../outside',b'x','file')],'UNSAFE_ARCHIVE_PATH')
    def test_symlink(self):self.check_code([('package/README.md',b'','symlink')],'NON_REGULAR_ARCHIVE_ENTRY')
    def test_unlisted(self):self.check_code([('package/hidden.env',b'x','file')],'NOT_ALLOWLISTED')
    def test_duplicate(self):self.check_code([('package/README.md',b'a','file'),('package/README.md',b'b','file')],'DUPLICATE_ENTRY')
    def test_private_path_is_not_echoed(self):
        text=('/'+'Users/'+'fictional-owner/private.txt').encode();r=self.check_code([('package/README.md',text,'file')],'personal_absolute_path');self.assertNotIn('fictional-owner',json.dumps(r))
    def test_exact_byte_check(self):
        r=module.audit_bytes(archive([('package/README.md',b'changed','file')]),{'README.md'},{'README.md':'0'*64});self.assertIn('SOURCE_BYTES_MISMATCH',[i['code'] for i in r['issues']])
    def test_nonempty_accounts(self):self.check_code([('package/config/accounts.json',b'{"platforms":{"douyin":{"accounts":[{}]}}}','file')],'NONEMPTY_ACCOUNT_MAPPING',{'config/accounts.json'})
    def test_private_contract_evidence(self):
        self.check_code([('package/config/article-contracts.json',b'{"platforms":{"sohu":{"managementEvidence":"private"}}}','file')],'PRIVATE_CONTRACT_METADATA',{'config/article-contracts.json'})
    def test_structural_contract_allowed(self):
        r=module.audit_bytes(archive([('package/config/article-contracts.json',b'{"platforms":{"sohu":{"nativeArticle":{"titleSelector":".title"}}}}','file')]),{'config/article-contracts.json'})
        self.assertNotIn('PRIVATE_CONTRACT_METADATA',[i['code'] for i in r['issues']])
    def test_private_token(self):
        r=module.audit_bytes(archive([('package/README.md',b'private-marker','file')]),{'README.md'},private_tokens=['private-marker']);self.assertIn('PRIVATE_SOURCE_TOKEN',[i['code'] for i in r['issues']])
    def test_clean_payload_all_required(self):
        entries=[]
        for name in module.REQUIRED:entries.append(('package/'+name,b'{}' if name.endswith('.json') else b'clean fixture','file'))
        r=module.audit_bytes(archive(entries),module.REQUIRED);self.assertTrue(r['ok'],r['issues'])
if __name__=='__main__':unittest.main()

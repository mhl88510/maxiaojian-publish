import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));let count=0;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.name==='node_modules'||d.name.startsWith('.')?[]:d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]);}
for(const f of walk(root)){
 const rel=path.relative(root,f);if(fs.lstatSync(f).isSymbolicLink())throw Error('SYMLINK_FORBIDDEN '+rel);
 if(/\.(mjs|json|md)$/.test(f)){
  const text=fs.readFileSync(f,'utf8');
  if(/\/Users\/|\/home\/|gh_[a-z0-9]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9]{10}/.test(text))throw Error('NONPORTABLE_OR_SENSITIVE_LITERAL '+rel);
  if(f.endsWith('.json'))JSON.parse(text);
 }
 if(f.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status)throw Error(rel+' syntax failed: '+r.stderr);count++;}
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.private!==true||pkg.license!=='MIT')throw Error('RELEASE_PERMISSION_NOT_CONFIRMED');
if(!Array.isArray(pkg.files)||new Set(pkg.files).size!==pkg.files.length||pkg.files.some(rel=>path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..')||/[?*]/.test(rel)||!fs.statSync(path.join(root,rel)).isFile()))throw Error('EXACT_PACKAGE_FILE_ALLOWLIST_REQUIRED');
await import('../core/run-school-publisher.mjs');
console.log(JSON.stringify({ok:true,syntaxChecked:count,coreImport:true,scan:'known private-path and secret literal patterns; not a complete privacy audit'}));

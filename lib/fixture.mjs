import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {compilePacket,sha256File} from './wrapper/content-packet.mjs';
export const REVIEW_FLAGS=['factsVerified','visualsVerified','accountIdentityVerified','originalityVerified','componentsVerified','sourceUrlsFetched','mediaTextChecked','mediaPixelsChecked'];
export const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// Resolve only OS-owned macOS aliases. User-created links remain forbidden.
export function systemCanonical(value){
 let resolved=path.resolve(value);
 if(process.platform==='darwin')for(const prefix of ['/tmp','/var']){
  if((resolved===prefix||resolved.startsWith(prefix+path.sep))&&fs.realpathSync(prefix)==='/private'+prefix)resolved='/private'+resolved;
 }
 return resolved;
}
export function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('REGULAR_FILE_REQUIRED');return s;}
export function confined(root,file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('ASSET_PATH_INVALID');
 const base=fs.realpathSync(root),relative=path.relative(base,path.resolve(file));
 if(relative===''||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('FIXTURE_PATH_ESCAPE');
 // Check every component before opening the leaf; no symlink-following reads.
 let current=base;for(const part of relative.split(path.sep)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('FIXTURE_SYMLINK_FORBIDDEN');}
 regular(file);if(fs.realpathSync(file)!==path.resolve(file))throw Error('FIXTURE_PATH_ALIAS');return path.resolve(file);
}
export function createFixture(directory,{title='虚构示例：内容发布保护',body='仅测试离线合同，不代表真实学校或作者。'}={}){
 const parent=fs.realpathSync(path.dirname(path.resolve(directory))),root=path.join(parent,path.basename(directory));
 fs.mkdirSync(root,{mode:0o700});
 const put=(name,bytes)=>{const file=path.join(root,name);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});return file;};
 const video=put('synthetic-video.mp4',Buffer.from('SYNTHETIC OFFLINE FIXTURE; NOT PLAYABLE MEDIA\n'));
 const source=put('source.txt','虚构离线测试来源；没有外部链接或真实业务数据。\n');
 const transcript=put('transcript.txt',body+'\n');
 const cover=put('synthetic-cover.png',Buffer.from('SYNTHETIC OFFLINE COVER; NOT A REAL IMAGE\n'));
 const packet={schema:'school-content-publish/v1',contentId:'offline-demo',subject:{kind:'school',key:'offline-example'},contentType:'video',sourceRefs:[{type:'file',path:source}],targets:[{platform:'douyin',accountKey:'demo',title,description:body,topics:['离线测试'],media:{videoPath:video,transcriptPath:transcript},cover:{uploadCustomCover:true,vertical3x4Path:cover,horizontal4x3Path:cover}}]};
 const pkg=compilePacket(packet).packages[0];const bytes=JSON.stringify(pkg,null,2)+'\n';
 const file=put('package.json',bytes),review={schema:'offline-review/v1',mode:'synthetic-only',packageSha256:hash(bytes),platform:'douyin',accountKey:'demo',actions:['check','draft','publish'],checks:Object.fromEntries(REVIEW_FLAGS.map(k=>[k,true])),mediaReviewIssues:[],truthVerified:false};
 put('review.json',JSON.stringify(review,null,2)+'\n');
 const assets=Object.fromEntries(pkg.studio.assetBindings.map(b=>[path.basename(b.path),{sha256:b.sha256,size:b.size}]));
 put('.offline-fixture.json',JSON.stringify({schema:'offline-fixture/v1',synthetic:true,assets},null,2)+'\n');
 return {ok:true,status:'SYNTHETIC_FIXTURE_CREATED',packagePath:file,reviewPath:path.join(root,'review.json'),publicationPerformed:false,reviewAssurance:'mock_contract_only; no factual or pixel verification'};
}
export function readFixture(file){
 file=systemCanonical(file);regular(file);const parent=path.dirname(file);
 const root=fs.realpathSync(parent);if(root!==parent)throw Error('FIXTURE_ROOT_SYMLINK_FORBIDDEN');
 file=confined(root,file);
 const marker=confined(root,path.join(root,'.offline-fixture.json'));const manifest=JSON.parse(fs.readFileSync(marker,'utf8'));
 if(manifest.schema!=='offline-fixture/v1'||manifest.synthetic!==true||!manifest.assets||typeof manifest.assets!=='object'||Array.isArray(manifest.assets))throw Error('SYNTHETIC_FIXTURE_REQUIRED');
 const bytes=fs.readFileSync(file);if(bytes.length>1024*1024)throw Error('PACKAGE_TOO_LARGE');const pkg=JSON.parse(bytes);
 return {root,file,bytes,pkg,manifest,sha256:hash(bytes)};
}
export function preflightFixturePaths(snapshot){
 const {root,pkg,manifest}=snapshot;
 // Only fixed compile-owned slots are allowed; unsupported preparation lineage
 // is verified by the extracted module's own tests, not read by the CLI demo.
 if(pkg.studio?.videoPreparation!==undefined)throw Error('DEMO_PREPARATION_ROUTE_UNSUPPORTED');
 const paths=[];for(const k of ['videoPath','articlePath','coverPath','layoutPath'])if(pkg[k]!==undefined)paths.push(pkg[k]);
 for(const k of ['vertical3x4Path','horizontal4x3Path','horizontal16x9Path'])if(pkg.cover?.[k]!==undefined)paths.push(pkg.cover[k]);
 if(Array.isArray(pkg.images))paths.push(...pkg.images);
 for(const ref of pkg.studio?.sourceRefs||[])if(ref?.type==='file')paths.push(ref.path);
 if(pkg.studio?.requested?.media?.transcriptPath!==undefined)paths.push(pkg.studio.requested.media.transcriptPath);
 for(const binding of pkg.studio?.assetBindings||[])paths.push(binding?.path);
 // The original fingerprint recursively hashes every *Path field. Validate
 // that exact recursive surface too, before allowing fingerprintPackage to run.
 const scan=(value,key='')=>{
  if(typeof value==='string'&&value&&(/Path$/.test(key)||['images','imagesPaths'].includes(key))){paths.push(value);return;}
  if(Array.isArray(value)){for(const child of value)scan(child,key);return;}
  if(value&&typeof value==='object')for(const [childKey,child]of Object.entries(value))scan(child,childKey);
 };
 scan(pkg);
 // Reject all shape/coverage and escape failures before any supplied asset read.
 for(const file of paths){if(typeof file!=='string'||!path.isAbsolute(file))throw Error('ASSET_PATH_INVALID');const rel=path.relative(root,file);if(rel!==path.basename(rel)||rel.startsWith('.')||!Object.hasOwn(manifest.assets,rel))throw Error('FIXTURE_PATH_ESCAPE');}
 for(const file of new Set(paths)){
  confined(root,file);const expected=manifest.assets[path.basename(file)];const stat=regular(file);
  if(stat.size!==expected.size||sha256File(file)!==expected.sha256)throw Error('SYNTHETIC_ASSET_CHANGED');
 }
}

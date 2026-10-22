#!/usr/bin/env node
import {simulate,createFixture,SCENARIOS} from '../lib/offline.mjs';
import {inspectReadOnly} from '../lib/read-only.mjs';
const help=`maxiaojian-publish 0.1.0
Native publisher (requires configured Ego runtime and exact account binding).
  maxiaojian-publish --list
  maxiaojian-publish --account-status <platform> <account-key>
  maxiaojian-publish <package.json> --action check|draft|publish|status [--execute]
    [--confirm-original-rights] [--prepared-state <state.json>]
  maxiaojian-publish read-only --platform <platform> --space-id <id> --page <pN>
  maxiaojian-publish init-demo <new-directory>
  maxiaojian-publish simulate <generated-package.json> --state-root <isolated-directory>
    [--action check|draft|publish|status] [--scenario ${SCENARIOS.join('|')}] [--execute]
Native draft/publish require --execute. Simulation is isolated and never publishes.
See README.md for account, browser, media and configuration requirements.`;
export async function main(argv){
 if(argv.length===0||argv.length===1&&['--help','-h'].includes(argv[0]))return console.log(help);
 if(argv[0]==='read-only'){
  const o={},keys={'--platform':'platform','--space-id':'spaceId','--page':'page','--expected-identity-sha256':'expectedIdentitySha256'};
  for(let i=1;i<argv.length;i++){const k=keys[argv[i]];if(!k||o[k]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('READONLY_INVALID_OPTION');o[k]=argv[++i];}
  o.spaceId=Number(o.spaceId);const result=await inspectReadOnly(o);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=2;return;
 }
 if(argv[0]==='init-demo'){if(argv.length!==2||argv[1].startsWith('--'))throw Error('NEW_FIXTURE_DIRECTORY_REQUIRED');console.log(JSON.stringify(createFixture(argv[1]),null,2));return;}
 if(argv[0]!=='simulate'){const {runSchoolPublisher}=await import('../core/run-school-publisher.mjs');const r=await runSchoolPublisher(argv);console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=2;return;}
 const file=argv[1];if(!file||file.startsWith('--'))throw Error('PACKAGE_REQUIRED');
 const opts={};const names={'--state-root':'stateRoot','--action':'action','--scenario':'scenario'};
 for(let i=2;i<argv.length;i++){
  if(argv[i]==='--execute'){if(opts.execute)throw Error('DUPLICATE_OPTION');opts.execute=true;continue;}
  const key=names[argv[i]];if(!key||opts[key]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('INVALID_OPTION');opts[key]=argv[++i];
 }
 const r=await simulate(file,opts);console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=2;
}
try{await main(process.argv.slice(2));}catch(e){console.error(JSON.stringify({ok:false,code:e.message,publicationPerformed:false}));process.exitCode=2;}

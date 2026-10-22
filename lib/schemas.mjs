import {normalizeConfig,validateConfig} from '../core/lib/config.mjs';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const ajv=new Ajv2020({allErrors:true,strict:true});
const names={compiled:'offline-compiled-package',accounts:'accounts',publisher:'publisher-config',intent:'offline-package'};
const validators=Object.fromEntries(Object.entries(names).map(([name,file])=>[name,ajv.compile(JSON.parse(fs.readFileSync(new URL('../schemas/'+file+'.schema.json',import.meta.url),'utf8')))]));
export function validateDocument(kind,value){
 const validator=validators[kind];if(!validator)throw Error('UNKNOWN_SCHEMA');
 if(!validator(value))return {ok:false,code:'SCHEMA_VALIDATION_FAILED',issues:validator.errors.map(x=>({path:x.instancePath,keyword:x.keyword}))};
 if(kind==='publisher'){
  const errors=validateConfig(normalizeConfig(value));
  if(errors.length)return {ok:false,code:'CONFIG_SEMANTIC_VALIDATION_FAILED',issues:errors.map(()=>({keyword:'semantic'}))};
 }
 if(kind==='accounts')for(const entry of Object.values(value.platforms)){
  const keys=entry.accounts.map(account=>account.key);
  if(new Set(keys).size!==keys.length)return {ok:false,code:'ACCOUNT_BINDING_AMBIGUOUS',issues:[{keyword:'uniqueAccountKey'}]};
 }
 return {ok:true};
}

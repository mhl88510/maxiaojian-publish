import {fileURLToPath} from "node:url";
import fs from 'node:fs';
import {FORM_HOSTS} from './ego-form-backend.mjs';
export const ARTICLE_CONTRACTS= process.env.MAXIAOJIAN_ARTICLE_CONTRACTS || fileURLToPath(new URL("../../config/article-contracts.json", import.meta.url));
export function registryTarget(pkg,account) {
 const t=pkg.schoolAccount||{},mapped=account.ego||{};
 return {...pkg,schoolAccount:{...mapped,...t,egoProfileId:t.egoProfileId||mapped.profileId||'',accountName:account.name}};
}
export async function resolveArticleContract(pkg,action,execute,{contractPath=ARTICLE_CONTRACTS}={}) {
 if(pkg.pageContract)return pkg;
 const preset=JSON.parse(fs.readFileSync(contractPath,'utf8')).platforms[pkg.schoolAccount.platform];
 if(!preset)throw new Error('PLATFORM_PAGE_CONTRACT_NOT_VERIFIED');
 if(!preset.titleSelector||!preset.bodySelector||!preset.editorPathPattern)throw new Error('ARTICLE_EDITOR_CONTRACT_NOT_VERIFIED');
 const b=pkg.schoolAccount;
 const script=`const b=${JSON.stringify(b)};const spaces=await listTaskSpaces();const s=spaces.find(x=>x.id===b.taskSpaceId&&x.name===b.taskSpaceName);if(!s||s.ownership!=='agent'||(b.egoProfileId&&s.profileId!==b.egoProfileId))throw new Error('EXACT_AGENT_SESSION_REQUIRED');const t=await taskSpace(b.taskSpaceId);console.log('SCHOOL_EDITOR_URL:'+JSON.stringify({url:await t.page(b.pageLabel).url()}));`;
 const r=await execute('ego-browser',['nodejs'],{input:script});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('SCHOOL_EDITOR_URL:'));
 if(r.code!==0||!line)throw new Error('EDITOR_URL_UNAVAILABLE');
 const url=JSON.parse(line.slice('SCHOOL_EDITOR_URL:'.length)).url,u=new URL(url);
 if(!FORM_HOSTS[pkg.schoolAccount.platform]?.includes(u.hostname)||!new RegExp(preset.editorPathPattern).test(u.pathname))throw new Error('CURRENT_PAGE_NOT_ARTICLE_EDITOR');
 return {...pkg,pageContract:{...preset,editorUrl:url}};
}
export function assertArticleMutationAllowed(pkg,account,action) {
 if(!['draft','publish'].includes(action))return;
 const id=pkg.pageContract?.editorUrl?.match(/\/p\/(\d+)\/edit/)?.[1];
 if(id&&(account.protectedContentIds||[]).includes(id))throw new Error('EXISTING_PUBLISHED_ARTICLE_PROTECTED');
 if(id)throw new Error('ARTICLE_EDITOR_STATE_REQUIRES_DRAFT_VERIFICATION');
}

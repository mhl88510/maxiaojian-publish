// Reuse installed OpenCLI read adapters with Ego's documented Page API. This
// is not the Browser Bridge CLI transport, and never launches another browser.
export const OPENCLI_PACKAGE=process.env.MAXIAOJIAN_OPENCLI_PACKAGE || "OPTIONAL_OPENCLI_NOT_CONFIGURED";
const COMMANDS=new Set(['whoami','videos','stats']);
const MARKER='__SCHOOL_OPENCLI_EGO_READ__';
export function buildEgoOpencliReadScript(route,command,args){
 if(!COMMANDS.has(command)||route.platform!=='douyin')throw new Error('OPENCLI_EGO_READ_COMMAND_FORBIDDEN');
 const binding={spaceId:route.task_space_id,spaceName:route.task_space_name,pageLabel:route.page_label,profileId:route.ego_profile_id,name:route.account_name,publicId:String(route.public_account_id||'')};
 if(!Number.isSafeInteger(binding.spaceId)||!binding.spaceName||!/^p[1-9][0-9]*$/.test(binding.pageLabel)||!binding.profileId||!binding.name||!binding.publicId)throw new Error('OPENCLI_EGO_BINDING_REQUIRED');
 return `
const marker=${JSON.stringify(MARKER)};
try {
 const expected=${JSON.stringify(binding)};
 const spaces=await listTaskSpaces();
 const matches=spaces.filter(s=>Number(s.id)===expected.spaceId&&s.name===expected.spaceName&&s.profileId===expected.profileId);
 if(matches.length!==1||matches[0].ownership!=='agent')throw new Error('EGO_SPACE_NOT_AGENT_OWNED');
 const task=await taskSpace(expected.spaceId);
 if(task.ownership!=='agent'||task.name!==expected.spaceName)throw new Error('EGO_SPACE_CHANGED');
 const tabs=await task.tabs();const matchesPage=tabs.filter(t=>t.label===expected.pageLabel);
 if(matchesPage.length!==1)throw new Error('EGO_PAGE_BINDING_CHANGED');
 const page=task.page(expected.pageLabel);
 const current=new URL(await page.url());
 if(current.protocol!=='https:'||current.hostname!=='creator.douyin.com')throw new Error('EGO_PLATFORM_HOST_MISMATCH');
 // Never navigate away from an editor, an upload, or a login page.
 if(!['/creator-micro/home','/creator-micro/content/manage'].includes(current.pathname))throw new Error('EGO_READ_SURFACE_REQUIRED');
 if(current.pathname!=='/creator-micro/home')await page.goto('https://creator.douyin.com/creator-micro/home');
 await page.waitForFunction(({name,id})=>{
  const compact=s=>String(s||'').normalize('NFC').replace(/\\s+/g,' ').trim();
  const text=compact(document.body.innerText);return text.includes(compact(name))&&text.includes(id);
 },{name:expected.name,id:expected.publicId},{timeout:20000});
 const header=await page.evaluate(()=>document.body.innerText);
 const compact=s=>String(s||'').normalize('NFC').replace(/\\s+/g,' ').trim();
 if(!compact(header).includes(compact(expected.name))||!header.includes(expected.publicId))throw new Error('EGO_VISIBLE_ACCOUNT_MISMATCH');
 const registry=await import(${JSON.stringify(OPENCLI_PACKAGE+'/dist/src/registry-api.js')});
 await import(${JSON.stringify(OPENCLI_PACKAGE+'/clis/douyin/auth.js')});
 await import(${JSON.stringify(OPENCLI_PACKAGE+'/clis/douyin/videos.js')});
 await import(${JSON.stringify(OPENCLI_PACKAGE+'/clis/douyin/stats.js')});
 const definition=registry.getRegistry().get(${JSON.stringify('douyin/'+command)});
 if(!definition||definition.access!=='read'||typeof definition.func!=='function')throw new Error('OPENCLI_READ_ADAPTER_REQUIRED');
 const safePage={
  evaluate:(script)=>page.evaluate(script),
  goto:async url=>{
   const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='creator.douyin.com'||u.pathname!=='/')throw new Error('OPENCLI_READ_NAVIGATION_FORBIDDEN');
   // The adapter asks for the same creator origin. The exact existing home
   // page is already identity-verified; no new tab or origin navigation needed.
  }
 };
 const result=await definition.func(safePage,${JSON.stringify(args)});
 const afterSpaces=await listTaskSpaces();
 const after=afterSpaces.filter(s=>Number(s.id)===expected.spaceId&&s.name===expected.spaceName&&s.profileId===expected.profileId);
 if(after.length!==1||after[0].ownership!=='agent')throw new Error('EGO_SPACE_CHANGED');
 console.log(marker+JSON.stringify({ok:true,data:result}));
}catch(error){console.log(marker+JSON.stringify({ok:false,code:String(error.message)}));}
`;
}
export async function executeEgoOpencliRead(route,command,args,execute){


 const script=buildEgoOpencliReadScript(route,command,args);
 const result=await execute('ego-browser',['nodejs'],{input:script,timeoutMs:150000});
 // Ego routes console output to stderr when called by a non-TTY subprocess.
 const lines=[result.stdout,result.stderr].flatMap(s=>String(s||'').split('\n')).filter(l=>l.startsWith(MARKER));
 if(result.code!==0||lines.length!==1)throw new Error('OPENCLI_EGO_TRANSPORT_FAILED');
 let data;try{data=JSON.parse(lines[0].slice(MARKER.length));}catch{throw new Error('OPENCLI_EGO_INVALID_RESULT');}
 if(!data.ok)throw new Error(data.code||'OPENCLI_EGO_READ_FAILED');
 return data.data;
}

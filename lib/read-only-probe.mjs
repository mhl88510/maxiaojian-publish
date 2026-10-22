// Fixed visible-DOM collector. No input values, stores, requests or page mutation.
export function collectVisibleState(platform){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
 const text=document.body?.innerText||'';
 const links=[...document.querySelectorAll('a[href]')].filter(visible);
 const identities=[];
 const add=(kind,value)=>{if(typeof value==='string'&&value.length>0&&value.length<=160&&!identities.some(x=>x.kind===kind&&x.value===value))identities.push({kind,value});};
 for(const a of links){
  let u;try{u=new URL(a.getAttribute('href'),location.origin);}catch{continue;}
  if(platform==='toutiao'&&u.hostname==='www.toutiao.com'&&/^\/c\/user\/\d+\/$/.test(u.pathname)){add('public-id',u.pathname.split('/')[3]);}
  if(platform==='weibo'&&u.hostname==='weibo.com'&&/^\/u\/\d+$/.test(u.pathname)&&a.closest('nav'))add('public-id',u.pathname.split('/')[2]);
  if(platform==='zhihu'&&u.hostname==='www.zhihu.com'&&/^\/people\/[^/]+$/.test(u.pathname))add('public-slug',u.pathname.split('/')[2]);
  if(platform==='bilibili'&&u.hostname==='space.bilibili.com'&&/^\/\d+\/?$/.test(u.pathname)&&(a.closest('header,[class*=header]')||location.hostname==='account.bilibili.com'&&location.pathname==='/account/home'&&a.innerText.trim()==='个人空间'))add('public-id',u.pathname.split('/')[1]);
  if(platform==='sohu'&&u.hostname==='mp.sohu.com'&&u.pathname.startsWith('/mpfe/v4/')&&['任务中心','互动管理','数据分析'].includes(a.innerText.trim()))add('account-route-id',u.searchParams.get('accountId'));
 }
 if(platform==='sohu'&&location.pathname.startsWith('/mpfe/v4/')){
  const names=[...document.querySelectorAll('.user-name')].filter(visible).map(e=>e.innerText.trim()).filter(Boolean);
  if(names.length===1){const id=new URL(location.href).searchParams.get('accountId');if(/^\d+$/.test(id||''))add('account-route-id',id);else add('visible-name',names[0]);}
 }
 // Douyin identity is intentionally unavailable outside its dedicated home view.
 if(platform==='douyin'&&location.pathname==='/creator-micro/home'){
  const ids=[...text.matchAll(/抖音号：\s*([A-Za-z0-9_.-]+)/g)].map(x=>x[1]);if(ids.length===1)add('visible-public-id',ids[0]);
 }
 const restriction=/您的账号已被封停|账号已封禁/.test(text);
 const loginRoute=/\/(?:login|signin)(?:[./]|$)/i.test(location.pathname);
 const loginForm=!![...document.querySelectorAll('input[type=password],input[placeholder="验证码"],input[placeholder="手机号"]')].find(visible);
 const loginText=/短信登录|邮箱登录|扫码登录|手机号登录/.test(text);
 const createChannel=platform==='youtube'&&/创建频道/.test([...document.querySelectorAll('[role=dialog],tp-yt-paper-dialog')].filter(visible).map(e=>e.innerText).join(' '));
 const overlay=!![...document.querySelectorAll('[role=dialog],tp-yt-paper-dialog')].find(visible);
 const inventoryCount=platform==='douyin'&&location.pathname==='/creator-micro/content/manage'?Number(text.match(/作品\s*\((\d+)\)/)?.[1]??NaN):NaN;
 return {host:location.hostname,path:location.pathname,identities:identities.slice(0,9),identityOverflow:identities.length>8,restricted:restriction,loginRequired:loginRoute||loginForm||loginText&&identities.length===0,sessionAmbiguous:loginText&&identities.length>0,createChannel,overlayVisible:overlay,managementVisible:/内容管理|作品管理/.test(text),publishedStatusVisible:/已发布|已发表/.test(text),inventoryCount:Number.isSafeInteger(inventoryCount)?inventoryCount:null,bodyHasVisibleText:text.trim().length>0};
}

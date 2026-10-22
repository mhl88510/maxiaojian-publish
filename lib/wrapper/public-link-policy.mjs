// User's project content policy, not a claim about all platform regulations.
import fs from 'node:fs';
const HOSTS={xiaohongshu:['xiaohongshu.com','xhslink.com'],douyin:['douyin.com'],wechat_channels:['channels.weixin.qq.com'],wechat_official:['mp.weixin.qq.com'],zhihu:['zhihu.com'],baijiahao:['baijiahao.baidu.com'],sohu:['sohu.com'],toutiao:['toutiao.com'],netease:['163.com'],bilibili:['bilibili.com','b23.tv'],youtube:['youtube.com','youtu.be']};
export function publicLinkIssues(platform,fields){
 const allowed=HOSTS[platform]||[];
 return Object.entries(fields).flatMap(([field,value])=>{
  let text=String(value??'').normalize('NFKC').replace(/[\u200b\ufeff]/gu,'').replace(/\[\.\]|\(\.\)|【\.】|。/g,'.');
  for(let i=0;i<2;i++){try{text=decodeURIComponent(text)}catch{break}}
  // Asset src URLs are transport, not authored text or clickable href. Text,
  // markdown links and hrefs remain checked; this is not OCR/redirect verification.
  text=text.replace(/\bsrc\s*=\s*(["']).*?\1/gi,'');
  // A Markdown image with an absolute local filesystem path is an asset
  // reference, not a public URL. Remove only the destination, preserving alt
  // text for policy checks; remote and clickable Markdown links remain intact.
  text=text.replace(/!\[([^\]]*)\]\((\/(?!\/)[^\s)]*)\)/g,'![$1]()');
  const domains=[...text.matchAll(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,24})(?=[^a-z0-9-]|$)/gi)].filter(m=>!(text[m.index-1]==='/'&&text[m.index-2]!=='/')).filter(m=>{
   // The literal official course name is a framework identifier, not a URL.
   // Only exempt this exact plain-text Chinese course context; schemes,
   // markdown destinations, href values, domains and paths remain checked.
   const before=text.slice(0,m.index),after=text.slice(m.index+m[0].length);
   return !(m[0]==='Vue.js'&&after.startsWith('前端开发')&&/^$|[\s\u3400-\u9fff]$/u.test(before));
  }).map(m=>m[0].toLowerCase());
  const external=domains.some(host=>!allowed.some(base=>host===base||host.endsWith('.'+base)));
  const unparsedScheme=/(?:https?|hxxps?):\s*\/\//i.test(text)&&domains.length===0;
  return external||unparsedScheme?[{field,code:'external_url'}]:[];
 });
}
export function packagePublicLinkIssues(pkg){
 const fields={};
 for(const key of ['title','description','body','summary','digest','author','cardText','captionText','burnedCTA','xhsTitle','douyinTitle','wechatTitle','xhsDescription','douyinDescription','wechatDescription'])if(typeof pkg[key]==='string')fields[key]=pkg[key];
 for(const key of ['topics','xhsTopics','douyinTopics','wechatTags'])if(Array.isArray(pkg[key]))fields[key]=pkg[key].join('\n');
 for(const [i,image] of (Array.isArray(pkg.images)?pkg.images:[]).entries())if(typeof image?.text==='string')fields[`images[${i}].text`]=image.text;
 for(const [key,obj] of [['cover',pkg.cover],['media',pkg.media]])for(const name of ['text','captionText','burnedCTA'])if(typeof obj?.[name]==='string')fields[`${key}.${name}`]=obj[name];
 for(const key of ['articlePath','layoutPath'])if(pkg[key]!==undefined){
  try{fields[key]=fs.readFileSync(pkg[key],'utf8')}catch{return [{field:key,code:'PUBLIC_TEXT_UNREADABLE'}]}
 }
 return publicLinkIssues(pkg.schoolAccount?.platform,fields);
}

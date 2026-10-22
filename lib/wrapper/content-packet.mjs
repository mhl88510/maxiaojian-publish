#!/usr/bin/env node
// Pure-local compiler. It never starts the publisher, a browser, or a network request.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildArticleImagePlan} from './article-image-plan.mjs';
import {validateDouyinPoiIntent} from './douyin-poi-intent.mjs';
import {loadVideoPreparationReceipt,preparationBindingPaths} from './video-preparation-receipt.mjs';
import {publicLinkIssues} from './public-link-policy.mjs';

export const SCHEMA = 'school-content-publish/v1';
const VIDEO = new Set(['xiaohongshu', 'douyin', 'wechat_channels', 'bilibili', 'youtube']);
const ARTICLE = new Set(['wechat_official', 'zhihu', 'baijiahao', 'sohu', 'toutiao', 'netease']);
const TARGET_KEYS = ['platform','accountKey','title','description','allowEmptyDescription','topics','body','articlePath','summary','author','media','cover','images','declarations','components','platformFields','approval'];
const FIELD_MAP = {
  xiaohongshu: ['xhsPoi'], douyin: ['douyinPoi','douyinSchedule'], wechat_channels: [],
  bilibili: ['bilibiliAllowedAutoTags'],
  youtube: ['youtubeAudience','youtubeVisibility','youtubeCategory','youtubeLanguage','youtubePlaylist','youtubeLicense','youtubePaidPromotion','youtubeAlteredContent','youtubeAllowEmbedding','youtubeNotifySubscribers'],
  sohu: ['category','declaration'], zhihu: [], baijiahao: [], toutiao: ['toutiaoLocation','toutiaoFirstPublish','toutiaoMicroHeadlineSync'], netease: [],
  wechat_official: ['layoutPath','digest','showCoverPic','commentSettings','scheduledAt'],
};
const REQUIRED_REVIEW = Object.freeze({factsVerified:false,visualsVerified:false,accountIdentityVerified:false,originalityVerified:false,componentsVerified:false,publicationPerformed:false,publicReadbackVerified:false});
function fail(message) { throw new Error(message); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); }
function keys(value, allowed, label) { object(value,label); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`UNSUPPORTED_FIELD: ${label}.${key}`); }
function requiredString(value,label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`); return value; }
function safeKey(value,label) { requiredString(value,label); if (!/^[a-zA-Z0-9_-]+$/.test(value)) fail(`${label} must be a safe key`); return value; }
function normalizedSubject(packet) {
  const hasSchoolKey=Object.prototype.hasOwnProperty.call(packet,'schoolKey');
  const hasSubject=Object.prototype.hasOwnProperty.call(packet,'subject');
  if(!hasSubject) {
    if(!hasSchoolKey) fail('schoolKey is required when subject is omitted');
    const key=safeKey(packet.schoolKey,'schoolKey');
    return {subject:{kind:'school',key},schoolKey:key};
  }
  const input=packet.subject;
  keys(input,['kind','key','name'],'subject');
  if(!['school','personal_ip'].includes(input.kind)) fail('subject.kind must be school or personal_ip');
  const key=safeKey(input.key,'subject.key');
  if(input.name!==undefined) requiredString(input.name,'subject.name');
  const subject={kind:input.kind,key,...(input.name===undefined?{}:{name:input.name})};
  if(input.kind==='school') {
    if(hasSchoolKey) {
      const schoolKey=safeKey(packet.schoolKey,'schoolKey');
      if(schoolKey!==key) fail('SUBJECT_SCHOOL_KEY_CONFLICT');
    }
    return {subject,schoolKey:key};
  }
  if(hasSchoolKey) fail('PERSONAL_SUBJECT_CANNOT_INCLUDE_SCHOOL_KEY');
  return {subject,schoolKey:undefined};
}
export function sha256File(file) {
  const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(65536);
  try { let count; while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,count)); }
  finally {fs.closeSync(fd);}
  return hash.digest('hex');
}
function bindFile(file,label,bindings,expected) {
  requiredString(file,label);
  if (!path.isAbsolute(file)) fail(`ABSOLUTE_PATH_REQUIRED: ${label}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`FILE_NOT_FOUND: ${label}`);
  const resolved = path.resolve(file), sha256 = sha256File(resolved);
  if (expected !== undefined && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || sha256 !== expected.toLowerCase())) fail(`SHA256_MISMATCH: ${label}`);
  bindings.set(resolved,{path:resolved,sha256,size:fs.statSync(resolved).size});
  return resolved;
}
function normalizeTopics(value,label) {
  if (!Array.isArray(value) || value.some(x=>typeof x !== 'string' || !x.trim())) fail(`${label} must be an explicit array of nonempty strings`);
  const tags = value.map(x=>x.trim().replace(/^#+\s*/,''));
  if (tags.some(x=>!x) || new Set(tags).size !== tags.length) fail(`DUPLICATE_OR_EMPTY_TOPIC: ${label}`);
  return tags;
}
const CONTACT = [
  ['phone', /(?:^|[^\d])(?:1[3-9](?:[\s—–·-]*\d){9}|0\d{2,3}[\s—–-]?\d{7,8})(?!\d)/u],
  ['wechat', /微信|[Vv微威]\s*信|加\s*[Vv]|VX\s*[:：]/u],
  ['external_url', /https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|cn|net|org|edu|gov|io|co|info|top|xyz)(?:\b|\/)/iu],
  ['qr_code', /二维码|二維碼|扫码|掃碼/u],
];
const PRIVATE = ['private_message_cta', /私信|私聊|私訊|私[\s._-]*信|加我/u];
export function textPolicyIssues(platform, fields, {allowPrivateMessageTrial=false}={}) {
  const linkIssues=publicLinkIssues(platform,fields);
  if (!['xiaohongshu','douyin','baijiahao'].includes(platform)) return linkIssues;
  const rules = platform === 'xiaohongshu' && !allowPrivateMessageTrial ? [...CONTACT,PRIVATE] : CONTACT;
  return [...linkIssues,...Object.entries(fields).flatMap(([field,value])=> {
    const text=String(value??'').normalize('NFKC').replace(/[\u200b\ufeff]/gu,'');
    return rules.filter(([,pattern])=>pattern.test(text)).map(([code])=>({field,code}));
  })].filter((issue,index,all)=>all.findIndex(x=>x.field===issue.field&&x.code===issue.code)===index);
}
function sourceRefs(value,bindings) {
  if (!Array.isArray(value) || !value.length) fail('sourceRefs must be a nonempty array');
  return value.map((ref,index)=> {
    const label=`sourceRefs[${index}]`;
    keys(ref,['type','path','url','sha256','role','note'],label);
    if (ref.type === 'file') {
      if (ref.url !== undefined) fail(`${label}: file/url contradiction`);
      const file=bindFile(ref.path,`${label}.path`,bindings,ref.sha256);
      return {...ref,path:file,sha256:bindings.get(file).sha256};
    }
    if (ref.type === 'url') {
      if (ref.path !== undefined || ref.sha256 !== undefined) fail(`${label}: URL cannot claim a locally verified file hash`);
      let url; try {url = new URL(ref.url);} catch {fail(`${label}: invalid URL`);}
      if (!['https:','http:'].includes(url.protocol) || url.username || url.password) fail(`${label}: invalid public URL`);
      // Provenance is not a credential store. Never echo the URL or query values on rejection.
      const accessKeys=/^(?:access[_-]?token|refresh[_-]?token|token|session[_-]?id|session|signature|sig|authorization|auth|auth[_-]?token|api[_-]?key|app[_-]?secret|secret|password|passwd|credential|cookie|ticket|code|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)|ossaccesskeyid)$/i;
      if([...url.searchParams.keys()].some(key=>accessKeys.test(key))) fail(`${label}: access-bearing URL query is forbidden`);
      return {...ref,retrieved:false};
    }
    fail(`${label}.type must be file or url`);
  });
}
function nativeBinding(matrix,platform,accountKey) {
  const matches=(matrix?.platforms?.[platform]?.accounts||[]).filter(x=>x.key===accountKey);
  if(matches.length!==1) return null;
  const e=matches[0].ego;
  if(!e || !e.profileId || !Number.isSafeInteger(e.taskSpaceId) || e.taskSpaceId<1 || !e.taskSpaceName || !/^p[1-9]\d*$/.test(e.pageLabel||'') || !e.targetId) return null;
  return {egoProfileId:e.profileId,taskSpaceId:e.taskSpaceId,taskSpaceName:e.taskSpaceName,pageLabel:e.pageLabel,targetId:e.targetId};
}
function compileTarget(packet,target,index,globalBindings,refs,{accountMatrix,subject,videoPreparation:optionsVideoPreparation}={}) {
  const label=`targets[${index}]`; keys(target,TARGET_KEYS,label);
  const platform=safeKey(target.platform,`${label}.platform`), accountKey=safeKey(target.accountKey,`${label}.accountKey`);
  if(!VIDEO.has(platform)&&!ARTICLE.has(platform)) fail(`UNSUPPORTED_PLATFORM: ${platform}`);
  requiredString(target.title,`${label}.title`);
  if(typeof target.description!=='string') fail(`${label}.description must be explicit (core is never final-copy fallback)`);
  if(!target.description.trim()&&target.allowEmptyDescription!==true) fail(`EMPTY_DESCRIPTION_REQUIRES_EXPLICIT_OPT_IN: ${label}`);
  if(target.description.includes('\\n')||target.title.includes('\\n')) fail(`${label}: use actual newlines, not literal escaped newline`);
  const topics=normalizeTopics(target.topics,`${label}.topics`);
  if(platform==='douyin'&&topics.length>5) fail('DOUYIN_AT_MOST_5_TOPICS');
  if(platform==='xiaohongshu'&&topics.some(x=>x.includes('.'))) fail('XHS_DOT_TOPIC_UNSUPPORTED');
  if(packet.contentType==='video'&&!VIDEO.has(platform)) fail(`CONTENT_TYPE_PLATFORM_UNSUPPORTED: video/${platform}`);
  if(packet.contentType==='article'&&!ARTICLE.has(platform)) fail(`CONTENT_TYPE_PLATFORM_UNSUPPORTED: article/${platform}`);
  if(packet.contentType==='image_note'&&!['xiaohongshu','douyin'].includes(platform)) fail(`CONTENT_TYPE_PLATFORM_UNSUPPORTED: image_note/${platform}`);
  const bindings=new Map(globalBindings), pf=target.platformFields||{};
  keys(pf,FIELD_MAP[platform],`${label}.platformFields`);
  if(platform==='douyin'&&pf.douyinSchedule!==undefined) {
    keys(pf.douyinSchedule,['schema','mode','publishAt','timeZone'],`${label}.platformFields.douyinSchedule`);
    const timing=pf.douyinSchedule;
    if(timing.schema!=='douyin-native-schedule-intent/v1'||timing.mode!=='scheduled'||timing.timeZone!=='Asia/Shanghai'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(timing.publishAt||'')||!Number.isFinite(Date.parse(timing.publishAt))||new Date(Date.parse(timing.publishAt)+8*3600_000).toISOString().slice(0,16)!==timing.publishAt.slice(0,16)) fail('DOUYIN_SCHEDULE_INVALID');
  }
  if(platform==='douyin'&&pf.douyinPoi!==undefined) {
    const result=validateDouyinPoiIntent(pf.douyinPoi,refs);
    if(!result.ok) fail(`DOUYIN_POI_INTENT_INVALID: ${result.errors.join(',')}`);
  }
  if(platform==='toutiao') {
    if(pf.toutiaoLocation!==undefined) fail('TOUTIAO_LOCATION_ADAPTER_UNVERIFIED');
    for(const key of ['toutiaoFirstPublish','toutiaoMicroHeadlineSync'])
      if(pf[key]!==undefined&&typeof pf[key]!=='boolean') fail(`INVALID_TOUTIAO_BOOLEAN:${key}`);
  }
  const pkg={subject:structuredClone(subject),schoolAccount:{platform,accountKey},contentType:packet.contentType,title:target.title,description:target.description,topics:[...topics],...structuredClone(pf)};
  if(platform==='wechat_official'&&pf.layoutPath!==undefined) pkg.layoutPath=bindFile(pf.layoutPath,`${label}.platformFields.layoutPath`,bindings);
  if(platform==='wechat_official'&&pf.digest!==undefined&&target.summary!==undefined&&pf.digest!==target.summary) fail('CONTRADICTING_SUMMARY_AND_DIGEST');
  if(platform==='xiaohongshu'&&pf.xhsPoi!==undefined) {
    keys(pf.xhsPoi,['name','address'],`${label}.platformFields.xhsPoi`);
    requiredString(pf.xhsPoi.name,`${label}.platformFields.xhsPoi.name`);
    requiredString(pf.xhsPoi.address,`${label}.platformFields.xhsPoi.address`);
  }
  const publicText={title:target.title,description:target.description,topics:topics.join('\n')};
  let mediaReview=[];
  if(target.media!==undefined) {
    keys(target.media,['videoPath','sha256','burnedCTA','transcriptPath','captionText'],`${label}.media`);
    if(packet.contentType!=='video') fail(`${label}.media is only supported for video`);
    pkg.videoPath=bindFile(target.media.videoPath,`${label}.media.videoPath`,bindings,target.media.sha256);
    if(target.media.transcriptPath) { const file=bindFile(target.media.transcriptPath,`${label}.media.transcriptPath`,bindings); publicText.transcript=fs.readFileSync(file,'utf8'); }
    if(target.media.captionText!==undefined) publicText.captionText=target.media.captionText;
    // Preserve the original media; known burned-in text is still part of the policy gate.
    if(target.media.burnedCTA!==undefined) {
      if(typeof target.media.burnedCTA!=='string') fail(`${label}.media.burnedCTA must be text`);
      publicText.burnedCTA=target.media.burnedCTA;
    }
  } else if(packet.contentType==='video') fail(`${label}.media.videoPath is required`);
  if(target.cover!==undefined) {
    keys(target.cover,['path','uploadCustomCover','vertical3x4Path','horizontal4x3Path','horizontal16x9Path','text'],`${label}.cover`);
    if(target.cover.text!==undefined) publicText.coverText=target.cover.text;
    if(packet.contentType==='article') {
      if(Object.keys(target.cover).some(x=>!['path','text'].includes(x))) fail(`${label}.cover: article requires path, not video slots`);
      pkg.coverPath=bindFile(target.cover.path,`${label}.cover.path`,bindings);
    } else {
      if(target.cover.path!==undefined) fail(`${label}.cover.path ambiguous for video/image_note; use explicit ratio slot`);
      pkg.cover={};
      for(const key of ['vertical3x4Path','horizontal4x3Path','horizontal16x9Path']) if(target.cover[key]!==undefined) pkg.cover[key]=bindFile(target.cover[key],`${label}.cover.${key}`,bindings);
      if(target.cover.uploadCustomCover!==undefined) {
        if(typeof target.cover.uploadCustomCover!=='boolean') fail(`${label}.cover.uploadCustomCover must be boolean`);
        pkg.cover.uploadCustomCover=target.cover.uploadCustomCover;
        if(!target.cover.uploadCustomCover&&Object.keys(pkg.cover).some(x=>x.endsWith('Path'))) fail(`${label}.cover: explicit cover assets contradict uploadCustomCover:false`);
      } else if(Object.keys(pkg.cover).length) pkg.cover.uploadCustomCover=true;
    }
  }
  if(target.images!==undefined) {
    if(packet.contentType==='video') fail(`${label}.images cannot silently turn a true video into an image note`);
    if(!Array.isArray(target.images)||!target.images.length) fail(`${label}.images must be a nonempty array`);
    pkg.images=target.images.map((image,i)=> {
      if(typeof image==='string') return bindFile(image,`${label}.images[${i}]`,bindings);
      keys(image,['path','sha256','text'],`${label}.images[${i}]`);
      if(image.text!==undefined) publicText[`images[${i}].text`]=image.text;
      return bindFile(image.path,`${label}.images[${i}].path`,bindings,image.sha256);
    });
  } else if(packet.contentType==='image_note') fail(`${label}.images is required`);
  if(packet.contentType==='article') {
    if((target.body!==undefined)===(target.articlePath!==undefined)) fail(`${label}: provide exactly one of body or articlePath`);
    if(target.body!==undefined) pkg.body=requiredString(target.body,`${label}.body`);
    else pkg.articlePath=bindFile(target.articlePath,`${label}.articlePath`,bindings);
    publicText.body=pkg.body??fs.readFileSync(pkg.articlePath,'utf8');
    for(const key of ['summary','author']) if(target[key]!==undefined) { if(typeof target[key]!=='string') fail(`${label}.${key} must be a string`); pkg[key]=target[key]; publicText[key]=target[key]; }
  } else if(['body','articlePath','summary','author'].some(x=>target[x]!==undefined)) fail(`${label}: article fields are unsupported for ${packet.contentType}`);
  const declarations=target.declarations||{};
  keys(declarations,['originality','contentSource'],`${label}.declarations`);
  if(declarations.originality!==undefined) {
    if(!['none','original'].includes(declarations.originality)) fail(`${label}.declarations.originality must be none or original`);
    if(VIDEO.has(platform)) {
      if(declarations.originality==='original'&&platform!=='xiaohongshu') fail(`ORIGINAL_DECLARATION_UNSUPPORTED: ${platform}`);
      pkg.platformDeclarations={[platform]:declarations.originality};
    } else if(platform==='wechat_official') pkg.originalDeclaration=declarations.originality;
    else if(platform==='sohu') {
      const choice=declarations.originality==='original'?'原创':'无需声明';
      if(pf.declaration!==undefined&&pf.declaration!==choice) fail('CONTRADICTING_DECLARATIONS');
      pkg.declaration=choice;
    } else if(declarations.originality==='original') fail(`ORIGINAL_DECLARATION_UNSUPPORTED: ${platform}`);
    // Explicit none is no request, not an unsupported originality declaration.
  }
  if(declarations.contentSource!==undefined) {
    if(platform!=='xiaohongshu') fail(`CONTENT_SOURCE_UI_FIELD_UNSUPPORTED: ${platform}; use sourceRefs for provenance`);
    keys(declarations.contentSource,['type','date','locationName','locationAddress'],`${label}.declarations.contentSource`);
    const source=declarations.contentSource;
    if(!['self_shot','ai_generated'].includes(source.type)) fail('XHS_INVALID_CONTENT_SOURCE');
    if(source.type==='self_shot'&&(!/^\d{4}-\d{2}-\d{2}$/.test(source.date||'')||!source.locationName||!source.locationAddress)) fail('XHS_SELF_SHOT_DETAILS_REQUIRED');
    pkg.xhsContentSource=structuredClone(source);
  }
  const components=target.components||{}; keys(components,['privateMessage'],`${label}.components`);
  if(components.privateMessage!==undefined) {
    if(platform!=='xiaohongshu'||components.privateMessage!=='if_available') fail('PRIVATE_MESSAGE_COMPONENT_UNSUPPORTED');
    pkg.xhsPrivateMessageComponent='if_available';
  }
  // Project publishing default: inspect and use a real eligible XHS component if available.
  // This is an execution intent, never a claim that a component exists or is mounted.
  if(platform==='xiaohongshu') pkg.xhsPrivateMessageComponent='if_available';
  // No blanket all-platform contact stripping. Explicit platform restrictions only.
  const approval=target.approval||{}; keys(approval,['status','evidenceRefs','privateMessageTrial'],`${label}.approval`);
  if(approval.status!==undefined&&!['pending','approved','rejected'].includes(approval.status)) fail(`${label}.approval.status invalid`);
  let trial=false;
  if(approval.privateMessageTrial!==undefined) {
    keys(approval.privateMessageTrial,['contentId','accountKey','evidenceRef'],`${label}.approval.privateMessageTrial`);
    const a=approval.privateMessageTrial;
    if(platform!=='xiaohongshu'||packet.contentType!=='video'||a.contentId!==packet.contentId||a.accountKey!==accountKey||!a.evidenceRef||approval.status!=='approved') fail('XHS_PRIVATE_MESSAGE_TRIAL_MUST_BE_EXACT_APPROVED_VIDEO');
    trial=true;
  }
  const issues=textPolicyIssues(platform,publicText,{allowPrivateMessageTrial:trial});
  if(issues.length) fail(`TEXT_POLICY_BLOCKED ${platform}: ${JSON.stringify(issues)}`);
  if(target.media?.burnedCTA!==undefined) mediaReview=textPolicyIssues(platform,{burnedCTA:target.media.burnedCTA},{allowPrivateMessageTrial:trial});
  if(packet.contentType==='video') {
    const titleFields={xiaohongshu:'xhsTitle',douyin:'douyinTitle',wechat_channels:'wechatTitle',bilibili:'bilibiliTitle',youtube:'youtubeTitle'};
    const topicFields={xiaohongshu:'xhsTopics',douyin:'douyinTopics',wechat_channels:'wechatTags',bilibili:'bilibiliTags',youtube:'youtubeTags'};
    const descriptionFields={douyin:'douyinDescription',wechat_channels:'wechatDescription',bilibili:'bilibiliDescription',youtube:'youtubeDescription'};
    pkg[titleFields[platform]]=target.title; pkg[topicFields[platform]]=[...topics];
    if(descriptionFields[platform]) pkg[descriptionFields[platform]]=target.description;
    pkg.backend='ego_video';
  } else pkg.backend=packet.contentType==='image_note'?'ego_image_note':'ego_article';
  // The current matrix is a school/business routing reference, not a personal identity registry.
  // Personal native bindings remain unresolved until their own route is independently verified.
  const native=platform==='wechat_official', binding=native&&subject.kind==='school'?nativeBinding(accountMatrix,platform,accountKey):null;
  if(native) {
    pkg.backend='ego_wechat_official'; pkg.publishingTransport='ego_native_ui';
    pkg.nativeOnly=true; pkg.needsNativeBinding=!binding;
    if(binding) Object.assign(pkg.schoolAccount,binding);
    pkg.nativeTask={kind:'wechat_official_article',accountKey,requiredBindingFields:['egoProfileId','taskSpaceId','taskSpaceName','pageLabel','targetId'],nextStep:binding?'Observe the exact existing Ego account page and verify identity before any UI action.':'Bind the authorized existing Ego account page first. Do not map accountKey to an API slot.',apiFallbackAllowed:false};
    if(pkg.images?.length) pkg.nativeTask.inlineImages={paths:[...pkg.images],writeVerified:false,placementVerified:false,requiredAction:'Insert these actual images at the authorized article positions in the original Ego editor and independently read back; compilation did not upload or place them.'};
  }
  const adapterIssues=[];
  if(subject.kind==='personal_ip') adapterIssues.push('PERSONAL_ACCOUNT_ROUTE_UNVERIFIED');
  if(packet.contentType==='image_note') adapterIssues.push('IMAGE_NOTE_WRITE_ADAPTER_UNVERIFIED');
  if(platform==='douyin'&&pkg.douyinPoi!==undefined) adapterIssues.push('DOUYIN_POI_ADAPTER_REQUIRED');
  // Channels short title is handled by the current native adapter; page write/readback remains a runtime gate.
  if(packet.contentType==='article'&&pkg.images?.length&&!native) adapterIssues.push(`ARTICLE_INLINE_IMAGES_WRITE_UNVERIFIED:${platform}`);
  const articleImages=packet.contentType==='article'?buildArticleImagePlan({body:pkg.body,articlePath:pkg.articlePath,layoutPath:pkg.layoutPath,images:pkg.images||[]}):null;
  if(native&&pkg.nativeTask.inlineImages) pkg.nativeTask.inlineImages.plan=structuredClone(articleImages);
  pkg.studio={schema:SCHEMA,contentId:packet.contentId,...(subject.kind==='school'?{schoolKey:subject.key}:{}),subject:structuredClone(subject),sourceRefs:refs,...(optionsVideoPreparation?{videoPreparation:structuredClone(optionsVideoPreparation)}:{}),
    requested:structuredClone(target),assetBindings:[...bindings.values()],...(articleImages?{articleImages}:{}),
    validation:{scope:'local_structure_and_text_only',...REQUIRED_REVIEW,sourceUrlsFetched:false,mediaTextChecked:!!(target.media?.transcriptPath||target.media?.captionText||target.media?.burnedCTA),mediaPixelsChecked:false,burnedCTAChanged:false,mediaReviewIssues:mediaReview,...(platform==='douyin'&&pkg.douyinPoi!==undefined?{nativePoiVerified:false}:{})},
    needsAdapter:adapterIssues.length>0,adapterIssues,requiresAdapterReason:adapterIssues.join('; ')||null,nativeOnly:native};
  return pkg;
}

export function compilePacket(packet,options={}) {
  keys(packet,['schema','contentId','schoolKey','subject','contentType','sourceRefs','core','targets','videoPreparationReceipt'],'packet');
  if(packet.schema!==SCHEMA) fail(`schema must be ${SCHEMA}`);
  safeKey(packet.contentId,'contentId');
  const {subject,schoolKey}=normalizedSubject(packet);
  if(!['video','article','image_note'].includes(packet.contentType)) fail('contentType must be video, article, or image_note');
  if(packet.core!==undefined) object(packet.core,'core');
  if(!Array.isArray(packet.targets)||!packet.targets.length) fail('targets must explicitly select at least one target');
  const globalBindings=new Map(),refs=sourceRefs(packet.sourceRefs,globalBindings),seen=new Set();
  if(packet.videoPreparationReceipt!==undefined&&packet.contentType!=='video')fail('VIDEO_PREPARATION_REQUIRES_VIDEO_PACKET');
  const videoPreparation=packet.videoPreparationReceipt===undefined?undefined:loadVideoPreparationReceipt(packet.videoPreparationReceipt,subject,globalBindings,packet.contentId);
  if(videoPreparation&&packet.targets.some(t=>videoPreparation.outputs.some(o=>o.mediaType==='video/mp4'&&(o.path===path.resolve(t?.media?.videoPath||'.')||(t?.media?.videoPath&&fs.existsSync(t.media.videoPath)&&o.sha256===sha256File(t.media.videoPath))))))fail('VIDEO_PREPARATION_CANDIDATE_IS_NOT_FINAL_MEDIA');
  const packages=packet.targets.map((t,i)=> {
    const key=`${t?.platform}/${t?.accountKey}`;
    if(seen.has(key)) fail(`DUPLICATE_TARGET: ${key}`); seen.add(key);
    return compileTarget(packet,t,i,globalBindings,refs,{...options,subject,videoPreparation});
  });
  return {schema:SCHEMA,contentId:packet.contentId,...(schoolKey===undefined?{}:{schoolKey}),subject:structuredClone(subject),contentType:packet.contentType,packages,
    status:'LOCAL_COMPILED_NOT_PUBLISHED',core:packet.core===undefined?undefined:structuredClone(packet.core),...REQUIRED_REVIEW};
}
export function verifyAssetBindings(pkg) {
  const issues=[],expected=new Set(),bindings=pkg?.studio?.assetBindings;
  const result=()=>({ok:!issues.length,issues,scope:'local_bytes_only',additionalChecks:['declared_media_text_policy'],...REQUIRED_REVIEW});
  const issue=code=>issues.push({code});
  if(pkg?.studio?.schema!==SCHEMA) {issue('COMPILED_SCHEMA_INVALID');return result();}
  if(!/^[a-zA-Z0-9_-]+$/.test(pkg.schoolAccount?.platform||'')||!/^[a-zA-Z0-9_-]+$/.test(pkg.schoolAccount?.accountKey||'')||!['video','article','image_note'].includes(pkg.contentType)) {issue('COMPILED_TARGET_INVALID');return result();}
  // Also reject old compiled packages that only recorded a known burned-in violation.
  // This checks supplied text, not image pixels or the truth of an approval record.
  const burnedCTA=pkg.studio.requested?.media?.burnedCTA;
  if(burnedCTA!==undefined) {
    if(typeof burnedCTA!=='string'||pkg.contentType!=='video') issue('DECLARED_MEDIA_TEXT_INVALID');
    else {
      const approval=pkg.studio.requested?.approval,a=approval?.privateMessageTrial;
      const trial=pkg.schoolAccount.platform==='xiaohongshu'&&approval?.status==='approved'&&a?.contentId===pkg.studio.contentId&&a?.accountKey===pkg.schoolAccount.accountKey&&typeof a?.evidenceRef==='string'&&!!a.evidenceRef.trim();
      if(textPolicyIssues(pkg.schoolAccount.platform,{burnedCTA},{allowPrivateMessageTrial:trial}).length) issue('DECLARED_MEDIA_TEXT_POLICY_BLOCKED');
    }
  }
  const hasPackageSubject=Object.prototype.hasOwnProperty.call(pkg,'subject'),hasStudioSubject=Object.prototype.hasOwnProperty.call(pkg.studio,'subject');
  if(hasPackageSubject!==hasStudioSubject) issue('COMPILED_SUBJECT_MISMATCH');
  if(hasPackageSubject&&hasStudioSubject) {
    const validSubject=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['kind','key','name'].includes(k))&&['school','personal_ip'].includes(value.kind)&&/^[a-zA-Z0-9_-]+$/.test(value.key||'')&&(value.name===undefined||(typeof value.name==='string'&&!!value.name.trim()));
    if(!validSubject(pkg.subject)||!validSubject(pkg.studio.subject)) issue('COMPILED_SUBJECT_INVALID');
    else if(JSON.stringify(pkg.subject)!==JSON.stringify(pkg.studio.subject)) issue('COMPILED_SUBJECT_MISMATCH');
    else if(pkg.subject.kind==='school'&&(pkg.schoolKey!==undefined&&pkg.schoolKey!==pkg.subject.key||pkg.studio.schoolKey!==undefined&&pkg.studio.schoolKey!==pkg.subject.key)) issue('COMPILED_SUBJECT_SCHOOL_KEY_MISMATCH');
    else if(pkg.subject.kind==='personal_ip'&&(Object.prototype.hasOwnProperty.call(pkg,'schoolKey')||Object.prototype.hasOwnProperty.call(pkg.studio,'schoolKey'))) issue('PERSONAL_SUBJECT_HAS_SCHOOL_KEY');
    if(pkg.subject?.kind==='personal_ip'&&(pkg.studio.needsAdapter!==true||!Array.isArray(pkg.studio.adapterIssues)||!pkg.studio.adapterIssues.includes('PERSONAL_ACCOUNT_ROUTE_UNVERIFIED'))) issue('PERSONAL_ROUTE_GATE_MISSING');
  }
  const add=value=> {
    if(typeof value!=='string'||!path.isAbsolute(value)) {issue('ASSET_PATH_INVALID');return;}
    expected.add(path.resolve(value));
  };
  // Fixed compile-owned file slots only: never recursively inspect arbitrary studio paths.
  for(const key of ['videoPath','articlePath','coverPath','layoutPath']) if(pkg[key]!==undefined) add(pkg[key]);
  if(pkg.cover!==undefined) {
    if(!pkg.cover||typeof pkg.cover!=='object'||Array.isArray(pkg.cover)||Object.keys(pkg.cover).some(k=>!['uploadCustomCover','vertical3x4Path','horizontal4x3Path','horizontal16x9Path'].includes(k))) issue('COMPILED_COVER_INVALID');
    else for(const key of ['vertical3x4Path','horizontal4x3Path','horizontal16x9Path']) if(pkg.cover[key]!==undefined) add(pkg.cover[key]);
  }
  if(pkg.images!==undefined) {
    if(!Array.isArray(pkg.images)) issue('COMPILED_IMAGES_INVALID');else pkg.images.forEach(add);
  }
  const refs=pkg.studio.sourceRefs;
  if(!Array.isArray(refs)||!refs.length) issue('COMPILED_SOURCE_REFS_INVALID');
  else for(const ref of refs) {
    if(!ref||typeof ref!=='object'||!['file','url'].includes(ref.type)) {issue('COMPILED_SOURCE_REF_INVALID');continue;}
    if(ref.type==='file') add(ref.path);
  }
  if(pkg.studio.videoPreparation!==undefined){
    try {preparationBindingPaths(pkg.studio.videoPreparation,pkg.subject,pkg.studio.contentId).forEach(add);}
    catch {issue('VIDEO_PREPARATION_COMPILED_INVALID');}
  }
  // The compiler retains transcript intent under this one documented field.
  const transcript=pkg.studio.requested?.media?.transcriptPath;
  if(transcript!==undefined) add(transcript);
  if(!Array.isArray(bindings)) {issue('ASSET_BINDINGS_MISSING');return result();}
  const seen=new Set();
  for(const binding of bindings) {
    if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).some(k=>!['path','sha256','size'].includes(k))||typeof binding.path!=='string'||!path.isAbsolute(binding.path)||!/^[a-f0-9]{64}$/.test(binding.sha256||'')||!Number.isSafeInteger(binding.size)||binding.size<0) {issue('ASSET_BINDING_INVALID');continue;}
    const file=path.resolve(binding.path);
    if(!expected.has(file)) {issue('ASSET_BINDING_UNEXPECTED');continue;}
    if(seen.has(file)) {issue('ASSET_BINDING_DUPLICATE');continue;}
    seen.add(file);
    // Shape/coverage failures must not cause arbitrary filesystem reads.
  }
  for(const file of expected) if(!seen.has(file)) issue('ASSET_BINDING_REQUIRED');
  if(issues.length) return result();
  for(const binding of bindings) {
    try {if(!fs.statSync(binding.path).isFile()||fs.statSync(binding.path).size!==binding.size||sha256File(binding.path)!==binding.sha256) issue('ASSET_CHANGED');}
    catch {issue('ASSET_MISSING');}
  }
  if(!issues.length&&pkg.studio.videoPreparation!==undefined) {
    try {
      const p=pkg.studio.videoPreparation,reloaded=loadVideoPreparationReceipt({path:p.receipt.path,sha256:p.receipt.sha256},pkg.subject,new Map(),pkg.studio.contentId);
      if(JSON.stringify(p)!==JSON.stringify(reloaded))issue('VIDEO_PREPARATION_RECEIPT_MISMATCH');
      if(reloaded.outputs.some(o=>o.mediaType==='video/mp4'&&(o.path===path.resolve(pkg.videoPath||'.')||o.sha256===sha256File(pkg.videoPath))))issue('VIDEO_PREPARATION_CANDIDATE_IS_NOT_FINAL_MEDIA');
    } catch {issue('VIDEO_PREPARATION_RECEIPT_INVALID');}
  }
  if(!issues.length&&pkg.contentType==='article') {
    try {
      const plan=buildArticleImagePlan({body:pkg.body,articlePath:pkg.articlePath,layoutPath:pkg.layoutPath,images:pkg.images||[]});
      if(pkg.studio.articleImages!==undefined&&JSON.stringify(plan)!==JSON.stringify(pkg.studio.articleImages)) issue('ARTICLE_IMAGE_PLAN_MISMATCH');
      if(pkg.nativeTask?.inlineImages?.plan!==undefined&&JSON.stringify(plan)!==JSON.stringify(pkg.nativeTask.inlineImages.plan)) issue('ARTICLE_NATIVE_IMAGE_PLAN_MISMATCH');
    } catch(error) {issue(/^ARTICLE_[A-Z_]+$/.test(error.message)?error.message:'ARTICLE_IMAGE_RECONCILIATION_FAILED');}
  }
  return {ok:!issues.length,issues,scope:'local_bytes_only',...REQUIRED_REVIEW};
}

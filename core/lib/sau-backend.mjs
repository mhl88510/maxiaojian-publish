// Internal SAU integration. Never fall back after an uncertain submission.
// Current SAU launches new browsers; only Ego Lite reuse is permitted by this project.
export const SAU_CAPABILITIES=Object.freeze({
  douyin:['video','note'],xiaohongshu:['video','note'],baijiahao:['video'],
  bilibili:['video'],kuaishou:['video','note'],wechat_channels:['video'],
  weibo:['video'],hupu:['video'],alipay:['video'],youtube:['video'],
});
export function planSau(pkg) {
  const t=pkg.schoolAccount||{}, type=pkg.contentType||'video';
  if(!SAU_CAPABILITIES[t.platform]?.includes(type))throw new Error('SAU_CONTENT_TYPE_NOT_SUPPORTED');
  if(!t.accountKey)throw new Error('SAU_ACCOUNT_KEY_REQUIRED');
  const args=[t.platform==='wechat_channels'?'tencent':t.platform,type==='note'?'upload-note':'upload-video','--account',t.accountKey];
  if(type==='video') {
    if(!pkg.videoPath||!pkg.title)throw new Error('VIDEO_AND_TITLE_REQUIRED');
    args.push('--file',pkg.videoPath,'--title',pkg.title);
    if(pkg.description)args.push('--desc',pkg.description);
    if(t.platform==='douyin') {
      const tags=pkg.douyinTopics||[];
      if(tags.length>5)throw new Error('DOUYIN_MAX_FIVE_TOPICS');
      if(tags.length)args.push('--tags',tags.join(','));
      if(pkg.douyinPortraitCoverPath)args.push('--thumbnail-portrait',pkg.douyinPortraitCoverPath);
      if(pkg.douyinLandscapeCoverPath)args.push('--thumbnail-landscape',pkg.douyinLandscapeCoverPath);
    }
  } else throw new Error('SAU_NOTE_MAPPING_REQUIRES_PLATFORM_SPECIFIC_FIELDS');
  return {command:'sau',args};
}
export async function runSau(pkg) {


  const plan=planSau(pkg);
  // Fail before invoking even SAU check/login: these also launch a browser.
  return {ok:false,status:'BLOCKED',code:'SAU_BROWSER_POLICY_BLOCKED',backend:'sau',plannedCommand:plan,
    message:'当前SAU后端会新启动浏览器，未满足仅复用Ego Lite的约束。已接入命令映射，但不执行、不要求重新扫码；不能因此宣称SAU可发布。'};
}

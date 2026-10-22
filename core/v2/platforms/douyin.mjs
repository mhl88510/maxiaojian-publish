const douyinTitle = pkg.platformTitle.douyin;
const douyinDescription = pkg.douyinDescription;
const douyinTopics = pkg.douyinTopics;
const douyinSchedule = pkg.douyinSchedule === undefined ? null : pkg.douyinSchedule;
const douyinScheduleLocalDateTime = typeof douyinSchedule?.publishAt === 'string'
  ? douyinSchedule.publishAt.slice(0, 16).replace('T', ' ')
  : '';
const douyinCustomCover = pkg.cover?.uploadCustomCover === true;
const douyinCoverAssets = [
  { slot: 'portrait', ratio: '3:4', path: String(pkg.cover?.vertical3x4Path || '') },
  { slot: 'landscape', ratio: '4:3', path: String(pkg.cover?.horizontal4x3Path || '') },
];

async function inspectDouyinUploadSurface() {
  return await js(String.raw`(() => {
    const url=location.href;
    const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
    const uploadText=/上传视频|上传作品|点击上传|选择视频|拖拽.{0,12}视频|支持.{0,20}视频|添加视频/i;
    const rows=[...document.querySelectorAll('input[type="file"]')].map(input=>{
      const accept=String(input.accept||'');
      if(!/video|\.mp4|\.mov|\.mkv|\.flv|\.webm/i.test(accept))return null;
      let node=input.parentElement,area=null;
      for(let depth=0;node&&depth<9;depth+=1,node=node.parentElement){
        const text=compact(node.innerText||node.textContent||'');
        const marker=String(node.className||'')+' '+String(node.getAttribute?.('data-testid')||'')+' '+String(node.getAttribute?.('aria-label')||'')+' '+String(node.getAttribute?.('title')||'');
        const role=String(node.getAttribute?.('role')||'');
        const semantic=/(upload|drop|drag|video|file)/i.test(marker)||node.tagName==='LABEL'||role==='button';
        if(visible(node)&&semantic&&uploadText.test(text)){area={tag:String(node.tagName||''),role,className:String(node.className||'').slice(0,160),text:text.slice(0,180),visible:true};break;}
      }
      return {accept:accept.slice(0,240),disabled:Boolean(input.disabled),inputVisible:visible(input),visibleUploadArea:area};
    }).filter(Boolean);
    const enabled=rows.filter(row=>!row.disabled);
    const match=enabled.length===1&&enabled[0].visibleUploadArea?enabled[0]:null;
    const reason=url!=='https://creator.douyin.com/creator-micro/content/upload'?'douyin_upload_url_not_exact':rows.length===0?'video_file_input_missing':enabled.length!==1?'enabled_video_file_input_not_unique':match?'':'visible_upload_area_missing';
    return {ok:url==='https://creator.douyin.com/creator-micro/content/upload'&&Boolean(match),url,reason,videoFileInput:match||null,videoInputCount:rows.length,enabledVideoInputCount:enabled.length};
  })()`);
}

async function inspectDouyinPoi() {
  if (pkg.douyinPoi === undefined) return okGate({notRequested:true});
  const receipt = expectedReceipts.poi || null;
  const validation = validateDouyinPoiReceipt({pkg,receipt,jobFingerprint,binding:pkg.schoolAccount});
  if (!validation.ok) return failedGate({code:validation.code,requested:true,receipt});
  const mounted = await js('('+probeDouyinPoiMounted.toString()+')('+[pkg.douyinPoi,receipt,DOUYIN_POI_NATIVE_CONTRACT].map(value=>JSON.stringify(value)).join(',')+')');
  return mounted.ok ? okGate({requested:true,receipt,mounted}) : failedGate({requested:true,receipt,mounted,code:mounted.code});
}

async function inspectDouyinSchedule() {
  const state = await js(String.raw`((requested,expectedLocal) => {
    const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
    const labels=[...document.querySelectorAll('label.radio-d4zkru.one-line-pe7juM')].map(el=>({el,text:compact(el.innerText||el.textContent),checked:el.getAttribute('data-checked')==='true',inputs:[...el.querySelectorAll('input[type="checkbox"]')]}));
    const timed=labels.filter(x=>x.text==='定时发布'),immediate=labels.filter(x=>x.text==='立即发布');
    const dateInputs=[...document.querySelectorAll('input[placeholder="日期和时间"]')];
    if(timed.length!==1||immediate.length!==1||timed[0].inputs.length!==1||immediate[0].inputs.length!==1)return {ok:false,reason:'native_schedule_mode_controls_not_unique',requested:requested===true,modeLabels:labels.map(x=>x.text),dateInputCount:dateInputs.length};
    const timedOn=timed[0].checked&&timed[0].inputs[0].checked===true&&timed[0].inputs[0].value==='1';
    const immediateOn=immediate[0].checked&&immediate[0].inputs[0].checked===true&&immediate[0].inputs[0].value==='0';
    if(requested===true){
      if(!timedOn||immediateOn||dateInputs.length!==1||!visible(dateInputs[0])||dateInputs[0].getAttribute('format')!=='yyyy-MM-dd HH:mm')return {ok:false,reason:'native_scheduled_mode_or_datetime_control_mismatch',requested:true,timedOn,immediateOn,dateInputCount:dateInputs.length,dateFormat:dateInputs[0]?.getAttribute('format')||null};
      const actual=String(dateInputs[0].value||'');
      const epoch=Date.parse(expectedLocal.replace(' ','T')+':00+08:00'),now=Date.now();
      const inWindow=Number.isFinite(epoch)&&epoch>=now+2*60*60*1000&&epoch<=now+14*24*60*60*1000;
      return {ok:actual===expectedLocal&&inWindow,reason:actual!==expectedLocal?'native_schedule_datetime_mismatch':!inWindow?'native_schedule_window_expired':null,requested:true,mode:'scheduled',actual,expected:expectedLocal,inWindow,timedOn,immediateOn,dateInputCount:dateInputs.length,dateFormat:dateInputs[0].getAttribute('format')};
    }
    return {ok:immediateOn&&!timedOn,reason:immediateOn&&!timedOn?null:'native_immediate_mode_not_explicit',requested:false,mode:immediateOn?'immediate':'unknown',timedOn,immediateOn,dateInputCount:dateInputs.length};
  })(${JSON.stringify(Boolean(douyinSchedule))},${JSON.stringify(douyinScheduleLocalDateTime)})`);
  return state.ok ? okGate(state) : failedGate(state);
}

function readDouyinSavePermissionInPage(expected,prepare=false) {
  const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
  const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>3&&r.height>3&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;};
  if(typeof expected!=='boolean')return {ok:false,code:'DOUYIN_SAVE_PERMISSION_INTENT_INVALID'};
  const textNodes=[...document.querySelectorAll('label,span,div,p')].filter(el=>visible(el)&&compact(el.innerText||el.textContent)==='保存权限');
  const headings=textNodes.filter(el=>!textNodes.some(other=>other!==el&&el.contains(other)));
  if(headings.length!==1)return {ok:false,code:'DOUYIN_SAVE_PERMISSION_HEADING_NOT_UNIQUE',headingCount:headings.length};
  let group=null,allowed=null,disallowed=null;
  for(let node=headings[0].parentElement,depth=0;node&&depth<8;node=node.parentElement,depth++){
    const options=[...node.querySelectorAll('label')].filter(visible).map(label=>({label,text:compact(label.innerText||label.textContent),inputs:[...label.querySelectorAll('input[type=\"radio\"],input[type=\"checkbox\"]')]}));
    const yes=options.filter(x=>x.text==='允许'),no=options.filter(x=>x.text==='不允许');
    if(yes.length===1&&no.length===1&&yes[0].inputs.length===1&&no[0].inputs.length===1){group=node;allowed=yes[0];disallowed=no[0];break;}
  }
  if(!group||!allowed||!disallowed)return {ok:false,code:'DOUYIN_SAVE_PERMISSION_RADIOS_NOT_UNIQUE'};
  // Current creator UI uses paired checkbox inputs as exclusive radio choices.
  // Its DOM data-checked value must agree with the native input; never infer
  // selection from label CSS or a generic checkbox elsewhere in the form.
  for(const row of [allowed,disallowed]){
    const input=row.inputs[0];
    if(input.disabled===true)return {ok:false,code:'DOUYIN_SAVE_PERMISSION_CONTROL_DISABLED'};
    if(input.type==='checkbox'){
      const declared=row.label.getAttribute('data-checked');
      if(!['true','false'].includes(declared)||(declared==='true')!==(input.checked===true))return {ok:false,code:'DOUYIN_SAVE_PERMISSION_CHECKBOX_STATE_MISMATCH'};
    }
  }
  const allowedChecked=allowed.inputs[0].checked===true,disallowedChecked=disallowed.inputs[0].checked===true;
  if(allowedChecked===disallowedChecked)return {ok:false,code:'DOUYIN_SAVE_PERMISSION_SELECTION_AMBIGUOUS'};
  const selected=allowedChecked;
  if(!prepare)return {ok:true,selected,requested:expected,matched:selected===expected};
  if(selected===expected)return {ok:true,selected,unchanged:true};
  const target=expected?allowed.label:disallowed.label,id=expected?'vp2-douyin-save-permission-allow':'vp2-douyin-save-permission-disallow';
  if(document.querySelectorAll('#'+id).length!==0)return {ok:false,code:'DOUYIN_SAVE_PERMISSION_SELECTOR_COLLISION'};
  target.id=id;
  return {ok:true,selected,selector:'#'+id};
}

async function ensureDouyinSchedule() {
  if(typeof nativeRecovery!=='undefined'&&nativeRecovery?.resumeType==='personal_r3_existing_video_metadata_v1'&&!Object.hasOwn(pkg,'douyinSchedule')){
    const observed=await inspectDouyinSchedule();
    return observed.ok?{ok:true,changed:false,preserved:true,evidence:observed.evidence}:{ok:false,code:'PERSONAL_EXISTING_UNREQUESTED_SCHEDULE_CHANGE_FORBIDDEN',reason:'No schedule intent in this fixed package; preserve native setting without clicks.',evidence:observed.evidence};
  }
  const before=await inspectDouyinSchedule();
  if(before.ok)return {ok:true,unchanged:true,evidence:before.evidence};
  const requested=Boolean(douyinSchedule);
  const prepared=await js(String.raw`((requested) => {
    const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
    const rows=[...document.querySelectorAll('label.radio-d4zkru.one-line-pe7juM')];
    const timed=rows.filter(el=>compact(el.innerText||el.textContent)==='定时发布');
    const immediate=rows.filter(el=>compact(el.innerText||el.textContent)==='立即发布');
    if(timed.length!==1||immediate.length!==1||timed[0].querySelectorAll('input[type="checkbox"]').length!==1||immediate[0].querySelectorAll('input[type="checkbox"]').length!==1)return {ok:false,reason:'native_schedule_mode_controls_not_unique'};
    timed[0].id='vp2-douyin-schedule-timed';immediate[0].id='vp2-douyin-schedule-immediate';
    return {ok:true,requested};
  })(${JSON.stringify(requested)})`);
  if(!prepared.ok)return {ok:false,code:'DOUYIN_SCHEDULE_NATIVE_CONTROLS_UNAVAILABLE',reason:prepared.reason};
  try {
    await click(requested?'#vp2-douyin-schedule-timed':'#vp2-douyin-schedule-immediate',{label:requested?'select native scheduled publication':'select native immediate publication'});
    if(requested){
      const dateReady=await js(String.raw`(() => {const rows=[...document.querySelectorAll('input[placeholder="日期和时间"]')];if(rows.length!==1||rows[0].getAttribute('format')!=='yyyy-MM-dd HH:mm')return {ok:false,count:rows.length,format:rows[0]?.getAttribute('format')||null};rows[0].id='vp2-douyin-schedule-date';return {ok:true}})()`);
      if(!dateReady.ok)return {ok:false,code:'DOUYIN_SCHEDULE_NATIVE_DATETIME_UNAVAILABLE',reason:dateReady};
      await boundPage().fill('#vp2-douyin-schedule-date',douyinScheduleLocalDateTime);
      await boundPage().press('#vp2-douyin-schedule-date','Enter');
    }
  } catch(error) {
    return {ok:false,code:'DOUYIN_SCHEDULE_NATIVE_SET_FAILED',reason:String(error?.message||error)};
  }
  await wait(0.3);
  const after=await inspectDouyinSchedule();
  return after.ok?{ok:true,changed:true,evidence:after.evidence}:{ok:false,code:'DOUYIN_SCHEDULE_NATIVE_READBACK_FAILED',reason:after.evidence};
}

async function ensureDouyinPoi() {
  const current=await inspectDouyinPoi();if(current.ok)return {ok:true,receipt:expectedReceipts.poi||null,notRequested:pkg.douyinPoi===undefined};
  const intent=verifyDouyinPoiIntent(pkg);if(!intent.ok)return {ok:false,code:'DOUYIN_POI_INTENT_INVALID',reason:'封存定位意图来源验证失败',evidence:intent};
  const selector=DOUYIN_POI_NATIVE_CONTRACT?.mounted?.containerSelector;
  if(!selector)return {ok:false,code:'DOUYIN_POI_NATIVE_CONTRACT_UNVERIFIED',reason:'真实定位控件契约缺失'};
  const readMounted=()=>js('(() => {const nodes=document.querySelectorAll('+JSON.stringify(selector)+');return nodes.length===1? ('+readDouyinPoiMountedRecord.toString()+')(nodes[0],'+JSON.stringify(DOUYIN_POI_NATIVE_CONTRACT)+'):{ok:false,code:"DOUYIN_POI_NATIVE_SELECT_NOT_UNIQUE"}})()');
  let mounted=await readMounted(),assessment=mounted.ok?assessDouyinPoiCandidate(pkg.douyinPoi,mounted.candidate):{ok:false};
  let acceptedCount=mounted.ok?1:0;
  if(!assessment.ok){
    const input='#douyin_creator_pc_anchor_jump input';
    const queryOptions=async(query)=>{
      // Force a distinct native input event; filling the same selected query
      // does not fire this picker search. Allow its debounce to settle before
      // reading candidates so stale option rows cannot win the race.
      await boundPage().fill(input,pkg.douyinPoi.schoolName);
      await wait(.8);
      await boundPage().fill(input,query);
      await wait(.8);
      let options=[];
      for(let n=0;n<16;n++){
        options=await js('(() => [...document.querySelectorAll(".semi-select-option[role=option]")].map(node=>('+readDouyinPoiReactOption.toString()+')(node)))()');
        if(options.some(x=>x.ok))break;await wait(.4);
      }
      return options.filter(x=>x.ok);
    };
    await click(selector,{label:'search exact school campus POI'});
    let accepted=[];
    // Search text can be shorter, but accepted entity identity/campus/address
    // remains verified against the unchanged sealed intent, never fuzzy matched.
    const queries=[pkg.douyinPoi.schoolName.replace(/职业学院$/, ''),pkg.douyinPoi.schoolName].filter((x,i,a)=>x&&a.indexOf(x)===i);
    for(const query of queries){
      const options=await queryOptions(query);
      accepted=options.map(x=>({record:x.candidate,assessment:assessDouyinPoiCandidate(pkg.douyinPoi,x.candidate)})).filter(x=>x.assessment.ok);
      if(accepted.length)break;
    }
    acceptedCount=accepted.length;
    if(accepted.length!==1){await pressKey('Escape');return {ok:false,code:'DOUYIN_POI_CANDIDATE_NOT_UNIQUE',reason:'原生候选中没有唯一对应已核校区的校园实体',evidence:{acceptedCount}};}
    const id=accepted[0].record.id;
    const prepared=await js('(() => {const rows=[...document.querySelectorAll(".semi-select-option[role=option]")].filter(node=>{const r=('+readDouyinPoiReactOption.toString()+')(node);return r.ok&&r.candidate.id==='+JSON.stringify(id)+'});if(rows.length!==1)return {ok:false};rows[0].id="vp2-douyin-poi-option";return {ok:true}})()');
    if(!prepared.ok)return {ok:false,code:'DOUYIN_POI_OPTION_DRIFT',reason:'点击前定位候选改变'};
    await click('.semi-select-option[role=option]:has-text('+JSON.stringify(accepted[0].record.name)+')',{label:'select verified south campus POI'});
    mounted=await readMounted();
    if(!mounted.ok){
      await click(selector,{label:'hydrate selected native POI record'});
      const options=await queryOptions(queries[0]);
      if(options.filter(x=>x.candidate.id===id).length!==1){await pressKey('Escape');return {ok:false,code:'DOUYIN_POI_HYDRATION_QUERY_FAILED',reason:'重新查询未返回唯一同ID定位实体'};}
      await pressKey('Escape');
      for(let attempt=0;attempt<30;attempt++){mounted=await readMounted();if(mounted.ok)break;if(!['DOUYIN_POI_NATIVE_SELECTION_RECORD_NOT_HYDRATED','DOUYIN_POI_NATIVE_SELECT_NOT_CLOSED'].includes(mounted.code))break;await wait(.3);}
    }
    assessment=mounted.ok?assessDouyinPoiCandidate(pkg.douyinPoi,mounted.candidate):{ok:false};
  }
  if(!mounted.ok||!assessment.ok)return {ok:false,code:'DOUYIN_POI_NATIVE_MOUNT_REQUIRED',reason:'已选定位缺少真实完整挂载记录',evidence:{mounted,assessment}};
  const b=pkg.schoolAccount;
  const receipt={schema:'douyin-poi-native-receipt/v1',status:'MOUNTED',nativeContractSchema:DOUYIN_POI_NATIVE_CONTRACT.schema,intentSha256:intent.intentSha256,jobFingerprint,platform:'douyin',accountKey:b.accountKey,binding:{profileId:String(b.profileId||b.egoProfileId||''),taskSpaceId:Number(b.taskSpaceId),pageLabel:b.pageLabel,targetId:b.targetId},candidate:assessment.candidate,evidence:{candidateCount:acceptedCount,selected:true,mounted:true,source:'native_picker',observedAt:new Date().toISOString()}};
  const valid=validateDouyinPoiReceipt({pkg,receipt,jobFingerprint,binding:b});if(!valid.ok)return {ok:false,code:valid.code,reason:'定位回执绑定验证失败',evidence:valid};
  expectedReceipts.poi=receipt;const fresh=await inspectDouyinPoi();if(!fresh.ok)return {ok:false,code:'DOUYIN_POI_NATIVE_CHANGED',reason:'定位挂载鲜读改变',evidence:fresh};
  return {ok:true,receipt,addressRelation:assessment.addressRelation};
}

async function inspectDouyin() {
  const poi = await inspectDouyinPoi();
  const uploadSurface = await inspectDouyinUploadSurface();
  const state = await js(String.raw`((expectedTitle, expectedDescription, requestedTopics) => {
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const visible = el => {
      if (!el) return false
      const r=el.getBoundingClientRect(),s=getComputedStyle(el)
      return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'
    }
    const declarationSections=[...document.querySelectorAll("section")].filter(el=>compact(el.querySelector(".title-cnbkZe")?.textContent)==="自主声明");
    const declarationText=declarationSections.length===1?compact(declarationSections[0].querySelector(".selectText-XSrMFZ.selected-Vx6wO5")?.textContent):"";
    const declarationNone=declarationText==="无需添加自主声明";
    const declarationAvailable=declarationSections.length>0;
    const text = compact(document.body.innerText || '')
    const titleInput = [...document.querySelectorAll('input')].find(el => (el.placeholder || '').includes('作品标题'))
    const title = String(titleInput?.value || '').trim()
    const editables = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')]
      .filter(visible)
      .map(el => {
        let context=''; let parent=el.parentElement
        for(let i=0;parent&&i<5;i+=1){context+=' '+compact(parent.innerText||parent.textContent||'');parent=parent.parentElement}
        const r=el.getBoundingClientRect(); return {el,context,area:r.width*r.height,cls:String(el.className||'')}
      })
      .sort((a,b)=>Number(/作品描述|#添加话题|@好友/.test(b.context))-Number(/作品描述|#添加话题|@好友/.test(a.context))||b.area-a.area)
    const editor = editables[0]?.el || null
    const editorText = compact(editor?.innerText || editor?.textContent || '').replace(/\u200b/g,'').trim()
    const scope = editor || document
    const normalizeTopic=value=>String(value||'').replace(/^#/,'').replace(/\s+/g,'').toLowerCase()
    const entityNames = [...scope.querySelectorAll('[data-mention="#"], [data-mention="activity"]')]
      .map(el=>normalizeTopic(compact(el.innerText||el.textContent||'')))
      .filter(Boolean)
    const escapeRegExp=value=>String(value).replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')
    const tokenCounts=Object.fromEntries(requestedTopics.map(tag=>[tag,entityNames.filter(name=>name===normalizeTopic(tag)).length]))
    const unexpected=entityNames.filter(name=>!requestedTopics.some(tag=>normalizeTopic(tag)===name))
    const selected = requestedTopics.filter(tag=>tokenCounts[tag]===1)
    const duplicates = requestedTopics.filter(tag=>tokenCounts[tag]>1)
    const clone = editor?.cloneNode(true)
    clone?.querySelectorAll('[data-mention], [data-fake-text], [class*="mention"], [class*="topic"], [class*="hash"]').forEach(el=>el.remove())
    let proseRaw=String(clone?.innerText||clone?.textContent||'').replace(/\u200b/g,' ')
    const plainNormalized=proseRaw.replace(/\s+/g,'').toLowerCase()
    const plainResidue=requestedTopics.filter(tag=>plainNormalized.includes('#'+normalizeTopic(tag)))
    for(const tag of requestedTopics){for(const form of [...new Set([String(tag),String(tag).replace(/\s+/g,'')])])proseRaw=proseRaw.replace(new RegExp('(?:^|\\s)#'+escapeRegExp(form)+'(?=$|\\s)','gi'),' ')}
    const prose = compact(proseRaw)
    const expectedProse = compact(expectedDescription)
    const uploadSucceeded = /上传成功|重新上传/.test(text) && /作品描述|基础信息/.test(text)
    const uploading = /上传过程中|取消上传|上传剩余时间|已上传：|上传速度|当前速度/.test(text) && !/上传成功/.test(text)
    const uploadFailed = /上传失败|网络错误|重新上传失败/.test(text)
    const loginRequired = /扫码登录|请登录|登录后|安全验证|验证码/.test(text) && !/创作中心|内容管理/.test(text)
    const resumeDialog = /你还有上次未发布的视频|是否继续编辑/.test(text)
    const identityEmpty = !title && !editorText
    const knownMisroutedInput = title === String(expectedTitle + expectedDescription).slice(0, 30)
    const identityMatches = title === expectedTitle || editorText.includes(expectedDescription) || identityEmpty || knownMisroutedInput
    const toutiaoLabel = [...document.querySelectorAll('div,span')]
      .map(el=>({el,text:compact(el.innerText||el.textContent||''),r:el.getBoundingClientRect()}))
      .filter(item=>item.text==='今日头条'&&item.r.width>20&&item.r.height>12)
      .sort((a,b)=>(a.r.width*a.r.height)-(b.r.width*b.r.height))[0]?.el
    let syncRow=toutiaoLabel
    while(syncRow&&!syncRow.querySelector('[role="switch"],input[type="checkbox"],[class*="semi-switch"]'))syncRow=syncRow.parentElement
    const sync=syncRow?.querySelector('input[role="switch"],input[type="checkbox"],[role="switch"],[class*="semi-switch"]')
    const syncOn=Boolean(sync&&(sync.checked===true||sync.getAttribute('aria-checked')==='true'||/checked|active|open|\bon\b/i.test(String(sync.className||''))))
    const syncRadios=[...document.querySelectorAll('label')].map(el=>({text:compact(el.innerText||el.textContent||''),input:el.querySelector('input.radio-native-p6VBGt,input[type="checkbox"]')})).filter(item=>/^(不同时发布|同时发布到)/.test(item.text))
    const noSyncChecked=Boolean(syncRadios.find(item=>item.text.startsWith('不同时发布'))?.input?.checked)
    const simultaneousChecked=Boolean(syncRadios.find(item=>item.text.startsWith('同时发布到'))?.input?.checked)
    const syncUnavailable=syncRadios.length===0&&!sync&&!/不同时发布|同时发布到|同步至|同步到|今日头条/.test(text)&&/发布设置/.test(text)&&/谁可以看/.test(text)&&/保存权限/.test(text)&&/发布时间/.test(text)&&[...document.querySelectorAll('button')].some(el=>compact(el.innerText)==='发布'&&visible(el))
    const topicControlReady=[...document.querySelectorAll('button,[role="button"],div,span')]
      .some(el=>visible(el)&&compact(el.innerText||el.textContent||'')==='#添加话题')
    const earlyMutationReady=visible(titleInput)&&visible(editor)&&topicControlReady&&(syncRadios.length>0||syncUnavailable)&&(uploading||uploadSucceeded)
    const coverUrls = {}
    for (const [slot,re] of [['landscape',/横封面\s*4\s*:\s*3|横封面4:3/],['portrait',/竖封面\s*3\s*:\s*4|竖封面3:4/]]) {
      const card=[...document.querySelectorAll('.coverControl-CjlzqC')].find(el=>re.test(compact(el.innerText||el.textContent||'')))
      const urls=[...(card?.querySelectorAll('img')||[])].map(img=>img.src).filter(src=>/blob:|douyinpic|pstatp|tos-cn|creator-media/.test(src))
      for(const el of [card,...(card?[...card.querySelectorAll('*')]:[])]){const bg=el?getComputedStyle(el).backgroundImage:'';const match=bg.match(/^url\(["']?(.*?)["']?\)$/);if(match&&/blob:|douyinpic|pstatp|tos-cn|creator-media/.test(match[1]))urls.push(match[1])}
      coverUrls[slot]=[...new Set(urls)]
    }
    const dialogs=[...document.querySelectorAll('[role="dialog"],.semi-modal,[class*="modal-mask"],[class*="dialog-mask"]')]
      .map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {text:compact(el.innerText||el.textContent||'').slice(0,500),cls:String(el.className||''),w:r.width,h:r.height,display:s.display,visibility:s.visibility,opacity:s.opacity}})
      .filter(item=>item.w>20&&item.h>20&&item.display!=='none'&&item.visibility!=='hidden'&&!/animate-hide|leave-active/.test(item.cls))
    return {unexpected,declarationAvailable,declarationText,declarationNone,url:location.href,text:text.slice(0,2800),title,editorText,prose,selected,plainResidue,duplicates,tokenCounts,uploadSucceeded,uploading,uploadFailed,loginRequired,resumeDialog,identityMatches,identityEmpty,knownMisroutedInput,syncUnavailable,syncOn,syncFound:Boolean(sync),noSyncChecked,simultaneousChecked,topicControlReady,earlyMutationReady,titleInputReady:visible(titleInput),editorReady:visible(editor),settingsReady:(syncRadios.length>0||syncUnavailable),coverUrls,dialogs}
  })(${JSON.stringify(douyinTitle)}, ${JSON.stringify(douyinDescription)}, ${JSON.stringify(douyinTopics)})`);
  const declarationIntent=pkg.platformDeclarations?.douyin||'none';
  const declarationOk=declarationIntent==='none'?(!state.declarationAvailable||state.declarationNone):declarationIntent==='ai_generated'?(state.declarationAvailable&&state.declarationText==='内容由AI生成'):false;
  const declarationEvidence={requested:pkg.platformDeclarations?.douyin||'none',available:state.declarationAvailable,selected:state.declarationText,ok:declarationOk};
  const savePermissionRequested=Object.prototype.hasOwnProperty.call(pkg,'douyinSaveAllowed');
  const savePermissionState=savePermissionRequested?await js('('+readDouyinSavePermissionInPage.toString()+')('+JSON.stringify(pkg.douyinSaveAllowed)+',false)'):{ok:true,notRequested:true};
  const savePermissionOk=!savePermissionRequested||(typeof pkg.douyinSaveAllowed==='boolean'&&savePermissionState?.ok===true&&savePermissionState.selected===pkg.douyinSaveAllowed);
  const savePermissionEvidence={requested:savePermissionRequested?pkg.douyinSaveAllowed:null,available:savePermissionState?.ok===true,selected:savePermissionState?.selected??null,ok:savePermissionOk,code:savePermissionState?.code||null,notRequested:!savePermissionRequested};
  const buttons = await inspectFinalButtons(/^发布$/);
  const finalButton = buttons.find(button=>button.buttonish) || buttons[0] || null;
  const receipt = expectedReceipts.cover || null;
  const expectedBySlot = Object.fromEntries(douyinCoverAssets.map(asset=>[asset.slot,asset]));
  const coverReceiptOk = douyinCustomCover && receipt && ['portrait','landscape'].every(slot => {
    const item=receipt.slots?.[slot]; const expected=expectedBySlot[slot];
    if(item?.pixelProof){const proof=item.pixelProof;
     if(proof.mode==='exact_native_visual_qa_sha_bound'){if(typeof personalCoverVisualContract==='undefined'||typeof verifyPersonalDouyinVisualCoverReceipt!=='function'||!verifyPersonalDouyinVisualCoverReceipt(slot,item,expected,personalCoverVisualContract,fs,crypto))return false;}
     else {const actualSha=crypto.createHash('sha256').update(fs.readFileSync(expected.path)).digest('hex');if(item.sourceSha256!==actualSha||proof.ok!==true||proof.afterUrl!==item.afterUrl||proof.mode!=='full_native_rgb_match_bound_source'||!(proof.mae<=3&&proof.rmse<=7&&proof.correlation>=.995))return false;}
    }
    return item?.assetPath===expected.path && item?.ratio===expected.ratio && item?.afterUrl && (state.coverUrls[slot]||[]).includes(item.afterUrl);
  }) && receipt.slots.portrait.afterUrl!==receipt.slots.landscape.afterUrl;
  const defaultCoverOk = !douyinCustomCover && ['portrait','landscape'].some(slot=>(state.coverUrls[slot]||[]).length>0 || /选择封面|设置封面/.test(state.text));
  const scopeResumeActive = typeof douyinPreparationScopeResumeActive !== 'undefined'
    && douyinPreparationScopeResumeActive === true && ['inspect','upload_start'].includes(phase);
  const authenticatedOk = !state.loginRequired && (!scopeResumeActive || uploadSurface.ok === true);
  return {
    gates: {
      poi,
      schedule: await inspectDouyinSchedule(),
      authenticated: authenticatedOk ? okGate({url:state.url,douyinUploadSurface:uploadSurface}) : failedGate({url:state.url,loginRequired:state.loginRequired,douyinUploadSurface:uploadSurface}),
      draftIdentity: state.identityMatches ? okGate({empty:state.identityEmpty,title:state.title,editorText:state.editorText,recovery:state.knownMisroutedInput?'known_title_body_input_misroute':null}) : failedGate({foreign:true,title:state.title,editorText:state.editorText}),
      video: state.uploadSucceeded && !state.uploading && !state.uploadFailed ? okGate({stable:true}) : failedGate({uploaded:state.uploadSucceeded,uploading:state.uploading,failed:state.uploadFailed,resumeDialog:state.resumeDialog}),
      title: state.title===douyinTitle ? okGate({expected:douyinTitle,actual:state.title}) : failedGate({expected:douyinTitle,actual:state.title}),
      description: state.prose===douyinDescription ? okGate({expected:douyinDescription,actual:state.prose}) : failedGate({expected:douyinDescription,actual:state.prose,editorText:state.editorText}),
      tags: state.selected.length===douyinTopics.length&&!state.plainResidue.length&&!state.duplicates.length&&!state.unexpected.length ? okGate({requested:douyinTopics,selected:state.selected,tokenCounts:state.tokenCounts}) : failedGate({requested:douyinTopics,selected:state.selected,plainResidue:state.plainResidue,duplicates:state.duplicates,unexpected:state.unexpected,tokenCounts:state.tokenCounts,editorText:state.editorText}),
      settings: declarationOk&&(state.noSyncChecked||state.syncUnavailable)&&!state.syncOn&&!state.simultaneousChecked&&savePermissionOk ? okGate({simultaneousPublish:false,toutiaoSync:false,controlUnavailable:state.syncUnavailable,declaration:declarationEvidence,savePermission:savePermissionEvidence}) : failedGate({simultaneousPublish:state.simultaneousChecked,noSyncChecked:state.noSyncChecked,toutiaoSync:state.syncOn,syncFound:state.syncFound,declaration:declarationEvidence,savePermission:savePermissionEvidence}),
      cover: coverReceiptOk||defaultCoverOk ? okGate({custom:douyinCustomCover,urls:state.coverUrls,receipt}) : failedGate({custom:douyinCustomCover,urls:state.coverUrls,receipt,reason:douyinCustomCover&&!receipt?'custom cover receipt missing':'cover not verified'}),
      noBlockingDialog: state.dialogs.length===0 ? okGate({active:[]}) : failedGate({active:state.dialogs}),
      finalButton: finalButton&&!finalButton.disabled ? okGate(finalButton) : failedGate({buttons}),
    },
    evidence:{
      pageSample:state.text,
      uploadSurface,
      earlyMutation:{
        ready:state.earlyMutationReady,
        uploading:state.uploading,
        uploadComplete:state.uploadSucceeded&&!state.uploading&&!state.uploadFailed,
        titleReady:state.titleInputReady,
        editorReady:state.editorReady,
        topicControlReady:state.topicControlReady,
        settingsReady:state.settingsReady,
      },
    },
  };
}

async function discardDouyinResumeDialog(before) {
  if (!before.gates.video.evidence?.resumeDialog) return { ok: true, skipped: true };
  const point=await js(String.raw`(() => {const c=v=>String(v||'').replace(/\s+/g,' ').trim();const item=[...document.querySelectorAll('button,[role="button"],div,span')].map(el=>({el,text:c(el.innerText||el.textContent||''),r:el.getBoundingClientRect()})).filter(x=>x.text==='放弃'&&x.r.width>12&&x.r.height>=8&&x.r.width<160&&x.r.height<70).sort((a,b)=>a.r.width*a.r.height-b.r.width*b.r.height)[0];if(!item)return null;const r=item.r;return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (!point) return { ok: false, reason: 'douyin discard button missing' };
  try {
    await click([point.x,point.y],{label:'discard stale douyin upload'});
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
  await wait(1.5);
  return { ok: true, changed: true };
}

function douyinPostResultDraftFreshUploadBlocker(before) {
  if (!isPersonalDouyinPostResultDraftContinuation()) return null;
  try {
    assertDouyinPersonalPostResultDraftFreshUploadObservation(before, pkg.schoolAccount, taskSpaceRef);
    return null;
  } catch (error) {
    const code = String(error?.code || 'DOUYIN_PERSONAL_POST_RESULT_DRAFT_FRESH_UPLOAD_NOT_BLANK').slice(0, 120);
    return typedBlocker(code, '续办前同一原始上传页必须再次证明空白编辑器、无存留视频/对话框且上传控件唯一；本次未触发文件输入', {
      retryable: false,
      evidence: { freshBlankUploadProof: false },
    });
  }
}

async function exposeDouyinVideoInput() {
  return await js(String.raw`(() => { const input=[...document.querySelectorAll('input[type=file]')].find(el=>/video|\.mp4|\.mov|\.mkv|\.flv/i.test(el.accept||'')); if(!input)return {ok:false,reason:'douyin video input missing'}; input.value=''; input.id='vp2-douyin-video'; return {ok:true,selector:'#vp2-douyin-video'} })()`);
}

async function waitDouyinEarlyMutationReady(mode) {
  let current = await inspectDouyin();
  for (let attempt=0; attempt<30; attempt+=1) {
    if (current.gates.video.ok) {
      return {...current,actions:{upload:{mode,stage:'complete',earlyMutationReady:false}}};
    }
    const video=current.gates.video.evidence||{};
    if (video.failed===true&&!video.uploading) {
      return {...current,actions:{upload:{mode,stage:'explicit_failure',earlyMutationReady:false}},blocker:typedBlocker('PLATFORM_REJECTED_ASSET','抖音在上传启动阶段明确显示失败',{retryable:true,evidence:video})};
    }
    if (video.uploading===true&&current.evidence?.earlyMutation?.ready===true) {
      return {...current,actions:{upload:{mode,stage:'editable_uploading',earlyMutationReady:true}}};
    }
    await wait(1);
    current=await inspectDouyin();
  }
  const video=current.gates.video.evidence||{};
  const early=current.evidence?.earlyMutation||{};
  const blocker=video.uploading===true
    ? typedBlocker('SELECTOR_DRIFT','抖音视频已开始上传，但提前填写所需编辑控件没有在等待窗口内全部出现',{retryable:true,evidence:{video,early}})
    : typedBlocker('UPLOAD_NOT_STARTED','抖音文件注入后没有出现上传进度或已完成证据',{retryable:true,evidence:{video,early}});
  return {...current,actions:{upload:{mode,stage:'not_editable',earlyMutationReady:false}},blocker};
}

async function startDouyinUpload() {
  let before=await inspectDouyin();
  const postResultDraftBlocker=douyinPostResultDraftFreshUploadBlocker(before);
  if(postResultDraftBlocker)return {...before,blocker:postResultDraftBlocker};
  if(before.gates.video.ok)return {...before,actions:{upload:{mode:'already_ready',stage:'complete',earlyMutationReady:false}}};
  if(!before.gates.draftIdentity.ok)return {...before,blocker:typedBlocker('FOREIGN_DRAFT','抖音当前编辑器属于其他视频草稿',{evidence:before.gates.draftIdentity.evidence})};
  if(before.gates.video.evidence?.uploading===true)return await waitDouyinEarlyMutationReady('resume_existing');
  const discarded=await discardDouyinResumeDialog(before);
  if(!discarded.ok)return {...before,blocker:typedBlocker('SELECTOR_DRIFT',discarded.reason)};
  if(discarded.changed)before=await inspectDouyin();
  const exposed=await exposeDouyinVideoInput();
  if(!exposed.ok)return {...before,blocker:typedBlocker('SELECTOR_DRIFT',exposed.reason)};
  try {
    await uploadFile(exposed.selector,videoPath);
  } catch (error) {
    const sourceChanged=error?.code==='DOUYIN_INPUT_MISSING_SOURCE_ASSET_CHANGED_AT_UPLOADFILE';
    return {...before,blocker:typedBlocker(sourceChanged?error.code:'UPLOAD_NOT_STARTED',String(error?.message||error),{retryable:!sourceChanged})};
  }
  return await waitDouyinEarlyMutationReady('injected');
}

async function waitExistingDouyinUpload() {
  let stableSince=0;
  for(let i=0;i<180;i+=1){
    await wait(5);
    const current=await inspectDouyin();
    const video=current.gates.video.evidence||{};
    if(current.gates.video.ok){
      if(!stableSince)stableSince=Date.now();
      if(Date.now()-stableSince>=10000)return {...current,actions:{upload:{mode:'resume_existing'}}};
    }else stableSince=0;
    if(video.failed===true&&!video.uploading){
      return {...current,actions:{upload:{mode:'resume_existing',result:'explicit_failure'}},blocker:typedBlocker('PLATFORM_REJECTED_ASSET','抖音恢复中的视频明确显示上传失败',{retryable:true,evidence:video})};
    }
  }
  const after=await inspectDouyin();
  return {...after,actions:{upload:{mode:'resume_existing'}},blocker:typedBlocker('UPLOAD_STALLED','抖音恢复中的视频没有在等待窗口内稳定完成',{retryable:true,evidence:after.gates.video.evidence})};
}

async function uploadDouyin() {
  let before=await inspectDouyin();
  if(before.gates.video.ok)return {...before,actions:{upload:{mode:'already_ready'}}};
  if(!before.gates.draftIdentity.ok)return {...before,blocker:typedBlocker('FOREIGN_DRAFT','抖音当前编辑器属于其他视频草稿',{evidence:before.gates.draftIdentity.evidence})};
  if(before.gates.video.evidence?.uploading===true)return await waitExistingDouyinUpload();
  const postResultDraftBlocker=douyinPostResultDraftFreshUploadBlocker(before);
  if(postResultDraftBlocker)return {...before,blocker:postResultDraftBlocker};
  const discarded=await discardDouyinResumeDialog(before);
  if(!discarded.ok)return {...before,blocker:typedBlocker('SELECTOR_DRIFT',discarded.reason)};
  if(discarded.changed)before=await inspectDouyin();
  const attempts=[];
  for(let attempt=1;attempt<=2;attempt+=1){
    const exposed=await exposeDouyinVideoInput();
    if(!exposed.ok)return {...before,blocker:typedBlocker('SELECTOR_DRIFT',exposed.reason)};
    try{await uploadFile(exposed.selector,videoPath);}catch(error){return {...before,blocker:typedBlocker('UPLOAD_NOT_STARTED',String(error?.message||error),{retryable:true,evidence:{attempt}})};}
    let stableSince=0;
    let activityObserved=false;
    let current=before;
    for(let i=0;i<180;i+=1){
      await wait(5);
      current=await inspectDouyin();
      const video=current.gates.video.evidence||{};
      if(video.uploading||video.failed!==true)activityObserved=true;
      if(current.gates.video.ok){
        if(!stableSince)stableSince=Date.now();
        if(Date.now()-stableSince>=10000)return {...current,actions:{upload:{mode:'injected'},uploadAttempts:attempts.concat({attempt,result:'ready'})}};
      }else stableSince=0;
      if(video.failed===true&&!video.uploading&&(activityObserved||i>=5)){
        attempts.push({attempt,result:'explicit_failure',evidence:video});
        break;
      }
    }
    const after=await inspectDouyin();
    if(after.gates.video.ok)return {...after,actions:{upload:{mode:'injected'},uploadAttempts:attempts.concat({attempt,result:'ready'})}};
    const video=after.gates.video.evidence||{};
    if(video.failed===true&&attempt<2){await wait(2);before=after;continue;}
    const blocker=video.failed===true
      ? typedBlocker('PLATFORM_REJECTED_ASSET','抖音明确显示视频上传失败，已完成一次有界重试',{retryable:true,evidence:{attempts,video}})
      : typedBlocker('UPLOAD_STALLED','抖音视频没有在等待窗口内稳定完成',{retryable:true,evidence:{attempts,video}});
    return {...after,actions:{upload:{mode:'injected'},uploadAttempts:attempts},blocker};
  }
  const after=await inspectDouyin();
  return {...after,blocker:typedBlocker('UPLOAD_STALLED','抖音视频重试后仍未稳定完成',{retryable:true,evidence:after.gates.video.evidence})};
}

async function setDouyinTitle() {
  const selector='input[placeholder*="作品标题"]';
  const before=await js(String.raw`((selector) => {const el=document.querySelector(selector);if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});return el.value})(${JSON.stringify(selector)})`);
  if(before===null)return {ok:false,reason:'douyin title input missing'};
  let after=before;
  for(let attempt=1;attempt<=3&&after!==douyinTitle;attempt+=1){
    const exposed=await js(String.raw`((selector) => {const el=document.querySelector(selector);if(!el)return {ok:false};el.id='vp2-douyin-title';el.scrollIntoView({block:'center',inline:'center'});return {ok:true,selector:'#vp2-douyin-title'}})(${JSON.stringify(selector)})`);
    if(!exposed.ok)return {ok:false,reason:'douyin title input missing during retry'};
    try{await click(exposed.selector,{label:'focus douyin title'})}catch(error){return {ok:false,reason:String(error?.message||error)}}
    const selected=await js(String.raw`((selector) => {const el=document.querySelector(selector);if(!el)return {ok:false};el.focus();el.select();return {ok:el.selectionStart===0&&el.selectionEnd===el.value.length,start:el.selectionStart,end:el.selectionEnd,length:el.value.length}})(${JSON.stringify(selector)})`);
    if(!selected.ok)continue;
    await pressKey('Backspace').catch(()=>{});
    await wait(.25);
    const cleared=await js(String.raw`((selector) => (document.querySelector(selector)?.value||'')==='')(${JSON.stringify(selector)})`);
    if(!cleared)continue;
    await cdp('Input.insertText',{text:douyinTitle});
    await wait(.5);
    await js(String.raw`((selector) => {document.querySelector(selector)?.blur();return true})(${JSON.stringify(selector)})`);await wait(.7);
    after=await js(String.raw`((selector) => document.querySelector(selector)?.value||'')(${JSON.stringify(selector)})`);
  }
  return after===douyinTitle?{ok:true,before,value:after}:{ok:false,reason:'douyin title input did not persist exact value after bounded retries',expected:douyinTitle,actual:after};
}

async function locateDouyinEditor() {
  return await js(String.raw`(() => {
    const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>180&&r.height>50&&s.display!=='none'&&s.visibility!=='hidden'}
    const rows=[...document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')].map(el=>{const r=el.getBoundingClientRect();let p=el.parentElement,context='';for(let i=0;p&&i<5;i+=1){context+=' '+compact(p.innerText||p.textContent||'');p=p.parentElement}return {el,r,context,cls:String(el.className||'')}}).filter(item=>visible(item.el)&&!item.el.closest('[role="dialog"],[class*="modal"],[class*="dialog"]')).sort((a,b)=>Number(/作品描述|#添加话题|@好友/.test(b.context))-Number(/作品描述|#添加话题|@好友/.test(a.context))||Number(/editor|zone|ace/.test(b.cls))-Number(/editor|zone|ace/.test(a.cls))||b.r.width*b.r.height-a.r.width*a.r.height)
    const item=rows[0];if(!item)return {ok:false,reason:'douyin description editor missing'};item.el.id='vp2-douyin-editor';item.el.scrollIntoView({block:'center',inline:'center'});return {ok:true,selector:'#vp2-douyin-editor',text:item.el.innerText||item.el.textContent||'',className:item.cls,point:{x:item.r.left+Math.min(24,item.r.width/4),y:item.r.top+Math.min(24,item.r.height/3)}}
  })()`);
}

async function focusDouyinEditorEnd() {
  const located=await locateDouyinEditor();
  if(!located.ok)return located;
  const endpoint=await js(String.raw`(() => {
    const editor=document.querySelector('#vp2-douyin-editor');if(!editor)return {ok:false,reason:'douyin editor lost'}
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node,last=null;while((node=walker.nextNode())){if(String(node.nodeValue||'').length)last=node}
    const er=editor.getBoundingClientRect();if(!last)return {ok:true,point:{x:er.left+12,y:er.top+20}}
    const range=document.createRange();range.setStart(last,Math.max(0,last.nodeValue.length-1));range.setEnd(last,last.nodeValue.length);const rect=range.getBoundingClientRect();
    return {ok:true,point:{x:Math.min(er.right-6,Math.max(er.left+6,rect.right+2)),y:Math.min(er.bottom-6,Math.max(er.top+6,rect.top+rect.height/2))}}
  })()`);
  if(!endpoint.ok)return endpoint;
  try{await click([endpoint.point.x,endpoint.point.y],{label:'focus douyin body end'})}catch(error){return {ok:false,reason:String(error?.message||error)}}
  const focused=await js(String.raw`(() => {const editor=document.querySelector('#vp2-douyin-editor');if(!editor)return{ok:false,reason:'douyin editor lost before focus confirmation'};editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);const active=document.activeElement;return{ok:active===editor||editor.contains(active),activeTag:active?.tagName||'',activeId:active?.id||''}})()`);
  await wait(.2);
  return focused.ok?{ok:true,point:endpoint.point,focus:focused}:{ok:false,reason:'douyin description editor did not retain focus',evidence:focused};
}

async function clearAndFillDouyinBody() {
  let located=await locateDouyinEditor();if(!located.ok)return located;
  for(let attempt=0;attempt<3;attempt+=1){
    try{await click([located.point.x,located.point.y],{label:'focus douyin body'})}catch(error){return {ok:false,reason:String(error?.message||error)}}
    const selected=await js(String.raw`(() => {const editor=document.querySelector('#vp2-douyin-editor');if(!editor)return{ok:false,reason:'douyin editor lost while selecting body'};editor.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);const active=document.activeElement;return{ok:active===editor||editor.contains(active),activeTag:active?.tagName||'',activeId:active?.id||''}})()`);
    if(!selected.ok)return {ok:false,reason:'douyin description editor did not retain selection focus',evidence:selected};
    await pressKey('Backspace').catch(()=>{});await wait(.7);
    located=await locateDouyinEditor();if(!String(located.text||'').replace(/[\s\u200b]/g,''))break;
  }
  const cleared=await locateDouyinEditor();if(String(cleared.text||'').replace(/[\s\u200b]/g,''))return {ok:false,reason:'douyin description editor did not clear',text:cleared.text};
  if(douyinDescription){const focused=await focusDouyinEditorEnd();if(!focused.ok)return focused;await cdp('Input.insertText',{text:douyinDescription});await wait(1);}
  const after=await locateDouyinEditor();const ok=String(after.text||'').replace(/[\s\u200b]/g,'')===String(douyinDescription||'').replace(/[\s\u200b]/g,'');return ok?{ok:true,text:after.text}:{ok:false,reason:'douyin description did not persist exact value',expected:douyinDescription,actual:after.text};
}

const normalizeDouyinTopic = value => String(value || '').replace(/^#/, '').replace(/\s+/g, '').toLowerCase();

async function inspectDouyinTrailingPlainText() {
  await locateDouyinEditor();
  return await js(String.raw`((expectedDescription) => {
    const editor=document.querySelector('#vp2-douyin-editor');if(!editor)return {ok:false,reason:'douyin editor missing during tail inspection'}
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node,lastPlain=null
    while((node=walker.nextNode())){if(!node.parentElement?.closest('[data-mention], [contenteditable="false"]')&&String(node.nodeValue||'').replace(/\u200b/g,'').length)lastPlain=node}
    let value=String(lastPlain?.nodeValue||'').replace(/\u200b/g,'')
    if(expectedDescription&&value.startsWith(expectedDescription))value=value.slice(expectedDescription.length)
    const entities=[...editor.querySelectorAll('[data-mention="#"], [data-mention="activity"]')].map(el=>String(el.innerText||el.textContent||'').replace(/[\s\u200b\u00a0]+/g,'').replace(/^#/,'').toLowerCase()).filter(Boolean)
    return {ok:true,value,trimmed:value.trim(),entities,editorText:String(editor.innerText||editor.textContent||'')}
  })(${JSON.stringify(douyinDescription)})`);
}

async function removeDouyinTrailingTopicQuery(tag, expectedCommitted = []) {
  const expected='#'+String(tag).replace(/\s+/g,'').toLowerCase();
  const before=await inspectDouyinTrailingPlainText();
  if(!before.ok)return before;
  const initial=String(before.trimmed||'').toLowerCase();
  if(!initial){
    const after=await inspectDouyin();
    const selected=after.gates.tags.evidence?.selected||[];
    const entitiesUnchanged=!after.gates.tags.evidence?.unexpected?.length&&selected.length===expectedCommitted.length&&selected.every((value,index)=>normalizeDouyinTopic(value)===normalizeDouyinTopic(expectedCommitted[index]));
    return after.gates.description.ok&&entitiesUnchanged
      ? {ok:true,alreadyClean:true,before}
      : {ok:false,reason:'douyin empty topic tail did not preserve exact prose and committed entities',description:after.gates.description.evidence,selected,expectedCommitted};
  }
  if(!initial.startsWith('#')||!expected.startsWith(initial))return {ok:false,reason:'douyin trailing text is not a provable prefix of the failed topic query',expected,actual:before.trimmed,evidence:before};
  const focused=await focusDouyinEditorEnd();if(!focused.ok)return focused;
  const snapshots=[];
  for(let attempt=0;attempt<expected.length+4;attempt+=1){
    const current=await inspectDouyinTrailingPlainText();
    if(!current.ok)return current;
    snapshots.push(current.trimmed);
    const tail=String(current.trimmed||'').toLowerCase();
    if(!tail||!tail.startsWith('#'))break;
    if(!expected.startsWith(tail))return {ok:false,reason:'douyin failed-topic tail changed into an unsafe value during cleanup',expected,actual:current.trimmed,snapshots};
    await pressKey('Backspace').catch(()=>{});await wait(.18);
  }
  const after=await inspectDouyin();
  const selected=after.gates.tags.evidence?.selected||[];
  const entitiesUnchanged=!after.gates.tags.evidence?.unexpected?.length&&selected.length===expectedCommitted.length&&selected.every((value,index)=>normalizeDouyinTopic(value)===normalizeDouyinTopic(expectedCommitted[index]));
  const tail=await inspectDouyinTrailingPlainText();
  const clean=!String(tail.trimmed||'').startsWith('#');
  return clean&&entitiesUnchanged&&after.gates.description.ok
    ? {ok:true,before,after:tail,snapshots}
    : {ok:false,reason:'douyin failed-topic tail could not be removed without changing committed entities or prose',clean,entitiesUnchanged,description:after.gates.description.evidence,selected,expectedCommitted,tail,snapshots};
}

function locateDouyinExactTopicInPage(tag) {
 const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
 const clean=v=>compact(v).replace(/^#/,'').toLowerCase();
 const expected=clean(tag),visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const containers=[...document.querySelectorAll('[class*="mention-suggest-item-container"]')].filter(visible);
 const names=containers.flatMap(c=>[...c.querySelectorAll('[class*="tag-hash-view-name-"]')]).filter(visible);
 let row=null;
 if(names.length){
  const exact=names.filter(n=>clean(n.textContent)===expected);
  if(exact.length!==1)return null;
  row=exact[0].parentElement?.parentElement;
  if(!row||!containers.some(c=>c.contains(row)))return null;
 }else{
  const exact=containers.flatMap(c=>[...c.querySelectorAll('*')]).filter(visible).filter(e=>{
   const text=compact(e.innerText||e.textContent),parts=text.split(/\s+/);
   return parts[0]?.toLowerCase()==='#'+expected&&(text.match(/#/g)||[]).length===1&&/^[\d.,万亿kwKW+\s]*(?:次播放|播放|浏览)?$/.test(parts.slice(1).join(' '));
  }).filter(e=>{const r=e.getBoundingClientRect();return r.height>20&&r.height<90&&r.width>150;});
  row=exact.sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0];
 }
 if(!row||!visible(row))return null;
 const id='vp2-douyin-exact-topic-row',prior=[...document.querySelectorAll('#'+id)];
 if(prior.some(e=>e!==row&&!containers.some(c=>c.contains(e))))return null;
 prior.forEach(e=>{if(e!==row)e.removeAttribute('id');});row.id=id;
 const r=row.getBoundingClientRect();
 return {selector:'#'+id,x:r.left+r.width/2,y:r.top+r.height/2,text:compact(row.textContent),exactName:expected};
}

async function addDouyinTopic(tag) {
  const queryTag=String(tag).replace(/\s+/g,'');
  const findRow=()=>js('('+locateDouyinExactTopicInPage.toString()+')('+JSON.stringify(queryTag)+')');
  const attempts=[];
  for(let attempt=1;attempt<=3;attempt+=1){
    const before=await inspectDouyin();
    const committedBefore=before.gates.tags.evidence?.selected||[];
    if(committedBefore.some(value=>normalizeDouyinTopic(value)===normalizeDouyinTopic(tag)))return {ok:true,already:true,attempts};
    const focused=await focusDouyinEditorEnd();if(!focused.ok)return focused;
    await cdp('Input.insertText',{text:' '});await wait(.2);
    const buttonPoint=await js(String.raw`(() => {const c=v=>String(v||'').replace(/\s+/g,' ').trim();const item=[...document.querySelectorAll('button,[role="button"],div,span')].map(el=>({el,text:c(el.innerText||el.textContent||''),r:el.getBoundingClientRect()})).filter(x=>x.text==='#添加话题'&&x.r.width>20&&x.r.width<140&&x.r.height>=8&&x.r.height<50).sort((a,b)=>a.r.width*a.r.height-b.r.width*b.r.height)[0];if(!item)return null;item.el.scrollIntoView({block:'center',inline:'center'});const r=item.el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if(!buttonPoint)return {ok:false,reason:'douyin add-topic button missing',attempts};
    try{await click([buttonPoint.x,buttonPoint.y],{label:`open douyin topic ${tag}`})}catch(error){return {ok:false,reason:String(error?.message||error),attempts}}
    await wait(.7);await cdp('Input.insertText',{text:queryTag});await wait(1.4);
    let typed=await inspectDouyinTrailingPlainText();
    if(!String(typed.trimmed||'')){
      const refocused=await focusDouyinEditorEnd();
      if(refocused.ok){
        await cdp('Input.insertText',{text:'#'+queryTag});await wait(1.4);
        typed=await inspectDouyinTrailingPlainText();
      }
    }
    if(String(typed.trimmed||'').toLowerCase()!==('#'+queryTag).toLowerCase()){
      const cleanup=await removeDouyinTrailingTopicQuery(queryTag,committedBefore);
      attempts.push({attempt,result:'query_not_exact',typed,cleanup});
      if(!cleanup.ok)return {ok:false,reason:cleanup.reason,tag,attempts};
      await wait(1.5*attempt);continue;
    }
    let row=null;for(let poll=0;poll<12&&!row;poll+=1){row=await findRow();if(!row)await wait(.8)}
    if(!row){
      const cleanup=await removeDouyinTrailingTopicQuery(queryTag,committedBefore);
      attempts.push({attempt,result:'suggestion_missing',cleanup});
      if(!cleanup.ok)return {ok:false,reason:cleanup.reason,tag,attempts};
      await wait(1.5*attempt);continue;
    }
    try{await click(row.selector||[row.x,row.y],{label:`commit douyin topic ${tag}`})}catch(error){return {ok:false,reason:String(error?.message||error),tag,attempts}}
    await wait(1.4);
    let state=await inspectDouyin();let committed=(state.gates.tags.evidence?.selected||[]).some(value=>normalizeDouyinTopic(value)===normalizeDouyinTopic(tag));
    if(!committed&&state.gates.tags.evidence?.unexpected?.length)return {ok:false,reason:'unexpected native topic entity after exact selection; reconcile existing editor',unexpected:state.gates.tags.evidence.unexpected,tag,attempts};
    if(!committed){
      const refocused=await focusDouyinEditorEnd();
      if(refocused.ok){
        await pressKey('ArrowDown').catch(()=>{});await wait(.25);
        await pressKey('Enter').catch(()=>{});await wait(1.2);
        state=await inspectDouyin();if(state.gates.tags.evidence?.unexpected?.length)return {ok:false,reason:'unexpected native topic entity after fallback; reconcile existing editor',unexpected:state.gates.tags.evidence.unexpected,tag,attempts};committed=(state.gates.tags.evidence?.selected||[]).some(value=>normalizeDouyinTopic(value)===normalizeDouyinTopic(tag));
      }
    }
    if(!committed){const retry=await findRow();if(retry){await click(retry.selector||[retry.x,retry.y],{label:`retry douyin topic ${tag}`}).catch(()=>{});await wait(1.2);state=await inspectDouyin();if(state.gates.tags.evidence?.unexpected?.length)return {ok:false,reason:'unexpected native topic entity after fallback; reconcile existing editor',unexpected:state.gates.tags.evidence.unexpected,tag,attempts};committed=(state.gates.tags.evidence?.selected||[]).some(value=>normalizeDouyinTopic(value)===normalizeDouyinTopic(tag))}}
    if(committed){await pressKey('ArrowRight').catch(()=>{});await cdp('Input.insertText',{text:' '}).catch(()=>{});await wait(.3);return {ok:true,text:row.text,attempts:[...attempts,{attempt,result:'committed'}]}}
    const cleanup=await removeDouyinTrailingTopicQuery(queryTag,committedBefore);
    attempts.push({attempt,result:'entity_not_committed',cleanup,evidence:state.gates.tags.evidence});
    if(!cleanup.ok)return {ok:false,reason:cleanup.reason,tag,attempts};
    await wait(1.5*attempt);
  }
  return {ok:false,reason:'exact douyin topic suggestion did not commit after bounded retries',tag,attempts};
}

async function recoverDouyinTopicPrefix(before) {
  const evidence=before.gates.tags.evidence||{};
  const selected=evidence.selected||[];
  const validPrefix=selected.length<douyinTopics.length&&!evidence.duplicates?.length&&!evidence.unexpected?.length
    &&selected.every((value,index)=>normalizeDouyinTopic(value)===normalizeDouyinTopic(douyinTopics[index]));
  const editorText=String(evidence.editorText||before.gates.description.evidence?.editorText||'').replace(/\s+/g,' ').trim();
  const descriptionPrefix=editorText.startsWith(String(douyinDescription||'').replace(/\s+/g,' ').trim());
  if(!validPrefix||!descriptionPrefix)return {ok:false,recoverable:false,reason:'douyin editor is not a provable description plus ordered topic prefix',selected,editorText};
  const nextTag=douyinTopics[selected.length];
  const cleanup=await removeDouyinTrailingTopicQuery(nextTag,selected);
  if(!cleanup.ok)return {ok:false,recoverable:true,reason:cleanup.reason,cleanup};
  return {ok:true,recoverable:true,selected,nextIndex:selected.length,cleanup};
}

async function turnOffDouyinSync() {
  const observed=await inspectDouyin(); if(observed.gates.settings.ok&&observed.gates.settings.evidence?.controlUnavailable)return {ok:true,notApplicable:true,evidence:observed.gates.settings.evidence};
  const located=await js(String.raw`(() => {const c=v=>String(v||'').replace(/\s+/g,' ').trim();const label=[...document.querySelectorAll('label')].find(el=>c(el.innerText||el.textContent||'').startsWith('不同时发布'));if(!label)return {ok:false,reason:'douyin no-sync radio missing'};const input=label.querySelector('input');label.scrollIntoView({block:'center',inline:'center'});const r=label.getBoundingClientRect();return {ok:true,on:Boolean(input?.checked),point:{x:r.left+r.width/2,y:r.top+r.height/2}}})()`);
  if(!located.ok)return located;if(!located.on){await click([located.point.x,located.point.y],{label:'disable douyin simultaneous publish'}).catch(()=>{});await wait(1)}const after=await inspectDouyin();return after.gates.settings.ok?{ok:true,wasOn:!located.on}:{ok:false,reason:'douyin simultaneous publish remained enabled',evidence:after.gates.settings.evidence};
}

function locateDouyinCoverCompletionInPage(labels){
 const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;};
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>visible(el)&&!/animate-hide/.test(String(el.className||''))&&/封面/.test(el.innerText||el.textContent||''));
 if(dialogs.length!==1)return {ok:false,code:'DOUYIN_COVER_DIALOG_AMBIGUOUS'};
 for(const label of labels){
  const rows=[...dialogs[0].querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&compact(el.innerText||el.textContent)===label&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!/disabled/.test(String(el.className||'')));
  if(rows.length>1)return {ok:false,code:'DOUYIN_COVER_COMPLETION_AMBIGUOUS'};if(!rows.length)continue;
  const button=rows[0];button.scrollIntoView({block:'center',inline:'nearest'});const r=button.getBoundingClientRect();
  if(r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return {ok:false,code:'DOUYIN_COVER_CONTROL_OUTSIDE_VIEWPORT',label,rect:{x:r.left,y:r.top,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight}};
  const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
  if(!hit||(hit!==button&&!button.contains(hit)))return {ok:false,code:'DOUYIN_COVER_CONTROL_OCCLUDED',label};
  const holders=[...document.querySelectorAll('[id="vp2-douyin-cover-complete"]')];
  if(holders.some(el=>el!==button&&!dialogs[0].contains(el)))return {ok:false,code:'DOUYIN_COVER_COMPLETION_LOCATOR_CONFLICT'};
  for(const prior of holders)if(prior!==button)prior.removeAttribute('id');
  button.id='vp2-douyin-cover-complete';
  if(document.querySelectorAll('[id="vp2-douyin-cover-complete"]').length!==1)return {ok:false,code:'DOUYIN_COVER_COMPLETION_LOCATOR_NOT_UNIQUE'};
  return {ok:true,label,x,y};
 }
 return {ok:false,code:'DOUYIN_COVER_COMPLETION_NOT_ENABLED'};
}

async function uploadDouyinCoverSlot(asset) {
  await js(String.raw`(() => {document.querySelectorAll('[class*="animate-hide"]').forEach(el=>{el.style.pointerEvents='none'});return true})()`);
  const active=await js(String.raw`(() => Boolean([...document.querySelectorAll('[role="dialog"]')].find(el=>!/animate-hide/.test(String(el.className||''))&&(el.innerText||el.textContent||'').includes('封面'))))()`);
  if(!active){
    const prepared=await js(String.raw`((slot) => {const c=v=>String(v||'').replace(/\s+/g,' ').trim();const re=slot==='portrait'?/竖封面\s*3\s*:\s*4|竖封面3:4/:/横封面\s*4\s*:\s*3|横封面4:3/;const label=[...document.querySelectorAll('div,span')].filter(el=>re.test(c(el.innerText||el.textContent||''))&&c(el.innerText||el.textContent||'').length<40).sort((a,b)=>c(a.innerText||a.textContent||'').length-c(b.innerText||b.textContent||'').length)[0];const card=label?.closest('.coverControl-CjlzqC')||label?.parentElement?.parentElement;if(!card)return {ok:false,reason:'douyin cover slot control missing'};card.id='vp2-douyin-cover-card-'+slot;card.scrollIntoView({block:'center',inline:'center'});return {ok:true,selector:'#'+card.id}})(${JSON.stringify(asset.slot)})`);
    if(!prepared.ok)return {...prepared,slot:asset.slot};await hover(prepared.selector,{label:`reveal douyin ${asset.slot} cover`}).catch(()=>{});await wait(.5);const trigger=await js(String.raw`((selector,slot) => {const card=document.querySelector(selector);const target=card?.querySelector('.title-wA45Xd')||card?.querySelector('.filter-k_CjvJ:not(.background-OpVteV)')||card;if(!target)return {ok:false,reason:'douyin cover edit trigger missing'};target.id='vp2-douyin-cover-trigger-'+slot;return {ok:true,selector:'#'+target.id}})(${JSON.stringify(prepared.selector)},${JSON.stringify(asset.slot)})`);if(!trigger.ok)return {...trigger,slot:asset.slot};await click(trigger.selector,{label:`open douyin ${asset.slot} cover`}).catch(()=>{});await wait(2);
  }
  const exposed=await js(String.raw`((slot) => {const dialog=[...document.querySelectorAll('[role="dialog"]')].find(el=>!/animate-hide/.test(String(el.className||''))&&(el.innerText||el.textContent||'').includes('封面'));if(!dialog)return {ok:false,reason:'douyin cover dialog missing'};const active=[...dialog.querySelectorAll('[class*="step-active"]')].map(el=>(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()).join(' ');const expected=slot==='portrait'?'竖封面':'横封面';if(active&&!active.includes(expected))return {ok:false,reason:'douyin cover dialog opened on wrong slot',active,expected};const input=dialog.querySelector('.upload-BvM5FF input.semi-upload-hidden-input')||[...dialog.querySelectorAll('input[type=file]')].find(el=>(el.parentElement?.innerText||'').includes('点击上传文件'));if(!input)return {ok:false,reason:'douyin custom cover input missing'};input.id='vp2-douyin-cover-'+slot;return {ok:true,selector:'#'+input.id,active}})(${JSON.stringify(asset.slot)})`);
  if(!exposed.ok)return exposed;try{await uploadFile(exposed.selector,asset.path)}catch(error){return {ok:false,reason:String(error?.message||error)}}await wait(3);
  const allowedLabels=asset.slot==='portrait'?['设置横封面','完成']:['完成'];let action=null;
  for(let attempt=0;attempt<30&&!action;attempt+=1){
    const located=await js('('+locateDouyinCoverCompletionInPage.toString()+')('+JSON.stringify(allowedLabels)+')');
    if(located?.ok)action=located;
    else if(located?.code==='DOUYIN_COVER_CONTROL_OUTSIDE_VIEWPORT'||located?.code==='DOUYIN_COVER_CONTROL_OCCLUDED')return {...located,slot:asset.slot};
    if(!action)await wait(.75);
  }
  if(!action)return {ok:false,reason:`douyin ${allowedLabels.join(' or ')} button did not enable`,slot:asset.slot};
  try{await click('#vp2-douyin-cover-complete',{label:`douyin cover ${action.label}`});}
  catch(error){return {ok:false,code:'DOUYIN_COVER_COMPLETION_CLICK_FAILED',reason:String(error?.message||error),slot:asset.slot};}
  if(action.label==='完成'){let closed=false;for(let attempt=0;attempt<40;attempt+=1){closed=await js(String.raw`(() => ![...document.querySelectorAll('[role="dialog"]')].some(el=>!/animate-hide/.test(String(el.className||''))&&/封面/.test(el.innerText||el.textContent||'')&&el.getBoundingClientRect().width>4&&el.getBoundingClientRect().height>4&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'&&Number(getComputedStyle(el).opacity||1)>0))()`);if(closed)break;await wait(.75)}if(!closed)return {ok:false,reason:'douyin cover dialog did not close after completion',slot:asset.slot}}else await wait(2);
  return {ok:true,assetPath:asset.path,ratio:asset.ratio,completionLabel:action.label};
}

async function recoverDouyinCoverPixels() {
  const state=await inspectDouyin();
  if(!state.gates.video.ok||!state.gates.draftIdentity.ok)return {ok:false,reason:'cover_recovery_requires_same_video_and_draft'};
  const slots={};
  for(const asset of douyinCoverAssets){
    const bytes=fs.readFileSync(asset.path),assetSha256=crypto.createHash('sha256').update(bytes).digest('hex');
    const proof=await js('('+probeDouyinCoverPixels.toString()+')('+[asset.slot,'data:image/png;base64,'+bytes.toString('base64'),compareDouyinCoverPixels.toString()].map(x=>JSON.stringify(x)).join(',')+')');
    if(!proof.ok)return {ok:false,reason:'native_cover_source_pixels_not_proven',slot:asset.slot,proof};
    if(crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex')!==assetSha256)return {ok:false,reason:'cover_source_changed'};
    slots[asset.slot]={assetPath:asset.path,ratio:asset.ratio,afterUrl:proof.afterUrl,beforeUrls:[],sourceSha256:assetSha256,pixelProof:proof};
  }
  if(slots.portrait.afterUrl===slots.landscape.afterUrl)return {ok:false,reason:'native_cover_slots_mirrored'};
  return {ok:true,receipt:{slots},reason:'fresh full RGB native transcode comparison against both bound source assets; no reupload'};
}

async function repairDelayedDouyinCoverReceipt(){
  const prior=expectedReceipts.cover;
  if(!prior?.slots?.portrait||!prior?.slots?.landscape)return {ok:false,skipped:true};
  const expected=Object.fromEntries(douyinCoverAssets.map(asset=>[asset.slot,asset]));
  if(!['portrait','landscape'].every(slot=>prior.slots[slot].assetPath===expected[slot].path&&prior.slots[slot].ratio===expected[slot].ratio))return {ok:false,skipped:true};
  // A changed preview URL is never proof of source identity. Require fresh
  // decoded pixels of both slots before repairing any delayed receipt.
  return await recoverDouyinCoverPixels();
}

async function ensureDouyinSavePermission() {
  if(!Object.prototype.hasOwnProperty.call(pkg,'douyinSaveAllowed'))return {ok:true,notRequested:true};
  if(typeof pkg.douyinSaveAllowed!=='boolean')return {ok:false,code:'DOUYIN_SAVE_PERMISSION_INTENT_INVALID'};
  const read=()=>js('('+readDouyinSavePermissionInPage.toString()+')('+JSON.stringify(pkg.douyinSaveAllowed)+',false)');
  let before=await read();
  if(before?.ok!==true)return {ok:false,code:before?.code||'DOUYIN_SAVE_PERMISSION_READBACK_FAILED',evidence:before};
  if(before.selected===pkg.douyinSaveAllowed)return {ok:true,changed:false,evidence:before};
  const prepared=await js('('+readDouyinSavePermissionInPage.toString()+')('+JSON.stringify(pkg.douyinSaveAllowed)+',true)');
  if(prepared?.ok!==true||typeof prepared.selector!=='string'||!/^#vp2-douyin-save-permission-(allow|disallow)$/.test(prepared.selector))return {ok:false,code:prepared?.code||'DOUYIN_SAVE_PERMISSION_CONTROL_UNAVAILABLE',evidence:prepared};
  try{await click(prepared.selector,{label:pkg.douyinSaveAllowed?'allow saving':'disallow saving'});}
  catch(error){return {ok:false,code:'DOUYIN_SAVE_PERMISSION_SET_FAILED',reason:String(error?.message||error)};}
  await wait(.2);
  const after=await read();
  return after?.ok===true&&after.selected===pkg.douyinSaveAllowed
    ?{ok:true,changed:true,evidence:after}
    :{ok:false,code:'DOUYIN_SAVE_PERMISSION_READBACK_FAILED',evidence:after};
}

async function ensureDouyinMetadata(before) {
  const actions = {};
  if(before.gates.tags.evidence?.unexpected?.length)return {ok:false,actions,blocker:typedBlocker('STATE_AMBIGUOUS','原生编辑器含未获批准话题，保留原文不重写',{evidence:{unexpected:before.gates.tags.evidence.unexpected}})};
  const savePermission=await ensureDouyinSavePermission();
  if(!savePermission.ok)return {ok:false,actions,blocker:typedBlocker('ACTION_FAILED','抖音保存权限没有按封存请求完成原生设置与回读',{evidence:savePermission})};
  if(!savePermission.notRequested)actions.savePermission=savePermission;
  if (!before.gates.title.ok) {
    actions.title = await setDouyinTitle();
    if (!actions.title.ok) return { ok:false,actions,blocker:typedBlocker('ACTION_FAILED', actions.title.reason, { evidence: actions.title }) };
  }
  if (!(before.gates.description.ok && before.gates.tags.ok)) {
    const recovered = await recoverDouyinTopicPrefix(before);
    let startIndex = 0;
    if (recovered.ok) {
      actions.bodyRecovery = recovered;
      startIndex = recovered.nextIndex;
    } else {
      if (recovered.recoverable) return { ok:false,actions,blocker:typedBlocker('ACTION_FAILED', recovered.reason, { evidence: recovered }) };
      if ((before.gates.tags.evidence?.selected||[]).length) return { ok:false,actions,blocker:typedBlocker('STATE_AMBIGUOUS', recovered.reason, { evidence: recovered }) };
      actions.body = await clearAndFillDouyinBody();
      if (!actions.body.ok) return { ok:false,actions,blocker:typedBlocker('ACTION_FAILED', actions.body.reason) };
    }
    for (const tag of douyinTopics.slice(startIndex)) {
      const added = await addDouyinTopic(tag);
      (actions.topics ||= []).push({ tag, ...added });
      if (!added.ok) return { ok:false,actions,blocker:typedBlocker('ACTION_FAILED', added.reason, { evidence: added }) };
    }
  }
  const declaration=await inspectDouyin();
  const de=declaration.gates.settings.evidence?.declaration;
  if(de?.available&&de.requested==='none'&&!de.ok){
    const prepared=await js(`(() => {const rows=[...document.querySelectorAll('section')].filter(x=>String(x.querySelector('.title-cnbkZe')?.textContent||'').trim()==='自主声明');if(rows.length!==1)return {ok:false};const control=rows[0].querySelector('.selectBox-buZRzi');if(!control)return {ok:false};control.id='vp2-douyin-declaration-control';return {ok:true}})()`);
    if(!prepared.ok)return {ok:false,actions,blocker:typedBlocker('SELECTOR_DRIFT','抖音自主声明控件不唯一')};
    await click('#vp2-douyin-declaration-control',{label:'set requested no declaration'});
    await click('text="无需添加自主声明"',{label:'choose no self declaration'});
    await click('text="确定"',{label:'confirm requested declaration'});
    const after=await inspectDouyin();actions.declaration=after.gates.settings.evidence?.declaration;
    if(!actions.declaration?.ok)return {ok:false,actions,blocker:typedBlocker('ACTION_FAILED','抖音无需声明未保存',{evidence:actions.declaration})};
  }
  actions.settings = await turnOffDouyinSync();
  if (!actions.settings.ok) return { ok:false,actions,blocker:typedBlocker('SELECTOR_DRIFT', actions.settings.reason) };
  return { ok:true,actions };
}

async function prefillDouyin() {
  const before=await inspectDouyin();
  if(!before.gates.draftIdentity.ok)return {...before,blocker:typedBlocker('FOREIGN_DRAFT','抖音当前编辑器属于其他视频草稿',{evidence:before.gates.draftIdentity.evidence})};
  const early=before.evidence?.earlyMutation||{};
  if(!before.gates.video.ok&&!(before.gates.video.evidence?.uploading===true&&early.ready===true)){
    return {...before,blocker:typedBlocker('STATE_AMBIGUOUS','抖音上传中的编辑区尚未满足提前填写条件',{retryable:true,evidence:{video:before.gates.video.evidence,early}})};
  }
  const metadata=await ensureDouyinMetadata(before);
  if(!metadata.ok)return {...(await inspectDouyin()),actions:metadata.actions,blocker:metadata.blocker};
  const after=await inspectDouyin();
  return {...after,actions:{...metadata.actions,prefill:{completedDuringUpload:after.gates.video.evidence?.uploading===true}}};
}

async function mutateDouyin() {
  const before = await inspectDouyin();
  if (!before.gates.video.ok) return { ...before, blocker: typedBlocker('STATE_AMBIGUOUS', '抖音没有可修复的已上传视频') };
  const metadata=await ensureDouyinMetadata(before);
  if(!metadata.ok)return {...(await inspectDouyin()),actions:metadata.actions,blocker:metadata.blocker};
  const actions = metadata.actions;

  const receipts = {};
  if (douyinCustomCover) {
    const repaired = await repairDelayedDouyinCoverReceipt();
    const recoveredPixels = !repaired.ok && !before.gates.cover.ok ? await recoverDouyinCoverPixels() : {ok:false};
    if(recoveredPixels.ok){receipts.cover=recoveredPixels.receipt;expectedReceipts.cover=receipts.cover;actions.coverPixelRecovery={ok:true,reason:recoveredPixels.reason};actions.receiptCheckpoint=checkpointReceipts(receipts);}
    
    if (recoveredPixels.ok) {
      // Source identity already recovered and checkpointed; never upload again.
    } else if (repaired.ok) {
      actions.coverReceiptRepair = { ok: true, reason: repaired.reason };
      receipts.cover = repaired.receipt;
      expectedReceipts.cover = receipts.cover;
    } else {
      const beforeUrls = before.gates.cover.evidence?.urls || {};
      const existingDistinct = (beforeUrls.portrait || []).some(url => url && (beforeUrls.landscape || []).some(other => other && other !== url));
      if (existingDistinct && !before.gates.cover.ok) {
        const current = await inspectDouyin();
        return {
          ...current,
          actions,
          blocker: typedBlocker('STATE_AMBIGUOUS', '抖音页面已有双封面，但正式回执和崩溃恢复 checkpoint 均缺失，无法证明素材身份；拒绝盲目重传', { retryable: false, evidence: { urls: beforeUrls, recoveredPixels, repaired } }),
        };
      }
      // Any unfinished attempt remains ambiguous; no fixed-object retry exception.
      const priorAttempts=expectedReceipts.cover?.attempts||[];
      if(priorAttempts.length){return {...(await inspectDouyin()),actions,blocker:typedBlocker('STATE_AMBIGUOUS','封面存在未确认尝试；先核验原作品，不重传',{evidence:{attemptedSlots:priorAttempts.map(x=>x.slot)}})};}
      receipts.cover = { slots: {}, attempts: [] };
      for (const asset of douyinCoverAssets) {
        receipts.cover.attempts.push({slot:asset.slot,assetPath:asset.path,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex'),startedAt:new Date().toISOString()});
        actions.receiptCheckpoint=checkpointReceipts(receipts);
        const uploaded = await uploadDouyinCoverSlot(asset);
        receipts.cover.attempts.at(-1).result={ok:uploaded.ok,reason:uploaded.reason||null,completionLabel:uploaded.completionLabel||null};
        actions.receiptCheckpoint=checkpointReceipts(receipts);
        (actions.covers ||= []).push({ asset, ...uploaded });
        if (!uploaded.ok) return { ...(await inspectDouyin()), actions, receipts, blocker: typedBlocker('PLATFORM_REJECTED_ASSET', uploaded.reason, { retryable: true, evidence: uploaded }) };
      }
      let coverState = null;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        coverState = await inspectDouyin();
        const portrait = coverState.gates.cover.evidence?.urls?.portrait || [];
        const landscape = coverState.gates.cover.evidence?.urls?.landscape || [];
        if (portrait.length && landscape.length && portrait.some(url => !landscape.includes(url)) && landscape.some(url => !portrait.includes(url))) break;
        await wait(1);
      }
      for (const asset of douyinCoverAssets) {
        const urls = coverState.gates.cover.evidence?.urls?.[asset.slot] || [];
        const otherSlot = asset.slot === 'portrait' ? 'landscape' : 'portrait';
        const otherUrls = coverState.gates.cover.evidence?.urls?.[otherSlot] || [];
        const afterUrl = urls.find(url => !(beforeUrls[asset.slot] || []).includes(url) && !otherUrls.includes(url));
        if (!afterUrl) return { ...coverState, blocker: typedBlocker('PLATFORM_REJECTED_ASSET', `douyin ${asset.slot} cover did not produce a distinct preview`, { retryable: true, evidence: { before: beforeUrls[asset.slot] || [], after: urls, other: otherUrls } }) };
        receipts.cover.slots[asset.slot] = { assetPath: asset.path, ratio: asset.ratio, beforeUrls: beforeUrls[asset.slot] || [], afterUrl };
      }
      expectedReceipts.cover = receipts.cover;
    }
  }
  actions.receiptCheckpoint = checkpointReceipts(receipts);
  actions.poi = await ensureDouyinPoi();
  if (!actions.poi.ok) return {...(await inspectDouyin()),actions,receipts,blocker:typedBlocker(actions.poi.code,actions.poi.reason,{retryable:true,evidence:actions.poi.evidence})};
  if (actions.poi.receipt) { receipts.poi=actions.poi.receipt; expectedReceipts.poi=receipts.poi; actions.receiptCheckpoint=checkpointReceipts(receipts); }
  actions.schedule=await ensureDouyinSchedule();
  if(!actions.schedule.ok)return {...(await inspectDouyin()),actions,receipts,blocker:typedBlocker(actions.schedule.code||'DOUYIN_SCHEDULE_NATIVE_SET_FAILED','抖音原生发布时间未能按当前包意图设置并鲜读确认',{retryable:false,evidence:actions.schedule})};
  const after = await inspectDouyin();
  return { ...after, actions, receipts };
}

async function runPlatformPhase(){if(phase==='inspect'||phase==='verify')return await inspectDouyin();if(phase==='upload_start')return await startDouyinUpload();if(phase==='prefill')return await prefillDouyin();if(phase==='upload')return await uploadDouyin();if(phase==='mutate')return await mutateDouyin();return {...(await inspectDouyin()),blocker:typedBlocker('ACTION_FAILED',`unsupported Douyin phase: ${phase}`)}}

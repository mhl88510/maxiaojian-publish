// Serialized into the original Ego page. Reads only bounded video-local React
// objects and File bytes; never returns React trees, tokens or signed play URLs.
export async function nativeVideoRecoveryProof(expected) {
 const fail=code=>({ok:false,code});
 if(expected?.version!==1||expected.neverInject!==true)return fail('VIDEO_RECOVERY_CONTRACT_INVALID');
 const g=window.__VIDEO_PUBLISHER_FINAL_GUARD__;
 if(g?.armed!==true||g.version!==1||!Array.isArray(g.blockedAttempts)||g.blockedAttempts.length||g.releasedAt)return fail('VIDEO_RECOVERY_GUARD_UNCLEAN');
 if(expected.resumeType==='personal_r3_existing_video_metadata_v1'&&location.pathname!=='/creator-micro/content/post/video')return fail('PERSONAL_EXISTING_EXACT_EDITOR_PATH_REQUIRED');
 if(!/\/creator-micro\/content\/post\/video/.test(location.pathname))return fail('VIDEO_RECOVERY_EDITOR_REQUIRED');
 const videos=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>20&&r.height>20});
 if(videos.length>1)return fail('VIDEO_RECOVERY_PREVIEW_AMBIGUOUS');
 const video=videos[0]||null;
 // No title-fiber fallback: the original preview must be restored first.
 // A stored receipt alone cannot prove current editor metadata identity.
 if(!video)return fail(expected.nativeVideoId&&expected.nativeMedia?'VIDEO_RECOVERY_PREVIEW_REQUIRED':'VIDEO_RECOVERY_PREVIEW_REQUIRED_FOR_INITIAL_RECOVERY');
 const anchor=video;
 if(video&&(video.readyState<2||!Number.isFinite(video.duration)||video.duration<=0))return fail('VIDEO_RECOVERY_PREVIEW_NOT_READY');
 const seen=new Set(),candidates=new Set();let budget=700;
 const blocked=/token|secret|cookie|password|authorization|play_url|poster_url/i;
 const walk=(o,depth)=>{
  if(!o||typeof o!=='object'||seen.has(o)||depth>3||budget--<=0||o instanceof Element||o instanceof File)return;
  seen.add(o);
  const desc=Object.getOwnPropertyDescriptors(o);
  if(desc.rawFile?.value instanceof File && typeof desc.vid?.value==='string')candidates.add(o);
  const cv=desc.currentVideo?.value;
  if(cv&&typeof cv==='object'&&Object.getOwnPropertyDescriptor(cv,'rawFile')?.value instanceof File)candidates.add(cv);
  for(const [k,d] of Object.entries(desc).slice(0,80)){
   if(blocked.test(k)||k==='children'||k==='return'||k==='rawFile')continue;
   if(d.value&&typeof d.value==='object')walk(d.value,depth+1);
  }
 };
 const scan=()=>{
  seen.clear();candidates.clear();budget=700;
  const fibers=new Set();
  let ancestor=anchor;
  for(let level=0;ancestor&&level<16;level++,ancestor=ancestor.parentElement){
   for(const key of Object.getOwnPropertyNames(ancestor).filter(k=>/^__react(?:Props|Fiber)\$/.test(k))){
    const v=Object.getOwnPropertyDescriptor(ancestor,key)?.value;
    if(key.startsWith('__reactProps'))walk(v,0);
    else {
     let fiber=v;
     for(let n=0;fiber&&n<16&&!fibers.has(fiber);n++,fiber=Object.getOwnPropertyDescriptor(fiber,'return')?.value){
      fibers.add(fiber);
      walk(Object.getOwnPropertyDescriptor(fiber,'memoizedProps')?.value,0);
      walk(Object.getOwnPropertyDescriptor(fiber,'pendingProps')?.value,0);
      walk(Object.getOwnPropertyDescriptor(fiber,'memoizedState')?.value,0);
     }
    }
   }
  }
 };
 scan();
 const matching=[...candidates].filter(c=>c.rawFile.size===expected.video.size&&c.rawFile.name===expected.video.name);
 const ids=new Set(matching.map(c=>c.vid));
 if(matching.length<1||ids.size!==1||typeof matching[0].vid!=='string'||!/^v[a-zA-Z0-9]{10,100}$/.test(matching[0].vid))return {...fail('VIDEO_RECOVERY_ORIGINAL_FILE_UNAVAILABLE'),diagnostic:{candidateCount:candidates.size,matchedCount:matching.length,visitedObjectCount:seen.size,vidCount:ids.size}};
 const c=matching[0],file=c.rawFile;
 if(expected.nativeVideoId && c.vid!==expected.nativeVideoId)return fail('VIDEO_RECOVERY_NATIVE_VID_CHANGED');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(sha256!==expected.video.sha256)return fail('VIDEO_RECOVERY_FILE_SHA_MISMATCH');
 if(Number(c.size)!==expected.video.size||c.name!==file.name||!(Number(c.duration)>0&&Number(c.width)>0&&Number(c.height)>0))return fail('VIDEO_RECOVERY_NATIVE_MEDIA_MISMATCH');
 if(video && (Math.abs(Number(c.duration)-video.duration)>0.1||Number(c.width)!==video.videoWidth||Number(c.height)!==video.videoHeight))return fail('VIDEO_RECOVERY_NATIVE_MEDIA_MISMATCH');
 if(!video && (c.uri!==expected.nativeMedia.uri||Math.abs(Number(c.duration)-expected.nativeMedia.duration)>0.1||Number(c.width)!==expected.nativeMedia.width||Number(c.height)!==expected.nativeMedia.height))return fail('VIDEO_RECOVERY_NATIVE_MEDIA_MISMATCH');
 if(typeof c.uri!=='string'||!/^tos-[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(c.uri))return fail('VIDEO_RECOVERY_NATIVE_URI_UNAVAILABLE');
 // Recheck after async hashing; changes during the probe invalidate the proof.
 scan();
 if(!candidates.has(c)||c.rawFile!==file||window.__VIDEO_PUBLISHER_FINAL_GUARD__!==g||g.armed!==true||g.blockedAttempts.length||g.releasedAt)return fail('VIDEO_RECOVERY_PAGE_CHANGED');
 return {ok:true,mode:'recovered_original_file',sha256,size:file.size,name:file.name,vid:c.vid,uri:c.uri,duration:Number(c.duration),width:Number(c.width),height:Number(c.height),proofAnchor:video?'original_video_preview':'original_editor_title_fiber',guardArmed:true,blockedAttempts:0,observedAt:new Date().toISOString()};
}

// Node-side fragment helper. Only returns from cover/title preview to the
// original video preview; no asset injection, permission click or final action.
export async function ensureNativeVideoRecoveryPreview(expected) {
 const previewState=()=>js(`(()=>{const rows=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>20&&r.height>20});return {count:rows.length,ready:rows.length===1&&rows[0].readyState>=2&&Number.isFinite(rows[0].duration)&&rows[0].duration>0&&rows[0].videoWidth>0}})()`);
 const waitReady=async changed=>{for(let n=0;n<30;n++){const s=await previewState();if(s.count>1)return {ok:false,code:'VIDEO_RECOVERY_PREVIEW_AMBIGUOUS'};if(s.ready)return {ok:true,changed};await wait(.3)}return {ok:false,code:'VIDEO_RECOVERY_PREVIEW_SWITCH_NOT_READY'}};
 const initial=await previewState();
 if(initial.count>0)return await waitReady(false);
 if(!expected.nativeVideoId||!expected.nativeMedia)return {ok:true,changed:false};
 const marker=String(expected.fingerprint||'');
 if(!/^[a-f0-9]{64}$/.test(marker))return {ok:false,code:'VIDEO_RECOVERY_CONTRACT_INVALID'};
 const located=await js(`((marker)=>{
  const g=window.__VIDEO_PUBLISHER_FINAL_GUARD__;
  if(g?.armed!==true||g.version!==1||g.blockedAttempts.length||g.releasedAt)return {ok:false,code:'VIDEO_RECOVERY_GUARD_UNCLEAN'};
  const compact=x=>String(x||'').replace(/\\s+/g,' ').trim();
  const nodes=[...document.querySelectorAll('[class*="previewTab-"] [class*="tabItem-"]')].filter(e=>compact(e.innerText||e.textContent)==='预览视频').filter(e=>e.closest('[class*="previewTab-"]') && String(e.parentElement?.className||'').includes('tabContainer-') && /预览视频/.test(e.parentElement.innerText||'') && String(e.parentElement.innerText||'').includes('预览封面/标题')).filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&e.getAttribute('aria-disabled')!=='true'});
  if(nodes.length!==1)return {ok:false,code:'VIDEO_RECOVERY_PREVIEW_CONTROL_AMBIGUOUS',count:nodes.length};
  nodes[0].setAttribute('data-school-native-recovery-preview',marker);
  nodes[0].scrollIntoView({block:'center',inline:'nearest'});
  return {ok:true};
 })(${JSON.stringify(marker)})`);
 if(!located.ok)return located;
 try {await click(`[data-school-native-recovery-preview="${marker}"]`,{label:'restore original video preview'});}
 catch {return {ok:false,code:'VIDEO_RECOVERY_PREVIEW_SWITCH_FAILED'};}
 return await waitReady(true);
}

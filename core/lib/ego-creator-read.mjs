// Project-owned, GET-only creator reader. No OpenCLI, extension, cookie export or retry.
export function parseCreatorJSON(text) {
  if (typeof text !== 'string' || text.length > 4_000_000) throw Error('CREATOR_RESPONSE_SIZE');
  let out = '', i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') { closed = true; break; }
      }
      if (!closed) throw Error('CREATOR_INVALID_JSON');
      out += text.slice(start, i);
    } else if (c === '-' || /[0-9]/.test(c)) {
      const token = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
      if (!token) throw Error('CREATOR_INVALID_JSON');
      // Preserve every unsafe integer, including owner UID and content ID, before JSON.parse.
      const big = /^-?\d+$/.test(token) && (BigInt(token) > 9007199254740991n || BigInt(token) < -9007199254740991n);
      out += big ? JSON.stringify(token) : token; i += token.length;
    } else { out += c; i++; }
  }
  return JSON.parse(out);
}

export function checkedCreatorUrl(url) {
  const u = new URL(url);
  if (u.origin !== 'https://creator.douyin.com' || u.username || u.password || u.hash ||
      !['/web/api/media/user/info/', '/janus/douyin/creator/pc/work_list'].includes(u.pathname))
    throw Error('CREATOR_READ_URL_NOT_ALLOWED');
  return u.href;
}

export function checkedCreatorResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.transport !== 'ego_creator_native_v1')
    throw Error('CREATOR_EVALUATE_SHAPE');
  if (r.kind !== 'ok') throw Error('CREATOR_' + (['TIMEOUT','NETWORK','HTTP','JSON','SIZE'].includes(r.kind) ? r.kind : 'TRANSPORT') + (r.httpStatus ? '_' + r.httpStatus : ''));
  if (r.httpStatus < 200 || r.httpStatus >= 300) throw Error('CREATOR_HTTP_' + r.httpStatus);
  const d = r.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw Error('CREATOR_API_SHAPE');
  if ('status_code' in d && d.status_code !== 0) {
    const message = String(d.status_msg ?? d.message ?? '');
    // Classify only; never log a platform response that may contain tokens or force re-login.
    if (/captcha|验证码|人机/i.test(message)) throw Error('CREATOR_CHALLENGE');
    if (/未登录|请登录|not logged|login required/i.test(message)) throw Error('CREATOR_AUTH_REQUIRED');
    throw Error('CREATOR_API_ERROR_' + String(d.status_code).replace(/[^a-zA-Z0-9_-]/g, '').slice(0,30));
  }
  return d;
}

export async function creatorGet(page, url, {onDiagnostic} = {}) {
  const checked = checkedCreatorUrl(url), endpoint = new URL(checked);
  // Never persist query values, raw exceptions, response bodies or account data.
  const started = Date.now();
  const base = {schema:'creator-request-diagnostic/v1', endpoint:endpoint.origin+endpoint.pathname,
    queryKeys:[...new Set(endpoint.searchParams.keys())].sort(), requestTimeoutMs:10000,
    targetId:typeof page.targetId==='string'&&/^[a-fA-F0-9]{32}$/.test(page.targetId)?page.targetId:null};
  const emit = d => { if(typeof onDiagnostic==='function')onDiagnostic({...base,...d}); };
  const js = `(async()=>{
    const transport='ego_creator_native_v1',started=Date.now();
    if(location.origin!=='https://creator.douyin.com')return {transport,kind:'TRANSPORT',requestElapsedMs:0,timerCleanupConfirmed:true};
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
    let result;
    try {
      const response=await fetch(${JSON.stringify(checked)},{method:'GET',credentials:'include',redirect:'error',signal:controller.signal});
      if(!response.ok)result={transport,kind:'HTTP',httpStatus:response.status};
      else {
        const text=await response.text();
        if(text.length>4000000)result={transport,kind:'SIZE'};
        else {try {const parse=${parseCreatorJSON.toString()};result={transport,kind:'ok',httpStatus:response.status,data:parse(text)};}
          catch {result={transport,kind:'JSON'};}}
      }
    } catch(e){result={transport,kind:controller.signal.aborted?'TIMEOUT':'NETWORK'};}
    finally{clearTimeout(timer);}
    return {...result,requestElapsedMs:Date.now()-started,timerCleanupConfirmed:true};
  })()`;
  let r;
  try {r=await page.evaluate(js);}
  catch(e) {
    // A rejected evaluate is a control-channel failure, not evidence of a fetch abort.
    const d={layer:'PAGE_EVALUATE_CONTROL',evaluateCompleted:false,returnedKind:null,
      elapsedMs:Date.now()-started,requestElapsedMs:null,timerCleanupConfirmed:null,
      errorType:['Error','TimeoutError','AbortError','TypeError'].includes(e?.name)?e.name:'UNKNOWN'};
    emit(d);const error=Error('CREATOR_EVALUATE_CONTROL_FAILED');error.diagnostic={...base,...d};throw error;
  }
  const shape=r&&typeof r==='object'&&!Array.isArray(r)&&r.transport==='ego_creator_native_v1';
  const d={layer:shape?'PAGE_REQUEST':'PAGE_EVALUATE_RESULT',evaluateCompleted:true,
    returnedType:r===null?'null':Array.isArray(r)?'array':typeof r,
    returnedKind:shape&&['ok','TIMEOUT','NETWORK','HTTP','JSON','SIZE','TRANSPORT'].includes(r.kind)?r.kind:null,
    elapsedMs:Date.now()-started,requestElapsedMs:shape&&Number.isFinite(r.requestElapsedMs)&&r.requestElapsedMs>=0?r.requestElapsedMs:null,
    httpStatus:shape&&Number.isInteger(r.httpStatus)&&r.httpStatus>=100&&r.httpStatus<=599?r.httpStatus:null,
    timerCleanupConfirmed:shape&&r.timerCleanupConfirmed===true?true:null};
  emit(d);
  try{return checkedCreatorResult(r);}catch(e){e.diagnostic={...base,...d};throw e;}
}

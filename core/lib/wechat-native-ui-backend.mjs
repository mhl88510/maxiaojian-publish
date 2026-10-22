export const WECHAT_NATIVE_RESULT_MARKER = 'SCHOOL_WECHAT_NATIVE_READ:';
export const WECHAT_NATIVE_ACTIONS = Object.freeze(['check', 'status', 'draft', 'publish', 'account-status']);
export const WECHAT_NATIVE_PHASES = Object.freeze([
  'binding',
  'native_identity',
  'article_editor',
  'body_import',
  'inline_images',
  'cover',
  'originality',
  'draft_save',
  'publish',
  'article_id_readback',
  'public_readback',
]);

const REQUIRED_BINDING_FIELDS = Object.freeze(['egoProfileId', 'taskSpaceId', 'taskSpaceName', 'pageLabel', 'targetId']);
const ACCOUNT_PLATFORM = 'wechat_official';

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTaskSpaceId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canonicalAccount(account) {
  const ego = account?.ego || {};
  const result = {
    platform: ACCOUNT_PLATFORM,
    accountKey: String(account?.key || ''),
    accountName: String(account?.name || ''),
    accountType: String(account?.type || ''),
    accountId: String(account?.id || ''),
    egoProfileId: String(ego.profileId || ''),
    taskSpaceId: normalizeTaskSpaceId(ego.taskSpaceId),
    taskSpaceName: String(ego.taskSpaceName || ''),
    pageLabel: String(ego.pageLabel || ''),
    targetId: String(ego.targetId || ''),
  };
  if (!result.accountKey || !result.accountName || !result.accountType) {
    throw codedError('WECHAT_ACCOUNT_REGISTRY_INCOMPLETE');
  }
  if (!result.egoProfileId || !result.taskSpaceId || !result.taskSpaceName || !/^p[1-9]\d*$/.test(result.pageLabel) || !result.targetId) {
    throw codedError('WECHAT_NATIVE_BINDING_UNAVAILABLE');
  }
  return result;
}

function sameBindingValue(given, expected, field) {
  if (field === 'taskSpaceId') return normalizeTaskSpaceId(given) === expected;
  return String(given ?? '') === String(expected ?? '');
}

/**
 * Resolve only a uniquely registered official account with a complete, canonical Ego binding.
 * In particular, a registered display name is not enough to guess the missing service-account
 * profile/space/target.
 */
export function resolveWechatNativeBinding(accountKey, matrix) {
  if (typeof accountKey !== 'string' || !accountKey.trim()) throw codedError('WECHAT_ACCOUNT_KEY_REQUIRED');
  const matches = (matrix?.platforms?.[ACCOUNT_PLATFORM]?.accounts || []).filter(account => account?.key === accountKey);
  if (matches.length !== 1) throw codedError(matches.length ? 'WECHAT_ACCOUNT_BINDING_AMBIGUOUS' : 'WECHAT_ACCOUNT_BINDING_REQUIRED');
  const binding = canonicalAccount(matches[0]);
  binding.knownAccounts = (matrix?.platforms?.[ACCOUNT_PLATFORM]?.accounts || [])
    .filter(account => account?.key !== accountKey)
    .map(account => ({ accountKey: String(account?.key || ''), accountName: String(account?.name || '') }));
  return binding;
}

/** Validate the content-studio native task against both its fixed package route and matrix binding. */
export function validateWechatNativeTask(pkg, binding, action = 'check') {
  if (!WECHAT_NATIVE_ACTIONS.includes(action)) throw codedError('WECHAT_NATIVE_ACTION_INVALID');
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw codedError('WECHAT_NATIVE_PACKAGE_INVALID');
  const target = pkg.schoolAccount || {};
  if (target.platform !== ACCOUNT_PLATFORM) throw codedError('WECHAT_NATIVE_PLATFORM_MISMATCH');
  if (target.accountKey !== binding.accountKey || pkg.nativeTask?.accountKey !== binding.accountKey) {
    throw codedError('WECHAT_NATIVE_ACCOUNT_KEY_MISMATCH');
  }
  if (target.accountName !== undefined && target.accountName !== binding.accountName) throw codedError('WECHAT_NATIVE_ACCOUNT_NAME_MISMATCH');
  if (target.accountType !== undefined && target.accountType !== binding.accountType) throw codedError('WECHAT_NATIVE_ACCOUNT_TYPE_MISMATCH');
  if (target.accountId !== undefined && String(target.accountId) !== binding.accountId) throw codedError('WECHAT_NATIVE_ACCOUNT_ID_MISMATCH');
  for (const field of REQUIRED_BINDING_FIELDS) {
    if (!sameBindingValue(target[field], binding[field], field)) throw codedError(`WECHAT_NATIVE_${field.replace(/[A-Z]/g, x => `_${x}`).toUpperCase()}_MISMATCH`);
  }
  if (!Array.isArray(pkg.nativeTask?.requiredBindingFields)
      || REQUIRED_BINDING_FIELDS.some(field => !pkg.nativeTask.requiredBindingFields.includes(field))) {
    throw codedError('WECHAT_NATIVE_TASK_CONTRACT_INCOMPLETE');
  }
  if (pkg.nativeTask?.kind !== 'wechat_official_article'
      || pkg.nativeTask?.apiFallbackAllowed !== false
      || pkg.backend !== 'ego_wechat_official'
      || pkg.publishingTransport !== 'ego_native_ui'
      || pkg.nativeOnly !== true) {
    throw codedError('WECHAT_NATIVE_TASK_CONTRACT_MISMATCH');
  }
  if (pkg.needsNativeBinding === true) throw codedError('WECHAT_NATIVE_BINDING_REQUIRED');
  if (action === 'status' && pkg.platformContentId !== undefined
      && (typeof pkg.platformContentId !== 'string' || !/^\d{1,32}$/.test(pkg.platformContentId))) {
    throw codedError('WECHAT_EXACT_STRING_CONTENT_ID_REQUIRED');
  }
  if (action === 'draft' || action === 'publish') {
    if (pkg.contentType !== 'article') throw codedError('WECHAT_NATIVE_ARTICLE_ONLY');
    if (pkg.studio?.subject?.kind === 'personal_ip') throw codedError('WECHAT_PERSONAL_ACCOUNT_ROUTE_UNVERIFIED');
    if (!String(pkg.title || '').trim()) throw codedError('WECHAT_ARTICLE_TITLE_REQUIRED');
    if (!(typeof pkg.body === 'string' && pkg.body.trim()) && !(typeof pkg.articlePath === 'string' && pkg.articlePath.trim())) {
      throw codedError('WECHAT_ARTICLE_BODY_REQUIRED');
    }
    if (pkg.originalDeclaration !== undefined && !['original', 'none'].includes(pkg.originalDeclaration)) {
      throw codedError('WECHAT_ORIGINALITY_INTENT_INVALID');
    }
  }
  if (action === 'publish' && (typeof pkg.platformContentId !== 'string' || !/^\d{1,32}$/.test(pkg.platformContentId))) {
    throw codedError('WECHAT_PUBLISH_REQUIRES_SAVED_NATIVE_DRAFT_ID');
  }
  return {
    ok: true,
    action,
    binding: { ...binding },
    apiFallbackAllowed: false,
    nativeOnly: true,
    liveIdentityVerified: false,
  };
}

function parseQuoted(text) {
  const match = String(text || '').match(/"((?:\\.|[^"\\])*)"/);
  if (!match) return '';
  try { return JSON.parse(`"${match[1]}"`); } catch { return match[1]; }
}

function parseRef(text) {
  return String(text || '').match(/\[ref=(\d+)\b/)?.[1] || '';
}

function parseSnapshotUrl(text) {
  const match = String(text || '').match(/\burl=(https?:\/\/[^\s\]]+)/);
  if (!match) return '';
  return match[1].replace(/[),;]+$/, '');
}

function snapshotTree(snapshot) {
  const root = { role: 'root', label: '', ref: '', raw: '', children: [], parent: null, indent: -1 };
  const stack = [root];
  for (const raw of String(snapshot || '').split(/\r?\n/)) {
    const match = raw.match(/^(\s*)([a-z][a-z0-9_-]*)(?:\s+(.*))?$/i);
    if (!match) continue;
    const indent = match[1].length;
    const role = match[2].toLowerCase();
    const rest = match[3] || '';
    if (!['root', 'container', 'heading', 'anchor', 'button', 'textbox', 'combobox', 'menuitem', 'checkbox', 'switch', 'link', 'text', 'paragraph', 'unordered_list', 'list_item', 'table', 'table_row', 'table_cell', 'image', 'svg_root', 'listboxoption', 'radio', 'option'].includes(role)) continue;
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    const node = { role, label: parseQuoted(rest), ref: parseRef(rest), raw, url: parseSnapshotUrl(rest), children: [], parent, indent };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function nodeText(node) {
  const result = [];
  const visit = current => {
    if (current.label) result.push(current.label);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return result;
}

function urlContentId(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, 'https://mp.weixin.qq.com');
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com') return null;
    // Do not treat analytics links (for example /cgi-bin/mpunderline?...appmsg_id=...) as article rows.
    if (!['/cgi-bin/appmsg', '/cgi-bin/appmsgpublish'].includes(url.pathname)) return null;
    for (const key of ['appmsg_id', 'mid', 'id']) {
      const value = url.searchParams.get(key);
      if (value && /^\d{1,32}$/.test(value)) return { platformContentId: value, idField: key };
    }
  } catch { /* malformed snapshot URLs are ignored */ }
  return null;
}

function statusFromContext(node) {
  const chain = [];
  for (let current = node; current && chain.length < 6; current = current.parent) chain.push(nodeText(current));
  for (const labels of chain) {
    const exact = new Set(labels.map(value => value.trim()));
    if (exact.has('审核未通过') || exact.has('未通过')) return 'REJECTED';
    if (exact.has('审核中')) return 'UNDER_REVIEW';
    if (exact.has('草稿')) return 'DRAFT';
    if (exact.has('已发表')) return 'PUBLISHED';
  }
  return 'STATUS_UNKNOWN';
}

function listScopeFromPath(pathname) {
  if (pathname === '/cgi-bin/appmsgpublish') return 'published_list';
  if (pathname === '/cgi-bin/appmsg') return 'draft_list';
  return null;
}

function descendantAnchors(node, result = []) {
  if (node.role === 'anchor' || node.role === 'link') result.push(node);
  for (const child of node.children) descendantAnchors(child, result);
  return result;
}

const CONTROL_LABELS = Object.freeze({
  '文章': 'article_create_entry',
  '贴图': 'image_text_create_entry',
  '预览': 'preview',
  '保存为草稿': 'draft_save',
  '发表': 'publish_entry',
  '原创': 'originality_entry',
  '文字原创': 'originality_state',
  '标题': 'article_title',
  '请输入标题': 'article_title',
  '正文': 'article_body',
});

/**
 * Discover only controls that exist as actionable nodes in the supplied *current* Ego snapshot.
 * Returned refs are ephemeral; the caller must take another snapshot before any future action.
 */
export function discoverWechatNativeControls(snapshot) {
  const tree = snapshotTree(snapshot);
  const candidates = [];
  const walk = node => {
    const labels = nodeText(node).map(label => label.trim()).filter(Boolean);
    const label = labels[0] || '';
    const phase = CONTROL_LABELS[label];
    const actionableRole = ['button', 'link', 'menuitem', 'checkbox', 'switch', 'textbox', 'combobox'].includes(node.role);
    if (phase && actionableRole && node.ref) {
      candidates.push({
        phase,
        role: node.role,
        label,
        snapshotRef: node.ref,
        locatorKind: 'transient_snapshot_ref',
        evidence: 'current_snapshot_role_and_exact_text',
        actionAllowed: false,
      });
    }
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return {
    source: 'current_ego_snapshot',
    controls: candidates,
    mutationAllowed: false,
    note: 'Snapshot refs are transient. Re-snapshot and revalidate account, target, role and exact text before any authorized action.',
  };
}

/** Parse safe identity and exact numeric article IDs from a snapshot without returning raw URLs. */
export function assessWechatNativeSnapshot(snapshot, binding, { knownAccounts = [], requestedContentId = null, currentUrl = null } = {}) {
  const tree = snapshotTree(snapshot);
  const allLabels = nodeText(tree).map(value => value.normalize('NFC').trim()).filter(Boolean);
  const nameOccurrences = allLabels.filter(value => value === binding.accountName.normalize('NFC')).length;
  const conflictingAccountKeys = knownAccounts
    .filter(account => account.accountKey !== binding.accountKey)
    .filter(account => account.accountName && allLabels.includes(String(account.accountName).normalize('NFC')))
    .map(account => account.accountKey);
  const accountNameVerified = nameOccurrences > 0 && conflictingAccountKeys.length === 0;
  const accountTypeVerified = allLabels.includes(binding.accountType);
  const anchors = descendantAnchors(tree);
  const articles = [];
  for (const anchor of anchors) {
    const id = urlContentId(anchor.url);
    if (!id) continue;
    const labels = nodeText(anchor).map(value => value.trim()).filter(Boolean);
    const title = labels[0] || '';
    if (!title) continue;
    const record = {
      platformContentId: id.platformContentId,
      idField: id.idField,
      title,
      status: statusFromContext(anchor),
      publicReadbackVerified: false,
    };
    articles.push(record);
  }
  let selectedArticle = null;
  let requestedArticleStatus = requestedContentId ? 'CONTENT_ID_NOT_OBSERVED' : null;
  if (requestedContentId) {
    if (typeof requestedContentId !== 'string' || !/^\d{1,32}$/.test(requestedContentId)) throw codedError('WECHAT_EXACT_STRING_CONTENT_ID_REQUIRED');
    const matches = articles.filter(article => article.platformContentId === requestedContentId);
    if (matches.length > 1) requestedArticleStatus = 'CONTENT_ID_AMBIGUOUS';
    else if (matches.length === 1) {
      selectedArticle = matches[0];
      requestedArticleStatus = 'EXACT_CONTENT_ID_OBSERVED';
    }
  }
  const controls = discoverWechatNativeControls(snapshot);
  const route = safeSnapshotRoute(snapshot) || (() => {
    try { const url = new URL(currentUrl); return { host: url.hostname, path: url.pathname }; } catch { return null; }
  })();
  const articleListScope = route?.host === 'mp.weixin.qq.com' ? listScopeFromPath(route.path) : null;
  return {
    accountKey: binding.accountKey,
    accountName: accountNameVerified ? binding.accountName : null,
    accountType: accountTypeVerified ? binding.accountType : null,
    accountNameVerified,
    accountTypeVerified,
    nameOccurrences,
    conflictingAccountKeys,
    articles,
    articleListReadbackVerified: articles.length > 0,
    requestedArticleStatus,
    selectedArticle,
    articleListScope,
    controls,
    observedUrl: route,
  };
}

function safeSnapshotRoute(snapshot) {
  const first = String(snapshot || '').split(/\r?\n/, 1)[0];
  const match = first.match(/https?:\/\/[^\s\]]+/);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return { host: url.hostname, path: url.pathname };
  } catch { return null; }
}

function nativePageGuardSource() {
  return `const b=${JSON.stringify(this)};
const verifyPage=async()=>{
  const spaces=(await listTaskSpaces()).filter(s=>Number(s.id)===b.taskSpaceId&&s.name===b.taskSpaceName);
  if(spaces.length!==1)throw Error(spaces.length?'WECHAT_NATIVE_SPACE_AMBIGUOUS':'WECHAT_NATIVE_SPACE_NOT_FOUND');
  const s=spaces[0];
  if(s.ownership!=='agent')throw Error(s.ownership==='user'?'WAIT_USER_CONTROL':'WECHAT_NATIVE_SPACE_OWNERSHIP_UNVERIFIED');
  if(s.profileId!==b.egoProfileId)throw Error('WECHAT_NATIVE_PROFILE_MISMATCH');
  const t=await taskSpace(b.taskSpaceId);
  if(Number(t.spaceId)!==b.taskSpaceId||t.name!==b.taskSpaceName||t.ownership!=='agent')throw Error('WECHAT_NATIVE_TASKSPACE_CHANGED');
  const tabs=(await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId);
  if(tabs.length!==1)throw Error(tabs.length?'WECHAT_NATIVE_TARGET_AMBIGUOUS':'WECHAT_NATIVE_TARGET_MISMATCH');
  const p=t.page(b.pageLabel);
  if(p.label!==b.pageLabel||Number(p.spaceId)!==b.taskSpaceId||p.targetId!==b.targetId)throw Error('WECHAT_NATIVE_PAGE_TARGET_MISMATCH');
  const rawUrl=await p.url();let route=null;
  try{const u=new URL(rawUrl);route={host:u.hostname,path:u.pathname};}catch{throw Error('WECHAT_NATIVE_PAGE_URL_INVALID');}
  if(route.host!=='mp.weixin.qq.com')throw Error('WECHAT_NATIVE_PAGE_HOST_MISMATCH');
  return {p,t,route};
};
const before=await verifyPage();
const snapshot=String(await before.p.snapshot({scope:'full_page'}));
const summarize=${summarizeWechatNativeSnapshot.toString()};
const observed=summarize(snapshot,b,before.route);
if(!observed.accountNameVerified)throw Error('WECHAT_NATIVE_ACCOUNT_NAME_UNVERIFIED');
const after=await verifyPage();
if(after.route.host!==before.route.host||after.route.path!==before.route.path)throw Error('WECHAT_NATIVE_PAGE_ROUTE_CHANGED');
const afterSnapshot=String(await after.p.snapshot({scope:'full_page'}));
const afterObserved=summarize(afterSnapshot,b,after.route);
if(!afterObserved.accountNameVerified)throw Error('WECHAT_NATIVE_ACCOUNT_NAME_UNVERIFIED');
if(afterObserved.accountNameVerified!==observed.accountNameVerified||afterObserved.accountName!==observed.accountName)throw Error('WECHAT_NATIVE_ACCOUNT_NAME_CHANGED');
console.log('SCHOOL_WECHAT_NATIVE_READ:'+JSON.stringify({ok:true,readOnly:true,accountKey:b.accountKey,accountNameVerified:observed.accountNameVerified,accountName:observed.accountName,accountTypeVerified:observed.accountTypeVerified,accountType:observed.accountType,articleListReadbackVerified:observed.articleListReadbackVerified,articles:observed.articles,controls:observed.controls,observedUrl:before.route,observedAt:new Date().toISOString(),sameTargetVerifiedBeforeAndAfter:true}));`;
}

function summarizeWechatNativeSnapshot(snapshot, binding, currentRoute) {
  const quoted = text => [...String(text || '').matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match => {
    try { return JSON.parse(`"${match[1]}"`); } catch { return match[1]; }
  });
  const parseUrl = text => String(text || '').match(/\burl=(https?:\/\/[^\s\]]+)/)?.[1]?.replace(/[),;]+$/, '') || '';
  const lines = String(snapshot || '').split(/\r?\n/);
  const labels = lines.flatMap(quoted).map(value => value.normalize('NFC').trim()).filter(Boolean);
  const nameOccurrences = labels.filter(value => value === binding.accountName.normalize('NFC')).length;
  const conflicts = (binding.knownAccounts || []).filter(account => account.accountKey !== binding.accountKey && account.accountName && labels.includes(String(account.accountName).normalize('NFC'))).map(account => account.accountKey);
  const accountNameVerified = nameOccurrences > 0 && conflicts.length === 0;
  const accountTypeVerified = labels.includes(binding.accountType);
  const articles = [];
  for (const line of lines) {
    if (!/^\s*(?:anchor|link)\b/i.test(line)) continue;
    const rawUrl = parseUrl(line);
    if (!rawUrl) continue;
    let id = null;
    try {
      const url = new URL(rawUrl, 'https://mp.weixin.qq.com');
      if (url.protocol === 'https:' && url.hostname === 'mp.weixin.qq.com' && ['/cgi-bin/appmsg', '/cgi-bin/appmsgpublish'].includes(url.pathname)) {
        for (const key of ['appmsg_id', 'mid', 'id']) {
          const value = url.searchParams.get(key);
          if (value && /^\d{1,32}$/.test(value)) { id = { platformContentId: value, idField: key }; break; }
        }
      }
    } catch { /* ignore malformed URLs */ }
    if (!id) continue;
    const lineIndex = lines.indexOf(line);
    const descendants = [];
    const parentIndent = (line.match(/^\s*/) || [''])[0].length;
    for (let i = lineIndex + 1; i < lines.length; i++) {
      const indent = (lines[i].match(/^\s*/) || [''])[0].length;
      if (lines[i].trim() && indent <= parentIndent) break;
      descendants.push(...quoted(lines[i]));
    }
    const inline = quoted(line);
    const title = inline[0] || descendants[0] || '';
    if (!title) continue;
    articles.push({ ...id, title, status: 'STATUS_UNKNOWN', publicReadbackVerified: false });
  }
  const actions = { '文章': 'article_create_entry', '贴图': 'image_text_create_entry', '预览': 'preview', '保存为草稿': 'draft_save', '发表': 'publish_entry', '原创': 'originality_entry', '文字原创': 'originality_state', '标题': 'article_title', '请输入标题': 'article_title', '正文': 'article_body' };
  const controls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], role = line.match(/^\s*(button|link|anchor|menuitem|checkbox|switch|textbox|combobox)\b/i)?.[1]?.toLowerCase();
    const ref = line.match(/\[ref=(\d+)\b/)?.[1] || '';
    if (!role || !ref) continue;
    const inline = quoted(line);
    const indent = (line.match(/^\s*/) || [''])[0].length;
    let descendant = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() && (lines[j].match(/^\s*/) || [''])[0].length <= indent) break;
      const values = quoted(lines[j]);
      if (values.length) { descendant = values[0]; break; }
    }
    const label = inline[0] || descendant;
    const phase = actions[label];
    if (!phase) continue;
    controls.push({ phase, role: role === 'anchor' ? 'anchor' : role, label, snapshotRef: ref, locatorKind: 'transient_snapshot_ref', evidence: 'current_snapshot_role_and_exact_text', actionAllowed: false });
  }
  const observedUrl = currentRoute ? { host: currentRoute.host, path: currentRoute.path } : null;
  const articleListScope = observedUrl?.host === 'mp.weixin.qq.com'
    ? (observedUrl.path === '/cgi-bin/appmsgpublish' ? 'published_list' : observedUrl.path === '/cgi-bin/appmsg' ? 'draft_list' : null)
    : null;
  const articleListReadbackVerified = !!articleListScope && articles.length > 0;
  return { accountName: accountNameVerified ? binding.accountName : null, accountNameVerified, accountType: accountTypeVerified ? binding.accountType : null, accountTypeVerified, articles, articleListScope, articleListReadbackVerified, controls: { source: 'current_ego_snapshot', controls, mutationAllowed: false, note: 'Snapshot refs are transient and must be rediscovered before any authorized action.' }, observedUrl };
}

export function buildWechatNativeReadScript(binding) {
  if (!binding || binding.platform !== ACCOUNT_PLATFORM || REQUIRED_BINDING_FIELDS.some(field => !binding[field])) throw codedError('WECHAT_NATIVE_BINDING_UNAVAILABLE');
  return nativePageGuardSource.call(binding);
}

function safeErrorCode(error) {
  return error?.code || String(error?.message || '').split(':')[0] || 'WECHAT_NATIVE_BACKEND_ERROR';
}

function safeDiagnostic(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s"'<>]+)/g, raw => {
      try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`; }
      catch { return '[URL_REDACTED]'; }
    })
    .replace(/\b(token|cookie|sessionid|authorization|key|secret)=([^&\s"'<>]+)/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

function safeTransportFailureCode(result) {
  const diagnostic = `${result?.stderr || ''}\n${result?.stdout || ''}`;
  const match = diagnostic.match(/\b(WECHAT_NATIVE_[A-Z0-9_]+|WAIT_USER_CONTROL)\b/);
  return match?.[1] || 'WECHAT_NATIVE_READBACK_UNAVAILABLE';
}

function resultBase(binding, action, additions = {}) {
  return {
    ok: false,
    status: 'BLOCKED',
    platform: ACCOUNT_PLATFORM,
    accountKey: binding?.accountKey || null,
    accountName: binding?.accountName || null,
    accountType: binding?.accountType || null,
    backend: 'ego_wechat_official',
    publishingTransport: 'ego_native_ui',
    action,
    readOnly: action === 'check' || action === 'status' || action === 'account-status',
    apiFallbackAllowed: false,
    nativeUIWriteVerified: false,
    publicationPerformed: false,
    uploadVerified: false,
    draftCreated: false,
    publicReadbackVerified: false,
    ...additions,
  };
}

function writePhaseResults(action, pkg) {
  const phases = [
    { phase: 'binding', status: 'STATIC_BINDING_VERIFIED', verified: true },
    { phase: 'native_identity', status: 'NOT_CHECKED', verified: false },
    { phase: 'article_editor', status: 'NOT_IMPLEMENTED', code: 'WECHAT_ARTICLE_EDITOR_DISCOVERY_REQUIRED', verified: false },
    { phase: 'body_import', status: 'NOT_IMPLEMENTED', code: 'WECHAT_HTML_IMPORT_NOT_VERIFIED', verified: false },
    { phase: 'inline_images', status: pkg?.images?.length ? 'NOT_IMPLEMENTED' : 'NOT_REQUESTED', code: pkg?.images?.length ? 'WECHAT_INLINE_IMAGE_UPLOAD_NOT_VERIFIED' : undefined, verified: false },
    { phase: 'cover', status: pkg?.coverPath ? 'NOT_IMPLEMENTED' : 'NOT_REQUESTED', code: pkg?.coverPath ? 'WECHAT_COVER_UPLOAD_NOT_VERIFIED' : undefined, verified: false },
    { phase: 'originality', status: 'NOT_IMPLEMENTED', code: 'WECHAT_ORIGINALITY_DIALOG_NOT_VERIFIED', requestedIntent: pkg?.originalDeclaration || 'UNSPECIFIED', verified: false },
    { phase: 'draft_save', status: 'NOT_IMPLEMENTED', code: 'WECHAT_NATIVE_DRAFT_SAVE_NOT_VERIFIED', verified: false },
    { phase: 'publish', status: action === 'publish' ? 'NOT_IMPLEMENTED' : 'NOT_REQUESTED', code: action === 'publish' ? 'WECHAT_NATIVE_PUBLISH_NOT_VERIFIED' : undefined, verified: false },
    { phase: 'article_id_readback', status: 'READ_ONLY_ADAPTER_AVAILABLE', verified: false },
    { phase: 'public_readback', status: 'NOT_IMPLEMENTED', code: 'WECHAT_PUBLIC_READBACK_NOT_VERIFIED', verified: false },
  ];
  return phases;
}

function assessNativeReadResult(observation, binding, action, requestedContentId = null) {
  if (observation?.accountKey !== binding.accountKey
      || observation?.accountNameVerified !== true
      || observation?.accountName !== binding.accountName
      || observation?.sameTargetVerifiedBeforeAndAfter !== true) {
    return resultBase(binding, action, {
      code: observation?.accountNameVerified === false ? 'WECHAT_NATIVE_ACCOUNT_NAME_UNVERIFIED' : 'WECHAT_NATIVE_IDENTITY_OR_TARGET_UNVERIFIED',
      accountIdentityVerified: false,
      accountTypeVerified: observation?.accountTypeVerified === true,
      articleListReadbackVerified: false,
      articles: [],
      controls: observation?.controls || null,
    });
  }
  const articles = Array.isArray(observation.articles) ? observation.articles : [];
  let selectedArticle = null;
  let contentMatchStatus = requestedContentId ? 'CONTENT_ID_NOT_OBSERVED' : null;
  if (requestedContentId) {
    const matches = articles.filter(article => article.platformContentId === requestedContentId);
    if (matches.length > 1) contentMatchStatus = 'CONTENT_ID_AMBIGUOUS';
    else if (matches.length === 1) { contentMatchStatus = 'EXACT_CONTENT_ID_OBSERVED'; selectedArticle = matches[0]; }
  }
  const articleListReadbackVerified = observation.articleListReadbackVerified === true;
  const code = requestedContentId && contentMatchStatus !== 'EXACT_CONTENT_ID_OBSERVED'
    ? contentMatchStatus
    : articleListReadbackVerified ? 'NATIVE_ARTICLE_ID_LIST_READ' : 'ARTICLE_ID_LIST_NOT_OBSERVED';
  return resultBase(binding, action, {
    ok: true,
    status: action === 'check' ? 'NATIVE_READ_ONLY_PREFLIGHT_PASSED' : 'ACCOUNT_IDENTITY_READBACK_VERIFIED',
    code,
    accountIdentityVerified: true,
    accountTypeVerified: observation.accountTypeVerified === true,
    articleListReadbackVerified,
    articleListScope: observation.articleListScope || null,
    articles,
    selectedArticle,
    contentMatchStatus,
    controls: observation.controls || null,
    observedUrl: observation.observedUrl || null,
    observedAt: observation.observedAt || null,
    sameTargetVerifiedBeforeAndAfter: true,
    publicReadbackVerified: false,
  });
}

/** Read-only native snapshot path. It never creates a TaskSpace, opens a page, navigates or mutates. */
export async function runWechatNative(pkg, matrix, execute, { action = 'check' } = {}) {


  let binding;
  try {
    if (typeof execute !== 'function') throw codedError('WECHAT_NATIVE_EXECUTOR_REQUIRED');
    const accountKey = pkg?.schoolAccount?.accountKey;
    binding = resolveWechatNativeBinding(accountKey, matrix);
    const contract = validateWechatNativeTask(pkg, binding, action);
    if (action === 'draft' || action === 'publish') {
      const phases = writePhaseResults(action, pkg);
      return resultBase(binding, action, {
        code: action === 'draft' ? 'WECHAT_NATIVE_DRAFT_WRITE_NOT_IMPLEMENTED' : 'WECHAT_NATIVE_PUBLISH_NOT_IMPLEMENTED',
        readOnly: true,
        phaseResults: phases,
        accountIdentityVerified: false,
        publicationPerformed: false,
        message: 'Only the read-only Ego snapshot adapter is implemented. Article insertion, image/cover upload, originality confirmation, draft save and publish remain explicitly unverified; no API fallback is allowed.',
      });
    }
    if (!['check', 'status'].includes(action)) throw codedError('WECHAT_NATIVE_ACTION_INVALID');
    const result = await execute('ego-browser', ['nodejs'], { input: buildWechatNativeReadScript(binding) });
    const line = `${result?.stdout || ''}\n${result?.stderr || ''}`.split(/\r?\n/).find(item => item.startsWith(WECHAT_NATIVE_RESULT_MARKER));
    if (result?.code !== 0 || !line) {
      return resultBase(binding, action, { code: result?.code === 0 ? 'WECHAT_NATIVE_READBACK_UNAVAILABLE' : safeTransportFailureCode(result), readOnly: true, accountIdentityVerified: false, articleListReadbackVerified: false, transportStatus: result?.code === 0 ? 'MISSING_STRUCTURED_OBSERVATION' : 'EGO_EXECUTION_FAILED' });
    }
    let observation;
    try { observation = JSON.parse(line.slice(WECHAT_NATIVE_RESULT_MARKER.length)); }
    catch { return resultBase(binding, action, { code: 'WECHAT_NATIVE_READBACK_MALFORMED', readOnly: true, accountIdentityVerified: false, articleListReadbackVerified: false }); }
    return assessNativeReadResult(observation, binding, action, pkg.platformContentId || null);
  } catch (error) {
    return resultBase(binding, action, { code: safeErrorCode(error), message: safeDiagnostic(error?.message), readOnly: true, accountIdentityVerified: false, articleListReadbackVerified: false });
  }
}

/** `school-publisher --account-status wechat_official <key>` equivalent for the native backend. */
export async function runWechatNativeAccountStatus(platform, accountKey, matrix, execute) {


  let binding;
  try {
    if (platform !== ACCOUNT_PLATFORM) throw codedError('WECHAT_NATIVE_PLATFORM_MISMATCH');
    binding = resolveWechatNativeBinding(accountKey, matrix);
    if (typeof execute !== 'function') throw codedError('WECHAT_NATIVE_EXECUTOR_REQUIRED');
    const result = await execute('ego-browser', ['nodejs'], { input: buildWechatNativeReadScript(binding) });
    const line = `${result?.stdout || ''}\n${result?.stderr || ''}`.split(/\r?\n/).find(item => item.startsWith(WECHAT_NATIVE_RESULT_MARKER));
    if (result?.code !== 0 || !line) return resultBase(binding, 'account-status', { code: result?.code === 0 ? 'WECHAT_NATIVE_READBACK_UNAVAILABLE' : safeTransportFailureCode(result), accountIdentityVerified: false, articleListReadbackVerified: false, transportStatus: result?.code === 0 ? 'MISSING_STRUCTURED_OBSERVATION' : 'EGO_EXECUTION_FAILED' });
    let observation;
    try { observation = JSON.parse(line.slice(WECHAT_NATIVE_RESULT_MARKER.length)); }
    catch { return resultBase(binding, 'account-status', { code: 'WECHAT_NATIVE_READBACK_MALFORMED', accountIdentityVerified: false, articleListReadbackVerified: false }); }
    return assessNativeReadResult(observation, binding, 'account-status');
  } catch (error) {
    return resultBase(binding, 'account-status', { code: safeErrorCode(error), message: safeDiagnostic(error?.message), accountIdentityVerified: false, articleListReadbackVerified: false });
  }
}

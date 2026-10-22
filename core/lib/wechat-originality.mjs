// These checked official draft/freepublish contracts do not document an
// originality setter or readback field. An intent is never platform evidence.
export function wechatDeclarationIntent(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('WECHAT_DECLARATION_INVALID');
  const fields = [[pkg.declaration, false], [pkg.originalDeclaration, true], [pkg.platformDeclarations?.wechat_official, false]];
  const values = fields.filter(([value]) => value !== undefined);
  const normalize = ([value, allowBoolean]) => {
    if ((allowBoolean && value === true) || value === 'original' || value === '原创') return 'original';
    if ((allowBoolean && value === false) || value === 'none' || value === '无需声明') return 'none';
    throw new Error('WECHAT_DECLARATION_INVALID');
  };
  const intents = values.map(normalize);
  if (new Set(intents).size > 1) throw new Error('WECHAT_DECLARATION_INVALID');
  return intents[0] || 'unspecified';
}

export function wechatOriginality(pkg, {reviewState = null} = {}) {
  const requested = wechatDeclarationIntent(pkg);
  return {
    requested, platformState: 'UNKNOWN', verified: false,
    capabilityScope: 'wechat_api_checked_draft_freepublish_contracts',
    writeSupported: false, readbackSupported: false, performed: false,
    reviewState,
    requiredNextStep: requested === 'original' ? 'VERIFY_AND_SET_IN_EXISTING_ACCOUNT_UI' : null,
  };
}

// Before reserving a write job, reject requests this API cannot fulfil. API
// draft creation is still allowed, explicitly pending a separately verified UI
// step; neither a rights flag nor a successful API response proves declaration.
export function preflightWechatDeclaration(pkg, action) {
  let originality;
  try { originality = wechatOriginality(pkg); }
  catch { return {ok: false, status: 'BLOCKED', code: 'WECHAT_DECLARATION_INVALID', publicationPerformed: false}; }
  if (action === 'publish' && originality.requested === 'original') {
    return {ok: false, status: 'BLOCKED', code: 'WECHAT_ORIGINALITY_UI_REQUIRED', originality,
      publicationPerformed: false, publicReadbackVerified: false};
  }
  return null;
}

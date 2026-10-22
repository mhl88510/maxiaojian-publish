import path from 'node:path';

export const DOUYIN_POI_INTENT_SCHEMA = 'douyin-poi-intent/v1';
export const DOUYIN_POI_ADDRESS_CONFLICT_POLICY = 'DO_NOT_INFER_EQUIVALENCE; require independent native campus/location evidence for a historical-address candidate';

const INTENT_KEYS = Object.freeze([
  'schema',
  'entityKind',
  'schoolName',
  'campus',
  'officialAddress',
  'excludedCampus',
  'historicalAddressVariants',
  'addressConflictPolicy',
  'intentSource',
]);
const SOURCE_KEYS = Object.freeze(['path', 'sha256']);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && !!value.trim();
}

/**
 * Validate a Douyin location intent and bind its source bytes to a packet
 * sourceRefs entry. This validates intent/provenance only; it says nothing
 * about whether Douyin exposes or has mounted a native POI.
 */
export function validateDouyinPoiIntent(value, sourceRefs = []) {
  const errors = [];
  const issue = code => errors.push(code);
  if (!isRecord(value)) return { ok: false, errors: ['DOUYIN_POI_INTENT_OBJECT_REQUIRED'] };

  for (const key of Object.keys(value)) {
    if (!INTENT_KEYS.includes(key)) issue(`DOUYIN_POI_INTENT_UNKNOWN_FIELD:${key}`);
  }
  if (value.schema !== DOUYIN_POI_INTENT_SCHEMA) issue('DOUYIN_POI_INTENT_SCHEMA_INVALID');
  if (value.entityKind !== 'school_campus') issue('DOUYIN_POI_ENTITY_KIND_INVALID');
  for (const key of ['schoolName', 'campus', 'officialAddress', 'excludedCampus']) {
    if (!nonempty(value[key])) issue(`DOUYIN_POI_${key.replace(/[A-Z]/g, m => `_${m}`).toUpperCase()}_REQUIRED`);
  }
  if (!Array.isArray(value.historicalAddressVariants)
    || value.historicalAddressVariants.length === 0
    || value.historicalAddressVariants.some(item => !nonempty(item))) {
    issue('DOUYIN_POI_HISTORICAL_ADDRESS_VARIANTS_REQUIRED');
  }
  if (value.addressConflictPolicy !== DOUYIN_POI_ADDRESS_CONFLICT_POLICY) {
    issue('DOUYIN_POI_ADDRESS_CONFLICT_POLICY_INVALID');
  }

  const source = value.intentSource;
  if (!isRecord(source)) {
    issue('DOUYIN_POI_INTENT_SOURCE_REQUIRED');
  } else {
    for (const key of Object.keys(source)) {
      if (!SOURCE_KEYS.includes(key)) issue(`DOUYIN_POI_INTENT_SOURCE_UNKNOWN_FIELD:${key}`);
    }
    const sourcePath = source.path;
    const sourceHash = source.sha256;
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
      issue('DOUYIN_POI_INTENT_SOURCE_ABSOLUTE_PATH_REQUIRED');
    }
    if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)) {
      issue('DOUYIN_POI_INTENT_SOURCE_SHA256_REQUIRED');
    }
    const sourceMatches = Array.isArray(sourceRefs) && sourceRefs.some(ref =>
      ref?.type === 'file'
      && typeof ref.path === 'string'
      && typeof sourcePath === 'string'
      && path.isAbsolute(sourcePath)
      && path.resolve(ref.path) === path.resolve(sourcePath)
      && ref.sha256 === sourceHash);
    if (!sourceMatches) issue('DOUYIN_POI_INTENT_SOURCE_REF_MISMATCH');
  }

  return { ok: errors.length === 0, errors };
}

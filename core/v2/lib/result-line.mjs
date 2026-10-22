export const V2_RESULT_PREFIX = "VIDEO_PUBLISHER_V2_RESULT:";

export function sanitizeV2Diagnostic(output, { expectedUid = "" } = {}) {
  let text = String(output || "");
  if (typeof expectedUid === "string" && expectedUid) text = text.split(expectedUid).join("[REDACTED]");
  return text
    .replace(/(["']?(?:uid|creatoruid|api[_-]?uid)["']?\s*:\s*)(?:"[^"]*"|'[^']*'|-?\d+)/gi, '$1"[REDACTED]"')
    .replace(/(\b(?:uid|creatoruid|api[_-]?uid)\b\s*[=:]\s*)["']?\d+["']?/gi, "$1[REDACTED]");
}

export function parseV2Result(output, context = "v2 runner", { expectedUid = "" } = {}) {
  const body = String(output || "");
  const line = body.split(/\r?\n/).reverse().find(item => item.trimStart().startsWith(V2_RESULT_PREFIX));
  if (!line) throw new Error(`${context} returned no structured observation: ${sanitizeV2Diagnostic(body, { expectedUid }).slice(-1800)}`);
  const raw = line.trimStart().slice(V2_RESULT_PREFIX.length).trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${context} returned invalid structured observation: ${sanitizeV2Diagnostic(raw, { expectedUid }).slice(0, 600)}`, { cause: error });
  }
}

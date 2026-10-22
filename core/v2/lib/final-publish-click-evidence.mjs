import fs from 'node:fs';

function actionClicked(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(actionClicked);
  if (value.finalPublishClicked === true || Number(value.finalPublishClickCount) > 0) return true;
  return Object.values(value).some(actionClicked);
}

/**
 * Return true/false only when persisted observation evidence is explicit.
 * Missing files/fields remain null; absence is never inferred from a draft
 * operation label or a zero-length UI inventory.
 */
export function finalPublishClickStatus(state, platforms) {
  let rowsSeen = 0;
  for (const platform of platforms || []) {
    const history = state?.platforms?.[platform]?.history;
    if (!Array.isArray(history) || history.length === 0) return null;
    for (const row of history) {
      rowsSeen += 1;
      let evidence;
      try {
        const stat = fs.lstatSync(row?.evidencePath || '');
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        evidence = JSON.parse(fs.readFileSync(row.evidencePath, 'utf8'));
      } catch { return null; }
      const observation = evidence?.observation;
      const safety = observation?.gates?.safety?.evidence;
      if (observation?.finalPublishClicked === true || safety?.finalPublishClicked === true
          || actionClicked(observation?.actions)) return true;
      if (observation?.finalPublishClicked !== false || safety?.finalPublishClicked !== false) return null;
      if (row.phase !== 'inspect' && safety?.guardArmed !== true) return null;
    }
  }
  return rowsSeen > 0 ? false : null;
}

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const READER_PATH = fileURLToPath(new URL("./ego-creator-read.mjs", import.meta.url));

export function needsDouyinCreatorReader(platform, pkg) {
  return platform === "douyin" && Boolean(pkg?.schoolAccount?.accountId || pkg?.schoolAccount?.apiUid);
}

// The V2 runner concatenates Ego-side fragments into one Node ESM stdin script.
// Keep this deliberately bound to the project-owned GET-only reader: don't turn
// it into a generic module loader or inline a second copy of its parser.
export function douyinCreatorReaderFragment(platform, pkg) {
  if (!needsDouyinCreatorReader(platform, pkg)) return "";
  const source = fs.readFileSync(READER_PATH, "utf8");
  const fragment = source.replace(/^export\s+/gm, "");
  if (/^\s*(?:import|export)\s/m.test(fragment)
      || !fragment.includes("function parseCreatorJSON(text)")
      || !fragment.includes("async function creatorGet(page, url)")) {
    throw new Error("DOUYIN_CREATOR_READER_FRAGMENT_INVALID");
  }
  return fragment;
}

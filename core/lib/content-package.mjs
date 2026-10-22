import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { verifyDouyinPoiIntent, verifyDouyinPoiPackage } from "./douyin-poi-native.mjs";

export function stripHash(tag) {
  return String(tag || "").trim().replace(/^#+\s*/, "").trim();
}

export function uniqueCleanTags(tags = []) {
  const seen = new Set();
  const result = [];
  for (const raw of tags) {
    const tag = stripHash(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function hasLiteralEscapedNewline(value) {
  return String(value || "").includes("\\n");
}

export function normalizeDescription(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

const SUPPORTED_PLATFORM_DECLARATIONS = Object.freeze({
  xiaohongshu: ["none", "original"],
  douyin: ["none"],
  bilibili: ["none"],
  wechat_channels: ["none"],
  youtube: ["none"],
});

export const DOUYIN_SCHEDULE_INTENT_SCHEMA = "douyin-native-schedule-intent/v1";
const DOUYIN_SCHEDULE_MIN_LEAD_MS = 2 * 60 * 60 * 1000;
const DOUYIN_SCHEDULE_MAX_LEAD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Validate an explicit native Douyin schedule intent without normalizing or
 * adding fields to packages that do not request scheduling. The UI accepts a
 * minute-precision local value; the package must still carry an explicit
 * +08:00 offset and the IANA zone used to render that value.
 */
export function validateDouyinScheduleIntent(intent, { now = Date.now() } = {}) {
  const errors = [];
  const result = { ok: false, errors, publishAtEpochMs: null, localDateTime: null };
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
    errors.push("douyinSchedule must be an object");
    return result;
  }
  const allowed = ["schema", "mode", "publishAt", "timeZone"];
  const extra = Object.keys(intent).filter(key => !allowed.includes(key));
  if (extra.length) errors.push(`douyinSchedule has unsupported fields: ${extra.join(", ")}`);
  if (intent.schema !== DOUYIN_SCHEDULE_INTENT_SCHEMA) errors.push(`douyinSchedule.schema must be ${DOUYIN_SCHEDULE_INTENT_SCHEMA}`);
  if (intent.mode !== "scheduled") errors.push('douyinSchedule.mode must be "scheduled"');
  if (intent.timeZone !== "Asia/Shanghai") errors.push('douyinSchedule.timeZone must be "Asia/Shanghai"');
  if (typeof intent.publishAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(intent.publishAt)) {
    errors.push("douyinSchedule.publishAt must be an ISO minute timestamp with explicit +08:00 offset and zero seconds");
  } else {
    const epoch = Date.parse(intent.publishAt);
    const localDateTime = intent.publishAt.slice(0, 16).replace("T", " ");
    if (!Number.isFinite(epoch)) {
      errors.push("douyinSchedule.publishAt is not a valid calendar date");
      result.localDateTime = null;
      result.ok = false;
      return result;
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(epoch));
    const formatted = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const nativeLocal = `${formatted.year}-${formatted.month}-${formatted.day} ${formatted.hour}:${formatted.minute}`;
    if (nativeLocal !== localDateTime) {
      errors.push("douyinSchedule.publishAt is invalid or does not match Asia/Shanghai local time");
    } else if (!Number.isFinite(now) || epoch < now + DOUYIN_SCHEDULE_MIN_LEAD_MS || epoch > now + DOUYIN_SCHEDULE_MAX_LEAD_MS) {
      errors.push("douyinSchedule.publishAt must be from 2 hours to 14 days after execution time");
    } else {
      result.publishAtEpochMs = epoch;
      result.localDateTime = localDateTime;
    }
  }
  result.ok = errors.length === 0;
  return result;
}

export { verifyDouyinPoiIntent };

export function platformDeclarationChoice(pkg, platform) {
  return String(pkg?.platformDeclarations?.[platform] || "none").trim();
}

export function codePointLength(value) {
  return Array.from(String(value || "")).length;
}

export function xiaohongshuTitleLength(value) {
  let halfUnits = 0;
  for (const character of Array.from(String(value || ""))) {
    halfUnits += character.codePointAt(0) <= 0x7f ? 1 : 2;
  }
  return halfUnits / 2;
}

export function getImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 24
    && buffer[0] === 0x89
    && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      format: "png",
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          format: "jpeg",
        };
      }
      offset += 2 + size;
    }
  }
  return { width: 0, height: 0, format: "unknown" };
}

export function ratioOk(dimensions, expected) {
  if (!dimensions.width || !dimensions.height) return false;
  const actual = dimensions.width / dimensions.height;
  const target = {
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "16:9": 16 / 9,
  }[expected];
  if (!target) return false;
  return Math.abs(actual - target) < 0.01;
}

export function coverUploadEnabled(cover = {}) {
  return cover.uploadCustomCover === true;
}

export function coverForPlatform(pkg, platform) {
  const cover = pkg.cover || {};
  const override = cover.platforms?.[platform] || {};
  return {
    ...cover,
    ...Object.fromEntries(["vertical3x4Path", "horizontal4x3Path", "horizontal16x9Path"]
      .map(key => [key, String(override[key] || cover[key] || "").trim()])),
  };
}

export function coverAssetsForPlatform(pkg, platform) {
  const cover = coverForPlatform(pkg, platform);
  const verticalPath = cover.vertical3x4Path;
  const horizontalPath = cover.horizontal4x3Path;
  const widescreenPath = cover.horizontal16x9Path;
  const mapping = {
    xiaohongshu: verticalPath ? [{ slot: "portrait", ratio: "3:4", path: verticalPath }] : [],
    wechat_channels: [
      ...(verticalPath ? [{ slot: "portrait", ratio: "3:4", path: verticalPath }] : []),
      ...(horizontalPath ? [{ slot: "landscape", ratio: "4:3", path: horizontalPath }] : []),
    ],
    bilibili: [
      ...(horizontalPath ? [{ slot: "homepage-master", ratio: "4:3", path: horizontalPath }] : []),
      ...(widescreenPath ? [{ slot: "personal-space", ratio: "16:9", path: widescreenPath }] : []),
    ],
    douyin: [
      ...(verticalPath ? [{ slot: "portrait", ratio: "3:4", path: verticalPath }] : []),
      ...(horizontalPath ? [{ slot: "landscape", ratio: "4:3", path: horizontalPath }] : []),
    ],
    youtube: widescreenPath
      ? [{ slot: "thumbnail", ratio: "16:9", path: widescreenPath }]
      : [],
  };
  return mapping[platform] || [];
}

export function readPackage(packagePath, { config: suppliedConfig } = {}) {
  if (!packagePath) {
    throw new Error("Missing package JSON path");
  }
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const config = suppliedConfig || loadConfig();
  const title = String(parsed.title || "").trim();
  const platformTitle = {
    xiaohongshu: String(parsed.xhsTitle || parsed.xiaohongshuTitle || title).trim(),
    douyin: String(parsed.douyinTitle || title).trim(),
    bilibili: String(parsed.bilibiliTitle || title).trim(),
    wechat_channels: String(parsed.wechatTitle || parsed.wechatChannelsTitle || title).trim(),
    youtube: String(parsed.youtubeTitle || title).trim(),
  };
  const description = normalizeDescription(parsed.description || "");
  const douyinDescription = normalizeDescription(parsed.douyinDescription || parsed.description || "");
  const bilibiliDescription = normalizeDescription(parsed.bilibiliDescription || parsed.description || "");
  const wechatDescription = normalizeDescription(parsed.wechatDescription || parsed.description || "");
  const youtubeDescription = normalizeDescription(parsed.youtubeDescription || parsed.description || "");
  const cover = {
    uploadCustomCover: parsed.cover?.uploadCustomCover === true,
    vertical3x4Path: String(parsed.cover?.vertical3x4Path || "").trim(),
    horizontal4x3Path: String(parsed.cover?.horizontal4x3Path || "").trim(),
    horizontal16x9Path: String(parsed.cover?.horizontal16x9Path || "").trim(),
    platforms: Object.fromEntries(
      ["xiaohongshu", "douyin", "bilibili", "wechat_channels", "youtube"].map(platform => {
        const value = parsed.cover?.platforms?.[platform] || {};
        return [platform, {
          vertical3x4Path: String(value.vertical3x4Path || "").trim(),
          horizontal4x3Path: String(value.horizontal4x3Path || "").trim(),
          horizontal16x9Path: String(value.horizontal16x9Path || "").trim(),
        }];
      }),
    ),
  };
  const douyinTopicSource = Array.isArray(parsed.douyinTopics)
    ? parsed.douyinTopics
    : Array.isArray(parsed.topics)
      ? parsed.topics
      : Array.isArray(parsed.tags)
        ? parsed.tags
        : config.platforms.douyin.defaultTopics;
  const douyinTopics = uniqueCleanTags(douyinTopicSource);
  const bilibiliTags = uniqueCleanTags(parsed.bilibiliTags || parsed.tags || []);
  const bilibiliAllowedAutoTags = uniqueCleanTags(
    Array.isArray(parsed.bilibiliAllowedAutoTags)
      ? parsed.bilibiliAllowedAutoTags
      : config.platforms.bilibili.allowedAutoTags,
  );
  const xhsTopics = uniqueCleanTags(parsed.xhsTopics || parsed.topics || parsed.tags || []);
  const wechatTags = uniqueCleanTags(parsed.wechatTags || parsed.topics || parsed.tags || []);
  const youtubeTags = uniqueCleanTags(parsed.youtubeTags || parsed.tags || parsed.topics || []);
  const youtubeAudience = String(parsed.youtubeAudience || "").trim();
  const youtubeVisibility = String(
    parsed.youtubeVisibility || config.platforms.youtube.defaultVisibility || "private",
  ).trim();
  const youtubeCategory = String(
    parsed.youtubeCategory ?? config.platforms.youtube.defaultCategory ?? "",
  ).trim();
  const youtubeLanguage = String(
    parsed.youtubeLanguage ?? config.platforms.youtube.defaultLanguage ?? "",
  ).trim();
  const platformDeclarations = Object.fromEntries(
    Object.keys(SUPPORTED_PLATFORM_DECLARATIONS).map(platform => [
      platform,
      String(parsed.platformDeclarations?.[platform] || "none").trim(),
    ]),
  );
  return {
    ...parsed,
    title,
    platformTitle,
    description,
    douyinDescription,
    bilibiliDescription,
    wechatDescription,
    youtubeDescription,
    cover,
    douyinTopics,
    bilibiliTags,
    bilibiliAllowedAutoTags,
    xhsTopics,
    wechatTags,
    youtubeTags,
    youtubeAudience,
    youtubeVisibility,
    youtubeCategory,
    youtubeLanguage,
    platformDeclarations,
    youtubePlaylist: String(parsed.youtubePlaylist || "").trim(),
    youtubeLicense: String(parsed.youtubeLicense || "standard_youtube").trim(),
    youtubePaidPromotion: parsed.youtubePaidPromotion === true,
    youtubeAlteredContent: parsed.youtubeAlteredContent === true,
    youtubeAlteredContentExplicit: Object.prototype.hasOwnProperty.call(parsed, "youtubeAlteredContent")
      && typeof parsed.youtubeAlteredContent === "boolean",
    youtubeAllowEmbedding: parsed.youtubeAllowEmbedding !== false,
    youtubeNotifySubscribers: parsed.youtubeNotifySubscribers !== false,
  };
}

export function validateCommonPackage(pkg) {
  const errors = [];
  if (!pkg.title) errors.push("title is required");
  if (Object.prototype.hasOwnProperty.call(pkg, "douyinSchedule") && pkg.schoolAccount?.platform !== "douyin") {
    errors.push("douyinSchedule is supported only for schoolAccount.platform douyin");
  }
  if (hasLiteralEscapedNewline(pkg.title)) errors.push("title contains literal escaped newline");
  for (const key of ["description", "douyinDescription", "bilibiliDescription", "wechatDescription", "youtubeDescription"]) {
    if (hasLiteralEscapedNewline(pkg[key])) errors.push(`${key} contains literal escaped newline; use real newlines`);
  }
  if (pkg.schoolAccount) {
    for (const [platform, allowed] of Object.entries(SUPPORTED_PLATFORM_DECLARATIONS)) {
      const choice = platformDeclarationChoice(pkg, platform);
      if (!allowed.includes(choice)) {
        errors.push(`platformDeclarations.${platform} must be "none" for the school publisher; unsupported declarations are never selected automatically`);
      }
    }
  }
  return errors;
}

export function validateCoverPackage(pkg, platform) {
  const errors = [];
  const cover = coverForPlatform(pkg, platform);
  if (!coverUploadEnabled(cover)) return errors;
  if (
    platform === "bilibili"
    && !cover.horizontal4x3Path
    && cover.horizontal16x9Path
  ) {
    errors.push("bilibili primary cover requires an exact 4:3 horizontal4x3Path; 16:9 is only a personal-space companion");
    return errors;
  }
  const assets = coverAssetsForPlatform(pkg, platform);
  if (!assets.length) {
    errors.push(`custom cover upload enabled, but no cover asset is mapped for ${platform}`);
    return errors;
  }
  if (platform === "douyin" && assets.length !== 2) {
    errors.push("douyin custom cover upload requires both 3:4 portrait and 4:3 landscape covers");
  }
  if (platform === "wechat_channels" && assets.length !== 2) {
    errors.push("wechat_channels custom cover upload requires both 3:4 personal-profile and 4:3 share-card covers");
  }
  if (platform === "bilibili" && assets.length !== 2) {
    errors.push("bilibili custom cover upload requires separate 4:3 homepage and 16:9 personal-space files");
  }
  if (platform === "youtube" && assets.length !== 1) {
    errors.push("youtube custom thumbnail upload requires one exact 16:9 horizontal16x9Path");
  }
  for (const asset of assets) {
    if (!asset.path || !fs.existsSync(asset.path)) {
      errors.push(`custom cover file not found for ${platform} ${asset.slot}: ${asset.path || "(missing path)"}`);
      continue;
    }
    const dimensions = getImageDimensions(asset.path);
    if (!ratioOk(dimensions, asset.ratio)) {
      errors.push(`custom cover ratio mismatch for ${platform} ${asset.slot}: expected ${asset.ratio}, got ${dimensions.width}x${dimensions.height || 0}`);
    }
  }
  return errors;
}

export function validateDouyinPackage(pkg) {
  const errors = validateCommonPackage(pkg);
  if (Object.prototype.hasOwnProperty.call(pkg, "douyinSchedule")) {
    errors.push(...validateDouyinScheduleIntent(pkg.douyinSchedule).errors);
  }
  if (pkg.poi && typeof pkg.poi === "object" && (pkg.poi.name || pkg.poi.id)) {
    errors.push("Douyin POI is not supported by the school publisher adapter yet; do not silently omit an explicitly requested location");
  }
  if (Object.prototype.hasOwnProperty.call(pkg, "douyinPoi")) {
    const intent = verifyDouyinPoiIntent(pkg);
    errors.push(...intent.errors);
    const capability = verifyDouyinPoiPackage(pkg);
    if (!capability.ok || capability.sourceBytesVerified !== true) {
      errors.push("DOUYIN_POI_INTENT_CAPABILITY_UNAVAILABLE: typed source intent could not be verified");
    }
  }
  errors.push(...validateCoverPackage(pkg, "douyin"));
  const douyinTitle = String(pkg.platformTitle?.douyin || pkg.title || "");
  const douyinTitleLength = codePointLength(douyinTitle);
  if (douyinTitleLength > 30) errors.push(`douyin title is ${douyinTitleLength}/30`);
  if ((pkg.douyinDescription.match(/#[^\s#]+/g) || []).length) {
    errors.push("douyinDescription must not contain inline hashtags; use douyinTopics");
  }
  if (!pkg.douyinTopics.length) errors.push("douyinTopics are required");
  if (pkg.douyinTopics.length > 5) errors.push("douyin supports at most 5 topics");
  return errors;
}

export function validateBilibiliPackage(pkg) {
  const errors = validateCommonPackage(pkg);
  errors.push(...validateCoverPackage(pkg, "bilibili"));
  const bilibiliTitle = String(pkg.platformTitle?.bilibili || pkg.title || "");
  const bilibiliTitleLength = codePointLength(bilibiliTitle);
  if (bilibiliTitleLength > 80) errors.push(`bilibili title is ${bilibiliTitleLength}/80`);
  if (!pkg.bilibiliDescription) errors.push("bilibiliDescription is required");
  if (!pkg.bilibiliTags.length) errors.push("bilibiliTags are required");
  if (pkg.bilibiliTags.length > 10) errors.push("bilibili supports at most 10 tags");
  return errors;
}

export function validateXiaohongshuPackage(pkg) {
  const errors = validateCommonPackage(pkg);
  errors.push(...validateCoverPackage(pkg, "xiaohongshu"));
  const xhsTitle = String(pkg.platformTitle?.xiaohongshu || pkg.xhsTitle || pkg.xiaohongshuTitle || pkg.title || "").trim();
  const xhsTitleLength = xiaohongshuTitleLength(xhsTitle);
  if (xhsTitleLength > 20) errors.push(`xiaohongshu title is ${xhsTitleLength}/20`);
  if (!pkg.xhsTopics.length) errors.push("xhsTopics are required");
  if (pkg.schoolAccount?.platform === "xiaohongshu") {
    if (!pkg.description) errors.push("description is required for school Xiaohongshu and is preserved alongside topic entities");
    const poi = pkg.xhsPoi;
    if (poi && (typeof poi !== "object" || !String(poi.name || "").trim() || !String(poi.address || "").trim())) {
      errors.push("xhsPoi, when provided, must include exact name and address");
    }
    if (pkg.xhsPrivateMessageComponent != null && pkg.xhsPrivateMessageComponent !== "if_available") {
      errors.push("xhsPrivateMessageComponent, when provided, must be if_available; never substitute a group/chat component");
    }
    const source = pkg.xhsContentSource;
    if (source && (typeof source !== "object"
      || (source.type === "self_shot" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.date || ""))
        || !String(source.locationName || "").trim() || !String(source.locationAddress || "").trim()))
      || !["self_shot", "ai_generated"].includes(source.type))) {
      errors.push("xhsContentSource, when provided, must be ai_generated or self_shot with YYYY-MM-DD date, locationName, and locationAddress");
    }
  }
  const dottedTopics = pkg.xhsTopics.filter(topic => topic.includes("."));
  if (dottedTopics.length) {
    errors.push(`xiaohongshu topics do not support "."; use a dot-free label instead: ${dottedTopics.join(", ")}`);
  }
  return errors;
}

export function validateWechatChannelsPackage(pkg) {
  const errors = validateCommonPackage(pkg);
  errors.push(...validateCoverPackage(pkg, "wechat_channels"));
  if (!pkg.wechatDescription) errors.push("wechatDescription is required");
  if (!pkg.wechatTags.length) errors.push("wechatTags are required");
  return errors;
}

export function validateYoutubePackage(pkg) {
  const errors = validateCommonPackage(pkg);
  errors.push(...validateCoverPackage(pkg, "youtube"));
  const title = String(pkg.platformTitle?.youtube || pkg.title || "");
  if (codePointLength(title) > 100) errors.push(`youtube title is ${codePointLength(title)}/100`);
  if (!pkg.youtubeDescription) errors.push("youtubeDescription is required");
  if (codePointLength(pkg.youtubeDescription) > 5000) {
    errors.push(`youtube description is ${codePointLength(pkg.youtubeDescription)}/5000`);
  }
  if (/(?:https?:\/\/|www\.|(?:^|[\s(])(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|ai|dev|app|co)(?:[\/\s)]|$))/iu.test(pkg.youtubeDescription)) {
    errors.push("youtubeDescription must not contain web links");
  }
  const serializedTagsLength = pkg.youtubeTags.join(",").length;
  if (serializedTagsLength > 500) errors.push(`youtube tags are ${serializedTagsLength}/500 characters`);
  if (!["made_for_kids", "not_made_for_kids"].includes(pkg.youtubeAudience)) {
    errors.push("youtubeAudience must be one of: made_for_kids, not_made_for_kids");
  }
  if (!["private", "unlisted", "public"].includes(pkg.youtubeVisibility)) {
    errors.push("youtubeVisibility must be one of: private, unlisted, public");
  }
  if (!["standard_youtube", "creative_commons"].includes(pkg.youtubeLicense)) {
    errors.push("youtubeLicense must be one of: standard_youtube, creative_commons");
  }
  return errors;
}

export function assertPackage(errors) {
  if (errors.length) {
    throw new Error(errors.join("; "));
  }
}

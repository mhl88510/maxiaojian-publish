import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DOUYIN_POI_INTENT_SCHEMA = "douyin-poi-intent/v1";
export const DOUYIN_POI_NATIVE_RECEIPT_SCHEMA = "douyin-poi-native-receipt/v1";
export const DOUYIN_POI_NATIVE_CONTRACT_SCHEMA = "douyin-poi-native-dom/v1";

// Captured from the current live Douyin editor. Any selector/fiber/state drift
// fails closed; the receipt never supplies these selectors or property paths.
export const DOUYIN_POI_NATIVE_CONTRACT = Object.freeze({
  schema: DOUYIN_POI_NATIVE_CONTRACT_SCHEMA,
  mounted: Object.freeze({
    containerSelector: "#douyin_creator_pc_anchor_jump .semi-select.select-PJBSlx",
    selectedLabelSelector: ".semi-select-selection-text",
    fiberKeyPrefix: "__reactFiber$",
    returnDepth: 3,
    placeholder: "输入地理位置",
    maxChildNodes: 64,
    maxChildDepth: 6,
  }),
});

const ADDRESS_CONFLICT_POLICY = "DO_NOT_INFER_EQUIVALENCE; require independent native campus/location evidence for a historical-address candidate";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeBinding(binding = {}) {
  return {
    profileId: String(binding.profileId || binding.egoProfileId || ""),
    taskSpaceId: Number(binding.taskSpaceId) || 0,
    pageLabel: String(binding.pageLabel || ""),
    targetId: String(binding.targetId || ""),
  };
}

export function verifyDouyinPoiIntent(pkg) {
  const value = pkg?.douyinPoi;
  const errors = [];
  const issue = code => errors.push(code);
  if (pkg?.schoolAccount?.platform !== "douyin") issue("douyinPoi is supported only on Douyin packages");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: [...errors, "douyinPoi must be a typed object; expected douyin-poi-intent/v1"] };
  }

  const allowed = ["schema", "entityKind", "schoolName", "campus", "officialAddress", "excludedCampus", "historicalAddressVariants", "addressConflictPolicy", "intentSource"];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(`douyinPoi has unsupported field ${key}`);
  if (value.schema !== DOUYIN_POI_INTENT_SCHEMA) issue("douyinPoi.schema must be douyin-poi-intent/v1");
  if (value.entityKind !== "school_campus") issue("douyinPoi.entityKind must be school_campus");
  for (const key of ["schoolName", "campus", "officialAddress", "excludedCampus"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) issue(`douyinPoi.${key} is required`);
  }
  if (!Array.isArray(value.historicalAddressVariants)
    || value.historicalAddressVariants.length === 0
    || value.historicalAddressVariants.some(item => typeof item !== "string" || !item.trim())) {
    issue("douyinPoi.historicalAddressVariants must be a nonempty array of text");
  }
  if (value.addressConflictPolicy !== ADDRESS_CONFLICT_POLICY) issue("douyinPoi.addressConflictPolicy is invalid");

  const source = value.intentSource;
  let sourceBytesVerified = false;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issue("douyinPoi.intentSource is required");
  } else {
    for (const key of Object.keys(source)) if (!["path", "sha256"].includes(key)) issue(`douyinPoi.intentSource has unsupported field ${key}`);
    if (typeof source.path !== "string" || !path.isAbsolute(source.path)) issue("douyinPoi.intentSource.path must be absolute");
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) issue("douyinPoi.intentSource.sha256 must be a lowercase SHA-256");
    const refs = pkg?.studio?.sourceRefs;
    const match = Array.isArray(refs) && refs.some(ref => ref?.type === "file"
      && typeof ref.path === "string"
      && path.isAbsolute(ref.path)
      && typeof source.path === "string"
      && path.isAbsolute(source.path)
      && path.resolve(ref.path) === path.resolve(source.path)
      && ref.sha256 === source.sha256);
    if (!match) issue("douyinPoi.intentSource must match a file path and SHA in studio.sourceRefs");
    if (match) {
      try {
        const actual = sha256(fs.readFileSync(source.path));
        if (actual !== source.sha256) issue("douyinPoi.intentSource source bytes no longer match its SHA-256");
        else sourceBytesVerified = true;
      } catch {
        issue("douyinPoi.intentSource file is missing or unreadable");
      }
    }
  }
  const intentSha256 = sha256(canonical(value));
  return { ok: errors.length === 0, errors, intentSha256, sourceBytesVerified };
}

// This package-level capability check only proves the typed, SHA-bound intent
// can enter the existing Douyin video adapter. Native selection remains a
// separate live gate and is deliberately false until the DOM contract exists.
export function verifyDouyinPoiPackage(pkg) {
  const intent = verifyDouyinPoiIntent(pkg);
  return {
    ok: intent.ok,
    errors: intent.errors,
    intentSha256: intent.intentSha256 || null,
    sourceBytesVerified: intent.sourceBytesVerified === true,
    nativeContractCalibrated: DOUYIN_POI_NATIVE_CONTRACT !== null,
    nativeSelectionReady: false,
  };
}

// Read one live result option only. The observed native option stores the POI
// record in the immediate React Fiber parent (return.memoizedProps); do not
// crawl ancestors, child trees, or arbitrary page state.
export function readDouyinPoiReactOption(optionNode) {
  const fail = code => ({ ok: false, code });
  const ownValue = (object, key) => {
    if (!object || typeof object !== "object") return undefined;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch { return undefined; }
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
  };
  const text = value => typeof value === "string" && value.length <= 320
    && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : "";
  try {
    if (!optionNode || typeof optionNode.getAttribute !== "function"
      || optionNode.getAttribute("role") !== "option"
      || !String(optionNode.getAttribute("class") || "").split(/\s+/).includes("semi-select-option")) return fail("DOUYIN_POI_OPTION_NODE_INVALID");
    if (typeof optionNode.getBoundingClientRect === "function") {
      const rect = optionNode.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return fail("DOUYIN_POI_OPTION_NOT_VISIBLE");
    }
    if (typeof getComputedStyle === "function") {
      const style = getComputedStyle(optionNode);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0) return fail("DOUYIN_POI_OPTION_NOT_VISIBLE");
    }
    const fiberKeys = Object.getOwnPropertyNames(optionNode).filter(key => key.startsWith("__reactFiber$"));
    if (fiberKeys.length !== 1) return fail("DOUYIN_POI_OPTION_FIBER_AMBIGUOUS");
    const fiber = ownValue(optionNode, fiberKeys[0]);
    const parent = ownValue(fiber, "return");
    const props = ownValue(parent, "memoizedProps");
    if (!props || typeof props !== "object" || Array.isArray(props)) return fail("DOUYIN_POI_OPTION_PROPS_MISSING");
    const id = ownValue(props, "id"), poiId = ownValue(props, "poi_id"), value = ownValue(props, "value");
    const name = text(ownValue(props, "name")), poiName = text(ownValue(props, "poi_name")), address = text(ownValue(props, "address"));
    if ([id, poiId, value].some(value => typeof value !== "string" || !/^\d{15,22}$/.test(value))
      || id !== poiId || id !== value) return fail("DOUYIN_POI_OPTION_ID_FIELDS_MISMATCH");
    if (!name || !poiName || name !== poiName || !address) return fail("DOUYIN_POI_OPTION_TEXT_FIELDS_INVALID");
    const nameNode = optionNode.querySelector?.(".name-QUhTI4");
    const addressNode = optionNode.querySelector?.(".address-rO52tq");
    const visibleName = text(String(nameNode?.innerText ?? nameNode?.textContent ?? ""));
    const visibleAddress = text(String(addressNode?.innerText ?? addressNode?.textContent ?? ""));
    const norm = value => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (!visibleName || !visibleAddress || norm(visibleName) !== norm(name) || norm(visibleAddress) !== norm(address)) return fail("DOUYIN_POI_OPTION_DOM_PROPS_MISMATCH");
    return { ok: true, code: "DOUYIN_POI_OPTION_RECORD_READ", candidate: { id, poi_id: poiId, value, name, poi_name: poiName, address } };
  } catch {
    return fail("DOUYIN_POI_OPTION_READ_FAILED");
  }
}

// Read the single selected native location after the popup has been re-queried
// and Escape-closed. The traversal is fixed at Fiber.return x3, Map.values()
// only, and bounded props.children inspection; Map keys and arbitrary Fiber
// trees are intentionally never traversed.
export function readDouyinPoiMountedRecord(selectNode, contract = DOUYIN_POI_NATIVE_CONTRACT) {
  const fail = code => ({ ok: false, code });
  const ownValue = (object, key) => {
    if (!object || typeof object !== "object") return undefined;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch { return undefined; }
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
  };
  const safeText = value => typeof value === "string" && value.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value) && Boolean(value.trim());
  const recordFrom = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id=ownValue(value,"id"),poiId=ownValue(value,"poi_id"),nativeValue=ownValue(value,"value");
    const name=ownValue(value,"name"),poiName=ownValue(value,"poi_name"),address=ownValue(value,"address");
    if ([id,poiId,nativeValue].some(item=>typeof item!=="string"||!/^\d{15,22}$/.test(item))||id!==poiId||id!==nativeValue
      || !safeText(name)||!safeText(poiName)||name!==poiName||!safeText(address)) return null;
    return {id,poi_id:poiId,value:nativeValue,name,poi_name:poiName,address};
  };
  try {
    const mounted=contract?.mounted;
    if (!mounted || mounted.returnDepth!==3 || mounted.placeholder!=="输入地理位置"
      || mounted.containerSelector!=="#douyin_creator_pc_anchor_jump .semi-select.select-PJBSlx"
      || mounted.selectedLabelSelector!==".semi-select-selection-text"
      || mounted.fiberKeyPrefix!=="__reactFiber$" || mounted.maxChildNodes!==64 || mounted.maxChildDepth!==6) return fail("DOUYIN_POI_NATIVE_CONTRACT_UNVERIFIED");
    if (!selectNode || typeof selectNode.getAttribute!=="function"
      || !String(selectNode.getAttribute("class")||"").split(/\s+/).includes("semi-select")
      || !String(selectNode.getAttribute("class")||"").split(/\s+/).includes("select-PJBSlx")) return fail("DOUYIN_POI_NATIVE_SELECT_NODE_INVALID");
    if (typeof selectNode.getBoundingClientRect==="function") {
      const rect=selectNode.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return fail("DOUYIN_POI_NATIVE_SELECT_NOT_VISIBLE");
    }
    if (typeof getComputedStyle==="function") {
      const style=getComputedStyle(selectNode);if(style.display==="none"||style.visibility==="hidden"||Number(style.opacity||1)<=0)return fail("DOUYIN_POI_NATIVE_SELECT_NOT_VISIBLE");
    }
    const fiberKeys=Object.getOwnPropertyNames(selectNode).filter(key=>key.startsWith(mounted.fiberKeyPrefix));
    if(fiberKeys.length!==1)return fail("DOUYIN_POI_NATIVE_FIBER_AMBIGUOUS");
    let fiber=ownValue(selectNode,fiberKeys[0]);const chain=[];
    for(let i=0;i<mounted.returnDepth;i+=1){if(!fiber||typeof fiber!=="object"||chain.includes(fiber))return fail("DOUYIN_POI_NATIVE_FIBER_PATH_INVALID");chain.push(fiber);fiber=ownValue(fiber,"return");}
    const props=ownValue(fiber,"memoizedProps"),state=ownValue(fiber,"memoizedState");
    if(!props||typeof props!=="object"||Array.isArray(props)||!state||typeof state!=="object"||Array.isArray(state))return fail("DOUYIN_POI_NATIVE_SELECT_STATE_MISSING");
    if(ownValue(props,"placeholder")!==mounted.placeholder||ownValue(props,"multiple")!==false||ownValue(props,"open")!==false)return fail("DOUYIN_POI_NATIVE_SELECT_PROPS_MISMATCH");
    const selectedValue=ownValue(props,"value");if(typeof selectedValue!=="string"||!/^\d{15,22}$/.test(selectedValue))return fail("DOUYIN_POI_NATIVE_SELECT_VALUE_INVALID");
    if(ownValue(state,"isOpen")!==false)return fail("DOUYIN_POI_NATIVE_SELECT_NOT_CLOSED");
    const selections=ownValue(state,"selections");
    if(!(selections instanceof Map)||selections.size!==1)return fail("DOUYIN_POI_NATIVE_SELECTION_MAP_INVALID");
    let mappedRecord=null;
    // Only the value is inspected. Never read/serialize Map keys: they are React labels.
    for(const selectedRecord of selections.values()){
      if(mappedRecord!==null)return fail("DOUYIN_POI_NATIVE_SELECTION_NOT_UNIQUE");
      if(ownValue(selectedRecord,"_notExist")===true)return fail("DOUYIN_POI_NATIVE_SELECTION_RECORD_NOT_HYDRATED");
      mappedRecord=recordFrom(selectedRecord);
    }
    if(!mappedRecord||mappedRecord.id!==selectedValue)return fail("DOUYIN_POI_NATIVE_SELECTION_VALUE_MISMATCH");

    const label=selectNode.querySelector?.(mounted.selectedLabelSelector);
    const labelText=String(label?.innerText??label?.textContent??"").normalize("NFC").replace(/\s+/g," ").trim();
    if(!labelText||labelText!==String(mappedRecord.name).normalize("NFC").replace(/\s+/g," ").trim())return fail("DOUYIN_POI_NATIVE_SELECTED_LABEL_MISMATCH");

    const children=ownValue(props,"children"),candidateRecords=[],seen=new WeakSet();let visited=0,malformed=false;
    const visit=(value,depth)=>{
      if(value==null)return;
      visited+=1;if(visited>mounted.maxChildNodes||depth>mounted.maxChildDepth){malformed=true;return;}
      if(typeof value!=="object")return;
      if(seen.has(value))return;seen.add(value);
      if(Array.isArray(value)){if(value.length>mounted.maxChildNodes){malformed=true;return;}for(const child of value)visit(child,depth+1);return;}
      const direct=recordFrom(value);
      if(direct){candidateRecords.push(direct);return;}
      const propKeys=["id","poi_id","value","name","poi_name","address"];
      const hasPoiField=propKeys.some(key=>ownValue(value,key)!==undefined);
      if(hasPoiField){malformed=true;return;}
      const childProps=ownValue(value,"props");
      if(childProps&&typeof childProps==="object"){
        const propRecord=recordFrom(childProps);
        if(propRecord){candidateRecords.push(propRecord);return;}
        if(propKeys.some(key=>ownValue(childProps,key)!==undefined)){malformed=true;return;}
        visit(ownValue(childProps,"children"),depth+1);
      }
      const directChildren=ownValue(value,"children");if(directChildren!==undefined)visit(directChildren,depth+1);
    };
    visit(children,0);
    if(malformed||candidateRecords.length===0||candidateRecords.length>mounted.maxChildNodes)return fail("DOUYIN_POI_NATIVE_CHILD_OPTIONS_INVALID");
    const matching=candidateRecords.filter(candidate=>candidate.id===mappedRecord.id&&candidate.name===mappedRecord.name&&candidate.address===mappedRecord.address);
    if(matching.length!==1)return fail("DOUYIN_POI_NATIVE_SELECTION_NOT_IN_CURRENT_OPTIONS");
    return {ok:true,code:"DOUYIN_POI_NATIVE_SELECTION_READ",candidate:mappedRecord,selectedValue,optionCount:candidateRecords.length,label:labelText,closed:true};
  }catch{
    return fail("DOUYIN_POI_NATIVE_SELECTION_READ_FAILED");
  }
}

// Candidate policy consumes the actual POI entity fields, never search text or
// values copied from the intent. Campus is independently evidenced by the
// candidate's explicit native name suffix, not inferred from its address.
export function assessDouyinPoiCandidate(intent, candidate) {
  const fail = code => ({ ok: false, code });
  const normalize = value => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const safeText = value => typeof value === "string" && value.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value) && Boolean(value.trim());
  try {
    if (!intent || intent.schema !== DOUYIN_POI_INTENT_SCHEMA || intent.entityKind !== "school_campus") return fail("DOUYIN_POI_INTENT_INVALID");
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fail("DOUYIN_POI_CANDIDATE_INVALID");
    const allowed = ["id", "poi_id", "value", "name", "poi_name", "address", "campus"];
    if (Object.keys(candidate).some(key => !allowed.includes(key))) return fail("DOUYIN_POI_CANDIDATE_UNSUPPORTED_FIELD");
    const {id, poi_id: poiId, value, name, poi_name: poiName, address} = candidate;
    if ([id, poiId, value].some(item => typeof item !== "string" || !/^\d{15,22}$/.test(item)) || id !== poiId || id !== value) return fail("DOUYIN_POI_CANDIDATE_ID_FIELDS_MISMATCH");
    if (![name, poiName, address].every(safeText) || normalize(name) !== normalize(poiName)) return fail("DOUYIN_POI_CANDIDATE_TEXT_FIELDS_INVALID");
    const normalizedName = normalize(name), normalizedSchool = normalize(intent.schoolName);
    if (!normalizedSchool || !normalizedName.startsWith(normalizedSchool)) return fail("DOUYIN_POI_CANDIDATE_SCHOOL_MISMATCH");
    const suffix = normalizedName.slice(normalizedSchool.length);
    const campusMatch = suffix.match(/^[（(]([^（）()]{1,32})[）)]$/);
    if (!campusMatch) return fail("DOUYIN_POI_CANDIDATE_CAMPUS_NOT_EXPLICIT");
    const nativeCampus = campusMatch[1];
    const targetCampus = normalize(intent.campus);
    const addressCity = normalize(intent.officialAddress).match(/([\u4e00-\u9fff]{2,8})市/);
    const cityPrefix = addressCity?.[1] || "";
    const targetSuffix = cityPrefix && targetCampus.startsWith(cityPrefix) ? targetCampus.slice(cityPrefix.length) : targetCampus;
    if (!targetSuffix || nativeCampus !== targetSuffix || nativeCampus.includes("北校区")
      || normalize(intent.excludedCampus) && normalizedName.includes(normalize(intent.excludedCampus))) return fail("DOUYIN_POI_CANDIDATE_CAMPUS_MISMATCH");
    if (candidate.campus !== undefined && normalize(candidate.campus) !== nativeCampus) return fail("DOUYIN_POI_CANDIDATE_CAMPUS_CLAIM_MISMATCH");

    const normalizedAddress = normalize(address), officialAddress = normalize(intent.officialAddress);
    const officialMatch = Boolean(officialAddress && normalizedAddress.includes(officialAddress));
    const historical = (Array.isArray(intent.historicalAddressVariants) ? intent.historicalAddressVariants : [])
      .filter(item => safeText(item) && normalizedAddress.includes(normalize(item)));
    if (normalizedAddress.includes(normalize(intent.excludedCampus)) || /新乡|获嘉|北校区/.test(normalizedAddress)) return fail("DOUYIN_POI_CANDIDATE_EXCLUDED_LOCATION");
    let addressRelation = "";
    if (officialMatch && historical.length === 0) addressRelation = "official_address_exact";
    else if (!officialMatch && historical.length === 1 && false) addressRelation = "listed_historical_address_with_explicit_native_campus";
    else return fail("DOUYIN_POI_CANDIDATE_ADDRESS_UNVERIFIED");
    return {
      ok: true,
      code: "DOUYIN_POI_CANDIDATE_ACCEPTED",
      addressRelation,
      campusEvidence: {kind: "explicit_native_name_suffix", value: nativeCampus},
      candidate: {id, name: String(name).trim(), campus: nativeCampus, address: String(address).trim()},
    };
  } catch {
    return fail("DOUYIN_POI_CANDIDATE_ASSESSMENT_FAILED");
  }
}

export function validateDouyinPoiReceipt({ pkg, receipt, jobFingerprint, binding, nativeContract = DOUYIN_POI_NATIVE_CONTRACT } = {}) {
  const intent = verifyDouyinPoiIntent(pkg);
  const fail = code => ({ ok: false, code, intentSha256: intent.intentSha256 || null });
  if (!intent.ok) return { ...fail("DOUYIN_POI_INTENT_INVALID"), errors: intent.errors };
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return fail("DOUYIN_POI_RECEIPT_MISSING");
  const allowedReceiptKeys = ["schema", "status", "nativeContractSchema", "intentSha256", "jobFingerprint", "platform", "accountKey", "binding", "candidate", "evidence"];
  if (Object.keys(receipt).some(key => !allowedReceiptKeys.includes(key))) return fail("DOUYIN_POI_RECEIPT_UNSUPPORTED_FIELD");
  if (receipt.schema !== DOUYIN_POI_NATIVE_RECEIPT_SCHEMA || receipt.status !== "MOUNTED") return fail("DOUYIN_POI_RECEIPT_SCHEMA_OR_STATUS_INVALID");
  if (!/^[a-f0-9]{64}$/.test(String(jobFingerprint || "")) || receipt.jobFingerprint !== jobFingerprint) return fail("DOUYIN_POI_RECEIPT_JOB_MISMATCH");
  if (receipt.intentSha256 !== intent.intentSha256) return fail("DOUYIN_POI_RECEIPT_INTENT_MISMATCH");
  if (receipt.platform !== "douyin" || receipt.accountKey !== pkg.schoolAccount?.accountKey) return fail("DOUYIN_POI_RECEIPT_PLATFORM_OR_ACCOUNT_MISMATCH");
  const expectedBinding = normalizeBinding(binding || pkg.schoolAccount);
  const actualBinding = normalizeBinding(receipt.binding);
  if (!receipt.binding || Object.keys(receipt.binding).some(key => !["profileId", "egoProfileId", "taskSpaceId", "pageLabel", "targetId"].includes(key))) return fail("DOUYIN_POI_RECEIPT_BINDING_FIELDS_INVALID");
  if (!expectedBinding.profileId || !expectedBinding.taskSpaceId || !expectedBinding.pageLabel || !expectedBinding.targetId
    || canonical(actualBinding) !== canonical(expectedBinding)) return fail("DOUYIN_POI_RECEIPT_BINDING_MISMATCH");
  const candidate = receipt.candidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || Object.keys(candidate).some(key => !["id", "name", "campus", "address"].includes(key))) return fail("DOUYIN_POI_RECEIPT_CANDIDATE_MISMATCH");
  const candidateAssessment = assessDouyinPoiCandidate(pkg.douyinPoi, {
    id: candidate.id, poi_id: candidate.id, value: candidate.id,
    name: candidate.name, poi_name: candidate.name, address: candidate.address, campus: candidate.campus,
  });
  if (!candidateAssessment.ok || canonical(candidateAssessment.candidate) !== canonical(candidate)) return fail("DOUYIN_POI_RECEIPT_CANDIDATE_MISMATCH");
  const evidence = receipt.evidence;
  if (!evidence || typeof evidence !== "object" || evidence.candidateCount !== 1
    || Object.keys(evidence).some(key => !["candidateCount", "selected", "mounted", "source", "observedAt"].includes(key))
    || evidence.selected !== true || evidence.mounted !== true || evidence.source !== "native_picker"
    || !Number.isFinite(Date.parse(evidence.observedAt))) return fail("DOUYIN_POI_RECEIPT_EVIDENCE_INVALID");
  if (receipt.nativeContractSchema !== DOUYIN_POI_NATIVE_CONTRACT_SCHEMA) return fail("DOUYIN_POI_RECEIPT_CONTRACT_MISMATCH");
  if (!nativeContract || nativeContract.schema !== DOUYIN_POI_NATIVE_CONTRACT_SCHEMA) return fail("DOUYIN_POI_NATIVE_CONTRACT_UNVERIFIED");
  return { ok: true, code: "DOUYIN_POI_RECEIPT_VALID", intentSha256: intent.intentSha256, candidate: { ...candidate }, candidateAssessment, binding: actualBinding };
}

// Closure-free so the exact function body can be injected into Ego's page
// runtime. Its contract is fixed in this module after DOM calibration; callers
// cannot smuggle selectors through the receipt. Null/unknown contracts block.
export function probeDouyinPoiMounted(intent, receipt, contract) {
  const fail = code => ({ok:false,code,mountedCount:0});
  const expectedSelector = "#douyin_creator_pc_anchor_jump .semi-select.select-PJBSlx";
  const expectedLabelSelector = ".semi-select-selection-text";
  if (!contract || contract.schema !== "douyin-poi-native-dom/v1") return fail("DOUYIN_POI_NATIVE_CONTRACT_UNVERIFIED");
  const mounted=contract.mounted;
  if (!mounted || mounted.containerSelector!==expectedSelector || mounted.selectedLabelSelector!==expectedLabelSelector
    || mounted.fiberKeyPrefix!=="__reactFiber$" || mounted.returnDepth!==3 || mounted.placeholder!=="输入地理位置"
    || mounted.maxChildNodes!==64 || mounted.maxChildDepth!==6) return fail("DOUYIN_POI_NATIVE_CONTRACT_INCOMPLETE");
  if (!intent || intent.schema!=="douyin-poi-intent/v1" || !receipt
    || receipt.schema!=="douyin-poi-native-receipt/v1" || receipt.status!=="MOUNTED"
    || !receipt.candidate || typeof receipt.candidate!=="object") return fail("DOUYIN_POI_RECEIPT_REQUIRED");
  const ownValue=(object,key)=>{
    if(!object||typeof object!=="object")return undefined;
    let descriptor;try{descriptor=Object.getOwnPropertyDescriptor(object,key);}catch{return undefined;}
    return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,"value")?descriptor.value:undefined;
  };
  const safeText=value=>typeof value==="string"&&value.length<=320&&!/[\u0000-\u001f\u007f]/.test(value)&&Boolean(value.trim());
  const recordFrom=value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const id=ownValue(value,"id"),poiId=ownValue(value,"poi_id"),nativeValue=ownValue(value,"value");
    const name=ownValue(value,"name"),poiName=ownValue(value,"poi_name"),address=ownValue(value,"address");
    if([id,poiId,nativeValue].some(item=>typeof item!=="string"||!/^\d{15,22}$/.test(item))||id!==poiId||id!==nativeValue
      ||!safeText(name)||!safeText(poiName)||name!==poiName||!safeText(address))return null;
    return {id,poi_id:poiId,value:nativeValue,name,poi_name:poiName,address};
  };
  const norm=value=>String(value||"").normalize("NFC").replace(/\s+/g," ").trim();
  const assess=value=>{
    const record=recordFrom(value);if(!record)return null;
    const name=norm(record.name),school=norm(intent.schoolName);if(!school||!name.startsWith(school))return null;
    const suffix=name.slice(school.length).match(/^[（(]([^（）()]{1,32})[）)]$/);if(!suffix)return null;
    const campus=suffix[1],target=norm(intent.campus),city=norm(intent.officialAddress).match(/([一-鿿]{2,8})市/)?.[1]||"";
    const targetSuffix=city&&target.startsWith(city)?target.slice(city.length):target;
    if(!targetSuffix||campus!==targetSuffix||campus.includes("北校区")||norm(intent.excludedCampus)&&name.includes(norm(intent.excludedCampus)))return null;
    const address=norm(record.address),official=norm(intent.officialAddress);
    const officialMatch=Boolean(official&&address.includes(official));
    const historical=(Array.isArray(intent.historicalAddressVariants)?intent.historicalAddressVariants:[]).filter(item=>safeText(item)&&address.includes(norm(item)));
    if(address.includes(norm(intent.excludedCampus))||/新乡|获嘉|北校区/.test(address))return null;
    let addressRelation="";
    if(officialMatch&&historical.length===0)addressRelation="official_address_exact";
    else if(!officialMatch&&historical.length===1&&false)addressRelation="listed_historical_address_with_explicit_native_campus";
    else return null;
    return {id:record.id,name:String(record.name).trim(),campus,address:String(record.address).trim(),addressRelation};
  };
  try{
    const nodes=[...document.querySelectorAll(mounted.containerSelector)];
    if(nodes.length!==1)return {ok:false,code:"DOUYIN_POI_NATIVE_SELECT_NOT_UNIQUE",mountedCount:nodes.length};
    const node=nodes[0],rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    if(!(rect.width>0&&rect.height>0)||style.display==="none"||style.visibility==="hidden"||Number(style.opacity||1)<=0)return fail("DOUYIN_POI_NATIVE_SELECT_NOT_VISIBLE");
    const fiberKeys=Object.getOwnPropertyNames(node).filter(key=>key.startsWith(mounted.fiberKeyPrefix));
    if(fiberKeys.length!==1)return fail("DOUYIN_POI_NATIVE_FIBER_AMBIGUOUS");
    const seenFibers=[];let fiber=ownValue(node,fiberKeys[0]);
    for(let i=0;i<mounted.returnDepth;i+=1){if(!fiber||typeof fiber!=="object"||seenFibers.includes(fiber))return fail("DOUYIN_POI_NATIVE_FIBER_PATH_INVALID");seenFibers.push(fiber);fiber=ownValue(fiber,"return");}
    const props=ownValue(fiber,"memoizedProps"),state=ownValue(fiber,"memoizedState");
    if(!props||typeof props!=="object"||!state||typeof state!=="object")return fail("DOUYIN_POI_NATIVE_SELECT_STATE_MISSING");
    if(ownValue(props,"placeholder")!==mounted.placeholder||ownValue(props,"multiple")!==false||ownValue(props,"open")!==false||ownValue(state,"isOpen")!==false)return fail("DOUYIN_POI_NATIVE_SELECT_NOT_CLOSED");
    const selectedValue=ownValue(props,"value");
    if(typeof selectedValue!=="string"||!/^\d{15,22}$/.test(selectedValue))return fail("DOUYIN_POI_NATIVE_SELECT_VALUE_INVALID");
    const selections=ownValue(state,"selections");
    if(!(selections instanceof Map)||selections.size!==1)return fail("DOUYIN_POI_NATIVE_SELECTION_MAP_INVALID");
    let selectedRecord=null;
    for(const value of selections.values()){
      if(selectedRecord!==null)return fail("DOUYIN_POI_NATIVE_SELECTION_NOT_UNIQUE");
      if(ownValue(value,"_notExist")===true)return fail("DOUYIN_POI_NATIVE_SELECTION_RECORD_NOT_HYDRATED");
      selectedRecord=recordFrom(value);
    }
    if(!selectedRecord||selectedRecord.id!==selectedValue)return fail("DOUYIN_POI_NATIVE_SELECTION_VALUE_MISMATCH");
    const label=node.querySelector(mounted.selectedLabelSelector);
    const labelText=norm(label?.innerText??label?.textContent??"");
    if(!labelText||labelText!==norm(selectedRecord.name))return fail("DOUYIN_POI_NATIVE_SELECTED_LABEL_MISMATCH");

    const childRecords=[],seen=new WeakSet();let visited=0,malformed=false;
    const visit=(value,depth)=>{
      if(value==null)return;
      visited+=1;if(visited>mounted.maxChildNodes||depth>mounted.maxChildDepth){malformed=true;return;}
      if(typeof value!=="object")return;
      if(seen.has(value))return;seen.add(value);
      if(Array.isArray(value)){if(value.length>mounted.maxChildNodes){malformed=true;return;}for(const child of value)visit(child,depth+1);return;}
      const direct=recordFrom(value);if(direct){childRecords.push(direct);return;}
      if(["id","poi_id","value","name","poi_name","address"].some(key=>ownValue(value,key)!==undefined)){malformed=true;return;}
      const childProps=ownValue(value,"props");
      if(childProps&&typeof childProps==="object"){
        const propRecord=recordFrom(childProps);if(propRecord){childRecords.push(propRecord);return;}
        if(["id","poi_id","value","name","poi_name","address"].some(key=>ownValue(childProps,key)!==undefined)){malformed=true;return;}
        visit(ownValue(childProps,"children"),depth+1);
      }
      const directChildren=ownValue(value,"children");if(directChildren!==undefined)visit(directChildren,depth+1);
    };
    visit(ownValue(props,"children"),0);
    if(malformed||childRecords.length===0)return fail("DOUYIN_POI_NATIVE_CHILD_OPTIONS_INVALID");
    const matches=childRecords.filter(value=>value.id===selectedRecord.id&&value.name===selectedRecord.name&&value.address===selectedRecord.address);
    if(matches.length!==1)return fail("DOUYIN_POI_NATIVE_SELECTION_NOT_IN_CURRENT_OPTIONS");

    const actual=assess(selectedRecord),expectedCandidate=receipt.candidate;
    const expected=assess({id:expectedCandidate.id,poi_id:expectedCandidate.id,value:expectedCandidate.id,
      name:expectedCandidate.name,poi_name:expectedCandidate.name,address:expectedCandidate.address});
    if(!actual||!expected||actual.id!==expected.id||actual.name!==expected.name||actual.campus!==expected.campus
      ||actual.address!==expected.address||expectedCandidate.campus!==actual.campus)return {ok:false,code:"DOUYIN_POI_NATIVE_MOUNT_MISMATCH",mountedCount:1,selectedCount:1,actual:selectedRecord};
    const {addressRelation,...candidate}=actual;
    return {ok:true,code:"DOUYIN_POI_NATIVE_MOUNTED",mountedCount:1,selectedCount:1,candidate,addressRelation,
      campusEvidence:{kind:"explicit_native_name_suffix",value:candidate.campus},selectedValue,optionCount:childRecords.length,closed:true};
  }catch{
    return fail("DOUYIN_POI_NATIVE_PROBE_FAILED");
  }
}

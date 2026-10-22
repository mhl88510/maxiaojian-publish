import fs from 'node:fs';
import {hash,regular,confined,REVIEW_FLAGS,preflightFixturePaths} from './fixture.mjs';
import {verifyAssetBindings} from './wrapper/content-packet.mjs';
import {packagePublicLinkIssues} from './wrapper/public-link-policy.mjs';
import {assessEgoSpaceOwnership,assessDouyinApiIdentity,isPlatformUrl} from '../core/lib/school-account.mjs';
const admissions=new WeakMap();
export function nativeIdentity(binding,observation,now=Date.now()){
 if(!observation||!Number.isFinite(observation.observedAt)||observation.observedAt>now+1000||now-observation.observedAt>60_000)throw Error('IDENTITY_EVIDENCE_STALE');
 const {space,page,identity}=observation;
 const ownership=assessEgoSpaceOwnership([space],binding);if(!ownership.ok)throw Error(ownership.code);
 if(space.profileId!==binding.egoProfileId||page?.label!==binding.pageLabel||page?.targetId!==binding.targetId||!isPlatformUrl(page?.url,binding.platform))throw Error('EXACT_NATIVE_BINDING_MISMATCH');
 if(!assessDouyinApiIdentity(identity,binding,observation.header).ok)throw Error('ACCOUNT_IDENTITY_MISMATCH');
 return true;
}
export function verifyReview(snapshot,action){
 const file=confined(snapshot.root,snapshot.root+'/review.json');regular(file);const bytes=fs.readFileSync(file);if(bytes.length>65536)throw Error('REVIEW_TOO_LARGE');const review=JSON.parse(bytes);
 if(review.schema!=='offline-review/v1'||review.mode!=='synthetic-only'||review.truthVerified!==false||review.packageSha256!==snapshot.sha256||review.platform!==snapshot.pkg.schoolAccount?.platform||review.accountKey!==snapshot.pkg.schoolAccount?.accountKey||!Array.isArray(review.actions)||!review.actions.includes(action))throw Error('REVIEW_BINDING_MISMATCH');
 if(REVIEW_FLAGS.some(k=>review.checks?.[k]!==true)||!Array.isArray(review.mediaReviewIssues)||review.mediaReviewIssues.length)throw Error('CONTENT_REVIEW_INCOMPLETE');
 return hash(bytes);
}
export function validatePrepared(snapshot,action){
 preflightFixturePaths(snapshot);
 const integrity=verifyAssetBindings(snapshot.pkg);if(!integrity.ok)throw Error('COMPILED_ASSET_INTEGRITY_FAILED:'+integrity.issues.map(x=>x.code).join(','));
 const issues=packagePublicLinkIssues(snapshot.pkg);if(issues.length)throw Error('PUBLIC_EXTERNAL_LINK_POLICY_BLOCKED');
 if(snapshot.pkg.studio?.needsAdapter===true||!Array.isArray(snapshot.pkg.studio?.adapterIssues)||snapshot.pkg.studio.adapterIssues.length)throw Error('ADAPTER_NOT_VERIFIED');
 if(snapshot.pkg.subject?.kind!=='school'||snapshot.pkg.subject.key!=='offline-example')throw Error('DEMO_SUBJECT_REQUIRED');
 return verifyReview(snapshot,action);
}
export function admit(snapshot,action,binding,observation){
 if(!['check','draft','publish'].includes(action))throw Error('ACTION_UNSUPPORTED');
 const reviewSha256=validatePrepared(snapshot,action);nativeIdentity(binding,observation);
 const token=Object.freeze({});admissions.set(token,{snapshot,action,binding:structuredClone(binding),reviewSha256,used:false});return token;
}
export function consume(token,{snapshot,action,binding,observation}){
 const entry=admissions.get(token);if(!entry||entry.used)throw Error('ADMISSION_MISSING_OR_CONSUMED');
 entry.used=true; // An attempted consume cannot be retried under a changed object.
 if(entry.snapshot!==snapshot||entry.action!==action||JSON.stringify(entry.binding)!==JSON.stringify(binding))throw Error('ADMISSION_TARGET_MISMATCH');
 if(hash(fs.readFileSync(snapshot.file))!==snapshot.sha256)throw Error('PACKAGE_CHANGED_AFTER_REVIEW');
 if(validatePrepared(snapshot,action)!==entry.reviewSha256)throw Error('REVIEW_CHANGED_AFTER_ADMISSION');
 nativeIdentity(binding,observation);return true;
}

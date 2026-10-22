import fs from 'node:fs';
// Text-only guard based on Baijiahao's official manual. It is not OCR, factual
// review, professional qualification validation, or a guarantee of approval.
export const BAIJIAHAO_POLICY_SOURCE='https://baijiahao.baidu.com/builder/manual/';
export function assessBaijiahaoContent(pkg){
 const fields={title:pkg.title||'',summary:pkg.summary||'',body:pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):''),cardText:pkg.cardText||''};
 const rules=[['CONTACT_PHONE',/(?:^|[^\d])(?:1[3-9](?:[\s—–·-]*\d){9}|0\d{2,3}[\s—–-]?\d{7,8})(?!\d)/],['EXTERNAL_CONTACT_CTA',/(?:微信同号|微信号|加我微信|加微信|加[微威]信|扫码[加联咨]|V信|威信|微信.{0,6}(?:咨询|联系|了解|沟通)|(?:联系|咨询|添加).{0,6}微信|加\s*V.{0,6}(?:咨询|联系|了解))/i],['EXTERNAL_URL',/(?:https?:\/\/|www\.)[^\s<>"']+/i],['BARE_EXTERNAL_DOMAIN',/(?:^|[^a-z0-9-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|cn|net|org|edu|gov|io|co|info|top|xyz|example)(?:\/[^\s<>"']*)?(?=$|[^a-z0-9])/i],['QR_PROMOTION',/(?:二维码|扫码咨询|扫一扫联系)/]];
 const issues=Object.entries(fields).flatMap(([field,text])=>rules.filter(([,pattern])=>pattern.test(String(text).normalize('NFKC').replace(/[\u200b\ufeff]/g,''))).map(([code])=>({field,code})));
 return {ok:issues.length===0,status:issues.length?'CONTENT_POLICY_BLOCKED':'TEXT_POLICY_CHECK_PASSED',code:issues.length?'BAIJIAHAO_PROMOTIONAL_CONTACT_OR_EXTERNAL_LINK':null,issues,policySource:BAIJIAHAO_POLICY_SOURCE,policyVerifiedAt:'2026-10-05',scope:'text_only',mediaContentChecked:false,qualificationVerified:false,approvalGuaranteed:false};
}

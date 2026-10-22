// Generic final release has no historical personal-cover override.
export function buildPersonalCoverVisualRuntimePrefix(c) {
 if(c?.personalCoverVisualContract)throw Error('BUSINESS_CASE_CONTINUATION_EXCLUDED');
 return '';
}

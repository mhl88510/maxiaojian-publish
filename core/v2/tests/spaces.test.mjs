// Updated from legacy name-only cleanup tests to current exact incarnation contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {exactCleanupBinding,cleanupIdentityMatches,selectSpacesToClose,spaceShouldClose,buildCleanupPlan,retireCurrentSpaces} from '../lib/spaces.mjs';
const binding={id:1,name:'Offline space',profileId:'Offline Profile',taskId:'test-task',tabs:[{label:'p1',targetId:'fake-target'}]};
test('cleanup refuses legacy name/prefix matching without original incarnation',()=>{
 assert.equal(spaceShouldClose({...binding,ownership:'agent'},{closeNames:new Set([binding.name]),prefixes:['Offline']}),false);
});
test('cleanup requires exact space/profile/task/target identity and agent ownership',()=>{
 const policy={closeBindings:[binding]};
 assert.equal(spaceShouldClose({...binding,ownership:'agent'},policy),true);
 for(const patch of [{ownership:'user'},{id:2},{name:'Other'},{profileId:'Other'},{taskId:'Other'},{tabs:[{label:'p1',targetId:'recycled'}]}])assert.equal(spaceShouldClose({...binding,ownership:'agent',...patch},policy),false);
 assert.equal(selectSpacesToClose([{...binding,ownership:'user'}],policy).length,0);
});
test('keep fences override exact cleanup selection',()=>{
 const space={...binding,ownership:'agent'};
 for(const policy of [{keepSpace:true},{keepIds:[1]},{keepNames:['Offline space']}])assert.equal(spaceShouldClose(space,{closeBindings:[binding],...policy}),false);
});
test('missing tabs and duplicate target identity are rejected',()=>{
 assert.equal(exactCleanupBinding({...binding,tabs:[]}),null);
 assert.equal(exactCleanupBinding({...binding,tabs:[...binding.tabs,...binding.tabs]}),null);
 assert.equal(cleanupIdentityMatches({...binding,ownership:'agent'},{...binding,tabs:[]}),false);
});
test('retirement preserves exact incarnation before assigning another space',()=>{
 const state={platforms:{douyin:{taskSpaceId:1,taskSpaceName:binding.name,cleanupBinding:binding}}};
 retireCurrentSpaces(state,['douyin']);assert.equal(state.retiredSpaces[0].cleanupBinding.taskId,'test-task');
});

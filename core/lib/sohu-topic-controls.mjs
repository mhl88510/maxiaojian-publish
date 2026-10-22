// Sohu moves the topic dropdown to document.body. Resolve it from the one
// observed ElSelect component, not from all dropdowns or broad text matches.
export function inspectSohuTopics(c) {
 const scopes=[...document.querySelectorAll(c.topicScopeSelector)];
 if(scopes.length!==1)throw Error('SOHU_TOPIC_SCOPE_NOT_UNIQUE');
 const scope=scopes[0],v=scope.__vue__,pop=v?.$refs?.popper?.$el;
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 if(!visible(scope)||v?.$options?.name!=='ElSelect')throw Error('SOHU_TOPIC_COMPONENT_UNVERIFIED');
 const labels=[...scope.querySelectorAll(c.topicTagSelector)].map(e=>e.innerText.trim());
 const selected=Array.isArray(v.selected)?v.selected.map(s=>String(s.currentLabel||'')):null;
 if(!selected||labels.length!==selected.length||labels.some((x,i)=>x!==selected[i]))throw Error('SOHU_TOPIC_TAG_STATE_MISMATCH');
 const popperReady=!!(pop?.isConnected&&pop.matches('.el-select-dropdown.is-multiple')&&visible(pop));
 const options=popperReady?[...pop.querySelectorAll(c.topicOptionSelector)].filter(visible).map(e=>({text:e.innerText.trim(),disabled:e.classList.contains('is-disabled'),selected:e.classList.contains('selected')})):[];
 return {labels,selected,query:String(v.query||''),popperReady,options};
}
export function clickSohuTopic({c,value}) {

 const scopes=[...document.querySelectorAll(c.topicScopeSelector)];
 if(scopes.length!==1)throw Error('SOHU_TOPIC_SCOPE_NOT_UNIQUE');
 const v=scopes[0].__vue__,pop=v?.$refs?.popper?.$el;
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 if(v?.$options?.name!=='ElSelect'||!pop?.isConnected||!pop.matches('.el-select-dropdown.is-multiple')||!visible(pop))throw Error('SOHU_TOPIC_POPPER_UNVERIFIED');
 const options=[...pop.querySelectorAll(c.topicOptionSelector)].filter(e=>e.innerText.trim()===value);
 if(options.length!==1||!visible(options[0])||options[0].classList.contains('is-disabled')||options[0].classList.contains('selected'))throw Error('SOHU_TOPIC_OPTION_NOT_UNIQUELY_READY');
 options[0].scrollIntoView({block:'center',inline:'center'});options[0].click();
}

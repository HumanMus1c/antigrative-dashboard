// Issue #24: real renderer with the App's sibling transcript/composer topology.
// All conversations, usage and preferences below are synthetic. No host is opened.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {trajectoryMetrics} from '../sidecars/panel/metrics.mjs';

const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
const preview=process.argv.includes('--preview');
const ids={main:'11111111-1111-1111-1111-111111111111',child:'22222222-2222-2222-2222-222222222222',other:'33333333-3333-3333-3333-333333333333'};
const files=await Promise.all(['i18n.cjs','theme.cjs','usage-ui.cjs','inline-widget.cjs'].map(name=>readFile(name==='inline-widget.cjs'&&process.env.AG_PULSE_SIDEBAR_SOURCE?process.env.AG_PULSE_SIDEBAR_SOURCE:join(repo,'compat',name),'utf8')));
const extract=source=>source.slice(source.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
const install=`window.__agPulseI18nFactory=(${extract(files[0])});window.__agPulseThemeFactory=(${extract(files[1])});window.__agPulseUsageFactory=(${extract(files[2])});(${extract(files[3])})();`;
const usage={accountKey:'sidebar-fixture',today:'2026-10-30',timeZone:'Asia/Shanghai',models:['Gemini'],days:[{date:'2026-10-30',models:{Gemini:{uncached:400,cacheRead:600,cacheWrite:0,output:180,total:1180,requests:1}}}],todayTokens:1180,weekTokens:1180,monthTokens:1180,totalTokens:1180,requests:1,syncing:false};
function sample(id,output,context,cached){return {connection:'live',groups:[],usage,speed:trajectoryMetrics({trajectory:{cascadeId:id,generatorMetadata:[{chatModel:{modelDisplayName:id===ids.main?'Gemini 4':'Gemini 3.8 Flash',chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:context*1000,maxContextTokens:100000}},usage:{inputTokens:1000-cached,cacheReadTokens:cached,responseOutputTokens:output,outputTokens:output,apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},streamingDuration:'2s'}}]}})};}
const samples={[ids.main]:sample(ids.main,100,12,200),[ids.child]:sample(ids.child,180,87,600),[ids.other]:sample(ids.other,140,46,800)};
const composer=kind=>`<section class="composer" data-testid="agent-input-box"><div><div class="editor" contenteditable="true" role="textbox" aria-label="Message input" tabindex="0"></div></div><div class="actions"><div class="left"><button class="protected" aria-label="Add context">＋</button>${kind==='main'?'<button data-testid="model-selector-trigger">Gemini 4</button>':'<div class="identity"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg><span>preview_worker</span></div>'}</div><div class="right"><button class="protected" aria-label="Voice">○</button><button class="protected" data-testid="send-button">➜</button></div></div></section>`;
const sidebar=()=>`<div id="sidebar-content" class="content"><div id="sidebar-transcript" data-testid="subagent-tab-conversation" data-cascade-id="${ids.child}" class="transcript"><p>Child conversation · sample data</p><div data-testid="subagent-node" data-cascade-id="${ids.other}">A child listed in the transcript does not own this pane.</div></div><div class="input-wrap"><div>${composer('child')}</div></div></div>`;
const css=`body{margin:0;background:#17191b;color:#ece9e1;font:14px system-ui}[hidden]{display:none!important}#workspace{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(390px,1fr);gap:16px;padding:24px;height:630px}.pane{min-width:0;border:1px solid #55514a;border-radius:16px;display:flex;flex-direction:column;padding:14px;box-sizing:border-box;background:#242522}.content{display:flex;flex-direction:column;flex:1;min-height:0}.transcript{flex:1;padding:18px;color:#d3c7ad}.composer{padding:8px;border:1px solid #636057;border-radius:14px;background:#292a26}.editor{height:65px;outline:none}.editor:empty:before{content:'Click here to focus this conversation';color:#aaa18f}.actions,.left,.right{display:flex;align-items:center;gap:4px}.left{flex:1;min-width:0}.right{flex:none}button{height:28px;border:0;background:transparent;color:inherit;white-space:nowrap}.protected{width:28px;flex:none}.identity{display:flex;align-items:center;gap:4px;padding:4px 8px;white-space:nowrap;font-size:12px}.identity svg{width:14px;height:14px;fill:none;stroke:currentColor;flex-shrink:1}.review{padding:20px 28px 0}.review h1{font-size:21px;margin:0 0 8px}.review p{margin:8px 0;color:#c9bda6}.review button{border:1px solid #b79958;border-radius:8px;background:#3a3526;padding:0 10px;margin-right:8px}.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.toolbar button{border:1px solid #807862;border-radius:6px}#workspace.full{grid-template-columns:1fr}`;
const server=createServer((req,res)=>{
 if(req.url==='/widget.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(install);return;}
 const lang=req.url.includes('zh')?'zh-CN':'en',missing=req.url.includes('missing=1');
 const controls=preview?`<header class="review"><h1>Issue #24 · 主对话与侧栏子代理</h1><p>使用真实插件代码的复现页面；会话和统计均为示例，不是实际对话。主对话：50 tok/s · 12%；侧栏子代理 A：90 tok/s · 87%；B：70 tok/s · 46%。</p><button onclick="focusMain()">聚焦主对话</button><button onclick="focusChild()">聚焦侧栏</button><button onclick="switchChild()">切换子代理 A / B</button><button onclick="fullView()">Full View</button><button onclick="location.reload()">恢复双栏</button></header>`:'';
 res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(`<!doctype html><meta charset="utf-8"><title>Issue #24 sidebar regression</title><style>${css}</style>${controls}<main id="workspace" data-cascade-id="${ids.main}"><section id="main-pane" class="pane" data-testid="conversation-view" data-cascade-id="${ids.main}"><div class="transcript">Main conversation · sample data</div>${composer('main')}</section><div id="aux-pane" class="pane" data-aux-pane-open="true"><div class="toolbar"><span>Subagent Conversation</span><button data-testid="subagent-tab-open-full-view" onclick="fullView()">Full View</button></div>${sidebar()}</div></main><script>
 history.replaceState({},'', '/c/${ids.main}');window.ids=${JSON.stringify(ids)};window.samples=${JSON.stringify(samples)};window.calls=[];window.held=[];window.holdFor=undefined;window.testPrefs={language:'${lang}',languageGuideDismissed:true,usageGuideDismissed:true,revision:1};
 window.agPulseHost={getPreferences:async()=>({...testPrefs}),setPreferences:async value=>(testPrefs={...testPrefs,...value,revision:testPrefs.revision+1}),report:()=>{},getMetrics:input=>{calls.push({...input});const result=structuredClone(samples[input.conversationId]||{connection:'live',groups:[],speed:null,usage:${JSON.stringify(usage)}});result.preferences={...testPrefs};return input.conversationId===holdFor?new Promise(resolve=>held.push(()=>resolve(result))):Promise.resolve(result)}};
 window.focusMain=()=>document.querySelector('#main-pane .editor')?.focus();window.focusChild=()=>document.querySelector('#aux-pane .editor')?.focus();window.switchChild=()=>{const marker=document.getElementById('sidebar-transcript');if(marker){marker.dataset.cascadeId=marker.dataset.cascadeId===ids.child?ids.other:ids.child;focusChild();}};
 window.fullView=()=>{const aux=document.getElementById('aux-pane'),content=document.getElementById('sidebar-content'),marker=document.getElementById('sidebar-transcript'),id=marker?.dataset.cascadeId||ids.child;document.getElementById('main-pane')?.remove();content.dataset.testid='conversation-view';content.dataset.cascadeId=id;marker?.remove();aux.removeAttribute('data-aux-pane-open');aux.removeAttribute('role');document.getElementById('workspace').classList.add('full');history.replaceState({},'', '/c/'+id);focusChild();};
 ${missing?"document.getElementById('sidebar-transcript').remove();focusChild();":"focusMain();"}
 </script><script src="/widget.js"></script>`);
});
await new Promise(resolve=>server.listen(preview?17917:0,'127.0.0.1',resolve));
if(preview){console.log('Synthetic sidebar preview: http://127.0.0.1:17917/?lang=zh');await new Promise(()=>{});}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch(process.platform==='win32'&&!process.env.CI?{channel:'msedge',headless:true}:{headless:true});
const errors=[],results=[];
try{
 for(const lang of ['en','zh']){
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}`);
   const bars=page.locator('[data-ag-pulse-bar]');
   const mainStrip=page.locator('#main-pane [data-ag-pulse-bar]');
   const auxStrip=page.locator('#aux-pane [data-ag-pulse-bar]');
   await mainStrip.waitFor();await auxStrip.waitFor();
   const expectPane=async(paneId,tps,context)=>{
    try{await page.waitForFunction(({paneId,tps,context})=>{const root=document.querySelector(`#${paneId} [data-ag-pulse-bar]`)?.shadowRoot;return root?.getElementById('tps')?.textContent===tps&&root?.getElementById('context-percent')?.textContent===context;},{paneId,tps,context},{timeout:2200});}
    catch(error){throw new Error(`Expected ${paneId} ${tps} tok/s and ${context}: `+JSON.stringify(await page.locator(`#${paneId} [data-ag-pulse-bar]`).evaluate(e=>({scope:e.dataset.scope,id:e.id,tps:e.shadowRoot.getElementById('tps').textContent,context:e.shadowRoot.getElementById('context-percent').textContent,calls:window.calls.slice(-5)}))),{cause:error});}
   };
   const expectMetrics=(tps,context)=>expectPane('aux-pane',tps,context);
   await expectPane('main-pane','50.0','12%');
   await expectMetrics('90.0','87%');
   assert.equal(await bars.count(),2,'Main and sidebar composers keep simultaneous strips');
   assert.equal(await mainStrip.getAttribute('id'),'ag-pulse-status-bar');
   assert.equal(await mainStrip.getAttribute('lang'),lang==='en'?'en':'zh-CN');
   await page.evaluate(()=>focusChild());
   await expectPane('main-pane','50.0','12%');
   await expectMetrics('90.0','87%');
   assert.equal(await auxStrip.getAttribute('data-scope'),'subagent');
   assert.equal(await auxStrip.locator('#cache-rate').textContent(),'60.0%');
   assert.equal(await page.evaluate(()=>location.pathname),'/c/'+ids.main,'Sidebar does not navigate the main route');
   assert.equal(await bars.count(),2,'Focusing sidebar keeps both strips mounted');
   const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   // Neutral presentation wrappers do not change which transcript owns input.
   await page.evaluate(()=>{const marker=document.getElementById('sidebar-transcript'),wrap=document.createElement('div');wrap.id='message-wrapper';wrap.style.flex='1';marker.before(wrap);wrap.append(marker);});
   await settle();await expectMetrics('90.0','87%');
   // Transcript content and hidden/inert sibling panels must not supply an ID.
   await page.evaluate(()=>{const original=document.getElementById('sidebar-transcript');for(const mode of ['hidden','inert']){const copy=original.cloneNode(true);copy.id='decoy-'+mode;copy.dataset.cascadeId=ids.other;copy.setAttribute(mode,'');document.getElementById('sidebar-content').append(copy);}});
   await settle();await expectMetrics('90.0','87%');
   // Ambiguity, invalid IDs and loading/replacement phases fail closed cleanly without affecting main pane.
   for(const mode of ['ambiguous','invalid','missing-id','missing-marker']){
    await page.evaluate(mode=>{calls=[];const marker=document.getElementById('sidebar-transcript');if(mode==='ambiguous'){const copy=marker.cloneNode(true);copy.id='decoy-visible';copy.dataset.cascadeId=ids.other;document.getElementById('sidebar-content').append(copy);}else if(mode==='invalid')marker.dataset.cascadeId='not-a-conversation';else if(mode==='missing-id')marker.removeAttribute('data-cascade-id');else{window.detachedMarker=marker;marker.remove();}},mode);
    await expectMetrics('—','—');
    await expectPane('main-pane','50.0','12%');
    assert.equal(await auxStrip.getAttribute('data-density'),'icons');
    assert.equal(await page.evaluate(()=>calls.filter(call=>!call.composerModel).every(call=>call.conversationId!==ids.main)),true,mode+' must not borrow main metrics');
    await page.evaluate(mode=>{if(mode==='ambiguous')document.getElementById('decoy-visible').remove();else if(mode==='missing-marker'){const replacement=window.detachedMarker.cloneNode(true);replacement.dataset.cascadeId=ids.child;document.getElementById('message-wrapper').append(replacement);delete window.detachedMarker;}else document.getElementById('sidebar-transcript').dataset.cascadeId=ids.child;},mode);
    await expectMetrics('90.0','87%');
    assert.equal(await auxStrip.getAttribute('data-density'),'full');
   }
   await page.evaluate(()=>document.querySelectorAll('[id^="decoy-"]').forEach(element=>element.remove()));
   // The transcript is a boundary, even with many descendant-looking IDs.
   await page.evaluate(()=>{const body=document.createElement('div');body.id='long-transcript';const fragment=document.createDocumentFragment();for(let i=0;i<5000;i++){const span=document.createElement('span');span.dataset.testid='subagent-tab-conversation';span.dataset.cascadeId=ids.other;fragment.append(span);}body.append(fragment);document.getElementById('sidebar-transcript').append(body);});
   await settle();await expectMetrics('90.0','87%');
   await page.evaluate(()=>document.getElementById('long-transcript').remove());
   // Unrecognized, excessively wide/deep presentation trees must not leak
   // the outer page's main ID. Removing them makes the local owner usable again.
   for(const mode of ['wide','deep']){
    await page.evaluate(mode=>{calls=[];if(mode==='wide'){const wrapper=document.createElement('div');wrapper.id='over-budget';for(let i=0;i<128;i++)wrapper.append(document.createElement('span'));document.getElementById('sidebar-content').append(wrapper);}else{let wrapper=document.getElementById('message-wrapper');for(let i=0;i<12;i++){const next=document.createElement('div');wrapper.append(next);wrapper=next;}wrapper.append(document.getElementById('sidebar-transcript'));}},mode);
    await expectMetrics('—','—');
    assert.equal(await page.evaluate(()=>calls.filter(call=>!call.composerModel).every(call=>call.conversationId!==ids.main)),true,'Over-budget ownership must not use the main route');
    await page.evaluate(mode=>{if(mode==='wide')document.getElementById('over-budget').remove();else{const marker=document.getElementById('sidebar-transcript');document.getElementById('message-wrapper').replaceChildren(marker);}},mode);
    await expectMetrics('90.0','87%');
   }
   await page.evaluate(()=>focusMain());await expectPane('main-pane','50.0','12%');await expectMetrics('90.0','87%');
   // A pending main refresh must neither block the child nor replace it.
   await page.evaluate(()=>{holdFor=ids.main;document.querySelector('#main-pane [data-ag-pulse-bar]').shadowRoot.querySelector('.refresh').click();});
   try{await page.waitForFunction(()=>held.length>=1,null,{timeout:2200});}catch(error){throw new Error('Pending-main fixture did not hold a request: '+JSON.stringify(await page.evaluate(()=>({held:held.length,holdFor,calls:calls.slice(-8),active:document.activeElement?.closest('.pane')?.id}))),{cause:error});}
   await page.evaluate(()=>{holdFor=undefined;focusChild();switchChild();});await expectMetrics('70.0','46%');
   await page.evaluate(()=>held.splice(0).forEach(resolve=>resolve()));
   await page.waitForTimeout(80);await expectMetrics('70.0','46%');await expectPane('main-pane','50.0','12%');
   await auxStrip.locator('[data-card=cache]').click();await auxStrip.locator('#open-usage').click();
   assert.equal(await auxStrip.locator('#usage-dashboard').evaluate(element=>element.open),true,'Sidebar usage entry opens');
   await page.waitForFunction(()=>calls.some(call=>call.usageSync===true&&call.conversationId===ids.other));
   await auxStrip.locator('#usage-dashboard #close').click();
   await auxStrip.locator('[data-card=context]').click();
   assert.equal(await auxStrip.getAttribute('lang'),lang==='en'?'en':'zh-CN','Opening usage and context must preserve language');
   await mkdir(join(repo,'.data','issue24-validation'),{recursive:true});
   await page.screenshot({path:join(repo,'.data','issue24-validation',`sidebar-fixture-${lang}.png`)});
   await page.keyboard.press('Escape');
   await page.evaluate(()=>fullView());await expectPane('aux-pane','70.0','46%');
   assert.equal(await bars.count(),1);assert.equal(await auxStrip.getAttribute('id'),'ag-pulse-status-bar');
   // Initial loading is also isolated, even without any previously known owner.
   await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}&missing=1`);
   await mainStrip.waitFor();await auxStrip.waitFor();
   await expectPane('main-pane','50.0','12%');await expectMetrics('—','—');
   assert.equal(await auxStrip.getAttribute('data-scope'),'subagent');
   assert.equal(await auxStrip.getAttribute('data-density'),'icons');
   assert.equal(await bars.count(),2);
   await settle();assert.equal(await page.evaluate(()=>calls.some(call=>!call.composerModel&&call.conversationId===null)&&calls.filter(call=>!call.composerModel).every(call=>call.conversationId!==ids.main)),true,'Unknown initial auxiliary owner must not use main route');
   // Side Question pane with model selector: empty starts with 3 compact icons and spring-expands when conversation data arrives.
   await page.evaluate(mainMarkup=>{
    calls=[];
    const content=document.getElementById('sidebar-content');
    content.innerHTML=`<div id="side-question-view" data-testid="side-question-conversation"><p>Ask a side question without interrupting the main conversation</p></div><div class="input-wrap">${mainMarkup}</div>`;
    document.querySelector('#aux-pane .editor')?.focus();
   },composer('main'));
   await settle();
   assert.equal(await bars.count(),2);
   await expectPane('main-pane','50.0','12%');
   await expectMetrics('—','—');
   assert.equal(await auxStrip.getAttribute('data-density'),'icons');
   assert.equal(await auxStrip.locator('.bar .chip:visible').count(),3);
   await page.evaluate(()=>focusMain());await settle();
   assert.equal(await bars.count(),2,'Focusing back on main preserves Side Question strip');
   await page.evaluate(id=>document.getElementById('side-question-view').setAttribute('data-cascade-id',id),ids.child);
   await expectMetrics('90.0','87%');
   assert.equal(await auxStrip.getAttribute('data-density'),'full');
   await expectPane('main-pane','50.0','12%');
   await page.screenshot({path:join(repo,'.data','issue24-validation',`side-question-both-${lang}.png`)});
   // Closing an unresolved/side pane returns to single main composer cleanly.
   await page.evaluate(()=>{document.getElementById('aux-pane').remove();focusMain();});
   await page.waitForFunction(()=>document.querySelectorAll('[data-ag-pulse-bar]').length===1);
   await expectPane('main-pane','50.0','12%');
   results.push({language:lang,simultaneousBars:true,sideQuestionCompactAndExpand:true,siblingOwner:true,wrappedOwner:true,focusSwitch:true,routeUnchanged:true,hiddenOwnersIgnored:true,invalidAndMissingOwnersIsolated:true,ambiguousOwnersIsolated:true,longTranscriptPruned:true,wideAndDeepOwnershipBounded:true,lateMainResponseIsolated:true,childSwitch:true,usageEntry:true,fullView:true,initialLoadingIsolated:true,sidebarClose:true});
  }finally{await page.close();}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({cases:results,pageErrors:errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

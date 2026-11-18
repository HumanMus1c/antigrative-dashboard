// IDE 2.6 Jetski content-frame contract. Synthetic data; no account or host API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
const sources=await Promise.all(['compat/i18n.cjs','compat/theme.cjs','compat/inline-widget.cjs','ide/surface.cjs'].map(p=>readFile(p==='compat/inline-widget.cjs'&&process.env.AG_PULSE_WIDGET_SOURCE?process.env.AG_PULSE_WIDGET_SOURCE:join(repo,p),'utf8')));
const ids={main:'11111111-1111-1111-1111-111111111111',child:'22222222-2222-2222-2222-222222222222',other:'33333333-3333-3333-3333-333333333333'};
const composer=child=>`<section data-testid="agent-input-box"><div contenteditable="true" role="textbox" class="editor" tabindex="0"></div><div class="row"><div class="native"><button class="native-control">+</button>${child?'<div class="identity"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg><span>worker</span></div>':'<button data-testid="model-selector-trigger">Gemini</button>'}</div><div class="controls"><button class="native-control" data-testid="send-button">→</button></div></div></section>`;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; style-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types 'none'"><style>
body{margin:0;background:#282724;color:#eee;font:13px system-ui}.pane{padding:12px;box-sizing:border-box;max-width:620px;margin:auto}.editor{height:40px;padding:6px}.row,.native,.controls{display:flex;align-items:center;gap:4px}.native{flex:1;min-width:0}.controls{flex:none}button{border:0;background:transparent;color:inherit;white-space:nowrap;height:28px}.native-control{width:28px;flex:none}.identity{display:flex;gap:4px;align-items:center;padding:4px}.identity svg{width:14px;height:14px;fill:none;stroke:currentColor}[hidden]{display:none!important}#main-pane{margin-top:160px}
</style></head><body><main id="main-pane" class="pane" data-testid="conversation-view" data-cascade-id="${ids.main}">${composer(false)}</main><aside id="child-pane" class="pane" data-aux-pane-open="true" hidden><div data-testid="subagent-tab-conversation" data-cascade-id="${ids.child}"><div data-cascade-id="${ids.other}">decoy child</div></div>${composer(true)}</aside><script>
window.calls=[];window.prefs={language:'en',languageGuideDismissed:true,usageGuideDismissed:true,revision:1};
window.agPulseHost={report:()=>{},getPreferences:async()=>prefs,setPreferences:async input=>(prefs={...prefs,...input,revision:prefs.revision+1}),getMetrics:async input=>{calls.push(input);const id=input.conversationId;return {connection:'live',groups:[],preferences:prefs,speed:id?{conversationId:id,tps:id==='${ids.child}'?90:50,latestTps:id==='${ids.child}'?90:50,rounds:1,steps:1,measuredRequests:1,counts:{responseOutput:100,thinkingOutput:0},cache:{hitRate:.5},tokens:{measuredRequests:1,totalTokens:1100,uncachedTokens:500,cachedTokens:500,outputTokens:100,inputRequests:1,outputRequests:1},context:{usedTokens:24000,maxTokens:256000,usedFraction:.09375,remainingFraction:.90625,model:'Gemini'}}:null};}};
window.__agPulseSurface=(${extract(sources[3])})({webview:true});window.__agPulseI18nFactory=(${extract(sources[0])});window.__agPulseThemeFactory=(${extract(sources[1])});(${extract(sources[2])})();
</script></body></html>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/host'?'<html><body style="margin:0"><iframe id="jetski-frame" style="width:100%;height:720px;border:0" src="/c/'+ids.main+'?extensionView=true&extensionVariant=vs-code"></iframe></body></html>':html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch(process.platform==='win32'&&!process.env.CI?{channel:'msedge',headless:true}:{headless:true}),errors=[];
try{
 const page=await browser.newPage({viewport:{width:760,height:800}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/host`);const frame=page.frames().find(f=>f.url().includes('/c/'));assert.ok(frame);
 await frame.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.dataset.layout==='ready',null,{timeout:5000});
 const widget=frame.locator('#ag-pulse-status-bar');assert.equal(await page.locator('#ag-pulse-status-bar').count(),0,'Only content frame hosts widget');
 assert.equal(await frame.evaluate(()=>window.top===window),false);assert.equal(await frame.locator('[id="antigravity.agentSidePanelInputBox"]').count(),0,'No legacy IDE input ID in Jetski');
 assert.equal(await frame.evaluate(()=>calls.at(-1).conversationId),ids.main);assert.equal(await widget.locator('#tps').textContent(),'50.0');
 for(const name of ['speed','cache','context']){await widget.locator(`[data-card=${name}]`).click();await widget.locator(`#${name}-card`).waitFor({state:'visible'});await page.keyboard.press('Escape');}
 await page.setViewportSize({width:350,height:800});await frame.waitForFunction(()=>{const w=document.getElementById('ag-pulse-status-bar');return w?.dataset.density==='icons'&&w.dataset.layout==='ready'&&!w.dataset.motion;});
 assert.equal(await widget.locator('.bar .chip:visible').count(),3);
 await page.setViewportSize({width:760,height:800});
 await frame.evaluate(()=>{document.getElementById('child-pane').hidden=false;document.querySelector('#child-pane .editor').focus();});
 const bars=frame.locator('[data-ag-pulse-bar]'),mainBar=frame.locator('#main-pane [data-ag-pulse-bar]'),childBar=frame.locator('#child-pane [data-ag-pulse-bar]');
 await frame.waitForFunction(()=>document.querySelectorAll('#child-pane [data-ag-pulse-bar]').length===1&&document.querySelector('#child-pane [data-ag-pulse-bar]')?.shadowRoot?.getElementById('tps')?.textContent==='90.0');
 assert.equal(await bars.count(),2,'Main and auxiliary composers keep simultaneous strips');
 assert.equal(await mainBar.locator('#tps').textContent(),'50.0');
 assert.equal(await childBar.locator('#tps').textContent(),'90.0');
 await frame.evaluate(()=>document.querySelector('[data-testid="subagent-tab-conversation"]').setAttribute('data-cascade-id','invalid'));
 await frame.waitForFunction(()=>document.querySelector('#child-pane [data-ag-pulse-bar]')?.shadowRoot?.getElementById('tps')?.textContent==='—');
 assert.equal(await childBar.getAttribute('data-density'),'icons');
 assert.equal(await mainBar.locator('#tps').textContent(),'50.0','Invalid child identity must not affect main strip');
 await frame.evaluate(()=>{document.getElementById('child-pane').hidden=true;document.querySelector('#main-pane .editor').focus();});
 await frame.waitForFunction(()=>document.querySelectorAll('[data-ag-pulse-bar]').length===1);
 await frame.evaluate(()=>document.getElementById('main-pane').setAttribute('data-cascade-id','33333333-3333-3333-3333-333333333333'));
 await frame.waitForFunction(()=>calls.at(-1)?.conversationId==='33333333-3333-3333-3333-333333333333');
 await frame.evaluate(()=>document.getElementById('main-pane').setAttribute('data-cascade-id',''));
 await frame.waitForFunction(()=>calls.at(-1)?.conversationId===null&&document.getElementById('ag-pulse-status-bar')?.dataset.density==='icons');
 assert.equal(await widget.locator('#tps').textContent(),'—','Explicit empty owner must not inherit route identity');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({nestedFrame:true,trustedTypes:true,legacyMarkerAbsent:true,compactIcons:true,cardsInteractive:true,simultaneousBars:true,ownerBeatsRoute:true,childIsolated:true,invalidOwnerFailsClosed:true,errors}));
}catch(error){console.error(JSON.stringify({pageErrors:errors}));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}

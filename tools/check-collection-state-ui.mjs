// Issue #25 synthetic states against the production widget. No personal data.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {trajectoryMetrics} from '../sidecars/panel/metrics.mjs';
const repo=join(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),preview=process.argv.includes('--preview');
const source=['i18n','theme','usage-ui','inline-widget'].map(n=>require(join(repo,'compat',n+'.cjs')).toString());
if(process.env.AG_PULSE_WIDGET_SOURCE)source[3]=require(process.env.AG_PULSE_WIDGET_SOURCE).toString();
const install=`window.__agPulseI18nFactory=${source[0]};window.__agPulseThemeFactory=${source[1]};window.__agPulseUsageFactory=${source[2]};(${source[3]})();`;
const id='11111111-1111-1111-1111-111111111111';
const speed=trajectoryMetrics({trajectory:{cascadeId:id,steps:[],generatorMetadata:[{chatModel:{modelDisplayName:'Gemini',streamingDuration:'2s',usage:{inputTokens:1000,cacheReadTokens:600,responseOutputTokens:100,outputTokens:100,apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:24000,maxContextTokens:256000}}}}]}});
const usage={accountKey:'collection-fixture',today:'2026-10-30',timeZone:'Asia/Shanghai',models:[],days:[],todayTokens:0,weekTokens:0,monthTokens:0,totalTokens:0,requests:0,syncing:false};
const server=createServer((req,res)=>{if(req.url==='/widget.js'){res.setHeader('Content-Type','text/javascript');res.end(install);return;}
 const url=new URL(req.url,'http://localhost'),lang=['en','zh-CN','zh-TW'].includes(url.searchParams.get('lang'))?url.searchParams.get('lang'):'zh-CN';
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>Collection limit preview</title><style>:root{--primary:#c58b32;--background:#1e201c}body[data-theme=light]{--background:#f3efe3;background:#f3efe3;color:#302d23}body[data-theme=light] .composer{background:#e5dfcf}body[data-theme=light] button,body[data-theme=light] select{background:#e5dfcf;color:#302d23}body{background:#1e201c;color:#f1eadd;font:14px system-ui;margin:0;padding:30px}button,select{color:inherit;background:#35382e;border:1px solid #77755e;border-radius:7px;padding:6px}.composer{margin:290px auto 0;max-width:1000px;padding:12px;border:1px solid #696856;border-radius:14px;background:#292c24}.editor{height:64px;outline:0}.actions,.left,.right{display:flex;gap:5px;align-items:center}.left{flex:1;min-width:0}.right{flex:none}.actions button{white-space:nowrap;border:0;height:28px;padding:2px 5px}.review{line-height:1.7}a{color:#d9b96d}</style><header class="review"><h2>统计受限 · 本地验收</h2><p>合成会话与示例数据，使用真实控件代码；不会读取你的历史。</p><select id="scenario"><option value="processing">后台补全（自动完成）</option><option value="processing-saved">后台补全（保留旧统计）</option><option value="limited" selected>无法继续统计</option><option value="saved">保留上次完整统计</option><option value="serialized">序列化统计超限</option><option value="field">单字段超限</option><option value="empty">尚无请求</option><option value="normal">正常统计</option></select> <select id="language"><option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option></select> <button id="theme" onclick="document.body.dataset.theme=document.body.dataset.theme==='light'?'dark':'light';document.documentElement.style.setProperty('--background',document.body.dataset.theme==='light'?'#f3efe3':'#1e201c')">切换深浅主题</button> <button onclick="document.querySelector('.composer').style.maxWidth=document.querySelector('.composer').style.maxWidth?'':'260px'">切换窄栏</button></header><main data-cascade-id="${id}"><section class="composer" data-testid="agent-input-box"><div role="textbox" contenteditable="true" class="editor">输入框（仅用于预览）</div><div class="actions"><div class="left"><button data-testid="model-selector-trigger">Gemini</button></div><div class="right"><button aria-label="Voice">○</button><button data-testid="send-button">➜</button></div></div></section></main><script>
 history.replaceState({},'', '/c/${id}');window.mode='limited';window.processingStarted=0;window.base=${JSON.stringify(speed)};window.usage=${JSON.stringify(usage)};window.testPrefs={language:'${lang}',revision:1,languageGuideDismissed:true,usageGuideDismissed:true};window.calls=[];
 window.agPulseHost={report:()=>{},getPreferences:async()=>({...testPrefs}),setPreferences:async value=>(testPrefs={...testPrefs,...value,revision:testPrefs.revision+1}),getMetrics:async input=>{calls.push(input);if(mode==='processing'&&processingStarted&&Date.now()-processingStarted>6000)mode='normal';const processing=mode.startsWith('processing'),limited=!['normal','empty'].includes(mode),saved=mode==='saved'||mode==='processing-saved';const collection=processing?{state:'processing',code:'background-collection',stage:'steps',processedSteps:Math.floor((Date.now()-processingStarted)/100),processedGenerators:0,freshness:saved?'saved':'unavailable',lastSuccessAt:saved?'2026-10-30T01:00:00Z':null}:limited?{state:'limited',code:'budget-exceeded',kind:mode==='serialized'?'projected-json':mode==='field'?'field':'retained-fields',...(mode==='field'?{unit:'characters',limit:16384,observed:16385}:{unit:'bytes',limitBytes:8388608,observedBytes:8388672}),complete:false,retryAt:new Date(Date.now()+30000).toISOString(),freshness:saved?'saved':'unavailable',lastSuccessAt:saved?'2026-10-30T01:00:00Z':null}:null;return {connection:'live',groups:[{id:'gemini',name:'Gemini',windows:{'5h':{available:true,remaining:.7,resetAt:new Date(Date.now()+18000000).toISOString()},weekly:{available:true,remaining:.8,resetAt:new Date(Date.now()+604800000).toISOString()}}}],speed:saved?{...base,restoredFromHistory:true,savedAt:'2026-10-30T01:00:00Z'}:mode==='normal'?base:null,collection,usage,preferences:{...testPrefs}}}};
 window.refreshFixture=()=>document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('.refresh').click();document.getElementById('scenario').onchange=e=>{mode=e.target.value;processingStarted=Date.now();refreshFixture()};document.getElementById('language').value=testPrefs.language;document.getElementById('language').onchange=e=>{testPrefs={...testPrefs,language:e.target.value,revision:testPrefs.revision+1};refreshFixture()};
 </script><script src="/widget.js"></script>`);
});
await new Promise(r=>server.listen(preview?17918:0,'127.0.0.1',r));
if(preview){console.log('Synthetic collection preview: http://127.0.0.1:17918/?lang=zh-CN');await new Promise(()=>{});}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch(process.platform==='win32'&&!process.env.CI?{channel:'msedge',headless:true}:{headless:true});
const errors=[],results=[];
async function verifyGlyphs(page,strip,density,expected,screenshot=null){
 await page.waitForFunction(density=>{const w=document.getElementById('ag-pulse-status-bar');return w?.dataset.layout==='ready'&&w.dataset.density===density&&!w.dataset.motion;},density);
 const geometry=await strip.evaluate(w=>{
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).display!=='none';
  const chips=[...w.shadowRoot.querySelectorAll('.bar .chip')].filter(visible),cache=chips.find(e=>e.dataset.card==='cache');
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
  return {chips:chips.length,cache:rect(cache),glyphs:[...cache.querySelectorAll(':scope>svg')].filter(visible).map(e=>({name:e.getAttribute('class')||'cache',...rect(e)})),total:chips.flatMap(e=>[...e.querySelectorAll(':scope>svg,:scope>.context-ring')]).filter(visible).length,stages:w.shadowRoot.querySelectorAll('.density-stage').length};
 });
 assert.equal(geometry.chips,3);
 assert.deepEqual(geometry.glyphs.map(e=>e.name),[expected],`${density}: exactly one cache state glyph must be visible`);
 assert.equal(geometry.total,3,'There must be exactly three visible strip glyphs, not just three buttons');
 assert.equal(geometry.stages,0,'Density motion must remove visual copies');
 if(density==='icons'){
  assert.equal(geometry.cache.width,24);assert.equal(geometry.cache.height,24);
  const g=geometry.glyphs[0],b=geometry.cache;
  assert.ok(Math.abs(g.left+g.width/2-b.left-b.width/2)<.6,'Cache glyph must be centered in its hit box horizontally');
  assert.ok(Math.abs(g.top+g.height/2-b.top-b.height/2)<.6,'Cache glyph must be centered in its hit box vertically');
  assert.ok(g.left>=b.left&&g.left+g.width<=b.left+b.width,'Cache glyph must not overflow into its neighbours');
  await strip.locator('[data-card=speed]').focus();await page.keyboard.press('Tab');
  const focus=await strip.evaluate(w=>{const button=w.shadowRoot.querySelector('[data-card=cache]'),style=getComputedStyle(button);return {active:w.shadowRoot.activeElement===button,visible:button.matches(':focus-visible'),width:parseFloat(style.outlineWidth),offset:parseFloat(style.outlineOffset)};});
  assert.ok(focus.active&&focus.visible,'Keyboard navigation must focus the cache control visibly');
  assert.ok(focus.width>0&&focus.width+focus.offset<=0,'Compact keyboard outline must fit inside the chip instead of clipping at the bar');
 }
 if(density==='icons')await page.keyboard.press('Enter');else await strip.locator('[data-card=cache]').click();
 await strip.locator('#cache-card').waitFor({state:'visible'});
 const anchor=await strip.evaluate(w=>{const b=w.shadowRoot.querySelector('[data-card=cache]').getBoundingClientRect(),c=w.shadowRoot.getElementById('cache-card').getBoundingClientRect();return {expanded:w.shadowRoot.querySelector('[data-card=cache]').getAttribute('aria-expanded'),left:c.left,expected:Math.min(innerWidth-c.width-12,Math.max(12,b.left+b.width/2-c.width/2)),right:c.right,viewport:innerWidth};});
 assert.equal(anchor.expanded,'true');assert.ok(Math.abs(anchor.left-anchor.expected)<1,'Card must stay centered on its button or clamped inside the viewport');
 assert.ok(anchor.left>=11&&anchor.right<=anchor.viewport-11,'Card must remain in the viewport');
 if(screenshot){await mkdir(join(repo,'.data/compact-icons-validation'),{recursive:true});await page.screenshot({path:join(repo,'.data/compact-icons-validation',screenshot)});}
 await page.keyboard.press('Escape');
}
async function verifyNarrowStateMatrix(page,strip){
 // Auxiliary panes shrink the main composer. Each cache state replaces one
 // glyph; hidden warning/processing SVGs must never become extra controls.
 const cases=[];
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{document.body.dataset.theme=theme;document.documentElement.style.setProperty('--background',theme==='light'?'#f3efe3':'#1e201c');},theme);
  await page.waitForFunction(theme=>document.getElementById('ag-pulse-status-bar')?.getAttribute('data-pulse-theme')===theme,theme);
  for(const [mode,expected]of [['normal','cache'],['empty','cache'],['limited','collection-warning'],['processing-saved','collection-processing']]){
   await page.selectOption('#scenario',mode);
   await page.waitForFunction(mode=>{const w=document.getElementById('ag-pulse-status-bar');return !w.shadowRoot.querySelector('.refresh[aria-busy=true]')&&(w.dataset.collection||'')===(mode.startsWith('processing')?'processing':mode==='limited'?'limited':'');},mode);
   for(const density of ['icons','full']){
    await page.evaluate(density=>document.querySelector('.composer').style.maxWidth=density==='icons'?'260px':'1000px',density);
    const expectedDensity=mode==='empty'?'icons':density;
    const screenshot=theme==='light'&&mode==='normal'&&density==='icons'?'fixed-light-'+await strip.getAttribute('lang')+'.png':null;
    await verifyGlyphs(page,strip,expectedDensity,expected,screenshot);
   }
   cases.push({theme,mode});
  }
 }
 // Restore the existing regression's original state.
 await page.evaluate(()=>{document.body.dataset.theme='dark';document.documentElement.style.setProperty('--background','#1e201c');});
 await page.selectOption('#scenario','limited');
 await page.waitForFunction(()=>{const w=document.getElementById('ag-pulse-status-bar');return w?.dataset.collection==='limited'&&w.getAttribute('data-pulse-theme')==='dark'&&!w.shadowRoot.querySelector('.refresh[aria-busy=true]');});
 return cases;
}
try{for(const lang of ['en','zh-CN','zh-TW']){
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}`);
 const strip=page.locator('#ag-pulse-status-bar');await strip.waitFor();await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.dataset.collection==='limited');
 const glyphCases=await verifyNarrowStateMatrix(page,strip);
 const label=lang==='en'?'Statistics limited':lang==='zh-CN'?'统计受限':'統計受限';
 assert.equal(await strip.locator('[data-card=cache]').getAttribute('aria-label'),label);
 assert.equal(await strip.locator('#samples').textContent(),'—');
 await strip.locator('[data-card=cache]').click();const notice=strip.locator('#cache-card .collection-notice');await notice.waitFor({state:'visible'});
 await notice.locator('summary').click();assert.match(await notice.locator('.collection-budget-size').textContent(),/8\.00 MiB/);assert.equal(await notice.locator('a').getAttribute('href'),'https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/main/docs/LONG_CONVERSATIONS.md');
 for(const mode of ['saved','serialized','field','empty','normal','limited']){
  await page.keyboard.press('Escape');await page.selectOption('#scenario',mode);
  await page.waitForFunction(mode=>{const w=document.getElementById('ag-pulse-status-bar'),r=w.shadowRoot;if(['empty','normal'].includes(mode))return !w.dataset.collection&&w.dataset.density===(mode==='empty'?'icons':'full')&&!w.dataset.motion;return mode==='saved'?r.getElementById('tps').textContent==='50.0':r.getElementById('tps').textContent==='—';},mode);
  if(mode==='empty')assert.equal(await strip.locator('.bar .chip:visible').count(),3);
  await strip.locator('[data-card=cache]').click();
  if(mode==='saved'){assert.match(await notice.locator('.collection-state').textContent(),/Last complete|上次完整/);assert.equal(await strip.locator('#tps').textContent(),'50.0');}
  if(mode==='field'){await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar').shadowRoot.querySelector('#cache-card .collection-budget-size').textContent.includes('16,385'));assert.doesNotMatch(await notice.locator('.collection-budget-size').textContent(),/MiB/);}
  if(['empty','normal'].includes(mode)){assert.equal(await notice.isVisible(),false);assert.equal(await strip.locator('.bar .collection-warning').isVisible(),false);}
 }
 // Completion is delivered by the existing polling loop, without any refresh click.
 await page.keyboard.press('Escape');await page.selectOption('#scenario','processing');
 await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.dataset.collection==='processing');
 const processingLabel=lang==='en'?'Completing statistics':lang==='zh-CN'?'正在补全统计':'正在補全統計';
 assert.equal(await strip.locator('[data-card=cache]').getAttribute('aria-label'),processingLabel);
 assert.equal(await strip.locator('.collection-warning').isVisible(),false);
 await strip.locator('[data-card=cache]').click();await notice.locator('summary').click();
 assert.doesNotMatch(await notice.locator('.collection-budget-size').textContent(),/%|MiB/);
 assert.equal(await notice.locator('a').isVisible(),false);
 await page.waitForFunction(()=>!document.getElementById('ag-pulse-status-bar')?.dataset.collection,null,{timeout:12000});
 assert.equal(await strip.locator('#tps').textContent(),'50.0');assert.equal(await notice.isVisible(),false);
 await page.keyboard.press('Escape');await page.selectOption('#scenario','processing-saved');
 await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.dataset.collection==='processing');
 assert.equal(await strip.locator('#tps').textContent(),'50.0');
 await strip.locator('[data-card=cache]').click();assert.match(await notice.locator('.collection-state').textContent(),/Last complete|上次完整/);
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('.composer').style.maxWidth='260px');
 await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar').classList.contains('icons-only'));
 assert.equal(await strip.locator('.bar .collection-processing').isVisible(),true);assert.equal(await strip.locator('.bar .collection-label').isVisible(),false);
 assert.equal(await strip.locator('#five-balance').textContent(),'70.0%');
 await page.evaluate(()=>document.querySelector('.composer').style.maxWidth='');await page.selectOption('#scenario','limited');
 await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.dataset.collection==='limited');
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('.composer').style.maxWidth='260px');await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.classList.contains('icons-only'));
 assert.equal(await strip.locator('.bar .collection-warning').isVisible(),true);assert.equal(await strip.locator('.bar .collection-label').isVisible(),false);assert.equal(await strip.locator('.bar .chip').count(),3);
 await strip.locator('[data-card=context]').click();assert.equal(await strip.locator('#context-summary').textContent(),'—');assert.equal(await strip.locator('#five-balance').textContent(),'70.0%');
 await page.keyboard.press('Escape');await page.click('#theme');await page.waitForFunction(()=>document.getElementById('ag-pulse-status-bar')?.getAttribute('data-pulse-theme')==='light');await strip.locator('[data-card=context]').click();assert.equal(await strip.locator('#context-card .collection-notice').isVisible(),true);

 await mkdir(join(repo,'.data/issue25-validation'),{recursive:true});await page.screenshot({path:join(repo,'.data/issue25-validation',`collection-${lang}.png`)});
 results.push({lang,limited:true,saved:true,fieldUnits:true,normalRecovery:true,narrow:true,quotaUnaffected:true,automaticBackgroundCompletion:true,processingSaved:true,processingNarrow:true,glyphCases,oneGlyphPerControl:true,compactHitBoxCentered:true,compactKeyboardOutlineUnclipped:true,cardAnchored:true,motionCopiesCleaned:true});
 }finally{await page.close();}
}assert.deepEqual(errors,[]);console.log(JSON.stringify({results,pageErrors:errors},null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}

// Exercise actual panel/inline renderers with distinct balances, opaque quota
// IDs and changing host names. No account or installed host is accessed.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {strict as assert} from 'node:assert';
import {createRequire} from 'node:module';
import {panelPageSource,panelAppSource} from '../sidecars/panel/panel-source.mjs';
import {trajectoryMetrics} from '../sidecars/panel/metrics.mjs';
const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
const preview=process.argv.includes('--preview'),createTheme=createRequire(import.meta.url)('../compat/theme.cjs');
const sources=await Promise.all(['i18n.cjs','theme.cjs','inline-widget.cjs'].map(name=>readFile(join(repo,'compat',name),'utf8')));
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
const ideSurface=extract(await readFile(join(repo,'ide/surface.cjs'),'utf8'));
const bundle=`window.__agPulseI18nFactory=(${extract(sources[0])});window.__agPulseThemeFactory=(${extract(sources[1])});(${extract(sources[2])})();`;
let prefs={language:'en',languageGuideDismissed:true,revision:1};
const quota=(id,name,value,weeklyOnly=false)=>({id,name,windows:Object.fromEntries(['5h','weekly'].map(key=>[key,weeklyOnly&&key==='5h'?{available:false}:{available:true,remaining:value,resetAt:new Date(Date.now()+(key==='weekly'?604800000:3600000)).toISOString()}]))});
let groups,model;const reset=()=>{groups=[quota('gemini','Gemini',.8),quota('gemini-argon-wtu','Gemini 4 Argon',.2,true),quota('3p','Claude / GPT',.6)];model='Gemini 4 Argon';};reset();
const sample=()=>({connection:'live',groups,quotaUpdatedAt:new Date().toISOString(),preferences:prefs,
 speed:trajectoryMetrics({trajectory:{cascadeId:'11111111-1111-1111-1111-111111111111',steps:[{type:'USER_INPUT'}],generatorMetadata:[{chatModel:{modelDisplayName:model,streamingDuration:'2.4s',timeToFirstToken:'.4s',usage:{messageId:'quota-preview',inputTokens:800,cacheReadTokens:200,outputTokens:100,responseOutputTokens:100,cacheWriteTokens:0,apiProvider:'API_PROVIDER_GOOGLE_GEMINI'},chatStartMetadata:{contextWindowMetadata:{estimatedTokensUsed:20000,maxContextTokens:100000}}}}]}})});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/metrics'||path==='/api/preferences'){
  if(path==='/api/preferences'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);res.end();return;}}
   try{const value=JSON.parse(body);if(['en','zh-CN','zh-TW'].includes(value.language))prefs={...prefs,language:value.language,revision:prefs.revision+1};}catch{res.writeHead(400);res.end();return;}
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(path==='/api/metrics'?sample():prefs));return;
 }
 if(path==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(panelAppSource());return;}
 if(path==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(join(repo,'sidecars/panel/styles.css')));return;}
 if(path==='/theme.css'){res.setHeader('Content-Type','text/css');res.end(createTheme().css(':root'));return;}
 if(path==='/preload.js'){res.end('');return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');
 if(path==='/panel'){res.end(panelPageSource().replace('</head>',preview?'<style>:root{--background:#201b18;--foreground:#f4e8df;--primary:#db8e59}</style></head>':'</head>'));return;}
 const ide=path==='/ide',id='11111111-1111-1111-1111-111111111111';
 const before=ide?'<section class="antigravity-agent-side-panel"><div class="composer" id="antigravity.agentSidePanelInputBox">':'<section class="composer">',after=ide?'</div></section>':'</section>';
 const surface=ide?`const box=document.getElementById('antigravity.agentSidePanelInputBox'),owner={props:{cascadeId:'${id}'},__k:[]},vnode={type:'div',__e:box,props:{id:box.id},__:owner,__k:[]};owner.__k=[vnode];document.querySelector('.antigravity-agent-side-panel').__k=owner;window.__agPulseSurface=(${ideSurface})();`:'';
 res.end(`<!doctype html><meta charset="utf-8"><style>body{margin:20px;background:#17181c;color:#eee;font:14px Arial}.composer{margin-top:240px;padding:16px;border:1px solid #555}.editor{height:55px}.actions{display:flex;gap:8px;align-items:center}button{height:30px;white-space:nowrap}.controls{margin-left:auto}</style>${before}<div class="editor" contenteditable="true" role="${ide?'combobox':'textbox'}"></div><div class="actions"><button data-testid="model-selector-trigger" aria-label="Choose model">Gemini 4 Argon</button><div class="controls"><button>＋</button></div></div>${after}<script>history.replaceState({},'', '/c/${id}');window.agPulseHost={getMetrics:()=>fetch('/api/metrics').then(r=>r.json()),getPreferences:async()=>(${JSON.stringify(prefs)}),setPreferences:async x=>x,report:()=>{}};${surface}${bundle}</script>`);
});
await new Promise(resolve=>server.listen(preview?17919:0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
if(preview){console.log('PR #28 preview (synthetic quota data): '+base+'/panel');await new Promise(()=>{});}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch(process.platform==='win32'&&!process.env.CI?{channel:'msedge',headless:true}:{headless:true});
const errors=[],results=[];
try{
 for(const mode of ['panel','inline','ide']){
  reset();const page=await browser.newPage({viewport:{width:1000,height:800}});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/'+mode);
  await page.locator('[data-card="context"]').first().click();
  const scope=mode!=='panel'?page.locator('#ag-pulse-status-bar'):page.locator('.widget');
  const refresh=async()=>{if(mode!=='panel')await page.locator('[data-testid="model-selector-trigger"]').evaluate((e,value)=>e.textContent=value,model);await scope.locator(mode==='panel'?'#refresh-button':'.refresh').click();};
  const balance=scope.locator('#week-balance'),five=scope.locator(mode==='panel'?'#five-details':'#five-quota-section');
  await balance.filter({hasText:'20.0%'}).waitFor();
  assert.equal(await five.isVisible(),false,'A weekly-only group has no invented five-hour card');
  assert.match(await scope.locator(mode==='panel'?'#week-quota-title':'#week-quota-title').textContent(),/Argon/);
  if(mode==='panel'){assert.equal(await scope.locator('#quota-group').inputValue(),'gemini-argon-wtu');assert.equal(await scope.locator('#five-summary').isVisible(),false);assert.equal(await scope.locator('#quota-overview').getAttribute('data-windows'),'1');}
  else assert.match(await scope.locator('.group-trigger').textContent(),/Gemini \(Argon\)/);
  groups.reverse();model='Gemini Flash';await refresh();await balance.filter({hasText:'80.0%'}).waitFor();
  assert.equal(await five.isVisible(),true);
  model='Gemini 4 Argon';groups=groups.filter(g=>g.id!=='gemini-argon-wtu');await refresh();await balance.filter({hasText:'80.0%'}).waitFor();
  assert.equal(await five.isVisible(),true,'An account with only shared Gemini quota keeps its own windows');
  groups.push(quota('opaque','Premium quota',.3,true));await refresh();await balance.filter({hasText:'80.0%'}).waitFor();
  groups.at(-1).name='Gemini 4 Argon';await refresh();await balance.filter({hasText:'30.0%'}).waitFor();
  assert.equal(await five.isVisible(),false);
  groups.at(-1).windows.weekly.remaining=0;await refresh();await balance.filter({hasText:'0.0%'}).waitFor();
  assert.equal(await five.isVisible(),false,'Exhausted weekly quota must not fall back to shared Gemini');
  groups.at(-1).windows.weekly={...groups.at(-1).windows.weekly,disabled:true,remaining:1};await refresh();
  await balance.filter({hasText:'Quota unavailable'}).waitFor();
  assert.equal(await scope.locator('#week-track').getAttribute('aria-valuenow'),null);
  assert.equal(await five.isVisible(),false);
  groups.at(-1).windows.weekly.disabled=false;
  if(mode==='panel'){
   assert.equal(await scope.locator('#quota-group option[value="opaque"]').textContent(),'Gemini (Argon)');
   await scope.locator('#quota-group').selectOption('gemini');
  }else{
   await scope.locator('.group-trigger').click();
   assert.equal(await scope.locator('[data-group="opaque"]').textContent(),'Gemini (Argon)');
   await scope.locator('[data-group="gemini"]').click();
  }
  await balance.filter({hasText:'80.0%'}).waitFor();model='Claude Sonnet';await refresh();await balance.filter({hasText:'80.0%'}).waitFor();
  results.push({mode,weeklyOnly:true,zeroDoesNotFallBack:true,sharedGeminiFallback:true,opaqueIds:true,modelSwitch:true,sameIdLabelRefresh:true,manualSelectionRetained:true});await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,pageErrors:errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

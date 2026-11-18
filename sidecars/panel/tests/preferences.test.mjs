import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {PreferencesStore} from '../../../compat/preferences.mjs';
const create=createRequire(import.meta.url)('../../../compat/i18n.cjs');
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'pulse-preferences-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'preferences.json');return {directory,file,store:new PreferencesStore({file})};
}
const connect=(language,store,extra={})=>language.connectPreferences({read:()=>store.get(),write:input=>store.set(input),...extra});

test('Traditional choice survives fresh storage, independent guide writes and stale replies',async t=>{
  const {file,store}=await fixture(t),language=create(null),controller=connect(language,store);
  await controller.ready;await controller.choose('zh-TW');
  await store.set({languageGuideDismissed:true});await store.set({usageGuideDismissed:true});
  const saved=await new PreferencesStore({file}).get();assert.equal(saved.language,'zh-TW');
  controller.sync({language:'en',revision:0});assert.equal(language.language,'zh-TW');controller.dispose();
  const restarted=create('en'),restored=connect(restarted,new PreferencesStore({file}));await restored.ready;
  assert.equal(restarted.language,'zh-TW');assert.equal(saved.usageGuideDismissed,true);assert.equal(saved.languageGuideDismissed,true);restored.dispose();
});

test('guide dismissal survives a fresh backend without selecting a language; older preference files migrate',async t=>{
  const {file,store}=await fixture(t);
  await store.set({languageGuideDismissed:true});
  assert.deepEqual((await new PreferencesStore({file}).get()).language,null);
  assert.equal((await store.get()).languageGuideDismissed,true);
  await writeFile(file,JSON.stringify({schema:1,language:'zh-CN',revision:1}));
  assert.equal((await store.get()).languageGuideDismissed,false);
  await Promise.all([store.set({languageGuideDismissed:true}),store.set({language:'en'})]);
  assert.equal((await store.get()).language,'en');assert.equal((await store.get()).languageGuideDismissed,true);
  await assert.rejects(store.set({languageGuideDismissed:false}));
});

test('Chinese and English survive a new backend and a renderer with empty origin storage',async t=>{
  const {file,store}=await fixture(t);assert.deepEqual(await store.get(),{language:null,languageGuideDismissed:false,usageGuideDismissed:false,speedStyle:null,revision:0});
  const first=create(null),controller=connect(first,store);await controller.ready;await controller.toggle();
  assert.equal(first.language,'zh-CN');controller.dispose();
  const afterRestart=create(null),restored=connect(afterRestart,new PreferencesStore({file}));await restored.ready;
  assert.equal(afterRestart.language,'zh-CN');await restored.toggle();restored.dispose();
  const again=create(null);await connect(again,new PreferencesStore({file})).ready;assert.equal(again.language,'en');
  const json=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(Object.keys(json).sort(),['language','languageGuideDismissed','revision','schema','speedStyle','usageGuideDismissed']);
});

test('usage onboarding completion persists independently of language and language onboarding',async t=>{
  const {file,store}=await fixture(t);
  await writeFile(file,JSON.stringify({schema:1,language:'zh-CN',languageGuideDismissed:true,revision:1}));
  assert.equal((await store.get()).usageGuideDismissed,false,'Existing users also receive the new usage explanation');
  await store.set({usageGuideDismissed:true});await store.set({language:'en'});
  const saved=await new PreferencesStore({file}).get();assert.equal(saved.usageGuideDismissed,true);assert.equal(saved.languageGuideDismissed,true);assert.equal(saved.language,'en');
  await assert.rejects(store.set({usageGuideDismissed:false}));await assert.rejects(store.set({usageGuideDismissed:'true'}));
  const fresh=await fixture(t);await fresh.store.set({usageGuideDismissed:true});const first=await fresh.store.get();assert.equal(first.language,null);assert.equal(first.languageGuideDismissed,false);
});

test('speed card style persists independently, defaults to minimal and rejects unknown styles',async t=>{
  const {file,store}=await fixture(t);
  await writeFile(file,JSON.stringify({schema:1,language:'zh-CN',languageGuideDismissed:true,revision:1}));
  const legacy=await store.get();assert.equal(legacy.speedStyle,null,'Older files have no style; renderers treat that as minimal');
  const language=create(null);assert.equal(language.normalizeSpeedStyle(legacy.speedStyle),'minimal');assert.equal(language.normalizeSpeedStyle('neon'),'minimal');
  await store.set({speedStyle:'cat'});await store.set({language:'en'});
  let saved=await new PreferencesStore({file}).get();assert.equal(saved.speedStyle,'cat');assert.equal(saved.language,'en');assert.equal(saved.languageGuideDismissed,true);
  await store.set({speedStyle:'minimal'});saved=await store.get();assert.equal(saved.speedStyle,'minimal');assert.equal(saved.language,'en');
  for(const input of [{speedStyle:'neon'},{speedStyle:null},{speedStyle:''},{speedStyle:'cat',theme:'x'}])await assert.rejects(store.set(input));
  await writeFile(file,JSON.stringify({schema:1,language:'en',speedStyle:'<script>',revision:3}));assert.equal((await store.get()).speedStyle,null,'Unknown stored styles are ignored, not trusted');
});

test('speed style controller saves choices, ignores stale polls and keeps a failed choice visible',async()=>{
  let fail=false,revision=1;const cached=[],changes=[];const language=create(null);
  const controller=language.connectSpeedStyle({initial:'cat',cache:value=>cached.push(value),changed:value=>changes.push(value),write:async input=>{
    await new Promise(resolve=>setTimeout(resolve,2));if(fail)throw new Error('Disk unavailable');return {language:null,speedStyle:input.speedStyle,revision:++revision};
  }});
  assert.equal(controller.style,'cat','A cached choice paints before the first preference read');
  controller.sync({language:null,speedStyle:null,revision:1});assert.equal(controller.style,'minimal');
  await controller.choose('cat');assert.equal(controller.style,'cat');assert.equal(controller.error,false);
  controller.sync({language:null,speedStyle:'minimal',revision:1});assert.equal(controller.style,'cat','A stale poll cannot undo a newer choice');
  fail=true;await controller.choose('minimal');assert.equal(controller.style,'minimal');assert.equal(controller.error,true);
  controller.sync({language:null,speedStyle:'cat',revision:99});assert.equal(controller.style,'minimal','An unsaved choice stays visible with its warning');
  fail=false;await controller.choose('minimal');assert.equal(controller.error,false);
  await controller.choose('neon');assert.equal(controller.style,'minimal');
  assert.deepEqual(cached.at(-1),'minimal');assert.ok(changes.length>=4);controller.dispose();
});

test('minimal sparkline geometry is right-aligned, bounded and ends on the latest sample',()=>{
  const language=create(null);
  assert.equal(language.minimalTrail([],{width:140,height:54}),null);
  const shape=language.minimalTrail([10,40,20,30],{width:140,height:54,top:6,bottom:2,right:4});
  assert.match(shape.line,/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){3}$/);assert.ok(shape.area.startsWith(shape.line)&&shape.area.endsWith('Z'));
  assert.equal(shape.end[0],136);
  const ys=[...shape.line.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m=>Number(m[2]));
  assert.ok(ys.every(y=>y>=6&&y<=52));assert.ok(ys[1]<ys[0],'Higher speed is drawn higher');assert.equal(shape.end[1],ys.at(-1));
  const single=language.minimalTrail([25],{width:120,height:44});assert.equal(single.line,'M105.5 22.2L116 22.2','A single sample draws a short flat segment ending at the latest point');
});

test('existing browser choice migrates once; durable preference overrides stale browser storage',async t=>{
  const {store}=await fixture(t);const old=create('zh-CN');await connect(old,store).ready;
  assert.equal((await store.get()).language,'zh-CN');await store.set({language:'en'});
  const stale=create('zh-CN');await connect(stale,store).ready;assert.equal(stale.language,'en');
});

test('atomic rapid writes persist the final choice and reject unrecognized values/keys',async t=>{
  const {store,directory}=await fixture(t);
  const values=await Promise.all(['zh-CN','en','zh-CN'].map(language=>store.set({language})));
  assert.ok(values[0].revision<values[1].revision&&values[1].revision<values[2].revision);
  for(const input of [{language:'zh'},{language:'../../other'},{language:'en',file:'other'},null,[]])await assert.rejects(store.set(input));
  assert.equal((await store.get()).language,'zh-CN');assert.deepEqual(await readdir(directory),['preferences.json']);
});

test('invalid files surface errors; failed replacement leaves the existing target intact',async t=>{
  const {store,file,directory}=await fixture(t);await writeFile(file,'not JSON');await assert.rejects(store.get());
  assert.ok((await store.snapshot()).error);assert.equal(await readFile(file,'utf8'),'not JSON');
  await store.set({language:'zh-CN'});assert.equal((await store.get()).language,'zh-CN');
  const blocked=join(directory,'blocked.json');await mkdir(blocked);const failed=new PreferencesStore({file:blocked});
  await assert.rejects(failed.set({language:'en'}));assert.deepEqual(await readdir(blocked),[]);
  assert.equal((await readdir(directory)).some(name=>name.endsWith('.tmp')),false);
});

test('a delayed startup read and stale polling response cannot undo a newer selection',async()=>{
  let resolve;const language=create(null);const pending=new Promise(done=>resolve=done);
  const controller=language.connectPreferences({read:()=>pending,write:async()=>({language:'zh-CN',revision:20})});
  await controller.choose('zh-CN');resolve({language:'en',revision:1});await controller.ready;
  controller.sync({language:'en',revision:1});assert.equal(language.language,'zh-CN');
  controller.sync({language:'en',revision:21});assert.equal(language.language,'en');controller.dispose();
});

test('rapid renderer toggles serialize writes; failed save is visible and can be retried',async()=>{
  let saved=null,revision=0,fail=false;const writes=[];const language=create(null);
  const controller=language.connectPreferences({read:async()=>({language:saved,revision}),cache:()=>{throw new Error('Storage blocked');},write:async input=>{
    await new Promise(resolve=>setTimeout(resolve,5));if(fail)throw new Error('Disk unavailable');
    saved=input.language;writes.push(saved);return {language:saved,revision:++revision};
  }});await controller.ready;
  const first=controller.toggle(),second=controller.toggle(),third=controller.toggle();
  controller.sync({language:'en',revision:100});await Promise.all([first,second,third]);
  assert.deepEqual(writes,['zh-CN','en','zh-CN']);assert.equal(saved,'zh-CN');assert.equal(language.language,'zh-CN');
  fail=true;await controller.choose('en');assert.equal(language.language,'en');assert.equal(controller.error,true);assert.equal(saved,'zh-CN');
  controller.sync({language:saved,revision});assert.equal(language.language,'en');assert.equal(controller.error,true);
  fail=false;await controller.choose('en');assert.equal(controller.error,false);assert.equal(saved,'en');
});

test('usageScope persists independently, defaults cleanly and validates choices',async t=>{
  const {file,store}=await fixture(t);
  const language=create(null);assert.equal(language.normalizeUsageScope(undefined),'local');assert.equal(language.normalizeUsageScope('account'),'account');assert.equal(language.normalizeUsageScope('bad'),'local');
  await store.set({usageScope:'account'});
  let saved=await new PreferencesStore({file}).get();assert.equal(saved.usageScope,'account');assert.equal(saved.language,null);
  await store.set({language:'zh-CN'});await store.set({usageScope:'local'});
  saved=await new PreferencesStore({file}).get();assert.equal(saved.usageScope,'local');assert.equal(saved.language,'zh-CN');
  for(const bad of [{usageScope:'all'},{usageScope:null},{usageScope:''},{usageScope:'local',extra:'x'}])await assert.rejects(store.set(bad));
  let revision=1,fail=false;
  const scopeCtrl=language.connectUsageScope({initial:'account',write:async input=>{if(fail)throw Error('io');return {language:null,usageScope:input.usageScope,revision:++revision};}});
  assert.equal(scopeCtrl.scope,'account');
  await scopeCtrl.choose('local');assert.equal(scopeCtrl.scope,'local');assert.equal(scopeCtrl.error,false);
  scopeCtrl.sync({language:null,usageScope:'account',revision:1});assert.equal(scopeCtrl.scope,'local');
  fail=true;await scopeCtrl.choose('account');assert.equal(scopeCtrl.scope,'account');assert.equal(scopeCtrl.error,true);
  scopeCtrl.dispose();
});

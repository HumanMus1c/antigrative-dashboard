import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {quotaMetrics} from '../metrics.mjs';
const createI18n=createRequire(import.meta.url)('../../../compat/i18n.cjs');
const gemini={id:'gemini',name:'Gemini'},argon={id:'opaque-premium',name:'Gemini 4 Argon'},third={id:'3p',name:'Claude / GPT'};

test('quota labels and selection agree across IDs, display names and order in all languages',()=>{
 for(const locale of ['en','zh-CN','zh-TW']){
  const ui=createI18n(locale);
  for(const group of [argon,{id:'gemini-argon',name:'Premium quota'},{id:'group-1',name:'Gemini 4 Argon'}]){
   assert.equal(ui.quotaGroupLabel(group),'Gemini (Argon)');
   for(const groups of [[gemini,group,third],[group,third,gemini]]){
    assert.equal(ui.chooseQuotaGroup(groups,'Gemini 4 Argon').id,group.id);
    assert.equal(ui.chooseQuotaGroup(groups,'Gemini Flash').id,'gemini');
    assert.equal(ui.chooseQuotaGroup(groups,'Gemini 4 Hydrogen (XHigh)').id,'gemini');
    assert.equal(ui.chooseQuotaGroup(groups,'Orchestrator (Carbon)').id,'gemini');
    assert.equal(ui.chooseQuotaGroup(groups,'GPT-5').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'Claude Sonnet').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'Claude Sonnet 4.5').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'Opus 4.6').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'Haiku 4.5').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'o3').id,'3p');
   }
  }
 }
});

test('an opaque quota group from the real normalizer is selected using its display name',()=>{
 const groups=quotaMetrics({groups:[{displayName:'Gemini',buckets:[{bucketId:'gemini-5h',remainingFraction:.8,window:'5h'}]},
  {displayName:'Gemini 4 Argon',buckets:[{window:'5h',remainingFraction:.2}]}]});
 const selected=createI18n('en').chooseQuotaGroup(groups,'Gemini 4 Argon');
 assert.equal(selected.id,'group-1');assert.equal(selected.windows['5h'].remaining,.2);
});

test('shared Gemini remains shared without an Argon bucket, manual selection is retained and models recompute',()=>{
 const ui=createI18n('en'),groups=[gemini,argon,third];
 assert.equal(ui.chooseQuotaGroup([gemini],'Gemini 4 Argon'),gemini);
 assert.equal(ui.quotaGroupLabel(ui.chooseQuotaGroup([gemini],'Gemini 4 Argon')),'Gemini');
 assert.equal(ui.chooseQuotaGroup([{id:'unknown',name:'Other'}],'Gemini 4 Argon'),null);
 assert.equal(ui.chooseQuotaGroup([argon],'Gemini Flash'),null);
 assert.equal(ui.chooseQuotaGroup(groups,'Gemini 4 Argon','gemini'),gemini);
 assert.equal(ui.chooseQuotaGroup(groups,'Gemini 4 Argon','deleted'),argon);
 assert.equal(ui.chooseQuotaGroup(groups,['Choose model','Gemini 4 Argon','Gemini Flash']),argon);
 assert.equal(ui.chooseQuotaGroup(groups,['Choose model','Select','Claude Sonnet']),third);
 assert.equal(ui.chooseQuotaGroup(groups,'Gemini Flash'),gemini);
 assert.equal(ui.chooseQuotaGroup([],'Gemini 4 Argon'),null);
});

test('real Argon weekly bucket renders one window and does not invent a five-hour allowance',()=>{
 const groups=quotaMetrics({response:{groups:[{displayName:'Gemini 4 Argon',buckets:[{
  bucketId:'gemini-argon-wtu-weekly',window:'weekly',remainingFraction:.17,resetTime:'2026-11-08T00:00:00Z'}]}]}});
 for(const locale of ['en','zh-CN','zh-TW']){
  const ui=createI18n(locale),group=ui.chooseQuotaGroup(groups,'Gemini 4 Argon');
  assert.equal(group.id,'gemini-argon-wtu');assert.equal(group.windows.weekly.remaining,.17);
  assert.deepEqual(ui.quotaWindows(group),['weekly']);assert.equal(group.windows['5h'].available,false);
  assert.match(ui.t('argonWeek'),/Argon/);
  assert.deepEqual(ui.quotaWindows(null),['5h','weekly']);
 }
});

test('unknown families keep their host labels and generic/no-model state can show account quota',()=>{
 const ui=createI18n('en'),unknown={id:'custom-vendor',name:'Custom model quota'};
 assert.equal(ui.quotaGroupLabel(unknown),'Custom model quota');
 assert.equal(ui.quotaGroupKind({id:'argonish',name:'ArgonDB'}),null);
 assert.equal(ui.chooseQuotaGroup([unknown,gemini],''),unknown);
 assert.equal(ui.quotaGroupLabel(null),'—');
});

test('disabled and unknown quota never become spendable balances; exhausted remains zero',()=>{
 const ui=createI18n('en');
 assert.equal(ui.quotaRemaining({available:true,remaining:0}),0);
 assert.equal(ui.quotaRemaining({available:true,disabled:true,remaining:1}),null);
 for(const remaining of [null,undefined,'1',NaN,-1,2])assert.equal(ui.quotaRemaining({available:true,remaining}),null);
});

test('quotaForecast and groupQuotaPace estimate depletion, pace deltas and warm-up across languages',()=>{
 const now=Date.UTC(2026,10,15,8,0,0),weekMs=604800000,fiveMs=18000000;
 for(const locale of ['en','zh-CN','zh-TW']){
  const ui=createI18n(locale);
  const overspeed={available:true,remaining:.638,resetAt:new Date(now+Math.round(weekMs*.702)).toISOString()};
  const fast=ui.quotaForecast(overspeed,'weekly',now);
  assert.equal(fast.pace,'fast');assert.ok(Math.abs(fast.paceDelta-(-.064))<1e-3);
  assert.equal(fast.forecastReady,true);assert.equal(fast.willExhaust,true);
  assert.equal(fast.projectedUsed,1);assert.equal(fast.projectedRemaining,0);assert.ok(fast.exhaustInMs>0);
  assert.equal(fast.outlook,'exhaust');
  assert.ok(Math.abs(fast.earlyByMs-(Math.round(weekMs*.702)-fast.exhaustInMs))<1000,'earlyByMs is the gap between depletion and reset');
  const comfy={available:true,remaining:.734,resetAt:new Date(now+Math.round(fiveMs*.4)).toISOString()};
  const slow=ui.quotaForecast(comfy,'5h',now);
  assert.equal(slow.pace,'slow');assert.equal(slow.forecastReady,true);assert.equal(slow.willExhaust,false);
  assert.ok(Math.abs(slow.projectedUsed-.266/.6)<1e-3);assert.ok(Math.abs(slow.projectedRemaining-(1-.266/.6))<1e-3);
  assert.equal(slow.outlook,'ok');assert.equal(slow.earlyByMs,null);
  const linear={available:true,remaining:.5,resetAt:new Date(now+Math.round(fiveMs*.5)).toISOString()};
  const steady=ui.quotaForecast(linear,'5h',now);
  assert.equal(steady.pace,'steady');assert.ok(Math.abs(steady.projectedUsed-1)<1e-3);assert.equal(steady.willExhaust,false);
  assert.equal(steady.outlook,'tight','Reaching about zero exactly at reset is tight, not comfortable');
  const warmup={available:true,remaining:.99,resetAt:new Date(now+weekMs-120000).toISOString()};
  const warm=ui.quotaForecast(warmup,'weekly',now);
  assert.equal(warm.warmingUp,true);assert.equal(warm.forecastReady,false);assert.equal(warm.outlook,null);
  const idle={available:true,remaining:1,resetAt:new Date(now+fiveMs).toISOString()};
  assert.equal(ui.quotaForecast(idle,'5h',now).pace,'idle');assert.equal(ui.quotaForecast(idle,'5h',now).outlook,'idle');
  assert.equal(ui.quotaForecast({available:true,remaining:.4,resetAt:new Date(now-1000).toISOString()},'5h',now),null);
  assert.equal(ui.quotaForecast({available:true,disabled:true,remaining:.4,resetAt:new Date(now+1000).toISOString()},'5h',now),null);
  const pace=ui.groupQuotaPace({id:'gemini',name:'Gemini',windows:{'5h':comfy,weekly:overspeed}},now);
  assert.equal(pace.pace,'exhaust');assert.equal(pace.window,'weekly');
  assert.equal(pace.label,ui.t('outlookExhaust'));
  assert.equal(ui.groupQuotaPace({id:'gemini',name:'Gemini',windows:{'5h':comfy}},now).pace,'ok');
  assert.equal(ui.groupQuotaPace({id:'gemini',name:'Gemini',windows:{'5h':linear,weekly:warmup}},now).pace,'tight');
  assert.equal(ui.groupQuotaPace({id:'gemini',name:'Gemini',windows:{weekly:warmup}},now),null,'A window still warming up has no conclusion yet');
  assert.equal(ui.groupQuotaPace({id:'gemini',name:'Gemini',windows:{'5h':idle}},now).pace,'idle');
 }
});

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
    assert.equal(ui.chooseQuotaGroup(groups,'GPT-5').id,'3p');
    assert.equal(ui.chooseQuotaGroup(groups,'Claude Sonnet').id,'3p');
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

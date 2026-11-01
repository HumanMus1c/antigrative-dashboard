import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaMetrics} from '../metrics.mjs';

// Shape observed in a paid-Pro summary, documented with the upstream adapter:
// https://github.com/Draculabo/AntigravityManager/pull/369
const reset='2026-11-07T06:50:31Z';
const argonBucket={bucketId:'gemini-argon-wtu-weekly',displayName:'Gemini 4 Argon Weekly Limit',window:'weekly',remainingFraction:.42,resetTime:reset};
const argonGroup=bucket=>({displayName:'Gemini 4 Argon',description:'For paid Pro plans, Argon quota is separate.',buckets:[bucket]});
const gemini={displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',window:'5h',remainingFraction:.8,resetTime:reset},{bucketId:'gemini-weekly',window:'weekly',remainingFraction:.7,resetTime:reset}]};

test('the returned Argon weekly bucket stays separate from shared Gemini and has no invented 5h window',()=>{
  const groups=quotaMetrics({response:{groups:[gemini,argonGroup(argonBucket)]}},Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(groups.length,2);assert.equal(groups[0].id,'gemini');assert.equal(groups[0].windows.weekly.remaining,.7);
  const argon=groups[1];assert.equal(argon.id,'gemini-argon-wtu');assert.equal(argon.name,'Gemini 4 Argon');
  assert.equal(argon.windows['5h'].available,false);assert.equal(argon.windows['5h'].remaining,undefined);
  assert.equal(argon.windows.weekly.available,true);assert.equal(argon.windows.weekly.id,'gemini-argon-wtu-weekly');
  assert.equal(argon.windows.weekly.remaining,.42);assert.equal(argon.windows.weekly.resetAt,'2026-11-07T06:50:31.000Z');
  assert.equal(argon.windows.weekly.expired,false);
});

test('a shared-only summary remains shared without fabricating an Argon group',()=>{
  const groups=quotaMetrics({groups:[gemini]});assert.equal(groups.length,1);assert.equal(groups[0].id,'gemini');
  assert.equal(groups[0].windows['5h'].remaining,.8);
});

test('flat and nested fraction values retain true zero and reject coercion-shaped values',()=>{
  for(const nested of [false,true]){
    for(const value of [0,'0',.42,'0.42',1]){
      const bucket={...argonBucket};delete bucket.remainingFraction;
      if(nested)bucket.remaining={remainingFraction:value};else bucket.remainingFraction=value;
      assert.equal(quotaMetrics({groups:[argonGroup(bucket)]})[0].windows.weekly.remaining,Number(value));
    }
    for(const value of [undefined,null,'',' ',false,true,[],{},NaN,Infinity,-.1,1.01,'0x1','not-a-number']){
      const bucket={...argonBucket};delete bucket.remainingFraction;
      if(nested)bucket.remaining={remainingFraction:value};else bucket.remainingFraction=value;
      assert.equal(quotaMetrics({groups:[argonGroup(bucket)]})[0].windows.weekly.remaining,null);
    }
  }
});

test('canonical flat fields remain authoritative when a nested adapter value conflicts',()=>{
  const bucket={...argonBucket,remainingFraction:null,remainingAmount:0,remaining:{remainingFraction:.5,remainingAmount:9}};
  const quota=quotaMetrics({groups:[argonGroup(bucket)]})[0].windows.weekly;
  assert.equal(quota.remaining,null);assert.equal(quota.amount,0);
  delete bucket.remainingFraction;delete bucket.remainingAmount;
  const nested=quotaMetrics({groups:[argonGroup(bucket)]})[0].windows.weekly;
  assert.equal(nested.remaining,.5);assert.equal(nested.amount,9);
});

test('flat quota summaries preserve each independent bucket family in either order',()=>{
  for(const buckets of [[...gemini.buckets,argonBucket],[argonBucket,...gemini.buckets]]){
    const groups=quotaMetrics({buckets});assert.equal(groups.length,2);
    const argon=groups.find(g=>g.id==='gemini-argon-wtu');assert.equal(argon.windows.weekly.remaining,.42);assert.equal(argon.windows['5h'].available,false);
    assert.equal(groups.find(g=>g.id==='gemini').windows.weekly.remaining,.7);
  }
});

test('unrecognized explicit periods do not become weekly because of a suffix, and invalid reset times remain unknown',()=>{
  const malformed=quotaMetrics({groups:[argonGroup({...argonBucket,window:'monthly'})]})[0];
  assert.equal(malformed.windows.weekly.available,false);assert.equal(malformed.windows['5h'].available,false);
  const noPeriod={...argonBucket};delete noPeriod.window;
  assert.equal(quotaMetrics({groups:[argonGroup(noPeriod)]})[0].windows.weekly.available,true);
  for(const resetTime of [undefined,null,0,'0','',{},'not-a-date']){
    const parsed=quotaMetrics({groups:[argonGroup({...argonBucket,resetTime,disabled:true})]})[0].windows.weekly;
    assert.equal(parsed.resetAt,null);assert.equal(parsed.expired,false);assert.equal(parsed.disabled,true);
  }
});

test('malformed quota envelopes and entries fail empty or unavailable instead of throwing',()=>{
  for(const input of [null,undefined,{},[],{response:null},{groups:'bad'},{groups:[null,5,[]]},{buckets:[null,7,[]]}])assert.deepEqual(quotaMetrics(input),[]);
  const groups=quotaMetrics({groups:[{displayName:'Gemini 4 Argon',buckets:'bad'}]});
  assert.equal(groups[0].windows.weekly.available,false);
});

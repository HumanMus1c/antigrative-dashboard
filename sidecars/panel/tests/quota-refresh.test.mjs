import test from 'node:test';
import assert from 'node:assert/strict';
import {MetricsStore} from '../store.mjs';

test('manual quota refresh uses the host forceRefresh field while automatic polling keeps its cache',async t=>{
 const calls=[];
 const client={resetTrajectories(){},async call(method,body){
  if(method==='GetUserStatus')return {userStatus:{email:'quota-fixture@example.test'}};
  assert.equal(method,'RetrieveUserQuotaSummary');calls.push(body);
  return {response:{groups:[{displayName:'Gemini 4 Argon',buckets:[{bucketId:'gemini-argon-wtu-weekly',window:'weekly',remainingFraction:.4}]}]}};
 }};
 const store=new MetricsStore(client,{history:{},background:null,transcripts:{reset(){}}});t.after(()=>store.dispose());
 await store.refreshQuota();await store.refreshQuota();assert.deepEqual(calls,[{}]);
 await Promise.all([store.refreshQuota(true),store.refreshQuota(true)]);
 assert.deepEqual(calls,[{},{forceRefresh:true}]);
 assert.equal(store.quota[0].windows.weekly.remaining,.4);assert.equal(store.quota[0].windows['5h'].available,false);
});

test('hover quotaRefresh forces quota RPC while keeping fresh session cache intact',async t=>{
 const quotaCalls=[],id='11111111-1111-1111-1111-111111111111';let trajectoryCalls=0;
 const client={resetTrajectories(){},async discover(){return {pid:1};},
  async trajectory(cid){trajectoryCalls++;return {trajectory:{cascadeId:cid,steps:[],generatorMetadata:[]}};},
  async call(method,body){
   if(method==='GetUserStatus')return {userStatus:{email:'quota-fixture@example.test'}};
   assert.equal(method,'RetrieveUserQuotaSummary');quotaCalls.push(body);
   return {response:{groups:[{displayName:'Gemini',buckets:[{bucketId:'gemini-5h',window:'5h',remainingFraction:.8}]}]}};
  }};
 const store=new MetricsStore(client,{history:{load:async()=>null,save:async()=>({savedAt:'2026-11-15T00:00:00Z'})},background:null,transcripts:null});
 t.after(()=>store.dispose());
 await store.snapshot({conversationId:id});
 await store.snapshot({conversationId:id,quotaRefresh:true});
 assert.deepEqual(quotaCalls,[{},{forceRefresh:true}]);
 assert.equal(trajectoryCalls,1);
});

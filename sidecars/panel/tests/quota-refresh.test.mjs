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

import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {RuntimeUi,makeRendererSource} from '../../compat/runtime-ui.mjs';

const url='http://127.0.0.1:5200/c/11111111-1111-1111-1111-111111111111?extensionView=true&extensionVariant=vs-code';
const nestedTarget=()=>({id:'agent-target',type:'iframe',url,webSocketDebuggerUrl:'ws://127.0.0.1:9123/devtools/page/agent-target',ideWebview:true,expectedFrameId:'agent-frame',expectedParentId:'wrapper-frame',expectedUrl:url,workbenchId:'workbench-one'});
const contextEvent=(id=7,frameId='agent-frame',origin='http://127.0.0.1:5200',isDefault=true)=>({method:'Runtime.executionContextCreated',params:{context:{id,origin,auxData:{isDefault,frameId}}}});
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(overrides={}){
 const state={targets:[nestedTarget()],frame:{id:'agent-frame',parentId:'wrapper-frame',url},calls:0,received:[],onCommand:null,snapshot:null},connections=[];
 class Connection{
  constructor(options){this.options=options;this.calls=[];this.closed=false;}
  async open(){return this;}
  async command(method,params={}){
   this.calls.push({method,params});
   if(state.onCommand)await state.onCommand(this,method,params);
   if(method==='Page.getFrameTree')return {frameTree:{frame:{...state.frame}}};
   if(method==='Runtime.enable'){this.options.onEvent(contextEvent(7,state.frame.id));await Promise.resolve();}
   if(method==='Page.addScriptToEvaluateOnNewDocument')return {identifier:'preload'};
   if(method==='Runtime.evaluate')return {result:{value:{mounted:true,installed:true,bridge:true}}};
   return {};
  }
  close(){this.closed=true;}
 }
 const ui=new RuntimeUi({owner:'ide-owner',source:'legacy-widget()',sourceForTarget:t=>t.ideWebview?'nested-widget()':'legacy-widget()',targetOrigin:t=>new URL(t.url).origin,discover:async()=>state.targets,snapshot:async input=>{state.calls++;state.received.push(input);return state.snapshot?state.snapshot(input):{connection:'live',groups:[],speed:null};},connect:(_url,options)=>{const c=new Connection(options);connections.push(c);return c;},...overrides});
 const request=(c,contextId=7,id=1,type='metrics',input={conversationId:null})=>ui.event(c,{method:'Runtime.bindingCalled',params:{name:ui.binding,executionContextId:contextId,payload:JSON.stringify({id,type,input})}});
 return {ui,state,connections,request};
}
const replies=c=>c.calls.filter(x=>x.method==='Runtime.evaluate'&&x.params.expression?.includes('__agPulseRuntimeBridge?.resolve('));

test('nested bridge is an explicit boolean opt-in while ordinary App sources remain top-only',async()=>{
 const i18n='module.exports = function(){return {};};',widget='module.exports = function(){window.widgetHasBridge=Boolean(window.agPulseHost);};';
 for(const [nested,allowNested,expected]of [[true,false,false],[true,true,true],[true,'true',false],[false,false,true]]){
  const window={};window.top=nested?{}:window;const sent=[];window.__agPulseRuntimeCallV4=p=>sent.push(JSON.parse(p));
  runInNewContext(makeRendererSource(i18n,widget,'',null,0,'',{allowNested}),{window,setTimeout,clearTimeout});
  assert.equal(Boolean(window.agPulseHost),expected);
  if(expected){const pending=window.agPulseHost.getMetrics({conversationId:null});assert.equal(sent[0].type,'metrics');window.__agPulseRuntimeBridge.resolve(sent[0].id,{connection:'live'});assert.equal((await pending).connection,'live');window.__agPulseRuntimeBridge.dispose();}
 }
});

test('proved nested frame receives exact-url guarded source without a persistent preload',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 assert.equal(f.ui.health.state,'mounted');assert.deepEqual([...c.contexts],[7]);
 assert.equal(c.calls.some(x=>x.method==='Page.addScriptToEvaluateOnNewDocument'),false);
 assert.match(c.guardedSource,/location\.href ===/);assert.ok(c.guardedSource.includes(JSON.stringify(url)));assert.match(c.guardedSource,/nested-widget/);
 await f.request(c);assert.equal(f.state.calls,1);assert.equal(replies(c).length,1);assert.equal(replies(c)[0].params.contextId,7);
});

test('nested attachment rejects changed frame, parent or URL before exposing bindings',async t=>{
 for(const [field,value]of [['id','another-frame'],['parentId','other-wrapper'],['url',url.replace('/c/','/artifact/')],['url',url+'&changed=true']])await t.test(field+':'+value,async()=>{
  const f=fixture();f.state.frame[field]=value;await assert.rejects(f.ui.attach(f.state.targets[0]),/frame changed/);const c=f.connections[0];assert.equal(c.closed,true);assert.equal(c.calls.some(x=>x.method==='Runtime.addBinding'),false);assert.equal(c.calls.some(x=>x.params.expression?.includes('nested-widget')),false);
 });
});

test('isolated worlds, another frame and another origin cannot request metrics or preferences',async t=>{
 const writes=[];const f=fixture({preferences:{get:async()=>({language:'en'}),set:async v=>(writes.push(v),v)}});t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 for(const e of [contextEvent(8,'agent-frame','http://127.0.0.1:5200',false),contextEvent(9,'other-frame'),contextEvent(10,'agent-frame','https://example.com')])await f.ui.event(c,e);
 for(const id of [8,9,10,99]){await f.request(c,id);await f.request(c,id,2,'preferences',{language:'zh-CN'});}
 assert.equal(f.state.calls,0);assert.deepEqual(writes,[]);assert.deepEqual([...c.contexts],[7]);
 await f.request(c,7,3,'preferences',{language:'zh-CN'});assert.deepEqual(writes,[{language:'zh-CN'}]);
});

test('same-origin navigation revokes nested context and suppresses a late metrics response',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0],pending=Promise.withResolvers();f.state.snapshot=()=>pending.promise;
 const request=f.request(c);await turn();assert.equal(f.state.calls,1);
 await f.ui.event(c,{method:'Page.frameNavigated',params:{frame:{id:'agent-frame',parentId:'wrapper-frame',url:url.replace('11111111','22222222')}}});
 assert.equal(c.revoked,true);assert.equal(c.contexts.size,0);
 pending.resolve({connection:'live',groups:[],speed:{tps:123}});await request;assert.equal(replies(c).length,0);
 await f.ui.event(c,contextEvent(11));await f.request(c,11);assert.equal(f.state.calls,1,'New context needs a fresh ownership proof');
});

test('destroyed or detached nested documents cannot retain access or late error delivery',async t=>{
 for(const event of [{method:'Runtime.executionContextDestroyed',params:{executionContextId:7}},{method:'Runtime.executionContextsCleared'},{method:'Page.frameDetached',params:{frameId:'agent-frame'}}])await t.test(event.method,async()=>{
  const f=fixture();await f.ui.tick();const c=f.connections[0],pending=Promise.withResolvers();f.state.snapshot=()=>pending.promise;
  const request=f.request(c);await turn();await f.ui.event(c,event);pending.reject(Error('old response'));await request;
  assert.equal(c.revoked,true);assert.equal(replies(c).length,0);await f.request(c);assert.equal(f.state.calls,1);await f.ui.stop();
 });
});


test('a late preferences reply is discarded after the verified context is destroyed',async t=>{
 const pending=Promise.withResolvers();const f=fixture({preferences:{get:()=>pending.promise}});t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 const request=f.request(c,7,4,'preferences',{});await turn();
 await f.ui.event(c,{method:'Runtime.executionContextDestroyed',params:{executionContextId:7}});
 pending.resolve({language:'zh-CN',revision:3});await request;assert.equal(replies(c).length,0);
});

test('a changed proof replaces the old session even when debugger endpoint is reused',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const old=f.connections[0];
 f.state.targets=[{...f.state.targets[0],expectedParentId:'new-wrapper',workbenchId:'workbench-two'}];f.state.frame.parentId='new-wrapper';await f.ui.tick();
 assert.equal(old.closed,true);assert.equal(f.connections.length,2);assert.equal(f.ui.sessions.size,1);assert.ok(old.calls.some(x=>x.method==='Runtime.removeBinding'));
 assert.equal(old.calls.some(x=>x.method==='Page.addScriptToEvaluateOnNewDocument'),false);await f.request(f.connections[1]);assert.equal(f.state.calls,1);
});

test('removing the nested target disposes only its widget and removes its binding',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const old=f.connections[0];f.state.targets=[];await f.ui.tick();
 assert.equal(f.ui.sessions.size,0);assert.equal(old.closed,true);assert.equal(f.ui.health.state,'waiting');assert.ok(old.calls.some(x=>x.params.expression?.includes('window.__agPulseDispose')));assert.ok(old.calls.some(x=>x.method==='Runtime.removeBinding'&&x.params.name===f.ui.binding));
 await f.request(old);assert.equal(f.state.calls,0);
});

test('navigation during nested attach cannot install hooks from a stale proof',async()=>{
 const f=fixture();f.state.onCommand=async(c,method)=>{if(method==='Runtime.enable')await f.ui.event(c,{method:'Page.frameNavigated',params:{frame:{...f.state.frame}}});};
 await assert.rejects(f.ui.attach(f.state.targets[0]),/changed|revoked|context|navigat/i);
 const c=f.connections[0];assert.equal(c.closed,true);assert.equal(c.calls.some(x=>x.params.expression?.includes('nested-widget')),false);
});

test('same-document route changes revoke nested authorization before the next discovery',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 await f.ui.event(c,{method:'Page.navigatedWithinDocument',params:{frameId:'agent-frame',url:'http://127.0.0.1:5200/settings-standalone'}});
 await f.request(c);assert.equal(f.state.calls,0);assert.equal(c.revoked,true);
});

test('navigation revokes synchronously while an older binding waits for ownership',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 const ownership=Promise.withResolvers();let reads=0;
 f.ui.owns=()=>{reads++;return ownership.promise;};
 const priorBinding=f.request(c);assert.equal(reads,1,'First request must be suspended on ownership');
 const navigation=f.ui.event(c,{method:'Page.frameNavigated',params:{frame:{...f.state.frame}}});
 // Do not await either promise here: revocation must happen synchronously in
 // protocol event order, even when a storage/ownership read is still pending.
 assert.equal(c.revoked,true);assert.equal(c.contexts.size,0);assert.equal(reads,1,'Revocation must not await ownership');
 const laterBinding=f.request(c);assert.equal(reads,1,'A subsequent binding must be rejected before another ownership read');
 ownership.resolve(true);await Promise.all([priorBinding,navigation,laterBinding]);
 assert.equal(f.state.calls,0);assert.equal(replies(c).length,0);
});

test('replacement root frame with the same verified parent revokes the old document',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 const pending=Promise.withResolvers();f.state.snapshot=()=>pending.promise;const request=f.request(c);await turn();
 await f.ui.event(c,{method:'Page.frameNavigated',params:{frame:{id:'replacement-agent-root',parentId:'wrapper-frame',url}}});
 assert.equal(c.revoked,true);assert.equal(c.contexts.size,0);assert.ok(c.retiredContexts.has(7));
 await f.ui.event(c,contextEvent(8,'replacement-agent-root'));await f.request(c,8);assert.equal(f.state.calls,1,'Replacement needs a new proof');
 pending.resolve({connection:'live',groups:[],speed:null});await request;assert.equal(replies(c).length,0);
});

test('same-document route teardown disposes the retired bridge and removes its binding',async t=>{
 const f=fixture();t.after(()=>f.ui.stop());await f.ui.tick();const c=f.connections[0];
 const pending=Promise.withResolvers();f.state.snapshot=()=>pending.promise;const request=f.request(c);await turn();
 await f.ui.event(c,{method:'Page.navigatedWithinDocument',params:{frameId:'agent-frame',url:'http://127.0.0.1:5200/settings-standalone'}});
 assert.equal(c.contexts.size,0);assert.deepEqual([...c.retiredContexts],[7]);
 f.state.targets=[];await f.ui.tick();assert.equal(c.closed,true);assert.equal(f.ui.sessions.size,0);
 const cleanup=c.calls.filter(x=>x.method==='Runtime.evaluate'&&x.params.expression?.includes('window.__agPulseDispose'));
 assert.equal(cleanup.length,1);assert.equal(cleanup[0].params.contextId,7,'Only the retired authorized context is cleanup-eligible');
 assert.match(cleanup[0].params.expression,/__agPulseRuntimeBridge\?\.dispose\(\)/);assert.match(cleanup[0].params.expression,/delete window\.agPulseHost/);
 assert.equal(c.calls.filter(x=>x.method==='Runtime.removeBinding'&&x.params.name===f.ui.binding).length,1);
 assert.equal(c.calls.some(x=>x.method==='Page.addScriptToEvaluateOnNewDocument'),false);
 pending.resolve({connection:'live',groups:[],speed:null});await request;assert.equal(replies(c).length,0);
});

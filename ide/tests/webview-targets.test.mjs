import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverIdeWebviews} from '../webview-targets.mjs';

const port=9000,app='/d:/IDE/resources/app',uuid='11111111-1111-1111-1111-111111111111';
const wrapperOrigin='vscode-webview://fixture-host';
const wrapperUrl=wrapperOrigin+'/index.html?id='+uuid+'&parentId=1&origin='+uuid+'&extensionId=&platform=electron&parentOrigin=vscode-file%3A%2F%2Fvscode-app&purpose=webviewView';
const backend='http://127.0.0.1:7000/?extensionView=true&extensionVariant=vs-code&useWebSocket=true&platform=electron';
const bridge='https://file+.vscode-resource.vscode-cdn.net'+app+'/extensions/agy/bridge.js';
const target=(id,type,url)=>({id,type,url,webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/${id}`});
function fixture(){
  const wb=target('workbench','page','vscode-file://vscode-app'+app+'/out/vs/code/electron-browser/workbench/workbench.html');
  const wrapper=target('wrapper','iframe',wrapperUrl),inner=target('jetski','iframe',backend);
  const state={targets:[wb,wrapper,inner],workbenches:[wb],port,overlays:[{url:wrapperUrl,id:uuid}],contexts:[{id:1,origin:wrapperOrigin,auxData:{isDefault:true,frameId:'wrapper'}},{id:2,origin:wrapperOrigin,auxData:{isDefault:true,frameId:'content'}}],content:{host:'antigravity',url:backend,scripts:[bridge]},tree:{frame:{id:'wrapper',url:wrapperUrl},childFrames:[{frame:{id:'content',parentId:'wrapper',url:wrapperOrigin+'/fake.html'},childFrames:[{frame:{id:'jetski',parentId:'content',url:backend}}]}]},connections:[],evaluations:0};
  state.connect=(url,options)=>{
    const isMain=url===wb.webSocketDebuggerUrl,isWrapper=url===wrapper.webSocketDebuggerUrl;
    const connection={closed:false,options,calls:[],async open(){if(state.openFails)throw Error('Private URL must not be exposed');return this;},async command(method,params={}){
      this.calls.push({method,params});
      if(method==='Runtime.enable')for(const context of state.contexts)options.onEvent({method:'Runtime.executionContextCreated',params:{context}});
      if(method==='Page.getFrameTree'){
        if(isWrapper)return {frameTree:state.tree};
        const id=url.split('/').at(-1),find=node=>node.frame.id===id?node:(node.childFrames||[]).map(find).find(Boolean);
        return {frameTree:state.childTree||find(state.tree)};
      }
      if(method==='DOM.getFrameOwner')return {backendNodeId:state.ownerNode??4};
      if(method==='DOM.describeNode')return {node:state.ownerElement||{localName:'iframe',attributes:['id','jetski-frame','src',state.content.url]}};
      if(method==='Runtime.evaluate'){
        state.evaluations++;
        if(isMain)return {result:{value:state.overlays}};
        return {result:{value:params.contextId===2?state.content:null}};
      }
      return {};
    },close(){this.closed=true;}};
    state.connections.push(connection);return connection;
  };
  return state;
}
const scan=state=>discoverIdeWebviews(state);
test('IDE discovery authorizes only the Agent-owned, official-wrapper Jetski child',async()=>{
 const f=fixture(),result=await scan(f);
 assert.equal(result.length,1);
 assert.deepEqual(result[0],{...f.targets[2],ideWebview:true,expectedFrameId:'jetski',expectedParentId:'content',expectedUrl:backend,workbenchId:'workbench'});
 assert.ok(f.connections.every(c=>c.closed));
 assert.deepEqual([...new Set(f.connections.flatMap(c=>c.calls.map(x=>x.method)))].sort(),['DOM.describeNode','DOM.getFrameOwner','Page.getFrameTree','Runtime.enable','Runtime.evaluate']);
 assert.equal(f.connections.some(c=>c.calls.some(x=>/addBinding|addScript/.test(x.method))),false);
});
test('real Chromium OOPIF layout proves omitted child using its parent and DOM owner',async()=>{
 const f=fixture();f.childTree=f.tree.childFrames[0].childFrames[0];delete f.tree.childFrames[0].childFrames;
 assert.equal((await scan(f)).length,1);
 for(const ownerElement of [{localName:'div',attributes:['id','jetski-frame','src',backend]},{localName:'iframe',attributes:['id','other-frame','src',backend]},{localName:'iframe',attributes:['id','jetski-frame','src',backend.replace(':7000',':7001')]}]){
   f.ownerElement=ownerElement;assert.deepEqual(await scan(f),[]);
 }
});
test('legacy or unready workbench is skipped without preventing native target discovery',async()=>{
 for(const modify of [f=>{f.overlays=[];},f=>{f.content=null;},f=>{f.openFails=true;},f=>{f.contexts=[];}]){
  const f=fixture();modify(f);assert.deepEqual(await scan(f),[]);assert.ok(f.connections.every(c=>c.closed));
 }
});
test('unrelated, ambiguous and spoofed Webviews do not receive authorization',async()=>{
 const cases=[
  f=>{f.overlays.push({...f.overlays[0]});},
  f=>{f.overlays[0].id='wrong-uuid';},
  f=>{f.targets[1].url=wrapperUrl.replace('extensionId=','extensionId=other.extension');f.overlays[0].url=f.targets[1].url;},
  f=>{f.targets[1].url=wrapperUrl.replace('purpose=webviewView','purpose=editor');f.overlays[0].url=f.targets[1].url;},
  f=>{f.workbenches.push({...f.workbenches[0]});},
  f=>{f.targets.push({...f.targets[1]});},
  f=>{f.content.host='other';},
  f=>{f.content.scripts=['https://attacker.example/bridge.js'];},
  f=>{f.content.scripts=[bridge.replace('/d:/IDE/','/d:/OTHER/')];},
  f=>{f.content.scripts=[bridge.replace('/extensions/agy/','/extensions/not-agy/')];},
  f=>{f.content.scripts=[bridge+'?source=forged'];},
  f=>{f.content.scripts=[bridge.replace('file+.','https+.')];},
 ];
 for(const modify of cases){const f=fixture();modify(f);assert.deepEqual(await scan(f),[]);}
});
test('child proof requires its own frame, parent and same bounded loopback transport',async()=>{
 const cases=[
  f=>{f.targets[2].webSocketDebuggerUrl='ws://evil.example:9000/devtools/page/jetski';},
  f=>{f.targets[2].webSocketDebuggerUrl='ws://127.0.0.1:9001/devtools/page/jetski';},
  f=>{f.targets[2].webSocketDebuggerUrl='ws://user:pass@127.0.0.1:9000/devtools/page/jetski';},
  f=>{f.targets[2].webSocketDebuggerUrl='ws://127.0.0.1:9000/devtools/page/wrong';},
  f=>{f.targets[2].type='page';},
  f=>{f.tree.childFrames[0].childFrames[0].frame.parentId='unrelated';},
  f=>{f.tree.frame.id='wrong-wrapper';},
  f=>{f.contexts[1].auxData.frameId='unrelated';},
  f=>{f.contexts[1].auxData.isDefault=false;},
  f=>{f.contexts[1].origin='https://evil.example';},
  f=>{f.targets.push({...f.targets[2]});},
  f=>{f.tree.childFrames[0].childFrames.push({frame:{id:'extra',parentId:'content',url:backend}});f.targets.push(target('extra','iframe',backend));},
 ];
 for(const modify of cases){const f=fixture();modify(f);assert.deepEqual(await scan(f),[]);}
});
test('terminal, artifact, settings, remote, ambiguous flags and malformed conversations are rejected',async()=>{
 const urls=[backend.replace('/?','/terminal?'),backend.replace('/?','/artifact-standalone?'),backend.replace('/?','/settings-standalone?'),backend.replace('/?','/c/not-a-guid?'),backend.replace('127.0.0.1','evil.example'),backend.replace('http://','file://'),backend.replace('extensionView=true','extensionView=false'),backend+'&extensionView=true',backend.replace('extensionVariant=vs-code','extensionVariant=other'),backend+'#untrusted'];
 for(const url of urls){const f=fixture();f.content.url=url;f.targets[2].url=url;f.tree.childFrames[0].childFrames[0].frame.url=url;assert.deepEqual(await scan(f),[]);}
 const f=fixture();f.targets[2].url=backend.replace('/?','/c/'+uuid+'?');f.tree.childFrames[0].childFrames[0].frame.url=f.targets[2].url;assert.equal((await scan(f)).length,1,'SPA navigation may select a conversation under the same validated Agent backend');
});
test('discovery bounds target lists, contexts, frames and deep trees',async()=>{
 const tooMany=fixture();tooMany.targets.push(...Array.from({length:129},(_,i)=>target('x'+i,'iframe',backend)));assert.deepEqual(await scan(tooMany),[]);assert.equal(tooMany.connections.length,0);
 const f=fixture();f.contexts.push(...Array.from({length:17},(_,i)=>({id:i+3,origin:wrapperOrigin,auxData:{isDefault:true,frameId:'other'+i}})));assert.deepEqual(await scan(f),[]);assert.equal(f.evaluations,1);
 const frames=fixture();frames.tree.childFrames.push(...Array.from({length:65},(_,i)=>({frame:{id:'extra'+i,url:backend}})));assert.deepEqual(await scan(frames),[]);
 const deep=fixture();let tree=deep.tree;for(let i=0;i<10;i++){tree.childFrames=[{frame:{id:'deep'+i,url:wrapperUrl}}];tree=tree.childFrames[0];}assert.deepEqual(await scan(deep),[]);
});

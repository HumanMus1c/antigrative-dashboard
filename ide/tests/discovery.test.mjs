import test from 'node:test';
import assert from 'node:assert/strict';
import {selectIdeServer,ideServer,agyServer,ideRoot,discoverIdeLog,discoverIdeLogPorts,discoverIdeProcesses} from '../discovery.mjs';
import {validIdeTarget} from '../runtime.mjs';
import {IdeClient} from '../client.mjs';
const rows=[
 {ProcessId:10,ParentProcessId:1,Name:'Antigravity IDE.exe',CommandLine:'IDE'},
 {ProcessId:20,ParentProcessId:10,Name:'language_server_windows_x64.exe',CommandLine:'LS --subclient_type ide --csrf_token test-only'},
 {ProcessId:30,ParentProcessId:11,Name:'language_server.exe',CommandLine:'LS --standalone --csrf_token desktop-test'},
 {ProcessId:40,ParentProcessId:10,Name:'language_server_windows_x64.exe',CommandLine:'LS --enable_lsp --subclient_type ide'},
 {ProcessId:50,ParentProcessId:2,Name:'Antigravity IDE.exe',CommandLine:'second IDE'},
 {ProcessId:60,ParentProcessId:50,Name:'language_server_windows_x64.exe',CommandLine:'LS --subclient_type ide --csrf_token other-test'},
];
test('agy hub is a strict language-server candidate, never a renderer root',()=>{
 const hub={ProcessId:120,ParentProcessId:110,Name:'agy.exe',CommandLine:'C:\\Antigravity\\agy.exe --hub'};
 const ancestry=[{ProcessId:100,ParentProcessId:1,Name:'Antigravity IDE.exe',CommandLine:'Antigravity IDE'},
   {ProcessId:110,ParentProcessId:100,Name:'electron-helper.exe',CommandLine:'helper'},hub];
 assert.equal(agyServer(hub),true);
 for(const row of [
   {...hub,CommandLine:'agy.exe'},
   {...hub,CommandLine:'agy.exe --hubble'},
   {...hub,CommandLine:'agy.exe --hub=true'},
   {...hub,CommandLine:'agy.exe --hub --enable_lsp'},
   {...hub,Name:'other.exe'}
 ])assert.equal(agyServer(row),false);
 assert.equal(ideRoot(hub),false);
 assert.equal(selectIdeServer(ancestry,new Map([[9000,100]]),9000).ProcessId,120);
 assert.throws(()=>selectIdeServer([{...hub,ParentProcessId:999},...ancestry.slice(0,2)],new Map([[9000,100]]),9000),/Waiting/);
 assert.throws(()=>selectIdeServer(ancestry,new Map([[9000,120]]),9000),/does not belong/);
});
test('Windows discovery selects an agy hub through a bounded helper lineage',async()=>{
 const processRows=[
  {ProcessId:100,ParentProcessId:1,Name:'Antigravity IDE.exe',CommandLine:'Antigravity IDE.exe'},
  {ProcessId:110,ParentProcessId:100,Name:'electron-helper.exe',CommandLine:'helper'},
  {ProcessId:120,ParentProcessId:110,Name:'agy.exe',CommandLine:'C:\\Antigravity\\agy.exe --hub'},
  {ProcessId:130,ParentProcessId:100,Name:'agy.exe',CommandLine:'agy.exe'},
 ];
 const run=async file=>file==='powershell.exe'
   ?{stdout:JSON.stringify(processRows)}
   :{stdout:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 100\nTCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 120'};
 const result=await discoverIdeProcesses(9000,{platform:'win32',run});
 assert.equal(result.ProcessId,120);assert.equal(result.rootPid,100);assert.deepEqual(result.Ports,[8000]);
});
test('shared renderer ports across two real IDE roots remain ambiguous',()=>{
 const roots=[
  {ProcessId:100,ParentProcessId:1,Name:'Antigravity IDE.exe',CommandLine:'Antigravity IDE.exe'},
  {ProcessId:200,ParentProcessId:2,Name:'antigravity-ide',CommandLine:'antigravity-ide'},
  {ProcessId:120,ParentProcessId:100,Name:'agy.exe',CommandLine:'agy.exe --hub'},
  {ProcessId:220,ParentProcessId:200,Name:'agy',CommandLine:'/opt/agy --hub'},
 ];
 assert.throws(()=>selectIdeServer(roots,new Map([[9000,new Set([100,200])]]),9000),/Multiple/);
 assert.equal(selectIdeServer(roots,new Map([[9000,100]]),9000).ProcessId,120);
});
test('POSIX parsing recognizes agy hub and excludes ordinary agy',async()=>{
 const ps=[
  '100 1 501 /usr/share/antigravity-ide/antigravity-ide',
  '110 100 501 /usr/lib/electron-helper',
  '120 110 501 /opt/agy --hub',
  '130 100 501 /opt/agy',
  '140 100 502 /opt/agy --hub',
 ].join('\n');
 const result=await discoverIdeProcesses(9000,{platform:'linux',uid:501,run:async()=>({stdout:ps}),linuxPort:async pid=>pid===100?[9000]:pid===120?[8000]:[]});
 assert.equal(result.ProcessId,120);assert.deepEqual(result.Ports,[8000]);
});
test('bind the exact IDE root to its main server, excluding LSP/desktop/other profiles',()=>{
 assert.equal(selectIdeServer(rows,new Map([[9000,10]]),9000).ProcessId,20);
 assert.equal(selectIdeServer(rows,new Map([[9001,50]]),9001).ProcessId,60);
 assert.throws(()=>selectIdeServer(rows,new Map([[9000,30]]),9000));
 assert.throws(()=>selectIdeServer([...rows,{...rows[1],ProcessId:70}],new Map([[9000,10]]),9000));
 for(const platform of ['windows','linux','macos'])for(const arch of ['x64','arm','arm64'])assert.ok(ideServer({...rows[1],Name:`language_server_${platform}_${arch}${platform==='windows'?'.exe':''}`}));
});
test('old log ports and HTTPS ports cannot pair with a fresh server credential',async()=>{
 const logs={'20261010T200000':'listening on random port at 9999 for HTTP\nlistening on random port at 7777 for HTTPS (gRPC)','20261010T190000':'listening on random port at 8000 for HTTP'};
 const options={list:async()=>Object.keys(logs),read:async file=>logs[file.split(/[\\/]/).at(-2)]};
 assert.equal(await discoverIdeLog('profile',[8000,7777],options),8000);
 await assert.rejects(()=>discoverIdeLog('profile',[7777],options));
});
test('IDE renderer discovery rejects desktop pages, subframes, remote/debug port changes',()=>{
 const t={type:'page',url:'vscode-file://vscode-app/d:/IDE/resources/app/out/vs/code/electron-browser/workbench/workbench.html',webSocketDebuggerUrl:'ws://127.0.0.1:9000/devtools/page/x'};
 assert.ok(validIdeTarget(t,9000));
 for(const changed of [{type:'iframe'},{url:'http://127.0.0.1:9000/'},{url:t.url.replace('workbench.html','other.html')},{webSocketDebuggerUrl:'ws://example.com:9000/x'},{webSocketDebuggerUrl:'ws://127.0.0.1:9001/x'}])assert.equal(validIdeTarget({...t,...changed},9000),false);
});

test('Windows discovery retains only exact main process and its listening ports',async()=>{
 const run=async file=>file==='powershell.exe'?{stdout:JSON.stringify(rows)}:{stdout:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 20'};
 const r=await discoverIdeProcesses(9000,{platform:'win32',run});assert.equal(r.ProcessId,20);assert.deepEqual(r.Ports,[8000]);
});

const localSocket=(pid,port,{state=0,local='127.0.0.1',remote='0.0.0.0',remotePort=0}={})=>({
 OwningProcess:pid,LocalPort:port,LocalAddress:local,RemoteAddress:remote,RemotePort:remotePort,State:state,
});
function windowsDiscoveryFixture({processes=rows.slice(0,2),sockets='',fallback=[],netstatError=false}={}){
 const calls=[];
 const run=async(file,args,options)=>{
  calls.push({file,args,options});
  if(file==='netstat.exe'){
   if(netstatError)throw Error('native socket table unavailable');
   return {stdout:sockets};
  }
  if(args.at(-1).includes('Get-CimInstance Win32_Process'))return {stdout:JSON.stringify(processes)};
  assert.equal(file,'powershell.exe');assert.match(args.at(-1),/Get-NetTCPConnection/);
  return {stdout:'\uFEFF'+JSON.stringify(fallback)};
 };
 return {run,calls};
}

test('Windows TUN pseudo-listeners do not mask IDE renderer and API ports',async()=>{
 for(const serverOtherPort of [false,true]){
  const fixture=windowsDiscoveryFixture({
   sockets:[
    'TCP 198.18.0.1:60000 198.18.0.20:0 LISTENING 10',
    'TCP 198.18.0.1:60001 198.18.0.21:0 LISTENING 20',
    ...(serverOtherPort?['TCP 127.0.0.1:7777 0.0.0.0:0 LISTENING 20']:[]),
   ].join('\n'),
   fallback:[localSocket(10,9000),localSocket(20,8000),localSocket(20,8000)],
  });
  const result=await discoverIdeProcesses(9000,{platform:'win32',run:fixture.run});
  assert.equal(result.rootPid,10);assert.equal(result.ProcessId,20);
  assert.deepEqual(result.Ports,serverOtherPort?[7777,8000]:[8000]);
  assert.equal(fixture.calls.length,3,'Only one process scan, native snapshot and batch fallback');
  assert.ok(fixture.calls.every(call=>call.options.windowsHide===true));
  assert.ok(fixture.calls.every(call=>call.options.timeout<=8000));
 }
});

test('Windows missing renderer port falls back even when the root owns another valid listener',async()=>{
 const fixture=windowsDiscoveryFixture({
  sockets:'TCP 127.0.0.1:9001 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 20',
  fallback:[localSocket(10,9000,{local:'::1',remote:'::'})],
 });
 const result=await discoverIdeProcesses(9000,{platform:'win32',run:fixture.run});
 assert.equal(result.rootPid,10);assert.deepEqual(result.Ports,[8000]);
 assert.equal(fixture.calls.length,3);
});

test('Windows IDE recovers from native socket snapshot failure with one owned-port fallback',async()=>{
 const fixture=windowsDiscoveryFixture({netstatError:true,fallback:[
  localSocket(10,9000,{state:'Listen'}),localSocket(20,8000,{state:2}),
  localSocket(99,8001),localSocket(10,65536),
 ]});
 const result=await discoverIdeProcesses(9000,{platform:'win32',run:fixture.run});
 assert.equal(result.rootPid,10);assert.deepEqual(result.Ports,[8000]);
 assert.equal(fixture.calls.length,3);
});

test('Windows normal IDE discovery keeps the native two-command fast path',async()=>{
 const fixture=windowsDiscoveryFixture({sockets:
  'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP [::1]:8000 [::]:0 LISTENING 20\nTCP 198.18.0.1:60000 198.18.0.20:0 LISTENING 99',
 });
 const result=await discoverIdeProcesses(9000,{platform:'win32',run:fixture.run});
 assert.equal(result.rootPid,10);assert.deepEqual(result.Ports,[8000]);
 assert.equal(fixture.calls.length,2,'Healthy discovery does not launch a PowerShell socket fallback');
});

test('Windows fallback sockets owned by an Electron helper cannot stand in for the root',async()=>{
 const fixture=windowsDiscoveryFixture({
  processes:[...rows.slice(0,2),{ProcessId:70,ParentProcessId:10,Name:'Antigravity IDE.exe',CommandLine:'IDE --type=utility'}],
  fallback:[localSocket(70,9000),localSocket(20,8000)],
 });
 await assert.rejects(discoverIdeProcesses(9000,{platform:'win32',run:fixture.run}),/does not belong/);
 assert.equal(fixture.calls.length,3);
});

test('Windows fallback cannot pair another PID socket with the selected server credential',async()=>{
 const fixture=windowsDiscoveryFixture({
  sockets:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10',
  fallback:[localSocket(99,8000)],
 });
 const result=await discoverIdeProcesses(9000,{platform:'win32',run:fixture.run});
 assert.equal(result.ProcessId,20);assert.deepEqual(result.Ports,[]);
 await assert.rejects(discoverIdeLog('profile',result.Ports,{
  list:async()=>['20261101T100000'],read:async()=> 'listening on random port at 8000 for HTTP\n',
 }),/Waiting for the IDE local API port/);
});

test('Windows fallback preserves ambiguity when two IDE roots own the renderer port',async()=>{
 const fixture=windowsDiscoveryFixture({processes:rows,fallback:[
  localSocket(10,9000),localSocket(20,8000),localSocket(50,9000),localSocket(60,8001),
 ]});
 await assert.rejects(discoverIdeProcesses(9000,{platform:'win32',run:fixture.run}),/Multiple Antigravity IDE/);
});

test('Windows fallback excludes non-listening and non-local sockets from renderer ownership',async()=>{
 for(const invalid of [
  localSocket(10,9000,{state:'Bound'}),localSocket(10,9000,{state:100}),
  localSocket(10,9000,{state:1}),localSocket(10,9000,{state:5}),
  localSocket(10,9000,{state:null}),localSocket(10,9000,{state:''}),
  localSocket(10,9000,{local:'198.18.0.1'}),localSocket(10,9000,{remote:'198.18.0.20'}),
  localSocket(10,9000,{remotePort:443}),
 ]){
  const fixture=windowsDiscoveryFixture({fallback:[invalid,localSocket(20,8000)]});
  await assert.rejects(discoverIdeProcesses(9000,{platform:'win32',run:fixture.run}),/does not belong/);
 }
});
test('macOS/Linux fixtures keep UID and PID lineage rather than newest process',async()=>{
 for(const platform of ['darwin','linux']){
  const suffix=platform==='darwin'?'macos':'linux';
  const ps=`10 1 501 ${platform==='darwin'?'/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE':'/usr/share/antigravity-ide/antigravity-ide'}\n20 10 501 /app/language_server_${suffix}_x64 --subclient_type ide --csrf_token test\n30 10 502 /app/language_server_${suffix}_x64 --subclient_type ide`;
  if(platform==='darwin'){
   const run=async file=>({stdout:file==='/bin/ps'?ps:'p10\nn127.0.0.1:9000\np20\nn127.0.0.1:8000'});
   const r=await discoverIdeProcesses(9000,{platform,uid:501,run});assert.equal(r.ProcessId,20);assert.deepEqual(r.Ports,[8000]);
  }else{
   const r=await discoverIdeProcesses(9000,{platform,uid:501,run:async()=>({stdout:ps}),linuxPort:async pid=>pid===10?[9000]:[8000]});
   assert.equal(r.ProcessId,20);assert.deepEqual(r.Ports,[8000]);
  }
 }
});
test('IDE client keeps credentials in memory and uses the selected main PID',async()=>{
 const client=new IdeClient({profile:'fixture',debugPort:()=>9000,processes:async()=>({...rows[1],Ports:[8000]}),logPorts:async()=>[8000]});
 assert.deepEqual(await client.discover(),{port:8000,csrf:'test-only',pid:20});
});

test('IDE client supplies HTTP log hints when a normal gRPC listener masks a missing API port',async()=>{
 const fixture=windowsDiscoveryFixture({
  sockets:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:7777 0.0.0.0:0 LISTENING 20',
  fallback:[localSocket(20,8000)],
 });
 const client=new IdeClient({profile:'fixture',debugPort:()=>9000,logPorts:async()=>[8000],
  processes:(port,options)=>discoverIdeProcesses(port,{...options,platform:'win32',run:fixture.run})});
 assert.deepEqual(await client.discover(),{port:8000,pid:20,csrf:'test-only'});
 assert.equal(fixture.calls.length,3);
 assert.match(fixture.calls[2].args.at(-1),/@\(20\)/);
});

test('IDE HTTP log candidates stay newest-first and read at most eight session logs',async()=>{
 const names=Array.from({length:20},(_,i)=>`202610${String(i+1).padStart(2,'0')}T100000`),readNames=[];
 const result=await discoverIdeLogPorts('profile',{list:async()=>[...names,'not-a-log'],read:async path=>{
  const name=path.split(/[\\/]/).at(-2);readNames.push(name);
  return `listening on random port at ${8000+Number(name.slice(6,8))} for HTTP\nlistening on random port at 7777 for HTTPS\n`;
 }});
 assert.deepEqual(result,[8020,8019,8018,8017,8016,8015,8014,8013]);assert.equal(readNames.length,8);
});

test('inherited sockets never replace the IDE root with its Electron helper or language server',()=>{
 const helpers=[{ProcessId:70,ParentProcessId:10,Name:'Antigravity IDE.exe',CommandLine:'IDE --type=gpu-process'},
  {ProcessId:80,ParentProcessId:10,Name:'Antigravity IDE.exe',CommandLine:'IDE --type=utility --utility-sub-type=node.mojom.NodeService'}];
 for(const order of [[10,20,40,70,80],[80,70,40,20,10]]){
  const result=selectIdeServer([...rows,...helpers],new Map([[9000,new Set(order)]]),9000);assert.equal(result.rootPid,10);assert.equal(result.ProcessId,20);
 }
 assert.throws(()=>selectIdeServer([...rows,...helpers],new Map([[9000,new Set([70,80])]]),9000),/does not belong/);
 for(const flag of ['--type=renderer','--type gpu-process','"--type=utility"','--utility-sub-type=node.mojom.NodeService'])assert.equal(ideRoot({...rows[0],CommandLine:'IDE '+flag}),false);
});
test('multiple real IDE owners fail explicitly rather than selecting the last PID',()=>{
 for(const ids of [[10,50],[50,10]])assert.throws(()=>selectIdeServer(rows,new Map([[9000,new Set(ids)]]),9000),/Multiple Antigravity IDE/);
 assert.throws(()=>selectIdeServer(rows,new Map([[9000,new Set([10,50,20,60])]]),9000));
 for(const port of [0,-1,65536,'9000',NaN])assert.throws(()=>selectIdeServer(rows,new Map(),port),/Invalid/);
});
test('Linux shared socket process order, UID isolation and extra IDE instances retain exact lineage',async()=>{
 for(const reverse of [false,true]){
  const lines=['10 1 501 /usr/share/antigravity-ide/antigravity-ide',
   '20 10 501 /app/language_server_linux_x64 --subclient_type ide',
   '30 10 501 /usr/share/antigravity-ide/antigravity-ide --type=gpu-process',
   '40 10 501 /usr/share/antigravity-ide/antigravity-ide --type=utility',
   '50 1 501 /usr/share/antigravity-ide/antigravity-ide',
   '60 50 501 /app/language_server_linux_x64 --subclient_type ide',
   '70 1 502 /usr/share/antigravity-ide/antigravity-ide'];
  const run=async()=>({stdout:(reverse?lines.reverse():lines).join('\n')});
  const linuxPort=async pid=>pid===50?[9001]:pid===60?[8001]:pid===20?[9000,8000]:[9000];
  const result=await discoverIdeProcesses(9000,{platform:'linux',uid:501,run,linuxPort});assert.equal(result.rootPid,10);assert.equal(result.ProcessId,20);assert.deepEqual(result.Ports,[9000,8000]);
  const other=await discoverIdeProcesses(9001,{platform:'linux',uid:501,run,linuxPort});assert.equal(other.ProcessId,60);
  await assert.rejects(discoverIdeProcesses(9000,{platform:'linux',uid:501,run,linuxPort:async pid=>pid===60?[8001]:[9000]}),/Multiple/);
 }
});
test('macOS lsof duplicate owners are retained; Electron helpers cannot win a shared port',async()=>{
 const ps='10 1 501 /Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE\n20 10 501 /app/language_server_macos_arm64 --subclient_type ide\n30 10 501 /Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE --type=gpu-process';
 const run=async file=>({stdout:file==='/bin/ps'?ps:'p10\nn127.0.0.1:9000\np20\nn127.0.0.1:9000\nn127.0.0.1:8000\np30\nn127.0.0.1:9000'});
 const result=await discoverIdeProcesses(9000,{platform:'darwin',uid:501,run});assert.equal(result.rootPid,10);assert.equal(result.ProcessId,20);
});

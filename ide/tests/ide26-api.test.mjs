import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {IdeClient} from '../client.mjs';
import * as discovery from '../discovery.mjs';
const root={ProcessId:10,ParentProcessId:1,Name:'Antigravity IDE.exe',CommandLine:'"C:\\IDE\\Antigravity IDE.exe"'};
const helper={ProcessId:15,ParentProcessId:10,Name:'Antigravity IDE.exe',CommandLine:'IDE --type=utility'};
const hub=(extra='--hub-port=8000')=>({ProcessId:20,ParentProcessId:15,Name:'agy.exe',CommandLine:`"C:\\User Space\\agy.exe" --hub ${extra} --csrf_token test-only`});
const client=(row,logPorts=async()=>[])=>new IdeClient({profile:'fixture',debugPort:()=>9000,processes:async()=>row,logPorts});

test('IDE 2.6 uses the exact owned hub HTTP port without legacy logs',async()=>{
 const value=await client({...hub(),Ports:[7777,8000]}).discover();
 assert.deepEqual(value,{pid:20,port:8000,csrf:'test-only'});
});
test('missing legacy log directory does not block the IDE 2.6 hub',async()=>{
 const value=await client({...hub(),Ports:[8000]},async()=>{throw Object.assign(Error('missing profile logs'),{code:'ENOENT'});}).discover();
 assert.equal(value.port,8000);
});
test('stale log hints cannot redirect a hub credential to its gRPC or previous HTTP listener',async()=>{
 assert.equal((await client({...hub(),Ports:[7777,8000]},async()=>[7777]).discover()).port,8000);
 await assert.rejects(client({...hub(),Ports:[7777]},async()=>[7777]).discover(),/local API port/);
});
test('hub port parser accepts supported quoting and assignment forms',()=>{
 for(const arg of ['--hub-port=8000','--hub-port 8000','"--hub-port=8000"','--hub-port="8000"','--hub-port "8000"'])assert.equal(discovery.ideHubPort(hub(arg)),8000,arg);
});
test('hub port parser rejects malformed, duplicate, non-hub and option-like data',()=>{
 for(const arg of ['', '--hub-port=0','--hub-port=-1','--hub-port=65536','--hub-port=8e3','--hub-port=8000x','--hub-port','--hub-port=8000 --hub-port=8001','--hub-port=8000 --hub-port=8000','-- --hub-port=8000','--label "data --hub-port=8000"'])assert.equal(discovery.ideHubPort(hub(arg)),null,arg);
 assert.equal(discovery.ideHubPort({...hub(),Name:'other.exe'}),null);
 assert.equal(discovery.ideHubPort({...hub(),CommandLine:'agy.exe --hub-port=8000 --csrf_token test-only'}),null);
});
test('invalid or missing hub-port cannot fall back to legacy logs',async()=>{
 for(const arg of ['','--hub-port=0','--hub-port=65536','--hub-port=8000 --hub-port=8001'])await assert.rejects(client({...hub(arg),Ports:[8000,8001]},async()=>[8000]).discover(),/local API port/);
});
test('legacy language server still requires its owned HTTP log port',async()=>{
 const legacy={ProcessId:20,Name:'language_server_windows_x64.exe',CommandLine:'LS --subclient_type ide --csrf_token legacy-test',Ports:[7777,8000]};
 assert.deepEqual(await client(legacy,async()=>[8000]).discover(),{pid:20,port:8000,csrf:'legacy-test'});
 await assert.rejects(client(legacy,async()=>[]).discover(),/local API port/);
});
test('Windows port selection preserves renderer lineage and rejects unrelated hubs',async()=>{
 const processes=[root,helper,hub(),{...hub(),ProcessId:30,ParentProcessId:999}];
 const run=async(file,args)=>file==='netstat.exe'?{stdout:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 20\nTCP 127.0.0.1:8001 0.0.0.0:0 LISTENING 30'}:{stdout:JSON.stringify(processes)};
 assert.equal((await discovery.discoverIdeProcesses(9000,{platform:'win32',run})).ProcessId,20);
 const wrong=processes.map(row=>row.ProcessId===20?{...row,ParentProcessId:999}:row);
 await assert.rejects(discovery.discoverIdeProcesses(9000,{platform:'win32',run:async(file,args)=>file==='netstat.exe'?run(file,args):{stdout:JSON.stringify(wrong)}}),/Waiting for the IDE main/);
});
test('Windows TUN fallback targets the hub flag even when gRPC already listens',async t=>{
 const sockets=[];
 const server=createServer(socket=>{sockets.push(socket);socket.on('data',()=>assert.fail('Discovery probe must not send credentials or payload'));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{for(const socket of sockets)socket.destroy();server.close();});
 const port=server.address().port,processes=[root,helper,hub(`--hub-port=${port}`)],calls=[];
 const run=async(file,args)=>{
  calls.push({file,args});
  if(file==='netstat.exe')return{stdout:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:7777 0.0.0.0:0 LISTENING 20'};
  if(args.at(-1).includes('Get-CimInstance'))return{stdout:JSON.stringify(processes)};
  return{stdout:JSON.stringify([{OwningProcess:20,LocalPort:port,LocalAddress:'127.0.0.1',RemoteAddress:'0.0.0.0',RemotePort:0,State:null}])};
 };
 const row=await discovery.discoverIdeProcesses(9000,{platform:'win32',run});
 assert.ok(row.Ports.includes(port));assert.equal(calls.length,3);
 const value=await client(row).discover();assert.equal(value.port,port);
});
test('Windows hub flag is not evidence that a different PID owns the socket',async()=>{
 const processes=[root,helper,hub()];
 const run=async(file,args)=>{
  if(file==='netstat.exe')return{stdout:'TCP 127.0.0.1:9000 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:7777 0.0.0.0:0 LISTENING 20\nTCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 99'};
  if(args.at(-1).includes('Get-CimInstance'))return{stdout:JSON.stringify(processes)};
  return{stdout:JSON.stringify([{OwningProcess:99,LocalPort:8000,LocalAddress:'127.0.0.1',RemoteAddress:'0.0.0.0',RemotePort:0,State:2}])};
 };
 const row=await discovery.discoverIdeProcesses(9000,{platform:'win32',run});
 assert.equal(row.Ports.includes(8000),false);await assert.rejects(client(row,async()=>[7777]).discover(),/local API port/);
});
test('POSIX hub API selection requires the current same-user process listener',async()=>{
 for(const platform of ['linux','darwin']){
  const ps='10 1 501 /opt/antigravity-ide\n15 10 501 /opt/helper\n20 15 501 /opt/agy --hub --hub-port=8000 --csrf_token test-only\n30 10 502 /opt/agy --hub --hub-port=8001';
  const row=await discovery.discoverIdeProcesses(9000,{platform,uid:501,run:async file=>({stdout:file==='/bin/ps'?ps:'p10\nn127.0.0.1:9000\np20\nn127.0.0.1:8000\nn127.0.0.1:7777'}),linuxPort:async pid=>pid===10?[9000]:pid===20?[8000,7777]:[]});
  assert.deepEqual(await client(row).discover(),{pid:20,port:8000,csrf:'test-only'});
 }
});

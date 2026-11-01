import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {discoverProcesses,discoverWindowsPorts,parseNetstat,httpLogPorts,probeLoopbackPort} from '../discovery.mjs';
import {AntigravityClient,serverFromDiscovery} from '../client.mjs';

const socket=(fields={})=>({OwningProcess:12,LocalAddress:'127.0.0.1',LocalPort:1234,RemoteAddress:'0.0.0.0',RemotePort:0,State:0,...fields});
const fakeListener='TCP 198.18.0.1:60000 198.18.0.12:0 LISTENING 12';
const standalone={ProcessId:12,CommandLine:'language_server.exe --standalone --csrf_token=fixture'};
function fixture({netstat=fakeListener,sockets=[socket()],processes=[standalone]}={}){
  const calls=[];
  const run=async(file,args,options)=>{
    calls.push({file,args,options});
    if(file==='netstat.exe'){if(netstat instanceof Error)throw netstat;return {stdout:netstat};}
    if(args.at(-1).includes('Get-CimInstance'))return {stdout:JSON.stringify(processes)};
    if(sockets instanceof Error)throw sockets;
    return {stdout:typeof sockets==='string'?sockets:JSON.stringify(sockets)};
  };
  return {run,calls};
}

test('TUN pseudo listeners and connected remotes never become localhost candidates',()=>{
  const parsed=parseNetstat([
    fakeListener,
    'TCP 192.168.1.3:1234 0.0.0.0:0 LISTENING 12',
    'TCP 127.0.0.1:1235 198.18.0.12:0 LISTENING 12',
    'TCP [::1]:1236 [::]:5 LISTENING 12',
    'TCP 127.0.0.1:1237 0.0.0.0:0 ESTABLISHED 12',
    'TCP 127.0.0.1:1238 0.0.0.0:0 LISTENING 4294967296',
  ].join('\n'));
  assert.equal(parsed.size,0);
  for(const local of ['127.0.0.1','0.0.0.0','[::]','[::1]','[0:0:0:0:0:0:0:1]','localhost']){
    for(const remote of ['0.0.0.0:0','[::]:0','*:0','*:*']){
      assert.deepEqual(parseNetstat(`TCP ${local}:1234 ${remote} LISTENING 12`).get(12),[1234]);
    }
  }
});

test('reported TUN State 0 recovers the exact process and HTTP log port',async()=>{
  const {run,calls}=fixture();
  const rows=await discoverProcesses({platform:'win32',run});
  assert.deepEqual(serverFromDiscovery('listening on random port at 1234 for HTTP\n',rows),{port:1234,pid:12,csrf:'fixture'});
  assert.deepEqual(rows[0].Ports,[1234]);assert.equal(calls.length,3);
  const script=calls[2].args.at(-1);
  assert.doesNotMatch(script,/-State\s+Listen/);
  assert.match(script,/-OwningProcess \$pulsePids/);
  for(const field of ['LocalAddress','RemoteAddress','RemotePort','State'])assert.ok(script.includes(field));
  assert.ok(calls.every(call=>call.options.windowsHide===true));
  assert.ok(calls[2].options.timeout<=8000);assert.ok(calls[2].options.maxBuffer<=1048576);
});

test('a pseudo listener alongside a valid port still triggers one merged fallback',async()=>{
  const {run,calls}=fixture({netstat:fakeListener+'\nTCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12',sockets:[socket(),socket({LocalPort:4321}),socket()]});
  const ports=await discoverWindowsPorts([12,12],{run});
  assert.deepEqual(ports.get(12),[4321,1234]);assert.equal(calls.length,2);
});

test('normal IPv4/IPv6/Listen/numeric states stay supported; other states cannot pass as zero',async()=>{
  const good=[socket(),socket({LocalPort:1235,State:'0'}),socket({LocalPort:1236,State:'Listen'}),
    socket({LocalPort:1237,State:2,LocalAddress:'::1',RemoteAddress:'::'}),socket({LocalPort:1238,State:'2',LocalAddress:'0.0.0.0'}),
    socket({LocalPort:1239,State:2,LocalAddress:'::',RemoteAddress:'::'})];
  const bad=[...['Closed','Bound','Established',1,5,100,null,'',false,{},undefined].map(State=>socket({State})),
    ...[null,'',false,{},undefined,10].map(RemotePort=>socket({RemotePort})),
    ...['198.18.0.1','192.168.1.3','127.0.0.1.evil','example.test',null].map(LocalAddress=>socket({LocalAddress})),
    ...['198.18.0.12','127.0.0.1','example.test',null].map(RemoteAddress=>socket({RemoteAddress})),
    ...[0,65536,'',null,{},1.5].map(LocalPort=>socket({LocalPort})),socket({OwningProcess:112})];
  for(const row of bad){
    const {run}=fixture({netstat:'',sockets:[row]});assert.equal((await discoverWindowsPorts([12],{run})).size,0);
  }
  const {run}=fixture({netstat:'',sockets:good});
  assert.deepEqual((await discoverWindowsPorts([12],{run})).get(12),[1234,1235,1236,1237,1238,1239]);
});

test('explicit null or empty state needs a reachable expected loopback port; a closed port stays rejected',async t=>{
  const server=createServer(),accepted=[];let payloadBytes=0;
  server.on('connection',connection=>{accepted.push(connection);connection.on('data',chunk=>payloadBytes+=chunk.length);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{for(const connection of accepted)connection.destroy();server.close();});
  const port=server.address().port;
  for(const State of [null,'']){
    const {run,calls}=fixture({netstat:'',sockets:[socket({State,LocalPort:port})]});
    assert.deepEqual((await discoverWindowsPorts([12],{run,expectedPorts:new Map([[12,[port]]])})).get(12),[port]);
    assert.equal(calls.length,2,'No extra process/socket enumeration per probe');
  }
  for(const connection of accepted)connection.destroy();
  await new Promise(resolve=>server.close(resolve));
  assert.equal(payloadBytes,0,'The reachability check sends no HTTP bytes or credentials');
  for(const State of [null,'']){
    const {run}=fixture({netstat:'',sockets:[socket({State,LocalPort:port})]});
    assert.equal((await discoverWindowsPorts([12],{run,expectedPorts:new Map([[12,[port]]])})).size,0);
  }
});

test('empty-state compatibility never probes a missing field, foreign PID, invalid tuple or older target',async()=>{
  let calls=0;const probe=async()=>{calls++;return true;};
  const invalid=[socket({State:undefined}),socket({State:false}),socket({State:'Bound'}),socket({State:'Closed'}),
    socket({State:null,OwningProcess:112}),socket({State:null,LocalAddress:'198.18.0.1'}),
    socket({State:null,RemoteAddress:'127.0.0.1'}),socket({State:null,RemotePort:443}),
    socket({State:null,LocalPort:4321})];
  const {run}=fixture({netstat:'',sockets:invalid});
  assert.equal((await discoverWindowsPorts([12],{run,expectedPorts:new Map([[12,[1234,4321]]]),probe})).size,0);
  assert.equal(calls,0);
  const noHint=fixture({netstat:'',sockets:[socket({State:null})]});
  assert.equal((await discoverWindowsPorts([12],{run:noHint.run,probe})).size,0);assert.equal(calls,0);
});

test('blank-state probes are deduplicated, bounded to four PIDs, and leave known listener states on the fast path',async()=>{
  const pids=[12,13,14,15,16,17],sockets=pids.flatMap(pid=>[socket({OwningProcess:pid,State:null}),socket({OwningProcess:pid,State:''})]);
  const calls=[],{run}=fixture({netstat:'',sockets});
  const ports=await discoverWindowsPorts(pids,{run,expectedPorts:new Map(pids.map(pid=>[pid,[1234]])),
    probe:async(port,options)=>{calls.push({port,...options});return true;}});
  assert.deepEqual([...ports.keys()],[12,13,14,15]);assert.equal(calls.length,4);
  assert.ok(calls.every(call=>call.port===1234&&call.timeoutMs>0&&call.timeoutMs<=400&&call.signal.aborted));
  let probes=0;
  const known=fixture({netstat:'',sockets:[socket({State:null}),socket({State:'Listen'}),socket({LocalPort:4321,State:0})]});
  assert.deepEqual((await discoverWindowsPorts([12],{run:known.run,expectedPorts:new Map([[12,[1234]]]),probe:async()=>{probes++;return true;}})).get(12),[1234,4321]);
  assert.equal(probes,0,'Known listening evidence needs no TCP probe');
});

test('unresponsive probes are cancelled inside the aggregate time budget',async()=>{
  const pids=[12,13,14,15,16],calls=[];
  const {run}=fixture({netstat:'',sockets:pids.map(pid=>socket({OwningProcess:pid,State:null}))});
  const started=performance.now();
  const ports=await discoverWindowsPorts(pids,{run,expectedPorts:new Map(pids.map(pid=>[pid,[1234]])),
    probe:(_port,options)=>{calls.push(options);return new Promise(()=>{});}});
  assert.equal(ports.size,0);assert.ok(calls.length>0&&calls.length<=4);
  assert.ok(calls.every(call=>call.signal.aborted&&call.timeoutMs<=400));
  assert.ok(calls.reduce((total,call)=>total+call.timeoutMs,0)<=1500);
  assert.ok(performance.now()-started<5000,'A non-settling probe cannot stall discovery indefinitely');
});

test('probe errors retain healthy native ports and do not promote uncertain ones',async()=>{
  for(const probe of [()=>{throw Error('connect failed');},async()=>{throw Error('connect failed');},async()=>false]){
    const {run}=fixture({netstat:'TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12',sockets:[socket({State:null})]});
    assert.deepEqual((await discoverWindowsPorts([12],{run,expectedPorts:new Map([[12,[1234]]]),probe})).get(12),[4321]);
  }
});

test('loopback probe closes sockets on connect, timeout and cancellation, without writing data',async()=>{
  for(const mode of ['connect','error','close','timeout','abort']){
    const socket=new EventEmitter(),controller=new AbortController();let destroyed=0,options;
    socket.destroy=()=>{destroyed++;};socket.unref=()=>{};socket.write=()=>assert.fail('Probe must not write');
    const result=probeLoopbackPort(1234,{timeoutMs:10,signal:controller.signal,connect:value=>{
      options=value;
      queueMicrotask(()=>{if(mode==='abort')controller.abort();else if(mode!=='timeout')socket.emit(mode,mode==='error'?Error('failed'):undefined);});return socket;
    }});
    assert.equal(await result,mode==='connect');assert.equal(destroyed,1);
    assert.deepEqual(options,{host:'127.0.0.1',port:1234,family:4});
  }
  let calls=0;
  const aborted=new AbortController();aborted.abort();
  assert.equal(await probeLoopbackPort(1234,{signal:aborted.signal,connect:()=>{calls++;}}),false);
  for(const port of [0,65536,'1234',NaN])assert.equal(await probeLoopbackPort(port,{connect:()=>{calls++;}}),false);
  assert.equal(calls,0);
});

test('native success avoids PowerShell; malformed, denied or timed-out fallback preserves existing ports',async()=>{
  const valid='TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12';
  const normal=fixture({netstat:valid+'\n'+fakeListener.replace(/ 12$/,' 99')});
  assert.deepEqual((await discoverWindowsPorts([12],{run:normal.run})).get(12),[4321]);assert.equal(normal.calls.length,1);
  for(const sockets of ['{bad','null','',new Error('denied'),Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})]){
    const {run,calls}=fixture({netstat:valid+'\n'+fakeListener,sockets});
    assert.deepEqual((await discoverWindowsPorts([12],{run})).get(12),[4321]);assert.equal(calls.length,2);
  }
  const failed=fixture({netstat:new Error('unavailable'),sockets:'\uFEFF'+JSON.stringify(socket())});
  assert.deepEqual((await discoverWindowsPorts([12],{run:failed.run})).get(12),[1234]);
});

test('all missing candidate PIDs share one fallback and foreign PIDs cannot use a stale log',async()=>{
  const {run,calls}=fixture({netstat:'',sockets:[socket(),socket({OwningProcess:112,LocalPort:4321}),socket({OwningProcess:99,LocalPort:9999})]});
  const ports=await discoverWindowsPorts([12,112],{run});
  assert.deepEqual([...ports],[[12,[1234]],[112,[4321]]]);assert.equal(calls.length,2);
  assert.throws(()=>serverFromDiscovery('listening on random port at 9999 for HTTP\n',[{...standalone,Ports:ports.get(12)}]),/接口启动/);
  const none=fixture();assert.equal((await discoverWindowsPorts([0,NaN,'12',4294967296],{run:none.run})).size,0);assert.equal(none.calls.length,0);
});

test('App log hints recover a missing HTTP listener even if native gRPC is valid and no fake row is present',async()=>{
  const {run,calls}=fixture({netstat:'TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12'});
  const client=new AntigravityClient({paths:()=>({log:'fixture'}),readLog:async()=> 'listening on random port at 4321 for HTTPS\nlistening on random port at 1234 for HTTP\n',
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  assert.deepEqual(await client.discover(),{port:1234,pid:12,csrf:'fixture'});
  assert.equal(calls.length,3);assert.deepEqual((await client.discover()).port,1234);assert.equal(calls.length,3);
});

test('a proven HTTP target keeps the native fast path even when TUN emits other fake listeners',async()=>{
  const {run,calls}=fixture({netstat:fakeListener+'\nTCP 127.0.0.1:1234 0.0.0.0:0 LISTENING 12'});
  const client=new AntigravityClient({paths:()=>({log:'fixture'}),readLog:async()=> 'listening on random port at 1234 for HTTP\n',
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  assert.equal((await client.discover()).port,1234);assert.equal(calls.length,2);
});

test('HTTP log hints preserve newest occurrence, discard invalid ports and never include HTTPS',()=>{
  assert.deepEqual(httpLogPorts([1234,4321,1234,0,65536].map(port=>`listening on random port at ${port} for HTTP\n`).join('')+
    'listening on random port at 7777 for HTTPS\n'),[1234,4321]);
});

test('a reused historical HTTP port cannot hide the newest HTTP listener',async()=>{
  const {run,calls}=fixture({netstat:'TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12'});
  const client=new AntigravityClient({paths:()=>({log:'fixture'}),readLog:async()=>
    'listening on random port at 4321 for HTTP\nlistening on random port at 1234 for HTTP\n',
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  assert.equal((await client.discover()).port,1234);assert.equal(calls.length,3);
});

test('a stale profile log cannot mask the current native log after HTTP port reuse',async()=>{
  const {run,calls}=fixture({netstat:'TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12'});
  const client=new AntigravityClient({paths:()=>({logCandidates:['profile','native']}),
    logStat:async file=>({mtimeMs:file==='native'?200:100}),
    readLog:async file=>`listening on random port at ${file==='native'?1234:4321} for HTTP\n`,
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  assert.equal((await client.discover()).port,1234);assert.equal(calls.length,3);
});

test('equal or unreadable log metadata preserves fallback order and explicit overrides remain authoritative',async()=>{
  const readLog=async file=>`listening on random port at ${file==='profile'?1234:4321} for HTTP\n`;
  const processes=async()=>[{...standalone,Ports:[1234,4321]}];
  for(const logStat of [async()=>({mtimeMs:200}),async()=>{throw Error('metadata unavailable');},async()=>({mtimeMs:NaN})]){
    const client=new AntigravityClient({paths:()=>({logCandidates:['profile','native']}),logStat,readLog,processes});
    assert.equal((await client.discover()).port,1234);
  }
  const incompleteMetadata=new AntigravityClient({paths:()=>({logCandidates:['profile','native']}),
    logStat:async file=>{if(file==='profile')throw Error('metadata unavailable');return {mtimeMs:200};},readLog,processes});
  assert.equal((await incompleteMetadata.discover()).port,1234);
  let stats=0;
  const overridden=new AntigravityClient({paths:()=>({log:'native',logCandidates:['native']}),
    logStat:async()=>{stats++;return {mtimeMs:200};},readLog,processes});
  assert.equal((await overridden.discover()).port,4321);assert.equal(stats,0);
});

test('newest log metadata cannot assign a foreign process port to the current credential',async()=>{
  const {run,calls}=fixture({netstat:'',sockets:[socket({OwningProcess:99})]});
  const client=new AntigravityClient({paths:()=>({logCandidates:['profile','native']}),
    logStat:async file=>({mtimeMs:file==='native'?200:100}),
    readLog:async file=>`listening on random port at ${file==='native'?1234:4321} for HTTP\n`,
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  await assert.rejects(client.discover(),/接口启动/);assert.equal(client.server,null);assert.equal(calls.length,3);
});

test('log hints cannot bypass PID checks; failed concurrent discovery retains exponential backoff',async()=>{
  const {run,calls}=fixture({netstat:'TCP 127.0.0.1:4321 0.0.0.0:0 LISTENING 12',sockets:[socket({OwningProcess:99})]});
  let now=0;
  const client=new AntigravityClient({now:()=>now,paths:()=>({log:'fixture'}),readLog:async()=> 'listening on random port at 1234 for HTTP\n',
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  const attempts=await Promise.allSettled(Array.from({length:30},()=>client.discover()));
  assert.ok(attempts.every(result=>result.status==='rejected'));assert.equal(calls.length,3);assert.equal(client.server,null);
  for(let n=0;n<30;n++)await assert.rejects(client.discover(),/接口启动/);
  assert.equal(calls.length,3);now=3000;await assert.rejects(client.discover());assert.equal(calls.length,6);
  now=4000;await assert.rejects(client.discover());assert.equal(calls.length,6);
});

test('recovered discovery reaches a real loopback RPC without proxying or credential leakage',async t=>{
  let requests=0;
  const server=createServer((req,res)=>{requests++;assert.equal(req.headers['x-codeium-csrf-token'],'fixture');req.resume();res.end('{"ok":true}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const port=server.address().port;
  const {run,calls}=fixture({sockets:[socket({LocalPort:port})]});
  const client=new AntigravityClient({paths:()=>({log:'fixture'}),readLog:async()=>`listening on random port at ${port} for HTTP\n`,
    processes:options=>discoverProcesses({platform:'win32',run,...options})});
  assert.deepEqual(await client.call('GetUserStatus'),{ok:true});assert.equal(requests,1);
  assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(calls),/csrf|fixture/);
});

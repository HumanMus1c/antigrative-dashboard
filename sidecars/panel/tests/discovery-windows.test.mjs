import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {discoverProcesses,discoverWindowsPorts,parseNetstat,httpLogPorts} from '../discovery.mjs';
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
    socket({LocalPort:1239,State:2,LocalAddress:'::',RemoteAddress:'::'}),socket({LocalPort:1240,State:null}),
    socket({LocalPort:1241,State:''}),socket({LocalPort:1242,State:undefined})];
  const bad=[...['Closed','Bound','Established',1,5,100,false,{}].map(State=>socket({State})),
    ...[null,'',false,{},undefined,10].map(RemotePort=>socket({RemotePort})),
    ...['198.18.0.1','192.168.1.3','127.0.0.1.evil','example.test',null].map(LocalAddress=>socket({LocalAddress})),
    ...['198.18.0.12','127.0.0.1','example.test',null].map(RemoteAddress=>socket({RemoteAddress})),
    ...[0,65536,'',null,{},1.5].map(LocalPort=>socket({LocalPort})),socket({OwningProcess:112})];
  for(const row of bad){
    const {run}=fixture({netstat:'',sockets:[row]});assert.equal((await discoverWindowsPorts([12],{run})).size,0);
  }
  const {run}=fixture({netstat:'',sockets:good});
  assert.deepEqual((await discoverWindowsPorts([12],{run})).get(12),[1234,1235,1236,1237,1238,1239,1240,1241,1242]);
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

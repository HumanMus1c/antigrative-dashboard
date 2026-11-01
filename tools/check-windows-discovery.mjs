// Run separately from the parallel Node suite: OS/CIM startup under a fully
// saturated runner is not a deterministic unit test. Keep production timeouts.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {discoverWindowsPorts,parseNetstat} from '../sidecars/panel/discovery.mjs';

if(process.platform!=='win32'){
  console.log('Windows native discovery check is only applicable on Windows.');
}else{
  const server=createServer(socket=>socket.end());
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port,exec=promisify(execFile);
    const {stdout}=await exec('netstat.exe',['-ano','-p','tcp'],{windowsHide:true,timeout:4000,maxBuffer:4194304});
    assert.ok(parseNetstat(stdout).get(process.pid)?.includes(port),'Native netstat must find the test listener');
    const commands=[];
    const run=async(file,args,options)=>{
      commands.push(file);
      // Exercise the real CIM fallback without altering the network or VPN.
      return file==='netstat.exe'?{stdout:''}:exec(file,args,options);
    };
    const recovered=await discoverWindowsPorts([process.pid],{run});
    assert.ok(recovered.get(process.pid)?.includes(port),'Real PowerShell fallback must find the test listener within its production budget');
    assert.deepEqual(commands,['netstat.exe','powershell.exe']);
    console.log(JSON.stringify({nativeNetstat:true,nativePowerShell:true,oneFallback:true,productionTimeouts:true}));
  }finally{await new Promise(resolve=>server.close(resolve));}
}

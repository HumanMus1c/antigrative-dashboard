import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
const languageServer = command => /(?:^|[\/\\])language_server(?:_(?:linux|macos|darwin)(?:_(?:x64|arm64))?)?(?:\.exe)?(?:\s|$)/.test(command);

export function httpLogPorts(log) {
  const ports=new Set();
  for(const match of log.matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)){
    const port=Number(match[1]);if(port<1||port>65535)continue;
    // Keep the most recent occurrence first without retaining complete logs.
    ports.delete(port);ports.add(port);
  }
  return [...ports].reverse();
}

export function parsePs(text, uid) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || Number(match[2]) !== uid || !languageServer(match[3]) || !/--standalone\b/.test(match[3])) return [];
    return [{ ProcessId:Number(match[1]), CommandLine:match[3] }];
  });
}

export function parseLsof(text) {
  // Machine-readable fields: p (PID), n (socket name). Never parse human columns.
  let pid = null; const ports = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) { pid = Number(line.slice(1)); if (!ports.has(pid)) ports.set(pid,[]); }
    const port = line[0] === 'n' && line.match(/:(\d+)(?:\s|$)/)?.[1];
    if (pid && port) ports.get(pid).push(Number(port));
  }
  return ports;
}

export function parseProcNet(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== '0A' || !/^\d+$/.test(fields[9] || '')) return [];
    const hex = fields[1]?.split(':')[1];
    const port = /^[0-9A-F]{4}$/i.test(hex || '') ? parseInt(hex,16) : 0;
    return port > 0 ? [{inode:fields[9],port}] : [];
  });
}

const validPid = value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
const address = value => typeof value === 'string' ? value.toLowerCase().replace(/^\[|\]$/g,'') : '';
const localAddress = value => ['127.0.0.1','0.0.0.0','::1','::','0:0:0:0:0:0:0:1','0:0:0:0:0:0:0:0','localhost'].includes(address(value));
const unspecifiedAddress = value => ['0.0.0.0','::','0:0:0:0:0:0:0:0','*'].includes(address(value));
const endpoint = value => {
  const match=String(value).match(/^(\[[^\]]+\]|[^:\s]+):(\d+|\*)$/);
  return match ? {address:match[1],port:match[2]} : null;
};
const integer = value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;

function netstatSnapshot(text) {
  const ports=new Map(),rejectedPids=new Set();
  for(const line of text.split(/\r?\n/)) {
    const match=line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(?:LISTENING|LISTEN|侦听|监听)\s+(\d+)\s*$/i);
    if(!match)continue;
    const local=endpoint(match[1]),remote=endpoint(match[2]),pid=Number(match[3]);
    if(!validPid(pid))continue;
    const port=Number(local?.port);
    // TUN drivers can label outbound fake-IP connections LISTENING. A
    // non-local endpoint must not suppress the PID-verified CIM fallback.
    if(!local||!remote||!localAddress(local.address)||!validPort(port)
      ||!unspecifiedAddress(remote.address)||!(remote.port==='0'||remote.address==='*'&&remote.port==='*')){
      rejectedPids.add(pid);continue;
    }
    if(!ports.has(pid))ports.set(pid,new Set());ports.get(pid).add(port);
  }
  return {ports:new Map([...ports].map(([pid,values])=>[pid,[...values]])),rejectedPids};
}

export function parseNetstat(text) { return netstatSnapshot(text).ports; }

export async function discoverWindowsPorts(pids,{run=exec,expectedPorts=new Map()}={}) {
  const wanted=new Set(pids.filter(validPid));
  if(!wanted.size)return new Map();
  const {stdout}=await run('netstat.exe',['-ano','-p','tcp'],{windowsHide:true,timeout:4000,maxBuffer:4194304}).catch(()=>({stdout:''}));
  const snapshot=netstatSnapshot(stdout);
  const ports=new Map([...snapshot.ports].filter(([pid])=>wanted.has(pid)));
  const missing=[...wanted].filter(pid=>{
    const found=ports.get(pid)||[],expected=[...(expectedPorts.get(pid)||[])].filter(validPort);
    // Hints are newest/preferred first. An older HTTP port may have been
    // reused for gRPC; it cannot suppress recovery of the current HTTP port.
    if(expected.length)return !found.includes(expected[0]);
    return !found.length||snapshot.rejectedPids.has(pid);
  });
  if(!missing.length)return ports;
  // Query all affected PIDs once, including sockets with the TUN-reported
  // nonstandard State 0. Do not accept every remote-port-zero socket: Closed
  // and Bound are not listeners. Preserve all fields for JS validation.
  // An exited/no-socket PID must not discard results for the remaining PIDs.
  const script=`$pulsePids = @(${missing.join(',')}); Get-NetTCPConnection -OwningProcess $pulsePids -ErrorAction SilentlyContinue | Select-Object OwningProcess,LocalAddress,LocalPort,RemoteAddress,RemotePort,State | ConvertTo-Json -Compress`;
  try {
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:1048576});
    const parsed=stdout.replace(/^\uFEFF/,'').trim();
    const value=parsed?JSON.parse(parsed):[],allowed=new Set(missing);
    for(const row of Array.isArray(value)?value:[value]){
      const pid=integer(row?.OwningProcess),port=integer(row?.LocalPort),state=row?.State;
      const listen=state===2||state==='2'||typeof state==='string'&&/^listen$/i.test(state);
      const tunUnknown=state===0||state==='0';
      if(!allowed.has(pid)||!validPort(port)||!localAddress(row?.LocalAddress)
        ||!unspecifiedAddress(row?.RemoteAddress)||integer(row?.RemotePort)!==0||!(listen||tunUnknown))continue;
      if(!ports.has(pid))ports.set(pid,[]);if(!ports.get(pid).includes(port))ports.get(pid).push(port);
    }
  } catch { /* Keep valid native listeners; retry via the client's existing backoff. */ }
  return ports;
}

export async function linuxPorts(pid, { proc = '/proc' } = {}) {
  const { readlink } = await import('node:fs/promises');
  const inodes = new Set();
  for (const fd of await readdir(join(proc,String(pid),'fd'))) {
    try { const link = await readlink(join(proc,String(pid),'fd',fd)); const m=link.match(/^socket:\[(\d+)\]$/); if(m)inodes.add(m[1]); } catch { /* Closed FD. */ }
  }
  const rows = [];
  for (const name of ['tcp','tcp6']) {
    try { rows.push(...parseProcNet(await readFile(join(proc,String(pid),'net',name),'utf8'))); } catch { /* IPv6 may be disabled. */ }
  }
  return [...new Set(rows.filter(row=>inodes.has(row.inode)).map(row=>row.port))];
}

export async function discoverProcesses({ platform = process.platform, run = exec, uid = process.getuid?.(), proc = '/proc', expectedPorts = [] } = {}) {
  if (platform === 'win32') {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe'\" | Where-Object { $_.CommandLine -match '(?:^|\\s)--standalone(?:\\s|=|$)' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:1048576});
    const parsed=stdout.trim()?JSON.parse(stdout.replace(/^\uFEFF/,'')):[];
    const rows=(Array.isArray(parsed)?parsed:[parsed]).filter(row=>Number.isSafeInteger(row?.ProcessId)&&row.ProcessId>0&&/(?:^|\s)--standalone(?:\s|=|$)/.test(row.CommandLine||''));
    if(!rows.length)return [];
    const ports=await discoverWindowsPorts(rows.map(row=>row.ProcessId),{run,
      expectedPorts:new Map(rows.map(row=>[row.ProcessId,expectedPorts]))});
    return rows.map(row=>({...row,Ports:ports.get(row.ProcessId)||[]}));
  }
  if (platform === 'darwin') {
    const {stdout}=await run('/bin/ps',['-ww','-axo','pid=,uid=,args='],{timeout:8000,maxBuffer:4194304});
    const rows=parsePs(stdout,uid);
    if(!rows.length)return [];
    const {stdout:sockets}=await run('/usr/sbin/lsof',['-nP','-a','-p',rows.map(r=>r.ProcessId).join(','),'-iTCP','-sTCP:LISTEN','-Fpn'],{timeout:8000,maxBuffer:1048576}).catch(error=>{if(error.code===1)return {stdout:error.stdout||''};throw error;});
    const ports=parseLsof(sockets);
    return rows.map(row=>({...row,Ports:ports.get(row.ProcessId)||[]}));
  }
  if (platform === 'linux') {
    const rows=[];
    for(const pid of (await readdir(proc)).filter(p=>/^\d+$/.test(p))) {
      try {
        const status=await readFile(join(proc,pid,'status'),'utf8');
        if(Number(status.match(/^Uid:\s+(\d+)/m)?.[1])!==uid)continue;
        const command=(await readFile(join(proc,pid,'cmdline'),'utf8')).split('\0').filter(Boolean).join(' ');
        if(!languageServer(command)||!/--standalone\b/.test(command))continue;
        rows.push({ProcessId:Number(pid),CommandLine:command,Ports:await linuxPorts(pid,{proc})});
      } catch { /* Processes can exit during discovery; inaccessible processes are not candidates. */ }
    }
    return rows;
  }
  throw new Error('Supported platforms: Windows, Linux, macOS');
}

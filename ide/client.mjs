import {AntigravityClient} from '../sidecars/panel/client.mjs';
import {discoverIdeProcesses,discoverIdeLogPorts,agyServer,ideServer,ideHubPort} from './discovery.mjs';
export class IdeClient extends AntigravityClient {
  constructor({profile,debugPort,processes=discoverIdeProcesses,logPorts=discoverIdeLogPorts}={}){super();this.profile=profile;this.debugPort=debugPort;this.ideProcesses=processes;this.logPorts=logPorts;}
  async discoverNow(){
    this.server=null;
    // Missing old-profile logs must not block a 2.6 hub. Logs are optional
    // discovery hints, not ownership or HTTP identity for an agy process.
    const expectedApiPorts=await this.logPorts(this.profile).catch(()=>[]);
    const row=await this.ideProcesses(this.debugPort(),{expectedApiPorts});
    const hub=agyServer(row),hubPort=hub?ideHubPort(row):null;
    const port=hub?(hubPort&&row.Ports.includes(hubPort)?hubPort:null)
      :ideServer(row)?expectedApiPorts.find(port=>row.Ports.includes(port)):null;
    if(!port)throw Error('Waiting for the IDE local API port');
    const csrf=row.CommandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
    if(!csrf)throw Error('IDE local API credential unavailable');
    this.server={port,csrf,pid:row.ProcessId};this.discoveredAt=Date.now();return this.server;
  }
}

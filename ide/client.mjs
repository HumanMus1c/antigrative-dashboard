import {AntigravityClient} from '../sidecars/panel/client.mjs';
import {discoverIdeProcesses,discoverIdeLogPorts} from './discovery.mjs';
export class IdeClient extends AntigravityClient {
  constructor({profile,debugPort,processes=discoverIdeProcesses,logPorts=discoverIdeLogPorts}={}){super();this.profile=profile;this.debugPort=debugPort;this.ideProcesses=processes;this.logPorts=logPorts;}
  async discoverNow(){
    this.server=null;
    const expectedApiPorts=await this.logPorts(this.profile);
    const row=await this.ideProcesses(this.debugPort(),{expectedApiPorts});
    const port=expectedApiPorts.find(port=>row.Ports.includes(port));
    if(!port)throw Error('Waiting for the IDE local API port');
    const csrf=row.CommandLine.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
    if(!csrf)throw Error('IDE local API credential unavailable');
    this.server={port,csrf,pid:row.ProcessId};this.discoveredAt=Date.now();return this.server;
  }
}

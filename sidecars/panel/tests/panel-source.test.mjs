import test from 'node:test';
import assert from 'node:assert/strict';
import {Script,runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {panelAppSource,panelPageSource} from '../panel-source.mjs';

test('sidecar bundle parses as classic JavaScript and waits for its DOM',()=>{
 const source=panelAppSource();assert.doesNotThrow(()=>new Script(source));
 const handlers=[];const window={};
 runInNewContext(source,{window,document:{readyState:'loading',addEventListener:(...args)=>handlers.push(args)}});
 assert.equal(window.__agPulsePanelInstalled,undefined);assert.equal(handlers.length,1);
 assert.equal(handlers[0][0],'DOMContentLoaded');assert.equal(handlers[0][2].once,true);
});

test('an incomplete sidecar document does not register listeners against missing widgets',()=>{
 const window={};assert.doesNotThrow(()=>runInNewContext(panelAppSource(),{window,document:{readyState:'complete',querySelector:()=>null}}));
 assert.equal(window.__agPulsePanelInstalled,undefined);
});

test('panel HTML versions script and styles together using their source content',()=>{
 const html=panelPageSource();const versions=[...html.matchAll(/(?:theme\.css|styles\.css|app\.js)\?v=([a-f0-9]{16})/g)].map(m=>m[1]);
 assert.equal(versions.length,3);assert.equal(new Set(versions).size,1);assert.ok(html.includes(`content="${versions[0]}"`));
 assert.match(html,/<script defer src="\/app\.js\?v=/);assert.doesNotMatch(html,/type="module"/);
});

test('sidecar version badge follows the installed manifest and invalidates all asset URLs',()=>{
 const current=JSON.parse(readFileSync(new URL('../../../plugin.json',import.meta.url),'utf8')).version;
 const badge=html=>html.match(/id="panel-version"[^>]*>([^<]*)<\/span>/)?.[1];
 assert.equal(badge(panelPageSource()),'v'+current);
 const render=version=>panelPageSource({readManifest:()=>JSON.stringify({name:'antigravity-pulse',version})});
 const first=render('9.8.7'),next=render('9.8.8');
 assert.equal(badge(first),'v9.8.7');assert.equal(badge(next),'v9.8.8');
 assert.match(first,/id="panel-name" title="Antigrative Dashboard v9\.8\.7"/);
 const keys=html=>[...html.matchAll(/(?:theme\.css|styles\.css|app\.js)\?v=([a-f0-9]{16})/g)].map(match=>match[1]);
 assert.equal(new Set(keys(first)).size,1);assert.equal(new Set(keys(next)).size,1);
 assert.notEqual(keys(first)[0],keys(next)[0],'Manifest-only changes must invalidate the served page assets');
 assert.equal(badge(render('9.8.7-preview.2+build.4')),'v9.8.7-preview.2+build.4');
});

test('missing, malformed and unrelated manifests hide the badge without breaking the page',()=>{
 for(const manifest of [null,[],{}, {version:'1.2.3'}, {name:'other',version:'1.2.3'},
  ...[null,17,'','v1.2.3','1.2','01.2.3','1.2.3 ", onclick="alert(1)','1.2.3-'+ 'x'.repeat(64)].map(version=>({name:'antigravity-pulse',version}))]){
  const html=panelPageSource({readManifest:()=>JSON.stringify(manifest)});
  assert.match(html,/<span class="version-tag" id="panel-version" hidden><\/span>/);
  assert.doesNotMatch(html,/id="panel-name" title=/);assert.match(html,/<script defer src="\/app\.js\?v=/);
 }
 for(const readManifest of [()=>'{bad json',()=>{throw Error('ENOENT');}]){
  assert.match(panelPageSource({readManifest}),/id="panel-version" hidden><\/span>/);
 }
});

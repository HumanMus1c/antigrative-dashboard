// Custom-scheme sidecars load a classic, self-contained script. Keep the
// editable modules as the single source, with explicit dependency boundaries.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const HERE=dirname(fileURLToPath(import.meta.url));
export function panelAppSource(){
 const read=name=>readFileSync(join(HERE,name),'utf8');
 const factory=name=>{
  const source=read('../../compat/'+name+'.cjs'),prefix='module.exports = ',index=source.indexOf(prefix);
  if(index<0)throw Error('Panel factory format changed: '+name);
  return source.slice(index+prefix.length).trim().replace(/;$/,'');
 };
 let app=read('app.js');
 for(const line of ["import { percent, rate, count, elapsed, countdown, resetDate } from './format.mjs';","import { createI18n } from './i18n.js';","import { createTheme } from './theme.js';"]){
  if(!app.includes(line))throw Error('Panel dependency list changed');app=app.replace(line,'');
 }
 const format=read('format.mjs').replace(/^export function /gm,'function ');
 if(/^\s*(?:import|export)\b/m.test(app+format))throw Error('Unsupported panel module dependency');
 return `(()=>{'use strict';\n${format}\nconst createI18n=(${factory('i18n')});\nconst createTheme=(${factory('theme')});\n${app}\n})();`;
}

function panelVersion(readManifest){
 try{
  const manifest=JSON.parse(readManifest()),value=manifest?.version;
  // Only an installed plugin manifest can supply the release badge. A broken
  // or unrelated manifest must not invent a version or inject HTML attributes.
  if(manifest?.name!=='antigravity-pulse'||typeof value!=='string'||value.length>64)return null;
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)?value:null;
 }catch{return null;}
}

export function panelPageSource({readManifest=()=>readFileSync(join(HERE,'../../plugin.json'),'utf8')}={}){
 const assets=/(href|src)="\/(theme\.css|styles\.css|app\.js)(?:\?[^\"]*)?"/g;
 let html=readFileSync(join(HERE,'index.html'),'utf8').replace(/<meta name="ag-pulse-panel-assets"[^>]*>/g,'').replace(assets,'$1="/$2"');
 const release=panelVersion(readManifest);
 if(release){
  // The title keeps the version discoverable when the narrow layout hides its
  // badge. Insert before hashing so even a manifest-only update busts caches.
  html=html.replace('<span id="panel-name">',`<span id="panel-name" title="Antigrative Dashboard v${release}">`)
   .replace('<span class="version-tag" id="panel-version" hidden></span>',`<span class="version-tag" id="panel-version" title="v${release}">v${release}</span>`);
 }
 const version=createHash('sha256').update(html).update(panelAppSource()).update(readFileSync(join(HERE,'styles.css'))).update(readFileSync(join(HERE,'../../compat/theme.cjs'))).digest('hex').slice(0,16);
 return html.replace(assets,(_,attribute,path)=>`${attribute}="/${path}?v=${version}"`).replace('</head>',`<meta name="ag-pulse-panel-assets" content="${version}"></head>`);
}

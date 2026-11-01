import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalize} from '../metrics.mjs';
import {render,displayWidth} from '../render.mjs';

// Contract-shaped fixtures, not a recording of the user's remote account.
// Exact Argon key is corroborated by upstream status-line consumers:
// https://github.com/akitaonrails/ai-usagebar/releases/tag/v1.40.0
const argonId='gemini-argon-wtu-weekly';
const now=Date.parse('2026-11-01T12:00:00Z');
const payload=()=>({version:'1.4.5',model:{id:'gemini-4-argon-high',display_name:'Gemini 4 Argon (High)'},terminal_width:120,
 context_window:{used_percentage:20,current_usage:{input_tokens:100,cache_read_input_tokens:900,cache_creation_input_tokens:0}},
 quota:{'gemini-5h':{remaining_fraction:.8},'gemini-weekly':{remaining_fraction:.7},
  '3p-5h':{remaining_fraction:.6},'3p-weekly':{remaining_fraction:.5},
  [argonId]:{remaining_fraction:.4,reset_time:'2026-11-05T12:00:00Z',reset_in_seconds:1}}});
const plain=(input,options={})=>render(normalize(input),{color:false,now,width:120,...options});
const strip=text=>text.replace(/\x1b\[[\d;]+m/g,'');

test('official Argon weekly bucket is independent, active first, and does not hide other known families',()=>{
 for(const reversed of [false,true]){
  const input=payload();if(reversed)input.quota=Object.fromEntries(Object.entries(input.quota).reverse());
  const rows=plain(input).split('\n');
  assert.equal(rows.length,4);assert.match(rows[1],/^Argon\s+left\s+week 40%.*4d0h/);
  assert.doesNotMatch(rows[1],/5h|80%|70%/);
  assert.match(rows.find(row=>row.startsWith('Gemini')),/5h 80%.*week 70%/);
  assert.match(rows.find(row=>row.startsWith('Claude\/GPT')),/5h 60%.*week 50%/);
  assert.doesNotMatch(rows.join('\n'),/… \+1/);
  assert.equal(normalize(input).cacheRate.reason,'unverified-cli-version','Adding a quota never opts Argon into an unverified cache policy');
 }
});

test('an Argon-only payload has one weekly row, including actual zero and unknown balances',()=>{
 for(const fraction of [0,undefined,null,'0.8',-1,2]){
  const input={model:{display_name:'Gemini 4 Argon (Medium)'},quota:{[argonId]:{remaining_fraction:fraction}}};
  const rows=plain(input).split('\n');assert.equal(rows.length,2);assert.doesNotMatch(rows[1],/5h/);
  assert.match(rows[1],fraction===0?/week 0% !/:/week --/);
 }
 const amountOnly=plain({quota:{[argonId]:{remaining_amount:10000}}});
 assert.match(amountOnly,/week --/);assert.doesNotMatch(amountOnly,/100%/);
});

test('disabled Argon remains separate and unavailable rather than showing a spendable balance',()=>{
 const input=payload();input.quota[argonId]={remaining_fraction:1,disabled:true,reset_in_seconds:3600};
 for(const [language,label]of [['en','Unavailable'],['zh-CN','不可用'],['zh-TW','無法使用']]){
  const row=plain(input,{language}).split('\n')[1];assert.ok(row.includes(label));
  assert.doesNotMatch(row,/100%|5h|↻/);
 }
});

test('absent dedicated bucket uses returned Gemini windows and never creates Argon quota',()=>{
 const input=payload();delete input.quota[argonId];
 const rows=plain(input).split('\n');assert.equal(rows.length,3);
 assert.match(rows[1],/^Gemini\s+left\s+5h 80%.*week 70%/);assert.doesNotMatch(rows.join('\n'),/^Argon/m);
 input.quota={};assert.match(plain(input),/Quota --/);assert.doesNotMatch(plain(input),/^Argon/m);
});

test('switching model families changes priority without changing balances; supplied ID is authoritative',()=>{
 const input=payload();
 input.model={id:'gemini-3.8-flash-high',display_name:'Gemini 4 Argon (High)'};
 assert.match(plain(input).split('\n')[1],/^Gemini\s/);
 input.model={id:'claude-sonnet-4-6'};assert.match(plain(input).split('\n')[1],/^Claude\/GPT/);
 input.model={display_name:'Gemini 4 Argon (Medium)'};assert.match(plain(input).split('\n')[1],/^Argon\s/);
 const row=plain(input).split('\n')[1];assert.match(row,/week 40%/);
});

test('unknown Argon-looking IDs retain their identities and cannot alias exact contract buckets',()=>{
 for(const key of ['gemini-argon-weekly','gemini-argon-wtu-5h','future-argon-weekly',argonId+'\u202e']){
  const input={model:{id:'gemini-4-argon-high'},quota:{[key]:{remaining_fraction:.42}}};
  const metrics=normalize(input);assert.equal(metrics.quotas[0].bucketId,null);
  const rows=render(metrics,{color:false,width:200}).split('\n');
  assert.ok(rows[1].startsWith(key.replace('\u202e','')));assert.doesNotMatch(rows[1],/^Argon\s/);
 }
 // An unknown key identical to an internal family name cannot merge windows.
 const input={quota:{[argonId]:{remaining_fraction:.4},'gemini-argon':{remaining_fraction:.9}}};
 const rows=plain(input).split('\n');assert.equal(rows.length,3);
 assert.match(rows.find(row=>row.startsWith('Argon ')),/week 40%/);
 assert.match(rows.find(row=>row.startsWith('gemini-argon ')),/90%/);
});

test('known windows survive the bounded input selection even behind many unknown buckets',()=>{
 const input=payload();input.quota={...Object.fromEntries(Array.from({length:20},(_,i)=>['future-'+i,{remaining_fraction:.1}])),...input.quota};
 const metrics=normalize(input);assert.equal(metrics.quotas.length,16);
 for(const key of ['gemini-5h','gemini-weekly','3p-5h','3p-weekly',argonId])assert.ok(metrics.quotas.some(row=>row.bucketId===key));
 const rows=render(metrics,{color:false,width:150}).split('\n');assert.equal(rows.length,4);
 assert.ok(rows.some(row=>/^Gemini\s/.test(row)));assert.ok(rows.some(row=>/^Claude\/GPT\s/.test(row)));assert.ok(rows.some(row=>/^Argon\s/.test(row)));
 assert.match(rows.at(-1),/… \+11/);
});

test('Argon progress retains quota thresholds and all output stays inside narrow CJK/ANSI terminals',()=>{
 for(const [fraction,code]of [[0,31],[.299,31],[.3,33],[.699,33],[.7,32],[1,32]]){
  const input=payload();input.quota[argonId].remaining_fraction=fraction;
  const row=render(normalize(input),{width:120,color:true,now}).split('\n')[1];
  assert.ok(row.includes(`\x1b[1;${code}m`));assert.doesNotMatch(row,/5h/);
 }
 for(const language of ['en','zh-CN','zh-TW'])for(const width of [1,2,8,16,25,32,40,55,80,100,120,500]){
  const metrics=normalize(payload()),colored=render(metrics,{width,language,details:true,now});
  assert.equal(strip(colored),render(metrics,{width,language,details:true,now,color:false}));
  assert.equal(colored.split('\n').length,5);
  for(const line of colored.split('\n'))assert.ok(displayWidth(strip(line))<=width);
  if(width>=32)assert.match(strip(colored).split('\n')[1],/40%/);
 }
});

test('preview command makes all three quota families reproducible without changing cache assumptions',()=>{
 const script=fileURLToPath(new URL('../statusline.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,'--preview-argon','--language','en','--no-color'],{encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,0);assert.equal(result.stderr,'');
 assert.match(result.stdout,/^Argon\s+left\s+week 40%/m);
 assert.match(result.stdout,/^Gemini\s/m);assert.match(result.stdout,/^Claude\/GPT\s/m);
 assert.match(result.stdout,/Cache --/);assert.doesNotMatch(result.stdout,/\x1b/);
});

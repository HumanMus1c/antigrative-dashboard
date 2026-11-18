import { percent, rate, count, elapsed, countdown, resetDate } from './format.mjs';
import { createI18n } from './i18n.js';
import { createTheme } from './theme.js';
function initPanel(){
if(!document.querySelector('.widget')||window.__agPulsePanelInstalled)return;
window.__agPulsePanelInstalled=true;
const theme=createTheme();
let themeController=theme.attach(document.documentElement);
window.addEventListener('pagehide',()=>themeController.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)themeController=theme.attach(document.documentElement);});
const localGet=key=>{try{return localStorage.getItem(key);}catch{return null;}};
const localSet=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const language=createI18n(localGet('ag-pulse-language'));
const t=language.t;

const $ = id => document.getElementById(id);
const text=(id,value)=>{const element=$(id);if(element.textContent!==String(value))element.textContent=String(value);};
const hidden=(id,value)=>{const element=$(id);if(element.hidden!==value)element.hidden=value;};
const compact=n=>{if(typeof n!=='number'||!Number.isFinite(n))return '—';for(const [base,suffix,nextBase,nextSuffix]of [[1e12,'T',0,''],[1e9,'B',1e12,'T'],[1e6,'M',1e9,'B'],[1e3,'K',1e6,'M']])if(n>=base){const scaled=n/base,rounded=Number(scaled.toFixed(1));return nextBase&&rounded*base>=nextBase?`1${nextSuffix}`:`${rounded}${suffix}`;}return String(n);};
const tokUnit=n=>n===1?'tok':'toks';
const compactDetail=n=>{if(typeof n!=='number'||!Number.isFinite(n))return '—';for(const [base,suffix,nextBase,nextSuffix]of [[1e12,'T',0,''],[1e9,'B',1e12,'T'],[1e6,'M',1e9,'B'],[1e3,'K',1e6,'M']])if(n>=base){const scaled=n/base,rounded=Number(scaled.toFixed(scaled<10?2:1));return nextBase&&rounded*base>=nextBase?`1${nextSuffix}`:`${rounded}${suffix}`;}return String(n);};
const chips = [...document.querySelectorAll('[data-card]')];
let snapshot = null, selectedGroup = null, group = null, autoGroupId = null, lastModelSig = null;
let pending = false, timer = null, serverOffset = 0, lastExpiredRefresh = 0;
let selectedCard='speed',cardMotion=null;
let refreshRequest=null,manualRequest=null;
const host = window.sidecar;
if (!host) document.body.classList.add('standalone');
const preferenceRequest=async(input)=>{
  const transport=host?.fetch?host.fetch.bind(host):fetch;
  const response=await transport('/api/preferences',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{cache:'no-store'});
  if(!response.ok)throw new Error('Preferences unavailable');return response.json();
};
const connectPreferences=()=>language.connectPreferences({read:()=>preferenceRequest(),write:preferenceRequest,
  cache:value=>localSet('ag-pulse-language',value),changed:()=>{localize();render();updateCountdowns();}});
let languagePicker=null;
let preferences=connectPreferences();
const speedStyle=language.connectSpeedStyle({initial:localGet('ag-pulse-speed-style'),cache:value=>localSet('ag-pulse-speed-style',value),write:preferenceRequest,
  changed:()=>{applySpeedStyle();localize();render();}});
function applySpeedStyle(){
  document.documentElement.dataset.speedStyle=speedStyle.style;
  $('speed-hero-icon')?.setAttribute('href',speedStyle.style==='cat'?'#gauge':'#pulse');
}

function showCard(name,animate=false) {
  if(!['speed','cache','context'].includes(name))return;
  const changed=selectedCard!==name;selectedCard=name;
  cardMotion?.cancel();cardMotion=null;
  for (const chip of chips){const selected=chip.dataset.card===name;chip.setAttribute('aria-selected',String(selected));chip.tabIndex=selected?0:-1;}
  for (const nameKey of ['speed','cache','context']) $(`${nameKey}-card`).hidden = name !== nameKey;
  if(changed&&animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)cardMotion=$(`${name}-card`).animate([{opacity:.6,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'cubic-bezier(.23,1,.32,1)'});
}
for (const chip of chips) {
  chip.addEventListener('click', event => showCard(chip.dataset.card,event.detail>0));
  chip.addEventListener('keydown',event=>{
    const current=chips.indexOf(chip);let next;
    if(event.key==='ArrowRight')next=(current+1)%chips.length;else if(event.key==='ArrowLeft')next=(current+chips.length-1)%chips.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=chips.length-1;else return;
    event.preventDefault();showCard(chips[next].dataset.card);chips[next].focus();
  });
}
function localize(){
  document.documentElement.lang=language.language;
  for(const e of document.querySelectorAll('[data-i18n]')){const value=t(e.dataset.i18n);if(e.textContent!==value)e.textContent=value;}
  for(const e of document.querySelectorAll('[data-i18n-aria]')){const value=t(e.dataset.i18nAria);if(e.getAttribute('aria-label')!==value)e.setAttribute('aria-label',value);}
  for(const e of document.querySelectorAll('[data-i18n-aria][title]')){const value=t(e.dataset.i18nAria);if(e.title!==value)e.title=value;}
  languagePicker?.update();$('language-toggle').dataset.saveFailed=String(preferences.error);if(preferences.error)$('language-toggle').title+=' · '+t('languageSaveFailed');
  for(const button of document.querySelectorAll('[data-speed-style-choice]')){
    const value=button.dataset.speedStyleChoice,name=t(value==='cat'?'styleCat':'styleMinimal'),failed=speedStyle.error&&speedStyle.style===value;
    button.setAttribute('aria-label',name);button.title=failed?`${name} · ${t('styleSaveFailed')}`:name;
    button.setAttribute('aria-pressed',String(speedStyle.style===value));button.dataset.saveFailed=String(failed);
  }
}

function chooseGroup(groups, speed, composerModel) {
  return language.chooseQuotaGroup(groups,[composerModel,speed?.model],selectedGroup);
}
function groupLabel(value) {
  return language.quotaGroupLabel(value);
}

function renderQuota(window, prefix, now = Date.now() + serverOffset) {
  const bucket = group?.windows?.[window];
  const remaining = language.quotaRemaining(bucket);
  $(`${prefix}-balance`).textContent = bucket?.disabled?t('unavailableQuota'):percent(remaining);
  const forecast = language.quotaForecast(bucket, window, now);
  const barBg = remaining !== null && remaining < .05 ? 'var(--pulse-danger)' : (remaining !== null && remaining < .2) || forecast?.willExhaust ? 'var(--pulse-warning)' : '';
  const fill = $(`${prefix}-fill`), projectedFill = $(`${prefix}-projected-fill`), track = $(`${prefix}-track`);
  // Solid fill is always the real balance; the hatched tail marks what the
  // current pace is expected to consume before the window resets.
  const hatch = Boolean(forecast?.forecastReady && remaining !== null && forecast.projectedRemaining < remaining - 0.005);
  fill.style.width = typeof remaining === 'number' ? `${remaining * 100}%` : '0%';
  fill.style.background = barBg;
  if (projectedFill) {
    projectedFill.style.left = hatch ? `${forecast.projectedRemaining * 100}%` : '0%';
    projectedFill.style.width = hatch ? `${(remaining - forecast.projectedRemaining) * 100}%` : '0%';
  }
  const forecastRow = $(`${prefix}-forecast`), forecastMain = $(`${prefix}-forecast-text`);
  if (forecastRow && forecastMain) {
    const showForecast = Boolean(forecast && typeof forecast.timeRemaining === 'number');
    hidden(`${prefix}-forecast`, !showForecast);
    if (showForecast) {
      if (forecast.willExhaust) {
        forecastMain.textContent = t('forecastDepletes', { eta: language.shortEta(forecast.exhaustInMs), early: language.shortEta(forecast.earlyByMs) });
        forecastMain.setAttribute('data-alert', 'true');
      } else {
        forecastMain.removeAttribute('data-alert');
        forecastMain.textContent = forecast.warmingUp ? t('forecastWarming', { pct: percent(forecast.used) }) : t('forecastLeft', { pct: percent(forecast.projectedRemaining) });
      }
      forecastRow.title = t('forecastBasis', { remaining: percent(forecast.remaining), time: percent(forecast.timeRemaining) });
    }
  }
  if (typeof remaining === 'number') { track.setAttribute('aria-valuenow', String(remaining * 100)); track.setAttribute('aria-valuemin','0'); track.setAttribute('aria-valuemax','100'); }
  else track.removeAttribute('aria-valuenow');
  const unavailableNote = !bucket?.available ? t('noQuota') : bucket.disabled ? t('disabledQuota') : remaining === null ? t('noFraction') : '';
  text(`${prefix}-note`, unavailableNote);
  hidden(`${prefix}-note`, !unavailableNote);
  const usageRow = $(`${prefix}-usage`);
  if (usageRow) {
    const winUsage = group?.id && !bucket?.disabled && bucket?.available ? snapshot?.usage?.quotaWindows?.[`${group.id}:${window}`] : null;
    const showUsage = Boolean(winUsage && typeof winUsage.observedTokens === 'number' && winUsage.observedTokens > 0);
    hidden(`${prefix}-usage`, !showUsage);
    if (showUsage) {
      const refText = winUsage.estimatedFullTokens ? ` (${t('quotaWindowFullRef', { full: compact(winUsage.estimatedFullTokens) })})` : '';
      text(`${prefix}-usage-value`, `${compact(winUsage.observedTokens)} ${tokUnit(winUsage.observedTokens)}${refText}`);
      usageRow.title = t('quotaWindowBasis');
    } else usageRow.removeAttribute('title');
  }
}

function renderPanelTrail(samples) {
  const svg = $('panel-speed-trail');
  if (!svg) return;
  const key = speedStyle.style + '|' + samples.join(',');
  if (svg.dataset.renderKey === key) return;
  svg.dataset.renderKey = key;
  const NS = 'http://www.w3.org/2000/svg', W = 120, H = 44, TOP = 14, snap = v => Math.round(v / 2) * 2;
  if (speedStyle.style !== 'cat') {
    const node = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
    const shape = language.minimalTrail(samples, { width: W, height: H, top: 5, bottom: 2, right: 4 });
    svg.replaceChildren(
      node('line', { class: 'panel-min-base', x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5 }),
      ...(shape ? [node('path', { class: 'panel-min-area', d: shape.area }), node('path', { class: 'panel-min-line', d: shape.line }), node('circle', { class: 'panel-min-dot', cx: shape.end[0], cy: shape.end[1], r: 2.4 })] : []),
    );
    return;
  }
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  let line = '', start = 0;
  if (samples.length) {
    const rawMax = Math.max(...samples), rawMin = Math.min(...samples), flat = rawMax === rawMin;
    const max = rawMax * 1.04, min = rawMin * 0.82, slots = Math.max(samples.length, 10), last = samples.length - 1;
    const x = idx => snap(W - ((last - idx) * (W - 4)) / (slots - 1)), y = val => flat ? snap(Math.round(H * 0.55)) : snap(TOP + (H - TOP - 4) * (1 - (val - min) / (max - min || 1)));
    start = Math.max(0, snap(x(0) - (W - 4) / (slots - 1)));
    line = `M${start} ${y(samples[0])}`;
    samples.forEach((v, idx) => { if (idx) line += `H${x(idx)}V${y(v)}`; });
    line += `H${W - 2}`;
  }
  svg.replaceChildren(
    el('line', { class: 'panel-speed-base', x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5 }),
    ...(line ? [el('path', { class: 'panel-speed-area', d: `${line}V${H}H${start}Z` }), el('path', { class: 'panel-speed-line', d: line })] : []),
  );
}

function render() {
  if (!snapshot) return;
  const groups = snapshot.groups || [], speed = snapshot.speed, composerModel = snapshot.composerModel || null;
  const modelSig = `${composerModel || ''}\n${speed?.model || ''}`;
  if (lastModelSig === null) lastModelSig = modelSig;
  else if (modelSig !== lastModelSig) { lastModelSig = modelSig; selectedGroup = null; }
  autoGroupId = language.chooseQuotaGroup(groups, [composerModel, speed?.model], null)?.id || null;
  group = chooseGroup(groups, speed, composerModel);
  const optionsKey = JSON.stringify([groups.map(g => [g.id,groupLabel(g)]),Boolean(group),language.language]);
  const select = $('quota-group');
  if (select.dataset.options !== optionsKey) {
    const options=groups.map(g=>new Option(groupLabel(g),g.id));
    if(!group){const empty=new Option(t('unavailableQuota'),'');empty.disabled=true;options.unshift(empty);}
    select.replaceChildren(...options);
    select.dataset.options = optionsKey;
  }
  select.value = group?.id||'';
  select.dataset.quotaFamily=language.quotaGroupKind(group)||'';
  select.title = group?groupLabel(group):t('unavailableQuota');
  for (const element of document.querySelectorAll('.group-name')) element.textContent = group ? groupLabel(group) : '—';
  const now = Date.now() + serverOffset;
  const panelSpot = $('panel-active-group');
  if (panelSpot) {
    text('panel-group-name', group ? groupLabel(group) : '—');
    hidden('panel-active-group', !group);
    const pace = group ? language.groupQuotaPace(group, now) : null;
    const badge = $('panel-quota-pace');
    if (badge) {
      hidden('panel-quota-pace', !pace);
      if (pace) {
        text('panel-quota-pace-text', pace.label);
        badge.dataset.pace = pace.pace;
        if (pace.critical) badge.dataset.critical = 'true'; else badge.removeAttribute('data-critical');
        badge.title = pace.title;
      }
    }
  }
  const visibleQuotaWindows=language.quotaWindows(group),isArgon=language.quotaGroupKind(group)==='gemini-argon';
  for(const [key,prefix]of[['5h','five'],['weekly','week']]){
    hidden(`${prefix}-summary`,!visibleQuotaWindows.includes(key));hidden(`${prefix}-details`,!visibleQuotaWindows.includes(key));
  }
  $('quota-overview').dataset.windows=String(visibleQuotaWindows.length);
  text('week-summary-label',t(isArgon?'argonWeek':'weekShort'));text('week-quota-title',t(isArgon?'argonWeek':'week'));
  $('week-details').setAttribute('aria-label',t(isArgon?'argonWeek':'week'));
  renderQuota('5h','five',now); renderQuota('weekly','week',now);
  const sibWrap = $('panel-quota-siblings');
  if (sibWrap) {
    const siblings = group ? groups.filter(g => g.id !== group.id) : groups;
    hidden('panel-quota-siblings', !siblings.length);
    const sibSig = JSON.stringify(siblings.map(g => [g.id, groupLabel(g), language.quotaWindows(g), language.quotaGroupKind(g) === 'gemini-argon', language.language]));
    if (sibWrap.dataset.signature !== sibSig) {
      sibWrap.replaceChildren(...siblings.map(g => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quota-sibling';
        btn.dataset.group = g.id;
        const wins = language.quotaWindows(g), sibArgon = language.quotaGroupKind(g) === 'gemini-argon';
        const lbl = document.createElement('span'); lbl.className = 'sibling-label';
        const dot = document.createElement('i'); dot.className = 'sibling-dot'; dot.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'); name.className = 'sibling-name'; name.textContent = groupLabel(g);
        lbl.append(dot, name);
        const metrics = document.createElement('span'); metrics.className = 'sibling-metrics';
        for (const w of wins) {
          const winEl = document.createElement('span'); winEl.className = 'sibling-win'; winEl.dataset.window = w;
          const tagEl = document.createElement('span'); tagEl.className = 'sibling-tag'; tagEl.textContent = w === '5h' ? '5h' : t(sibArgon ? 'argonWeek' : 'weekShort');
          const valEl = document.createElement('span'); valEl.className = 'sibling-val'; valEl.textContent = '—';
          const bar = document.createElement('i'); bar.className = 'sibling-bar';
          const fill = document.createElement('i'); bar.append(fill);
          winEl.append(tagEl, valEl, bar);
          metrics.append(winEl);
        }
        btn.append(lbl, metrics);
        btn.addEventListener('click', () => {
          const kb = btn.matches(':focus-visible');
          selectedGroup = g.id === autoGroupId ? null : g.id;
          render();
          if (kb) sibWrap.querySelector('.quota-sibling')?.focus({ preventScroll: true });
        });
        return btn;
      }));
      sibWrap.dataset.signature = sibSig;
    }
    for (const btn of sibWrap.children) {
      const g = groups.find(item => item.id === btn.dataset.group);
      if (!g) continue;
      const wins = language.quotaWindows(g), sibArgon = language.quotaGroupKind(g) === 'gemini-argon';
      const tipParts = [groupLabel(g)];
      for (const w of wins) {
        const winEl = btn.querySelector(`.sibling-win[data-window="${w}"]`);
        if (!winEl) continue;
        const b = g?.windows?.[w], remaining = language.quotaRemaining(b), val = b?.disabled ? t('unavailableQuota') : percent(remaining);
        const valEl = winEl.querySelector('.sibling-val'), fillEl = winEl.querySelector('.sibling-bar i');
        if (valEl && valEl.textContent !== val) valEl.textContent = val;
        if (fillEl) {
          const nextWidth = typeof remaining === 'number' ? `${remaining * 100}%` : '0%';
          const nextBg = remaining !== null && remaining < .05 ? 'var(--pulse-danger)' : remaining !== null && remaining < .2 ? 'var(--pulse-warning)' : '';
          if (fillEl.style.width !== nextWidth) fillEl.style.width = nextWidth;
          if (fillEl.style.background !== nextBg) fillEl.style.background = nextBg;
        }
        const tag = w === '5h' ? '5h' : t(sibArgon ? 'argonWeek' : 'weekShort');
        tipParts.push(`${tag} ${val}`);
      }
      const tip = tipParts.join(' · ');
      if (btn.title !== tip) btn.title = tip;
    }
  }
  const isFiniteRate=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const legacyRate=speed?.latestRateStatus==='legacy',unreliableRate=speed?.latestRateStatus==='unreliable';
  const latestVal=!speed||legacyRate?null:!unreliableRate&&isFiniteRate(speed.latestTps)?speed.latestTps:isFiniteRate(speed.tps)?speed.tps:null;
  const trailSamples=speed&&!legacyRate?(Array.isArray(speed.recentTps)&&speed.recentTps.length?speed.recentTps.filter(v=>isFiniteRate(v)&&v>0):latestVal>0?[Math.round(latestVal*10)/10]:[]):[];
  renderPanelTrail(trailSamples);
  $('strip-tps').textContent = rate(speed?.tps);
  $('speed-tab').title=rate(speed?.tps)+' tok/s';
  $('session-tps').textContent = legacyRate?t('ratePending'):rate(speed?.tps);
  hidden('panel-session-unit',Boolean(legacyRate));
  $('latest-tps').textContent = unreliableRate?t('timingUnreliable'):legacyRate?t('ratePending'):rate(latestVal);
  if(unreliableRate||legacyRate)$('latest-tps').setAttribute('data-status','true');else $('latest-tps').removeAttribute('data-status');
  hidden('panel-latest-unit',Boolean(unreliableRate||legacyRate));
  const peakCandidate=legacyRate||!speed?-1:isFiniteRate(speed.peakTps)?speed.peakTps:Math.max(isFiniteRate(speed.tps)?speed.tps:-1,!unreliableRate&&isFiniteRate(speed.latestTps)?speed.latestTps:-1);
  text('peak-tps',peakCandidate>=0?rate(peakCandidate):'—');
  $('request-count').textContent = t('sampleCount',{n:speed?.measuredRequests??0});
  $('session-steps').textContent = speed ? t('rounds',{rounds:speed.rounds,steps:speed.steps}).replace(/\s*·\s*$/,'') : '';
  const collectionLimited=snapshot.collection?.state==='limited',collectionProcessing=snapshot.collection?.state==='processing'&&snapshot.collection.code==='background-collection';
  $('strip-model').textContent = collectionProcessing?t(speed?'collectionSaved':'collectionProcessing'):collectionLimited?t(speed?'collectionSaved':'collectionLimited'):speed?.model || t(snapshot.sessionError?'collectionUnavailable':'waitingRequest');
  $('strip-model').title=$('strip-model').textContent;
  $('model-time').textContent = language.elapsed(speed?.modelSeconds);
  $('tool-time').textContent = language.elapsed(speed?.toolSeconds);
  text('speed-times', speed ? `${language.elapsed(speed.modelSeconds)} / ${language.elapsed(speed.toolSeconds)}` : '—');
  if ($('speed-times')?.parentElement) $('speed-times').parentElement.title = speed ? `${t('modelTime')}: ${language.elapsed(speed.modelSeconds)} · ${t('toolTime')}: ${language.elapsed(speed.toolSeconds)}` : '';
  $('ttft').textContent = language.elapsed(speed?.ttftSeconds);
  const respOut = speed?.counts?.responseOutput, thinkOut = speed?.counts?.thinkingOutput;
  $('token-detail').textContent = speed ? `${count(respOut)} / ${count(thinkOut)} ${tokUnit((respOut || 0) + (thinkOut || 0))}` : '—';
  text('speed-basis-tag', speed ? t(speed.rateBasis === 'all-output' ? 'basisShortAll' : 'basisShortResponse') : '');
  const taskUsage=Number.isSafeInteger(speed?.taskUsage?.subagents)&&speed.taskUsage.subagents>0?speed.taskUsage:null;
  const usage=taskUsage||speed,cache=usage?.cache;
  const currentOnly=!collectionLimited&&!collectionProcessing&&taskUsage?.state==='partial'&&taskUsage.loadedSubagents===0;
  const cacheTab=$('cache-tab');
  const cacheAttr=(name,value)=>{if(value===null){if(cacheTab.hasAttribute(name))cacheTab.removeAttribute(name);}else if(cacheTab.getAttribute(name)!==value)cacheTab.setAttribute(name,value);};
  cacheAttr('data-task-current-only',currentOnly?'true':null);
  cacheAttr('aria-label',currentOnly?t('taskCurrentOnly'):null);
  cacheAttr('title',currentOnly?t('taskCurrentOnly'):null);
  const context=speed?.context,hasCapacity=typeof context?.usedFraction==='number';
  $('strip-context').textContent=hasCapacity?`${Math.round(context.usedFraction*100)}%`:'—';
  $('strip-context-size').textContent=context?`${compact(context.usedTokens)} / ${context.maxTokens===null?'—':compact(context.maxTokens)}`:'—';
  $('context-tab').title=context?t('contextTokens',{used:count(context.usedTokens),max:context.maxTokens===null?'—':count(context.maxTokens)}):t('contextUnknown');
  $('context-summary').textContent=hasCapacity?t('contextUsed',{used:Math.round(context.usedFraction*100),remaining:Math.round(context.remainingFraction*100)}):t('contextUnknown');
  $('context-tokens').textContent=context?t('contextTokens',{used:compact(context.usedTokens),max:context.maxTokens===null?'—':compact(context.maxTokens)}):'—';
  $('context-model').textContent=context?.model||'—';
  $('context-fill').style.width=hasCapacity?`${Math.min(1,context.usedFraction)*100}%`:'0%';
  $('context-fill').style.background=hasCapacity&&context.usedFraction>=.9?'var(--pulse-danger)':'';
  if(hasCapacity){$('context-track').setAttribute('aria-valuenow',String(Math.min(100,context.usedFraction*100)));$('context-track').setAttribute('aria-valuemin','0');$('context-track').setAttribute('aria-valuemax','100');}else $('context-track').removeAttribute('aria-valuenow');
  text('strip-cache',percent(cache?.hitRate));text('cache-rate',percent(cache?.hitRate));
  const tokens=usage?.tokens || cache;
  // Coverage remains available in raw statistics and documented separately.
  const hasTotal=tokens?.measuredRequests&&Number.isSafeInteger(tokens.totalTokens)&&tokens.totalTokens>=0;
  text('strip-cache-total',hasTotal?`${compact(tokens.totalTokens)} tok`:'— tok');
  text('cache-coverage',hasTotal?(tokens.totalTokens>=1e9?compactDetail(tokens.totalTokens):count(tokens.totalTokens)):'—');
  text('cache-coverage-unit',hasTotal?tokUnit(tokens.totalTokens):'toks');
  const setTip=(el,tip)=>{if(!el)return;if(tip===null){if(el.hasAttribute('title'))el.removeAttribute('title');}else if(el.getAttribute('title')!==tip)el.setAttribute('title',tip);};
  setTip($('cache-coverage')?.parentElement,hasTotal&&tokens.totalTokens>=1e9?`${count(tokens.totalTokens)} ${tokUnit(tokens.totalTokens)}`:null);
  const inputCoverage={uncachedTokens:'uncachedRequests',cachedTokens:'cachedRequests',cacheWriteTokens:'cacheWriteRequests'};
  for(const [field,id,labelKey]of[['cachedTokens','cache-read','cacheRead'],['uncachedTokens','cache-miss','cacheMiss'],['outputTokens','cache-output','cacheOutput']]) {
    const available=field==='outputTokens'?(tokens?.outputAvailable??(tokens?.outputRequests??tokens?.measuredRequests)):(tokens?.[inputCoverage[field]]??tokens?.inputRequests??tokens?.measuredRequests);
    const known=Number.isSafeInteger(tokens?.[field])&&tokens[field]>=0;
    const cell=$(`${id}-cell`);
    if(available&&known){
      const v=tokens[field];
      text(id,compactDetail(v));text(`${id}-unit`,` ${tokUnit(v)}`);hidden(`${id}-unit`,false);
      setTip(cell,`${t(labelKey)}: ${count(v)} ${tokUnit(v)}`);
    }else{
      text(id,'—');hidden(`${id}-unit`,true);
      setTip(cell,null);
    }
  }
  const cwAvail=tokens?.cacheWriteRequests??tokens?.inputRequests??tokens?.measuredRequests;
  const cwKnown=cwAvail&&Number.isSafeInteger(tokens?.cacheWriteTokens)&&tokens.cacheWriteTokens>=0;
  const cwVal=tokens?.cacheWriteTokens;
  text('cache-write',cwKnown?`${cwVal>=1e9?compactDetail(cwVal):count(cwVal)} ${tokUnit(cwVal)}`:'—');
  setTip($('cache-write-row'),cwKnown&&cwVal>=1e9?`${count(cwVal)} ${tokUnit(cwVal)}`:null);
  const readVal=Number.isSafeInteger(tokens?.cachedTokens)&&tokens.cachedTokens>0?tokens.cachedTokens:0;
  const missVal=Number.isSafeInteger(tokens?.uncachedTokens)&&tokens.uncachedTokens>0?tokens.uncachedTokens:0;
  const outVal=Number.isSafeInteger(tokens?.outputTokens)&&tokens.outputTokens>0?tokens.outputTokens:0;
  const meterSum=readVal+missVal+outVal;
  $('cache-seg-read').style.width=meterSum?`${(readVal/meterSum)*100}%`:'0%';
  $('cache-seg-miss').style.width=meterSum?`${(missVal/meterSum)*100}%`:'0%';
  $('cache-seg-out').style.width=meterSum?`${(outVal/meterSum)*100}%`:'0%';
  hidden('cache-write-row',!(tokens?.cacheWriteTokens>0));
  hidden('task-own-row',!taskUsage);hidden('task-subagents-row',!taskUsage);
  text('task-subagents-label',taskUsage?t('taskSubagents',{n:count(taskUsage.subagents)}):'');
  for(const [field,id,rowId]of[['ownTokens','task-own','task-own-row'],['subagentTokens','task-subagents','task-subagents-row']]){
    const value=taskUsage?.[field],known=field!=='subagentTokens'||taskUsage?.loadedSubagents>0;
    const ok=known&&Number.isSafeInteger(value)&&value>=0;
    text(id,ok?`${value>=1e9?compactDetail(value):count(value)} ${tokUnit(value)}`:'—');
    setTip($(rowId),ok&&value>=1e9?`${count(value)} ${tokUnit(value)}`:null);
  }
  const taskNote=taskUsage?.state==='loading'?t('taskLoading'):taskUsage?.state==='partial'?t(taskUsage.loadedSubagents===0?'taskCurrentOnly':'taskPartial'):'';
  text('cache-note',taskNote);hidden('cache-note',!taskNote);
  $('connection-dot').className = `connection-dot ${snapshot.connection}`;
  $('connection-dot').title = t(snapshot.connection === 'live'?'live':snapshot.connection === 'stale'?'stale':'offline');
  const timestamp = snapshot.quotaUpdatedAt ? new Date(snapshot.quotaUpdatedAt).toLocaleTimeString(language.language,{hour12:false}) : null;
  $('health-note').textContent = (collectionProcessing?t('collectionProcessingReason'):collectionLimited?t('collectionReason'):language.errorMessage(snapshot.error||snapshot.sessionError)) || (timestamp ? t('health',{time:timestamp}) : t('firstUpdate'));
  $('health-note').classList.toggle('warning', snapshot.connection !== 'live' || !!snapshot.sessionError || collectionLimited);
  const integration = snapshot.integration;
  $('integration-note').textContent = integration && !['mounted','disabled'].includes(integration.state)
    ? (language.language === 'zh-TW' ? '內嵌狀態列正在自動重新連線；此面板仍可檢視統計資料。' : (language.language === 'zh-CN' ? '内嵌栏正在自动重连；此面板仍可查看统计。' : 'Inline widget is reconnecting automatically; statistics remain available in this panel.')) : '';
  updateCountdowns();
}

function updateCountdowns() {
  const now = Date.now() + serverOffset;
  for (const [window,prefix] of [['5h','five'],['weekly','week']]) {
    const bucket = group?.windows?.[window];
    $(`${prefix}-countdown`).textContent = language.countdown(bucket?.resetAt,now);
    $(`${prefix}-summary-countdown`).textContent=language.countdown(bucket?.resetAt,now,true);
    const remaining=language.quotaRemaining(bucket);
    $(`${prefix}-summary-balance`).textContent=bucket?.disabled?t('unavailableQuota'):percent(remaining);
    $(`${prefix}-summary-fill`).style.width=remaining!==null?`${remaining*100}%`:'0%';
    if (bucket?.resetAt && Date.parse(bucket.resetAt) <= now && snapshot?.connection === 'live' && now - lastExpiredRefresh > 30000) {
      lastExpiredRefresh = now; setTimeout(() => refresh(true),0);
    }
  }
}

function refreshBusy(busy){
  const button=$('refresh-button');button.setAttribute('aria-busy',String(busy));button.setAttribute('aria-disabled',String(busy));
  button.dataset.i18nAria=busy?'refreshing':'refreshStats';button.title=t(button.dataset.i18nAria);button.setAttribute('aria-label',button.title);
}
function refreshManually(){
  if(manualRequest)return;
  refreshBusy(true);const started=performance.now();
  manualRequest=(async()=>{
    try{if(pending)await refreshRequest;await refresh(true);}
    finally{
      const remaining=250-(performance.now()-started);
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      refreshBusy(false);manualRequest=null;
    }
  })();
}
function refresh(force = false) {
  if (pending) return refreshRequest;
  pending = true;
  refreshRequest=(async()=>{
  try {
    const params = new URLSearchParams();
    if (host?.conversationId) params.set('conversationId',host.conversationId);
    if (force) params.set('force','1');
    const transport = host?.fetch ? host.fetch.bind(host) : fetch;
    const response = await transport(`/api/metrics?${params}`,{cache:'no-store'});
    if (!response.ok) throw new Error(t('panelUnavailable'));
    const value = await response.json();
    if (!['live','stale','offline'].includes(value.connection)) throw new Error(t('invalidData'));
    snapshot = value;
    if(Object.hasOwn(value,'theme'))themeController.setHostTheme(value.theme);
    if(value.preferences){preferences.sync(value.preferences);speedStyle.sync(value.preferences);}
    serverOffset = Date.parse(value.serverTime) - Date.now();
    if (!Number.isFinite(serverOffset)) serverOffset = 0;
    render();
  } catch (error) {
    if (snapshot) { snapshot.connection = 'stale'; snapshot.error = error.message; render(); }
    else { $('health-note').textContent = language.errorMessage(error.message); $('health-note').classList.add('warning'); }
  } finally {
    pending = false; refreshRequest=null;
    clearTimeout(timer); timer = setTimeout(refresh, document.hidden ? 10000 : 2200);
  }
  })();
  return refreshRequest;
}
$('quota-group').addEventListener('change', event => { selectedGroup = event.target.value === autoGroupId ? null : event.target.value; render(); });
$('refresh-button').addEventListener('click', refreshManually);
languagePicker=language.mountLanguagePicker({button:$('language-toggle'),parent:document.body,choose:value=>preferences.choose(value)});
for(const button of document.querySelectorAll('[data-speed-style-choice]'))button.addEventListener('click',()=>void speedStyle.choose(button.dataset.speedStyleChoice));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('pagehide',()=>{preferences.dispose();languagePicker.close(false);});
window.addEventListener('pageshow',event=>{if(event.persisted)preferences=connectPreferences();});
setInterval(updateCountdowns,1000);
applySpeedStyle();
localize();
showCard('speed');
refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPanel,{once:true});
else initPanel();

// The app: /app (dashboard) · /app/new + /app/edit/:id (5-step wizard) · /app/w/:id (one watch, live feed + 24h chart).
import { CONFIG } from './config.js';
import * as chain from './chain.js';
import { $, $$, esc, toast, copyText, fmt, ago, reduced } from './ui.js';
import { hoot, icon, channelLogo } from './hoot.js';
import * as R from './rules.js';
import { go, addCleanup } from './main.js';

const KIND_EMOJI = { failed: '⚠️', any: '📣' };
const emojiFor = (rule, label = '') => {
  if (!rule) return '🦉';
  if (KIND_EMOJI[rule.kind]) return KIND_EMOJI[rule.kind];
  if (/owner/i.test(rule.event)) return '👑';
  if (/vote/i.test(rule.event)) return '🗳';
  if (/transfer/i.test(rule.event) || /transfer/i.test(label)) return '💸';
  return '🔔';
};
const netTag = (net) => `<span class="net-tag ${net.key === 'testnet' ? 'test' : ''}">${net.key === 'testnet' ? 'Testnet · 968' : 'Mainnet · 677'}</span>`;
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok'; } catch { return 'Asia/Bangkok'; } };
const KNOWN_SIGS = () => {
  const E = window.ethers; if (!E) return {};
  const out = { [R.ZERO32]: 'Any event', [R.failedSig(E)]: 'Failed calls' };
  ['Transfer(address,address,uint256)', 'OwnershipTransferred(address,address)', 'Approval(address,address,uint256)', 'ApprovalForAll(address,address,bool)', 'VoteCast(address,uint256,uint8,uint256,string)'].forEach((s) => (out[E.id(s)] = `Event ${s.split('(')[0]}`));
  return out;
};
export const sigName = (sig) => KNOWN_SIGS()[sig] || `Event ${sig.slice(0, 10)}…`;

/** Rule text for a watch: this browser first, then the Worker. */
async function ruleFor(watch, state) {
  const local = chain.localRules.get(watch.id);
  if (local?.rule) return local.rule;
  if (state?.rule) return state.rule;
  return null;
}
function statusOf(watch, st) {
  if (!watch.active) return st?.autoPaused ? { cls: 'paused', text: 'Paused · 500/day limit' } : { cls: 'paused', text: 'Paused' };
  if (st?.error) return { cls: 'error', text: 'Error' };
  if (st && st.behind > 20) return { cls: 'catching', text: `Catching up · ${fmt(st.behind)} blocks behind` };
  return { cls: '', text: 'Watching' };
}
async function workerStates(ids) {
  if (!chain.hasWorker() || chain.MODE === 'preview' || !ids.length) return {};
  try { return (await chain.worker.state(ids)).watches || {}; } catch { return {}; }
}

// =================================================================== DASHBOARD
export async function renderDashboard(root) {
  root.innerHTML = `<section class="app wrap">
    <div class="app-head"><div><h1>Your watches</h1><p>Every watch you registered, what it’s doing, and when it last hooted.</p></div>
      <a class="btn btn-primary" href="app/new" data-link>${icon.plus()} New watch</a></div>
    <div id="dashBody"><div class="card panel"><div class="row"><span class="spin"></span> Loading your watches…</div></div></div>
  </section>`;
  const body = $('#dashBody', root);
  const paint = async () => {
    const me = chain.currentAccount();
    if (!me) {
      body.innerHTML = `<div class="card empty">${hoot('watch')}<h2>Connect your wallet</h2><p>Your watches are tied to the wallet that registered them. Connect to see them — or start a new one.</p>
        <div class="row" style="justify-content:center"><button class="btn btn-ink" id="dConnect" type="button">${icon.wallet()} Connect wallet</button><a class="btn btn-outline" href="app/new" data-link>Start watching</a></div></div>`;
      $('#dConnect', body).addEventListener('click', async () => { try { await chain.connect(); } catch (e) { toast(e.message, true); } });
      return;
    }
    let watches;
    await chain.loadEthers().catch(() => {});
    try { watches = (await chain.registry.watchesOf(me)).filter((w) => !chain.hidden.all().has(w.id)); } catch (e) {
      body.innerHTML = `<div class="notice bad">Couldn’t read WatchRegistry: ${esc(e.message)}</div>`; return;
    }
    if (!watches.length) {
      body.innerHTML = `<div class="card empty">${hoot('sleep', { title: 'Hoot is asleep on a branch' })}<h2>No watches yet</h2><p>Paste a contract, pick what to watch, and Hoot will ping you when it happens.</p><a class="btn btn-primary" href="app/new" data-link>Start watching</a></div>`;
      return;
    }
    const states = await workerStates(watches.map((w) => w.id));
    const rows = await Promise.all(watches.reverse().map(async (w) => {
      const st = states[w.id];
      const rule = await ruleFor(w, st);
      const s = statusOf(w, st);
      const net = chain.netByChainId(w.chainId);
      return `<a class="card watch-row" href="app/w/${w.id}" data-link>
        <span class="wr-em">${emojiFor(rule, w.label)}</span>
        <div style="min-width:0"><h3>${esc(w.label)}</h3><div class="wr-sub">${esc(rule ? R.describeRule(rule) : sigName(w.eventSig))}</div><div class="wr-sub">${esc((rule?.name ? rule.name + ' · ' : '') + chain.short(w.target))} · ${net.key}</div></div>
        <div class="wr-hide"><div class="wr-k">Last alert</div><div class="wr-v">${st?.lastAlertAt ? ago(st.lastAlertAt) : '—'}</div></div>
        <div class="wr-hide"><div class="wr-k">Alerts today</div><div class="wr-v">${st ? fmt(st.alertsToday || 0) : '—'}</div></div>
        <span class="status ${s.cls}">${esc(s.text)}</span>
      </a>`;
    }));
    const note = !chain.hasWorker() ? `<div class="notice warn">🦉 The alert Worker isn’t connected yet, so alerts aren’t being sent. Open a watch to see its recent matches, scanned live in your browser.</div>` : '';
    body.innerHTML = note + `<div class="watch-list">${rows.join('')}</div>`;
  };
  await paint();
  addCleanup(chain.onChange((w) => w === 'wallet' && paint()));
}

// =================================================================== WIZARD
const STEPS = ['Contract', 'What to watch', 'Filters', 'Where to send', 'Register'];
const SUGGEST = ['Tell me when someone sends more than 1,000 BOT', 'Ping me when the owner changes', 'Every new vote', 'Any failed call to this contract'];

export async function renderWizard(root, editId = null) {
  const params = new URLSearchParams(location.search);
  const s = {
    step: 1, maxStep: 1, editId,
    address: '', net: null, checking: false, checkMsg: '', info: null,
    abiMode: 'auto', template: '', abiText: '', abiErr: '', events: [],
    name: '', unit: 'BOT', decimals: 18,
    chip: params.get('chip') || '', say: params.get('say') || '', sayMsg: '', sayBusy: false,
    rule: null, ruleErr: '',
    label: '', quietOn: false, quietFrom: '23:00', quietTo: '07:00', tz: browserTz(),
    channel: { type: 'dashboard', code: '', connected: false, chat: '', url: '', tested: false, msg: '' },
    tx: null, done: null, original: null,
  };
  let pollTimer;
  addCleanup(() => clearInterval(pollTimer));

  root.innerHTML = `<section class="app wrap">
    <div class="crumbs"><a href="app" data-link>Dashboard</a> / ${editId === null ? 'New watch' : `Edit watch #${editId}`}</div>
    <div class="app-head"><div><h1>${editId === null ? 'Create a watch' : 'Edit this watch'}</h1><p>Five short steps. Nothing goes on-chain until you press Register.</p></div></div>
    <div class="wiz"><nav class="card wiz-rail" id="rail" aria-label="Steps"></nav><div id="stepBody"></div></div>
  </section>`;
  const rail = $('#rail', root);
  const body = $('#stepBody', root);

  // ---------- edit mode: load the watch and its rule
  if (editId !== null) {
    try {
      const w = await chain.registry.getWatch(editId);
      const st = (await workerStates([editId]))[editId];
      const rule = await ruleFor(w, st);
      if (!R.isAddress(w.owner) || !chain.sameAddr(w.owner, chain.currentAccount())) {
        body.innerHTML = `<div class="notice bad">Only the wallet that registered watch #${editId} can edit it. Connect that wallet and try again.</div>`; renderRail(); return;
      }
      if (!rule) { body.innerHTML = `<div class="notice warn">This browser doesn’t have the rule for watch #${editId} (only its hash is on-chain). Open it from the browser you created it in, or connect the Worker.</div>`; renderRail(); return; }
      Object.assign(s, {
        address: w.target, net: chain.netByChainId(w.chainId), events: rule.events.map(R.parseEventFragment).filter(Boolean), abiMode: 'paste',
        abiText: rule.events.join('\n'), name: rule.name, unit: rule.unit, decimals: rule.decimals ?? 18, rule, label: w.label, original: w,
        quietOn: !!rule.quiet, quietFrom: rule.quiet?.from || '23:00', quietTo: rule.quiet?.to || '07:00', tz: rule.quiet?.tz || browserTz(),
        step: 3, maxStep: 5,
      });
      const ch = chain.localRules.get(editId)?.channel;
      if (ch) s.channel = { ...s.channel, ...ch, connected: ch.type === 'telegram', tested: true };
    } catch (e) { body.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
  } else if (R.isAddress(params.get('address'))) {
    s.address = params.get('address');
  }

  function renderRail() {
    rail.innerHTML = STEPS.map((t, i) => {
      const n = i + 1;
      return `<button type="button" data-go="${n}" ${n > s.maxStep ? 'disabled' : ''} ${n === s.step ? 'aria-current="step"' : ''} class="${n < s.step ? 'done' : ''}"><span class="n">${n < s.step ? '✓' : n}</span>${t}</button>`;
    }).join('') + `<div class="rail-hoot">${hoot(s.step === 5 && s.done ? 'bell' : s.step === 2 ? 'happy' : 'watch')}</div>`;
    $$('[data-go]', rail).forEach((b) => b.addEventListener('click', () => goStep(Number(b.dataset.go))));
  }
  function goStep(n) {
    s.step = n; s.maxStep = Math.max(s.maxStep, n);
    renderRail(); paint();
    if (window.scrollY > 200) window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }
  const paint = () => [null, step1, step2, step3, step4, step5][s.step]();
  const foot = (back, nextLabel, nextOk = true, nextId = 'next') => `<div class="panel-foot">${back ? `<button class="btn btn-outline btn-sm" type="button" id="back">Back</button>` : '<span></span>'}
    ${nextLabel ? `<button class="btn btn-primary" type="button" id="${nextId}" ${nextOk ? '' : 'disabled'}>${nextLabel} ${icon.right()}</button>` : ''}</div>`;
  const bindBack = () => $('#back', body)?.addEventListener('click', () => goStep(s.step - 1));

  // ---------------------------------------------------------------- step 1: contract + ABI
  async function checkAddress() {
    const a = s.address.trim();
    s.net = null; s.info = null; s.checkMsg = '';
    if (!R.isAddress(a)) { s.checkMsg = a ? 'That doesn’t look like an address (0x + 40 characters).' : ''; step1(); return; }
    s.checking = true; step1();
    try {
      const r = await chain.detectNetwork(a);
      if (!r.net) { s.checkMsg = 'No contract code at this address on BOT Chain mainnet or testnet. Check the address — or the network you deployed to.'; }
      else {
        s.net = r.net;
        s.info = await chain.explorerInfo(r.net, a);
        if (s.info.name && !s.name) s.name = s.info.name.slice(0, R.LIMITS.name);
        if (s.info.symbol) s.unit = s.info.symbol.slice(0, 10);
        if (s.info.decimals != null) s.decimals = s.info.decimals;
        if (s.info.abi && s.abiMode === 'auto') applyAbi(s.info.abi);
        else if (!s.info.abi && s.abiMode === 'auto') { s.abiMode = 'template'; if (s.info.decimals != null) pickTemplate('erc20'); }
      }
    } catch (e) { s.checkMsg = `Couldn’t reach BOT Chain: ${e.message}`; }
    s.checking = false; step1();
  }
  function applyAbi(text) {
    s.abiText = text;
    const p = R.parseAbi(text);
    s.abiErr = p.error === 'empty' ? '' : p.error ? 'That isn’t an ABI we can read. Paste the JSON array, a Remix artifact, or lines like “event Transfer(…)”.' : '';
    s.events = p.events;
  }
  function pickTemplate(key) { s.template = key; s.events = R.templateEvents(key); s.abiErr = ''; }

  function step1() {
    const ok = !!s.net && !s.abiErr && (s.events.length > 0 || s.template === 'any' || (s.abiMode !== 'template' && s.abiText.trim().length > 0));
    const infoLine = s.checking ? `<div class="row" style="margin-top:10px"><span class="spin"></span> Looking on mainnet and testnet…</div>`
      : s.net ? `<div class="row" style="margin-top:10px">${netTag(s.net)}<span class="okmsg">Contract found ✓</span>${s.info?.name ? `<span class="muted">${esc(s.info.name)}${s.info.symbol ? ` · ${esc(s.info.symbol)}` : ''}</span>` : ''}<a class="muted" href="${chain.explorerAddress(s.address, s.net)}" target="_blank" rel="noopener" style="font-size:13px">explorer ↗</a></div>`
      : s.checkMsg ? `<p class="err" style="margin-top:10px">${esc(s.checkMsg)}</p>` : '';
    const abiTabs = [['auto', 'From explorer'], ['paste', 'Paste JSON'], ['file', 'Drop Remix artifact'], ['template', 'Template']];
    let abiBody = '';
    if (s.abiMode === 'auto') abiBody = s.info?.abi ? `<p class="okmsg" style="margin-top:12px">Verified ABI loaded from ${esc(new URL(s.net.explorer).host)} ✓${s.info.proxy ? ' (proxy → implementation)' : ''}</p>` : `<p class="hint" style="margin-top:12px">${s.net ? 'This contract isn’t verified on the explorer — paste its ABI, drop a Remix artifact or pick a template.' : 'Paste an address first — Hoot will load the verified ABI if there is one.'}</p>`;
    if (s.abiMode === 'paste') abiBody = `<label class="field"><span class="sr">ABI</span><textarea class="input" id="abiText" placeholder='[{"type":"event","name":"Transfer",…}]  — or —  event Transfer(address indexed from, address indexed to, uint256 value)'>${esc(s.abiText)}</textarea></label>`;
    if (s.abiMode === 'file') abiBody = `<div class="drop" id="drop" style="margin-top:12px">Drop the Remix artifact (<span class="mono">Contract.json</span>) here, or <label>choose a file<input type="file" id="abiFile" accept=".json,application/json" hidden></label>.</div>`;
    if (s.abiMode === 'template') abiBody = `<div class="tpl-grid">${Object.entries(R.TEMPLATE_ABIS).map(([k, t]) => `<button class="tpl" type="button" data-tpl="${k}" aria-pressed="${s.template === k}">${t.title}<small>${k === 'any' ? 'every log' : t.events.map((e) => R.parseEventFragment(e).name).join(' · ')}</small></button>`).join('')}</div>`;
    body.innerHTML = `<div class="card panel">
      <h2>Which contract?</h2><p class="lead">Paste an address. Hoot checks BOT Chain mainnet and testnet and finds the right one.</p>
      <div class="field"><span>Contract address</span><div class="row"><input class="input mono grow" id="addr" value="${esc(s.address)}" placeholder="0x…" spellcheck="false" autocomplete="off" ${s.editId !== null ? 'disabled' : ''}>
        ${s.editId === null ? `<button class="btn btn-ink" type="button" id="check">Check</button>` : ''}</div>${infoLine}</div>
      <label class="field"><span>What do you call it? <small>(shown in alerts, optional)</small></span><input class="input" id="cname" maxlength="${R.LIMITS.name}" value="${esc(s.name)}" placeholder="Snack Poll"></label>
      <div class="field"><span>Contract events (ABI)</span><div class="seg" role="group">${abiTabs.map(([k, t]) => `<button type="button" data-abi="${k}" aria-pressed="${s.abiMode === k}">${t}</button>`).join('')}</div>${abiBody}
        ${s.abiErr ? `<p class="err">${esc(s.abiErr)}</p>` : ''}
        ${s.events.length ? `<div class="events-list">${s.events.slice(0, 24).map((e) => `<span class="ev-tag">${esc(e.name)}</span>`).join('')}${s.events.length > 24 ? `<span class="ev-tag">+${s.events.length - 24}</span>` : ''}</div>`
          : (s.abiText || s.template === 'any') && !s.abiErr ? `<div class="notice warn" style="margin-top:12px">This ABI has no events — only “Failed calls” and “Any event” (raw topics) are available.</div>` : ''}
      </div>
      ${foot(false, 'Next: what to watch', ok)}</div>`;
    const addr = $('#addr', body);
    addr?.addEventListener('input', () => { s.address = addr.value.trim(); if (R.isAddress(s.address)) checkAddress(); });
    addr?.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkAddress(); });
    $('#check', body)?.addEventListener('click', checkAddress);
    $('#cname', body).addEventListener('input', (e) => (s.name = e.target.value));
    $$('[data-abi]', body).forEach((b) => b.addEventListener('click', () => { s.abiMode = b.dataset.abi; if (s.abiMode === 'auto' && s.info?.abi) applyAbi(s.info.abi); step1(); }));
    $$('[data-tpl]', body).forEach((b) => b.addEventListener('click', () => { pickTemplate(b.dataset.tpl); step1(); }));
    const ta = $('#abiText', body);
    ta?.addEventListener('input', () => { applyAbi(ta.value); const pos = ta.selectionStart; step1(); const t2 = $('#abiText', body); t2.focus(); t2.setSelectionRange(pos, pos); });
    const drop = $('#drop', body);
    if (drop) {
      const readFile = async (f) => { if (!f) return; applyAbi(await f.text()); if (!s.abiErr) s.abiMode = 'paste'; step1(); };
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
      $('#abiFile', body).addEventListener('change', (e) => readFile(e.target.files[0]));
    }
    $('#next', body)?.addEventListener('click', () => goStep(2));
    if (s.address && !s.net && !s.checking && !s.checkMsg && s.editId === null) checkAddress();
  }

  // ---------------------------------------------------------------- step 2: what to watch
  const extra = () => ({ unit: s.unit, name: s.name, decimals: s.decimals, quiet: null });
  function setRule(draft, { fromSay = false } = {}) {
    if (!draft) { s.rule = null; s.ruleErr = "I couldn't map that — pick an event"; return false; }
    draft.name = s.name; draft.unit = draft.unit && draft.unit !== 'BOT' ? draft.unit : s.unit; draft.decimals = s.decimals;
    // sentence numbers default to 18 decimals; use the token's own decimals when the explorer knows them
    if (fromSay && s.decimals !== 18) (draft.conditions || []).forEach((c) => { if (c.decimals === 18) c.decimals = s.decimals; });
    const v = R.validateRule(draft, s.events);
    if (!v.ok) { s.rule = null; s.ruleErr = v.error; return false; }
    s.rule = v.rule; s.ruleErr = '';
    if (!s.label || s.editId === null) s.label = v.rule.label;
    return true;
  }
  async function askAI() {
    const text = s.say.trim();
    if (!text) return;
    s.sayBusy = true; s.chip = ''; step2();
    let draft = null; let via = 'built-in';
    if (chain.hasWorker()) {
      try { draft = (await chain.worker.rule(text, s.events, s.unit, s.decimals)).rule; via = 'ai'; } catch { /* fall back */ }
    }
    if (!draft) draft = R.guessRule(text, s.events);
    s.sayBusy = false;
    s.sayMsg = setRule(draft, { fromSay: true }) ? via : 'fail';
    step2();
  }
  function step2() {
    const avail = R.chipAvailability(s.events);
    const card = s.rule ? `<div class="bot-msg">${hoot('happy')}<div>
        ${s.sayMsg === 'ai' || s.sayMsg === 'built-in' ? 'Here’s the rule I made:' : 'Your rule:'}
        <div class="rule-card" style="margin-top:8px;box-shadow:none"><div class="rc-chips">${ruleChipsHtml(s.rule)}</div><p class="rc-text mono">${esc(R.describeRule(s.rule))}</p>
        <div class="rc-actions"><button class="btn btn-primary btn-sm" type="button" id="looks">Looks right</button><button class="btn btn-outline btn-sm" type="button" id="edit">Edit</button></div></div></div></div>`
      : s.ruleErr ? `<div class="bot-msg">${hoot('confused')}<div><b>${esc(s.ruleErr)}</b><br><span class="muted">Try one of the templates above, or say it with an event name: ${s.events.slice(0, 4).map((e) => `<span class="mono">${esc(e.name)}</span>`).join(', ') || '—'}.</span></div></div>` : '';
    body.innerHTML = `<div class="card panel">
      <h2>What should Hoot watch?</h2><p class="lead">Pick a template, or just say it.</p>
      <div class="chips" role="group" aria-label="Templates">${R.CHIPS.map((c) => `<button class="chip" type="button" data-chip="${c.id}" aria-pressed="${s.chip === c.id}" ${avail[c.id] ? '' : 'aria-disabled="true" title="This contract’s ABI doesn’t have a matching event"'}>${c.emoji} ${c.label}</button>`).join('')}</div>
      <div class="or">or just say it</div>
      <div class="say-box">
        <div class="suggest">${SUGGEST.map((t) => `<button type="button" data-sug="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="chat-input" id="sayForm"><input id="sayIn" value="${esc(s.say)}" placeholder="Tell me when someone sends more than 1,000 ${esc(s.unit)}" aria-label="Describe what to watch" maxlength="240">
          <button class="round-btn" type="submit" aria-label="Make the rule" ${s.sayBusy ? 'disabled' : ''}>${s.sayBusy ? '<span class="spin"></span>' : icon.arrow()}</button></form>
        ${card}
      </div>
      ${foot(true, 'Next: filters', !!s.rule)}</div>`;
    bindBack();
    $$('[data-chip]', body).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') { toast('This contract’s ABI doesn’t have a matching event.', true); return; }
      s.chip = b.dataset.chip; s.sayMsg = '';
      setRule(R.ruleFromChip(s.chip, s.events, extra()));
      step2();
    }));
    $$('[data-sug]', body).forEach((b) => b.addEventListener('click', () => { s.say = b.dataset.sug; askAI(); }));
    $('#sayForm', body).addEventListener('submit', (e) => { e.preventDefault(); s.say = $('#sayIn', body).value; askAI(); });
    $('#looks', body)?.addEventListener('click', () => goStep(4));
    $('#edit', body)?.addEventListener('click', () => goStep(3));
    $('#next', body)?.addEventListener('click', () => goStep(3));
  }
  // first visit with ?chip / ?say from the website
  let autoDone = false;
  const autoFromParams = () => {
    if (autoDone || !s.events) return; autoDone = true;
    if (s.say) { askAI(); return; }
    if (s.chip && R.chipAvailability(s.events)[s.chip]) setRule(R.ruleFromChip(s.chip, s.events, extra()));
  };

  // ---------------------------------------------------------------- step 3: filters (rule editor)
  function step3() {
    const r = s.rule || { kind: 'event', conditions: [] };
    const ev = r.kind === 'event' ? s.events.find((e) => e.name === r.event) : null;
    const tzs = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Bangkok', 'Europe/London', 'America/New_York']; } })();
    const condRow = (c, i) => {
      const f = ev?.inputs.find((x) => x.name === c.field) || ev?.inputs[0];
      return `<div class="cond" data-i="${i}">
        <select class="select input" data-k="field" aria-label="Field">${ev.inputs.map((x) => `<option value="${esc(x.name)}" ${x.name === c.field ? 'selected' : ''}>${esc(x.name)} · ${x.type}</option>`).join('')}</select>
        <select class="select input" data-k="op" aria-label="Comparison">${R.opsFor(f.type).map((o) => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input class="input mono" data-k="value" value="${esc(c.value)}" aria-label="Value" placeholder="${R.isAddr(f.type) ? '0x…' : R.isNum(f.type) ? '1000' : 'text'}">
        ${R.isNum(f.type) ? `<label class="dec" title="Divide by 10^decimals (token units)"><input type="checkbox" data-k="decOn" ${c.decimals ? 'checked' : ''}> ÷10^<input class="input mono" data-k="decimals" value="${c.decimals || s.decimals}" style="width:52px;min-height:34px;padding:4px 6px" aria-label="Decimals"></label>` : '<span></span>'}
        <button class="x" type="button" data-k="del" aria-label="Remove condition">${icon.close()}</button></div>`;
    };
    const quick = ev ? [
      ['from', ev.inputs.find((x) => x.type === 'address' && /^(from|_from|sender|src)$/i.test(x.name))],
      ['to', ev.inputs.find((x) => x.type === 'address' && /^(to|_to|recipient|dst)$/i.test(x.name))],
      ['min value', R.valueField(ev)],
    ].filter(([, f]) => f) : [];
    body.innerHTML = `<div class="card panel">
      <h2>Filters</h2><p class="lead">Fine-tune when Hoot should speak up.</p>
      <div class="field"><span>Watch for</span><div class="seg" role="group">
        <button type="button" data-kind="event" aria-pressed="${r.kind === 'event'}" ${s.events.length ? '' : 'disabled'}>One event</button>
        <button type="button" data-kind="any" aria-pressed="${r.kind === 'any'}">Any event</button>
        <button type="button" data-kind="failed" aria-pressed="${r.kind === 'failed'}">Failed calls</button></div></div>
      ${r.kind === 'event' ? `<label class="field"><span>Event</span><select class="select input" id="evSel">${s.events.map((e) => `<option value="${esc(e.name)}" ${e.name === r.event ? 'selected' : ''}>${esc(e.signature)}</option>`).join('')}</select></label>
        <div class="field"><span>Conditions <small>(all must match)</small></span>
          ${ev && r.conditions.length ? r.conditions.map(condRow).join('') : '<p class="hint">No conditions — every matching event alerts.</p>'}
          ${ev && ev.inputs.length ? `<div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-xs" type="button" id="addCond">${icon.plus()} Condition</button>${quick.map(([k, f]) => `<button class="btn btn-ghost btn-xs" type="button" data-quick="${esc(f.name)}" data-qk="${k}">+ ${k === 'min value' ? 'Min value' : k === 'from' ? 'From address' : 'To address'}</button>`).join('')}</div>` : ''}
        </div>` : r.kind === 'failed' ? `<p class="hint" style="margin-top:14px">Hoot checks every transaction sent to this contract and alerts when one reverts (status 0).</p>` : `<p class="hint" style="margin-top:14px">Every log this contract emits will alert${s.events.length ? `, decoded with its ${s.events.length} known events` : ' (raw topics)'}.</p>`}
      <div class="row" style="margin-top:4px">
        <label class="field grow"><span>Label <small>(on-chain, ≤ 40)</small></span><input class="input" id="label" maxlength="40" value="${esc(s.label)}" ${s.editId !== null ? 'disabled title="The label is fixed on-chain"' : ''}></label>
        <label class="field" style="width:130px"><span>Unit</span><input class="input mono" id="unit" maxlength="10" value="${esc(s.unit)}"></label>
      </div>
      <div class="field"><span>Quiet hours</span><div class="quiet-row">
        <label class="switch"><input type="checkbox" id="qOn" ${s.quietOn ? 'checked' : ''}><i></i>On</label>
        <input class="input mono" type="time" id="qFrom" value="${s.quietFrom}" aria-label="Quiet from" ${s.quietOn ? '' : 'disabled'}>
        <input class="input mono" type="time" id="qTo" value="${s.quietTo}" aria-label="Quiet until" ${s.quietOn ? '' : 'disabled'}>
        <select class="select input" id="qTz" aria-label="Timezone" ${s.quietOn ? '' : 'disabled'}>${tzs.map((z) => `<option ${z === s.tz ? 'selected' : ''}>${z}</option>`).join('')}</select>
      </div><small>During quiet hours alerts are held and sent as one digest when they end.</small></div>
      <div class="notice ${s.ruleErr ? 'bad' : 'ok'}" style="margin-top:20px">${s.ruleErr ? esc(s.ruleErr) : `<span class="mono">${esc(R.describeRule(s.rule))}</span>`}</div>
      ${foot(true, 'Next: where to send', !!s.rule && !s.ruleErr)}</div>`;
    bindBack();
    const recheck = (draft) => { const v = R.validateRule({ ...draft, decimals: s.decimals, quiet: s.quietOn ? { from: s.quietFrom, to: s.quietTo, tz: s.tz } : null, name: s.name, unit: s.unit, label: s.label }, s.events); s.rule = v.ok ? v.rule : { ...draft }; s.ruleErr = v.ok ? '' : v.error; if (v.ok && !s.label) s.label = v.rule.label; };
    const cur = () => ({ ...(s.rule || {}), kind: r.kind, event: r.event, conditions: [...(r.conditions || [])], events: r.events });
    $$('[data-kind]', body).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.kind;
      const d = k === 'event' ? { kind: 'event', event: s.events[0]?.name, conditions: [] } : { kind: k, events: k === 'any' ? s.events.map((e) => e.fragment) : [] };
      if (s.editId === null) s.label = '';
      recheck(d); step3();
    }));
    $('#evSel', body)?.addEventListener('change', (e) => { if (s.editId === null) s.label = ''; recheck({ kind: 'event', event: e.target.value, conditions: [] }); step3(); });
    $('#addCond', body)?.addEventListener('click', () => { const f = ev.inputs[0]; const d = cur(); d.conditions.push({ field: f.name, op: R.opsFor(f.type)[0], value: '', decimals: 0 }); recheck(d); step3(); });
    $$('[data-quick]', body).forEach((b) => b.addEventListener('click', () => {
      const d = cur(); const k = b.dataset.qk;
      d.conditions.push(k === 'min value' ? { field: b.dataset.quick, op: '>=', value: '1000', decimals: s.decimals } : { field: b.dataset.quick, op: '=', value: '' });
      recheck(d); step3();
    }));
    $$('.cond', body).forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = (redraw) => {
        const d = cur(); const c = { ...d.conditions[i] };
        c.field = $('[data-k="field"]', row).value; c.op = $('[data-k="op"]', row).value; c.value = $('[data-k="value"]', row).value;
        const on = $('[data-k="decOn"]', row); c.decimals = on && on.checked ? Math.max(0, parseInt($('[data-k="decimals"]', row).value, 10) || 0) : 0;
        const f = ev.inputs.find((x) => x.name === c.field);
        if (!R.opsFor(f.type).includes(c.op)) c.op = R.opsFor(f.type)[0];
        d.conditions[i] = c; recheck(d);
        if (redraw) step3(); else { const n = $('.notice', body); n.className = `notice ${s.ruleErr ? 'bad' : 'ok'}`; n.innerHTML = s.ruleErr ? esc(s.ruleErr) : `<span class="mono">${esc(R.describeRule(s.rule))}</span>`; $('#next', body).disabled = !!s.ruleErr; }
      };
      $('[data-k="field"]', row).addEventListener('change', () => upd(true));
      $('[data-k="op"]', row).addEventListener('change', () => upd(false));
      $('[data-k="value"]', row).addEventListener('input', () => upd(false));
      $('[data-k="decOn"]', row)?.addEventListener('change', () => upd(false));
      $('[data-k="decimals"]', row)?.addEventListener('input', () => upd(false));
      $('[data-k="del"]', row).addEventListener('click', () => { const d = cur(); d.conditions.splice(i, 1); recheck(d); step3(); });
    });
    $('#label', body).addEventListener('input', (e) => { s.label = e.target.value; recheck(cur()); });
    $('#unit', body).addEventListener('input', (e) => { s.unit = e.target.value.trim() || 'BOT'; recheck(cur()); const n = $('.notice', body); n.innerHTML = s.ruleErr ? esc(s.ruleErr) : `<span class="mono">${esc(R.describeRule(s.rule))}</span>`; });
    const q = () => { s.quietOn = $('#qOn', body).checked; s.quietFrom = $('#qFrom', body).value || '23:00'; s.quietTo = $('#qTo', body).value || '07:00'; s.tz = $('#qTz', body).value; recheck(cur()); };
    $('#qOn', body).addEventListener('change', () => { q(); step3(); });
    ['#qFrom', '#qTo', '#qTz'].forEach((id) => $(id, body).addEventListener('change', q));
    $('#next', body)?.addEventListener('click', () => { recheck(cur()); if (!s.ruleErr) goStep(4); else step3(); });
    if (s.rule) recheck(cur());
  }

  // ---------------------------------------------------------------- step 4: where to send
  function step4() {
    const c = s.channel;
    const noWorker = !chain.hasWorker();
    let detail = '';
    if (c.type === 'telegram') {
      detail = noWorker ? `<div class="notice warn" style="margin:0">The alert Worker isn’t connected yet, so the Telegram bot can’t be linked. Pick Discord or Dashboard only for now.</div>`
        : c.connected ? `<div class="row"><span class="okmsg">Connected ✓ ${esc(c.chat || '')}</span><button class="btn btn-outline btn-sm" type="button" id="test">${icon.send()} Send test</button><button class="btn btn-ghost btn-xs" type="button" id="tgAgain">Use another chat</button></div>`
        : `<p class="hint">Opens <span class="mono">t.me/${esc(CONFIG.telegramBot)}</span>. Press <b>Start</b> and the bot replies “Connected ✓”.</p>
           <div class="row" style="margin-top:10px"><button class="btn btn-ink" type="button" id="tgGo">${channelLogo.telegram()} Connect Telegram</button>${c.code ? `<span class="row muted" style="font-size:14px"><span class="spin"></span> Waiting for you to press Start…</span>` : ''}</div>`;
    }
    if (c.type === 'discord') {
      detail = `<label class="field" style="margin-top:0"><span>Channel webhook URL</span><input class="input mono" id="hook" value="${esc(c.url)}" placeholder="https://discord.com/api/webhooks/…" spellcheck="false" autocomplete="off"><small>Discord → Channel settings → Integrations → Webhooks → Copy URL. It stays in the Worker, never on-chain.</small></label>
        <div class="row" style="margin-top:10px"><button class="btn btn-outline btn-sm" type="button" id="test" ${/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(c.url) ? '' : 'disabled'}>${icon.send()} Send test</button></div>`;
    }
    if (c.type === 'dashboard') detail = `<p class="hint">No pings — matches show up on your dashboard only. You can add Telegram or Discord later with Edit.</p>`;
    body.innerHTML = `<div class="card panel">
      <h2>Where should Hoot hoot?</h2><p class="lead">Pick one place for alerts.</p>
      <div class="ch-grid">
        <button class="ch" type="button" data-ch="telegram" aria-pressed="${c.type === 'telegram'}">${channelLogo.telegram()}<b>Telegram</b><small>A message from the Contract Watch bot</small></button>
        <button class="ch" type="button" data-ch="discord" aria-pressed="${c.type === 'discord'}">${channelLogo.discord()}<b>Discord</b><small>A post in your channel via webhook</small></button>
        <button class="ch" type="button" data-ch="dashboard" aria-pressed="${c.type === 'dashboard'}"><span style="font-size:30px;line-height:1">📊</span><b>Dashboard only</b><small>No pings, just the live feed</small></button>
      </div>
      <div class="ch-detail">${detail}${c.msg ? `<p class="${c.msgBad ? 'err' : 'okmsg'}" style="margin-top:10px">${esc(c.msg)}</p>` : ''}</div>
      ${foot(true, 'Next: review', c.type === 'dashboard' || (c.type === 'telegram' && c.connected) || (c.type === 'discord' && /^https:\/\//.test(c.url)))}</div>`;
    bindBack();
    $$('[data-ch]', body).forEach((b) => b.addEventListener('click', () => { c.type = b.dataset.ch; c.msg = ''; clearInterval(pollTimer); step4(); }));
    $('#hook', body)?.addEventListener('input', (e) => { c.url = e.target.value.trim(); c.tested = false; c.msg = ''; const t = $('#test', body); if (t) t.disabled = !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(c.url); $('#next', body).disabled = !/^https:\/\//.test(c.url); });
    $('#tgGo', body)?.addEventListener('click', () => {
      c.code = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
      window.open(`https://t.me/${CONFIG.telegramBot}?start=${c.code}`, '_blank', 'noopener');
      const t0 = Date.now();
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (Date.now() - t0 > 180000) { clearInterval(pollTimer); c.msg = 'Didn’t hear back from Telegram — press Connect again.'; c.msgBad = true; c.code = ''; step4(); return; }
        try { const r = await chain.worker.tgStatus(c.code); if (r.connected) { clearInterval(pollTimer); c.connected = true; c.chat = r.chat || ''; c.msg = ''; step4(); } } catch { /* keep waiting */ }
      }, 2500);
      step4();
    });
    $('#tgAgain', body)?.addEventListener('click', () => { c.connected = false; c.code = ''; step4(); });
    $('#test', body)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        if (chain.hasWorker()) {
          await chain.worker.test(c.type === 'telegram' ? { type: 'telegram', code: c.code } : { type: 'discord', url: c.url }, s.label || 'Test');
          c.msg = 'Test sent ✓ — check your ' + (c.type === 'telegram' ? 'Telegram' : 'channel') + '.';
        } else {
          // no Worker yet: Discord accepts a simple multipart post straight from the browser (no reply readable)
          const fd = new FormData();
          fd.append('content', `🦉 Hoot! Test from Contract Watch — ${s.label || 'your watch'} is set up.`);
          await fetch(c.url, { method: 'POST', mode: 'no-cors', body: fd });
          c.msg = 'Test sent — check your channel. (If nothing arrives, the webhook URL is wrong.)';
        }
        c.msgBad = false; c.tested = true;
      } catch (err) { c.msg = err.message || 'That didn’t work — check the webhook URL.'; c.msgBad = true; }
      step4();
    });
    $('#next', body)?.addEventListener('click', () => goStep(5));
  }

  // ---------------------------------------------------------------- step 5: register
  async function step5() {
    if (s.done) return doneView();
    const E = await chain.loadEthers();
    const hash = R.ruleHash(s.rule, E);
    const sig = R.eventSigOf(s.rule, E);
    const chLabel = { telegram: `Telegram ${s.channel.chat ? '· ' + s.channel.chat : ''}`, discord: 'Discord webhook', dashboard: 'Dashboard only' }[s.channel.type];
    const unchanged = s.original && s.original.ruleHash === hash;
    const live = chain.MODE === 'live';
    const needWallet = live && !chain.wallet.hasWallet;
    const tx = s.tx;
    body.innerHTML = `<div class="card panel">
      <h2>${s.editId === null ? 'Register the watch' : 'Save your changes'}</h2>
      <p class="lead">${s.editId === null ? 'One transaction records the watch on BOT Chain. Then you sign a short message so the Worker knows it’s yours.' : unchanged ? 'The rule is the same, so no transaction is needed — just a signature to update the alert settings.' : 'One transaction updates the rule hash on-chain, then a signature updates the Worker.'}</p>
      <div class="review">
        <div class="review-row"><span>Contract</span><span><span class="mono">${esc(s.address)}</span> ${s.name ? `· ${esc(s.name)}` : ''} ${netTag(s.net)}</span></div>
        <div class="review-row"><span>Rule</span><span class="mono">${esc(R.describeRule(s.rule))}</span></div>
        <div class="review-row"><span>Label</span><span>${esc(s.label)}</span></div>
        <div class="review-row"><span>Quiet hours</span><span>${s.rule.quiet ? `${s.rule.quiet.from}–${s.rule.quiet.to} · ${esc(s.rule.quiet.tz)}` : 'Off'}</span></div>
        <div class="review-row"><span>Alerts go to</span><span>${esc(chLabel)}</span></div>
        <div class="review-row"><span>On-chain</span><span class="mono" style="font-size:12px;word-break:break-all">eventSig ${sig}<br>ruleHash ${hash}</span></div>
      </div>
      ${needWallet ? `<div class="notice warn" style="margin-top:16px">MetaMask isn’t installed. <a href="https://metamask.io/download/" target="_blank" rel="noopener">Install it</a> to register — you can still explore templates and public pages.</div>` : ''}
      ${live && chain.wallet.account && !chain.wallet.chainOk ? `<div class="notice warn" style="margin-top:16px">Your wallet is on another network. <button class="btn btn-ink btn-sm" type="button" id="sw">Switch to BOT Chain</button></div>` : ''}
      ${tx ? `<div class="tx-state ${tx.bad ? 'bad' : ''}">${tx.bad ? '⚠️' : '<span class="spin"></span>'}<span>${tx.text}</span></div>` : ''}
      ${foot(true, '', true)}</div>`;
    const f = $('.panel-foot', body);
    f.insertAdjacentHTML('beforeend', `<button class="btn btn-primary" type="button" id="reg" ${needWallet || (tx && !tx.bad) ? 'disabled' : ''}>${tx?.bad ? 'Try again' : s.editId === null ? 'Register watch' : unchanged ? 'Sign & save' : 'Update rule'}</button>`);
    bindBack();
    $('#sw', body)?.addEventListener('click', async () => { try { await chain.switchNetwork(); step5(); } catch (e) { toast(e.message, true); } });
    $('#reg', body).addEventListener('click', async () => {
      const setTx = (text, bad = false) => { s.tx = { text, bad }; step5(); };
      try {
        let id = s.editId; let txHash = '';
        if (s.editId === null) {
          setTx('Confirm the transaction in MetaMask…');
          const r = await chain.registry.register(s.address, s.net.chainId, sig, hash, s.label, (h) => { txHash = h; setTx(`Registering on BOT Chain… <a href="${chain.explorerTx(h)}" target="_blank" rel="noopener">view tx ↗</a>`); });
          id = r.id; txHash = r.hash;
        } else if (!unchanged) {
          setTx('Confirm the rule update in MetaMask…');
          const r = await chain.registry.updateRule(s.editId, hash, (h) => setTx(`Updating the rule on BOT Chain… <a href="${chain.explorerTx(h)}" target="_blank" rel="noopener">view tx ↗</a>`));
          txHash = r.hash;
        }
        chain.localRules.set(id, { rule: s.rule, channel: { type: s.channel.type, chat: s.channel.chat }, hash });
        let workerMsg = '';
        if (chain.hasWorker() && chain.MODE === 'live') {
          setTx('Sign the message in MetaMask so the Worker knows this watch is yours…');
          try {
            const proof = await chain.signProof(id, 'save');
            const channel = s.channel.type === 'telegram' ? { type: 'telegram', code: s.channel.code } : s.channel.type === 'discord' ? { type: 'discord', url: s.channel.url } : { type: 'dashboard' };
            await chain.worker.save({ id, rule: s.rule, channel: s.editId !== null && s.channel.type === 'telegram' && !s.channel.code ? { type: 'keep' } : channel, ...proof });
            workerMsg = 'ok';
          } catch (e) { workerMsg = e.message; }
        } else workerMsg = chain.MODE === 'preview' ? 'preview' : 'noworker';
        s.tx = null;
        s.done = { id, txHash, workerMsg };
        renderRail(); doneView();
      } catch (e) {
        setTx(esc(e.message) + (e.code === 'rejected' ? '' : ''), true);
      }
    });
  }
  function doneView() {
    const { id, txHash, workerMsg } = s.done;
    const msg = workerMsg === 'ok' ? `<div class="notice ok">Alerts are on. The Worker checks every minute — the next match ${s.channel.type === 'dashboard' ? 'shows up on your dashboard' : `pings your ${s.channel.type === 'telegram' ? 'Telegram' : 'Discord'}`}.</div>`
      : workerMsg === 'preview' ? `<div class="notice warn">Preview mode: the watch is saved in this browser. Once WatchRegistry is deployed and the Worker is live, alerts go out for real.</div>`
      : workerMsg === 'noworker' ? `<div class="notice warn">The watch is on-chain ✓, but the alert Worker isn’t connected yet — so no pings yet. Your dashboard still shows recent matches.</div>`
      : `<div class="notice bad">The watch is on-chain ✓, but saving the alert settings failed: ${esc(workerMsg)}. Open the watch and press Edit to try again.</div>`;
    body.innerHTML = `<div class="card panel center">
      <div style="width:170px;margin:0 auto">${hoot('bell', { title: 'Hoot rings a bell' })}</div>
      <h2 style="margin-top:10px">${s.editId === null ? `Watch #${id} is live!` : `Watch #${id} updated`}</h2>
      <p class="lead">${esc(s.label)} · <span class="mono">${esc(R.describeRule(s.rule))}</span></p>
      <div style="max-width:560px;margin:18px auto 0;text-align:left">${msg}</div>
      <div class="row" style="justify-content:center;margin-top:10px">
        <a class="btn btn-primary" href="app/w/${id}" data-link>Open the live feed</a>
        <a class="btn btn-outline" href="w/${s.address}" data-link>Public page</a>
        ${txHash && chain.MODE === 'live' ? `<a class="btn btn-ghost" href="${chain.explorerTx(txHash)}" target="_blank" rel="noopener">View tx ${icon.ext()}</a>` : ''}
      </div></div>`;
  }

  // start
  renderRail();
  paint();
  if (editId === null && (s.chip || s.say)) {
    // run once the ABI is known: wait for step 1 to finish its lookup, then pre-pick
    const wait = setInterval(() => {
      if (s.checking) return;
      clearInterval(wait);
      if (s.net && (s.events.length || s.chip === 'failed' || s.chip === 'any')) { autoFromParams(); if (s.rule) { s.maxStep = 2; renderRail(); } }
    }, 300);
    addCleanup(() => clearInterval(wait));
  }
}

function ruleChipsHtml(r) {
  const out = [];
  if (r.kind === 'event') {
    out.push(`<span class="rc-chip ev">Event ${esc(r.event)}</span>`);
    r.conditions.forEach((c) => out.push(`<span class="rc-chip">${esc(R.describeCondition(c, r))}</span>`));
    if (!r.conditions.length) out.push('<span class="rc-chip">every time</span>');
  } else out.push(`<span class="rc-chip ev">${r.kind === 'failed' ? 'Failed calls' : 'Any event'}</span>`);
  if (r.quiet) out.push(`<span class="rc-chip q">🌙 quiet ${r.quiet.from}–${r.quiet.to}</span>`);
  return out.join('');
}

// =================================================================== ONE WATCH
let chartLib;
const loadChart = () => (window.Chart ? Promise.resolve(window.Chart) : (chartLib ||= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
  s.onload = () => res(window.Chart); s.onerror = rej; document.head.append(s);
})));

export async function renderWatch(root, id) {
  root.innerHTML = `<section class="app wrap"><div class="crumbs"><a href="app" data-link>Dashboard</a> / Watch #${id}</div><div id="wBody"><div class="card panel"><div class="row"><span class="spin"></span> Loading watch #${id}…</div></div></div></section>`;
  const body = $('#wBody', root);
  let w;
  try { w = await chain.registry.getWatch(id); } catch (e) { body.innerHTML = `<div class="card empty">${hoot('confused')}<h2>Watch #${id} not found</h2><p>${esc(e.message)}</p><a class="btn btn-primary" href="app" data-link>Back to dashboard</a></div>`; return; }
  const net = chain.netByChainId(w.chainId);
  let st = (await workerStates([id]))[id];
  const rule = await ruleFor(w, st);
  const E = await chain.loadEthers();
  const mine = chain.sameAddr(w.owner, chain.currentAccount());
  const hashOk = rule ? R.ruleHash(rule, E) === w.ruleHash : null;
  const s = statusOf(w, st);

  body.innerHTML = `
    <div class="app-head"><div>
      <h1><span style="margin-right:10px">${emojiFor(rule, w.label)}</span>${esc(w.label)}</h1>
      <p><span class="status ${s.cls}" id="wStatus">${esc(s.text)}</span> &nbsp;<span class="mono">${esc(rule?.name ? rule.name + ' · ' : '')}${esc(chain.short(w.target))}</span> ${netTag(net)}</p>
    </div>${mine ? `<a class="btn btn-primary" href="app/new" data-link>${icon.plus()} New watch</a>` : ''}</div>
    ${!rule ? `<div class="notice warn">This browser doesn’t have the rule text (only its hash is on-chain). Open the watch in the browser you created it in, or connect the Worker. Showing what the chain knows.</div>` : ''}
    ${st?.autoPaused ? `<div class="notice warn">⏸ Paused automatically after 500 alerts today. Press Resume to turn it back on.</div>` : ''}
    <div class="kpis">
      <div class="card kpi"><span>Alerts today</span><b id="kToday">${st ? fmt(st.alertsToday || 0) : '—'}</b></div>
      <div class="card kpi"><span>Last alert</span><b id="kLast" style="font-size:22px">${st?.lastAlertAt ? ago(st.lastAlertAt) : '—'}</b></div>
      <div class="card kpi"><span id="kMatchL">Matches</span><b id="kMatch">—</b></div>
      <div class="card kpi"><span>Blocks behind</span><b id="kBehind">${st ? fmt(st.behind ?? 0) : '—'}</b></div>
    </div>
    <div class="dash-grid">
      <div>
        <div class="card panel"><div class="row" style="justify-content:space-between"><h2 class="h-sm" id="chartTitle">Matches · last 24h</h2><span class="hint" id="chartNote"></span></div><div class="chart-box"><canvas id="chart" aria-label="Matches per hour"></canvas></div></div>
        <div class="card panel"><div class="row" style="justify-content:space-between"><h2 class="h-sm">Live feed</h2><span class="live-dot" id="feedLive">live</span></div><div class="feed" id="feed"><div class="row"><span class="spin"></span> Reading recent blocks…</div></div></div>
      </div>
      <aside class="side-actions">
        <div class="card panel">
          <h2 class="h-sm">Rule</h2>
          ${rule ? `<div class="rc-chips" style="margin-top:12px">${ruleChipsHtml(rule)}</div><p class="mono hint" style="margin-top:10px">${esc(R.describeRule(rule))}</p>` : `<p class="mono hint" style="margin-top:10px">${esc(sigName(w.eventSig))}</p>`}
          <div class="kv" style="margin-top:16px">
            <div><span>Contract</span><a class="mono" href="${chain.explorerAddress(w.target, net)}" target="_blank" rel="noopener">${esc(chain.short(w.target))} ↗</a></div>
            <div><span>Owner</span><span class="mono">${esc(chain.short(w.owner))}${mine ? ' (you)' : ''}</span></div>
            <div><span>Registered</span><span>${new Date(w.at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
            <div><span>Rule hash</span><span class="mono" title="${w.ruleHash}">${w.ruleHash.slice(0, 10)}… ${hashOk === true ? '✓' : hashOk === false ? '≠ local' : ''}</span></div>
          </div>
        </div>
        ${mine ? `<div class="card panel side-actions">
          <button class="btn btn-outline btn-block" type="button" id="pause">${w.active ? `${icon.pause()} Pause` : `${icon.play()} Resume`}</button>
          <a class="btn btn-outline btn-block" href="app/edit/${id}" data-link>${icon.edit()} Edit rule</a>
          <button class="btn btn-danger btn-block" type="button" id="del">${icon.trash()} Delete</button>
          <p class="hint" id="actMsg"></p></div>` : ''}
        <div class="card panel side-actions">
          <a class="btn btn-ghost btn-block" href="w/${w.target}" data-link>${icon.globe()} Public page</a>
          <button class="btn btn-ghost btn-block" type="button" id="share">${icon.copy()} Copy public link</button>
        </div>
      </aside>
    </div>`;

  // ---------- actions (owner only)
  const actMsg = (t) => { const el = $('#actMsg', body); if (el) el.innerHTML = t; };
  $('#pause', body)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      actMsg('Confirm in MetaMask…');
      await chain.registry.setActive(id, !w.active, (h) => actMsg(`Sending… <a href="${chain.explorerTx(h)}" target="_blank" rel="noopener">view tx ↗</a>`));
      if (chain.hasWorker() && chain.MODE === 'live') { try { const p = await chain.signProof(id, w.active ? 'pause' : 'resume'); await chain.worker.save({ id, active: !w.active, ...p }); } catch { /* the Worker also reads `active` from the chain */ } }
      toast(w.active ? 'Paused — Hoot is napping 😴' : 'Resumed — Hoot is watching 🦉');
      renderWatch(root, id);
    } catch (err) { actMsg(esc(err.message)); e.target.disabled = false; }
  });
  $('#del', body)?.addEventListener('click', async (e) => {
    if (!confirm('Delete this watch?\n\nAlerts stop and your channel details are removed from the Worker. The on-chain record stays, marked paused.')) return;
    e.target.disabled = true;
    try {
      if (w.active) { actMsg('Confirm the pause in MetaMask…'); await chain.registry.setActive(id, false); }
      if (chain.hasWorker() && chain.MODE === 'live') { actMsg('Sign to remove your channel from the Worker…'); const p = await chain.signProof(id, 'delete'); await chain.worker.remove({ id, ...p }); }
      chain.localRules.remove(id);
      chain.hidden.add(id);
      toast('Watch deleted');
      go('app');
    } catch (err) { actMsg(esc(err.message)); e.target.disabled = false; }
  });
  $('#share', body).addEventListener('click', () => copyText(new URL(`w/${w.target}`, document.baseURI).href, 'Public link copied'));

  // ---------- feed + chart
  let chart;
  const drawChart = async (hourly, note, unitMin = 60) => {
    $('#chartNote', body).textContent = note;
    $('#chartTitle', body).textContent = unitMin === 60 ? 'Matches · last 24h' : 'Matches · recent blocks';
    try {
      const Chart = await loadChart();
      const labels = hourly.map((_, i) => { const back = (hourly.length - 1 - i) * unitMin; return i === hourly.length - 1 ? 'now' : back >= 60 ? `-${Math.round(back / 60)}h` : `-${Math.round(back)}m`; });
      const data = { labels, datasets: [{ data: hourly, backgroundColor: hourly.map((v, i) => (i === hourly.length - 1 ? '#FF8A3D' : '#9BD3B5')), borderRadius: 6, borderSkipped: false, maxBarThickness: 22 }] };
      if (chart) { chart.data = data; chart.update(); return; }
      chart = new Chart($('#chart', body), {
        type: 'bar', data,
        options: {
          responsive: true, maintainAspectRatio: false, animation: reduced() ? false : { duration: 700, easing: 'easeOutQuart' },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw} match${c.raw === 1 ? '' : 'es'}` } } },
          scales: { x: { grid: { display: false }, ticks: { color: '#5E7169', font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } }, y: { beginAtZero: true, ticks: { precision: 0, color: '#5E7169', font: { size: 11 } }, grid: { color: 'rgba(18,49,42,.06)' } } },
        },
      });
      addCleanup(() => chart.destroy());
    } catch { $('#chartNote', body).textContent = 'Chart couldn’t load'; }
  };
  const row = (h) => `<div class="feed-row"><span class="em">${emojiFor(rule, w.label)}</span><div class="fr-main"><b>${esc(h.name || w.label)}</b><p title="${esc(h.summary)}">${esc(h.summary)}</p></div>
    <time>${h.ts ? ago(h.ts) : ''}<br><a href="${chain.explorerTx(h.tx, net)}" target="_blank" rel="noopener">#${fmt(h.block)} ↗</a></time></div>`;
  const emptyFeed = (note) => `<div class="empty" style="padding:24px 10px"><div style="width:110px;margin:0 auto">${hoot('confused', { title: 'No events yet' })}</div><h2 class="h-sm" style="margin-top:8px">No events yet</h2><p style="margin-bottom:0">${note}</p></div>`;

  const refresh = async () => {
    if (!root.isConnected) return;
    // 1) the Worker's history (full 24h) when available
    if (chain.hasWorker() && chain.MODE === 'live') {
      try {
        st = (await workerStates([id]))[id];
        if (st) {
          const s2 = statusOf(w, st);
          $('#wStatus', body).className = `status ${s2.cls}`; $('#wStatus', body).textContent = s2.text;
          $('#kToday', body).textContent = fmt(st.alertsToday || 0); $('#kLast', body).textContent = st.lastAlertAt ? ago(st.lastAlertAt) : '—';
          $('#kBehind', body).textContent = fmt(st.behind ?? 0);
          $('#kMatchL', body).textContent = 'Matches · 24h'; $('#kMatch', body).textContent = fmt((st.hourly || []).reduce((a, b) => a + b, 0));
          $('#feed', body).innerHTML = (st.events || []).length ? st.events.map(row).join('') : emptyFeed('Hoot is watching. Matches will land here the moment they happen.');
          drawChart(st.hourly || Array(24).fill(0), 'from the Worker');
          return;
        }
      } catch { /* fall back to the browser scan */ }
    }
    // 2) browser scan of recent blocks
    if (!rule) { $('#feed', body).innerHTML = emptyFeed('Without the rule text this browser can’t decode matches.'); drawChart(Array(24).fill(0), ''); return; }
    try {
      const r = await chain.scanRecent(w, rule, 4000);
      const span = r.head - r.from + 1;
      $('#kMatchL', body).textContent = `Matches · last ${fmt(span)} blocks`;
      $('#kMatch', body).textContent = fmt(r.hits.length);
      $('#feed', body).innerHTML = r.hits.length ? r.hits.slice(0, 60).map(row).join('') : emptyFeed(rule.kind === 'failed' ? 'No failed calls in the last 60 blocks.' : `Nothing matched in the last ${fmt(span)} blocks (~${Math.round(span * 0.75 / 60)} min).`);
      // bucket what we scanned into 24 bars across the scanned window (≈ minutes, not hours)
      const buckets = Array(24).fill(0);
      r.hits.forEach((h) => { const i = Math.min(23, Math.floor(((h.block - r.from) / span) * 24)); buckets[i]++; });
      drawChart(buckets, `browser scan · ~${Math.round(span * 0.75 / 60)} min (the Worker keeps the full 24h)`, (span * 0.75) / 60 / 24);
      $('#feedLive', body).className = 'live-dot';
    } catch (e) {
      $('#feed', body).innerHTML = `<div class="notice bad">Couldn’t read recent blocks: ${esc(e.message)}</div>`;
      $('#feedLive', body).className = 'live-dot off'; $('#feedLive', body).textContent = 'offline';
    }
  };
  await refresh();
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  addCleanup(() => clearInterval(timer));
}

// Rule logic shared by the app, the Worker and the tests. Pure JS — no DOM, no ethers import.
// Functions that need hashing or ABI decoding take the ethers namespace as an argument (`E`).
//
// A rule is plain JSON:
// {
//   v: 1,
//   kind: 'event' | 'any' | 'failed',
//   event: 'Transfer',                                  // kind 'event' only
//   events: ['event Transfer(address indexed from, address indexed to, uint256 value)'], // for decoding
//   conditions: [{ field: 'value', op: '>', value: '1000', decimals: 18 }],
//   unit: 'BOT',                                        // symbol shown next to scaled numbers
//   name: 'Snack Poll',                                 // what people call the watched contract
//   quiet: { from: '23:00', to: '07:00', tz: 'Asia/Bangkok' } | null,
// }
// The on-chain ruleHash is keccak256 of canonicalRule(rule). Channels are never part of a rule.

export const FAILED_CALLS_KEY = 'ContractWatch:FailedCalls';
export const ZERO32 = '0x' + '0'.repeat(64);
export const OPS = ['>', '>=', '<', '<=', '=', '!=', 'contains'];
export const LIMITS = { label: 40, name: 40, conditions: 6, events: 30, perMinute: 20, perDay: 500 };

// ------------------------------------------------------------------ ABI templates
export const TEMPLATE_ABIS = {
  erc20: {
    title: 'ERC-20 token',
    events: [
      'event Transfer(address indexed from, address indexed to, uint256 value)',
      'event Approval(address indexed owner, address indexed spender, uint256 value)',
    ],
  },
  erc721: {
    title: 'ERC-721 NFT',
    events: [
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
      'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
      'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
    ],
  },
  ownable: {
    title: 'Ownable',
    events: ['event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)'],
  },
  any: { title: 'Any event by topic', events: [] },
};

// ------------------------------------------------------------------ ABI parsing
const EVENT_RE = /^event\s+([A-Za-z_$][\w$]*)\s*\((.*)\)\s*(anonymous)?\s*;?$/;

/** "event Transfer(address indexed from, …)" → { name, inputs:[{type,name,indexed}], signature, fragment } */
export function parseEventFragment(text) {
  const m = String(text).trim().match(EVENT_RE);
  if (!m) return null;
  const inputs = m[2].trim()
    ? splitTop(m[2]).map((p, i) => {
        const parts = p.trim().split(/\s+/);
        const type = parts[0];
        const indexed = parts.includes('indexed');
        const name = parts.filter((x, j) => j > 0 && x !== 'indexed')[0] || `arg${i}`;
        return { type, name, indexed };
      })
    : [];
  return toEvent(m[1], inputs, !!m[3]);
}

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function typeOf(input) {
  // tuples: (type,type)[] from JSON ABI components
  if (input.type?.startsWith('tuple')) return `(${(input.components || []).map(typeOf).join(',')})${input.type.slice(5)}`;
  return input.type;
}

function toEvent(name, inputs, anonymous = false) {
  const signature = `${name}(${inputs.map(typeOf).join(',')})`;
  const fragment = `event ${name}(${inputs.map((x) => `${typeOf(x)}${x.indexed ? ' indexed' : ''} ${x.name}`).join(', ')})`;
  return { name, inputs: inputs.map((x) => ({ type: typeOf(x), name: x.name, indexed: !!x.indexed })), signature, fragment, anonymous };
}

/**
 * Accepts: a JSON ABI array, a Remix / Hardhat / Foundry artifact ({abi} or {output:{abi}}),
 * or human-readable lines ("event Transfer(…)"). Returns { events, functions, error }.
 */
export function parseAbi(text) {
  const raw = String(text || '').trim();
  if (!raw) return { events: [], functions: 0, error: 'empty' };
  let abi = null;
  try {
    const j = JSON.parse(raw);
    abi = Array.isArray(j) ? j : j.abi || j.output?.abi || j.compilerOutput?.abi || null;
    if (!abi && j.data?.abi) abi = j.data.abi;
  } catch {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const events = lines.map(parseEventFragment).filter(Boolean);
    return events.length ? { events: dedupe(events), functions: 0, error: '' } : { events: [], functions: 0, error: 'unreadable' };
  }
  if (!Array.isArray(abi)) return { events: [], functions: 0, error: 'no_abi' };
  const events = abi
    .filter((x) => x && x.type === 'event' && x.name)
    .map((x) => toEvent(x.name, (x.inputs || []).map((i, k) => ({ ...i, name: i.name || `arg${k}` })), !!x.anonymous))
    .filter((e) => !e.anonymous);
  return { events: dedupe(events), functions: abi.filter((x) => x?.type === 'function').length, error: '' };
}
const dedupe = (events) => [...new Map(events.map((e) => [e.signature, e])).values()];

export const templateEvents = (key) => (TEMPLATE_ABIS[key]?.events || []).map(parseEventFragment);

// ------------------------------------------------------------------ fields
export const isNum = (t) => /^u?int\d*$/.test(t);
export const isAddr = (t) => t === 'address';
export const isText = (t) => t === 'string' || /^bytes\d*$/.test(t);
export const opsFor = (t) => (isNum(t) ? ['>', '>=', '<', '<=', '=', '!='] : isAddr(t) || t === 'bool' ? ['=', '!='] : ['=', '!=', 'contains']);
const VALUE_NAMES = /^(value|amount|wad|_value|_amount|tokens|weight|votes|qty|quantity)$/i;
export const valueField = (ev) => ev?.inputs.find((i) => isNum(i.type) && VALUE_NAMES.test(i.name)) || ev?.inputs.find((i) => isNum(i.type) && !i.indexed);

// ------------------------------------------------------------------ number helpers (BigInt, no float drift)
export function parseUnits(str, decimals = 0) {
  const s = String(str).replace(/[,_\s]/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') throw new Error('bad_number');
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  if (f.length > decimals && /[1-9]/.test(f.slice(decimals))) throw new Error('too_many_decimals');
  const v = BigInt((i || '0') + f.slice(0, decimals).padEnd(decimals, '0'));
  return neg ? -v : v;
}
export function formatUnits(v, decimals = 0, maxFrac = 4) {
  let n = BigInt(v);
  const neg = n < 0n; if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  let frac = decimals ? (n % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '') : '';
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + w + (frac ? '.' + frac : '');
}
export const groupNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-2)}` : a || '');
export const shortAddrLong = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());

// ------------------------------------------------------------------ templates ("what to watch" chips)
export const CHIPS = [
  { id: 'big', emoji: '💸', label: 'Big transfers' },
  { id: 'owner', emoji: '👑', label: 'Ownership changed' },
  { id: 'votes', emoji: '🗳', label: 'New votes' },
  { id: 'failed', emoji: '⚠️', label: 'Failed calls to this contract' },
  { id: 'any', emoji: '📣', label: 'Any event' },
];

const findEvent = (events, test) => events.find((e) => test(e.name.toLowerCase(), e));

/** Which chips can work with this ABI. Failed calls always can; 'any' needs at least one event or a raw topic. */
export function chipAvailability(events) {
  return {
    big: !!findEvent(events, (n, e) => n === 'transfer' && valueField(e)),
    owner: !!findEvent(events, (n) => n.includes('ownership') || n.includes('ownerchanged') || n === 'ownerset'),
    votes: !!findEvent(events, (n) => n.includes('vote')),
    failed: true,
    any: true,
  };
}

/** Builds a starting rule for a chip. Returns null when the ABI doesn't support it. */
export function ruleFromChip(id, events, extra = {}) {
  const base = { v: 1, conditions: [], unit: extra.unit || 'BOT', decimals: extra.decimals ?? 18, name: extra.name || '', quiet: extra.quiet || null };
  if (id === 'failed') return { ...base, kind: 'failed', events: [], label: 'Failed calls' };
  if (id === 'any') return { ...base, kind: 'any', events: events.slice(0, LIMITS.events).map((e) => e.fragment), label: 'Any event' };
  let ev;
  if (id === 'big') {
    ev = findEvent(events, (n, e) => n === 'transfer' && valueField(e));
    if (!ev) return null;
    const f = valueField(ev);
    return { ...base, kind: 'event', event: ev.name, events: [ev.fragment], conditions: [{ field: f.name, op: '>', value: '1000', decimals: extra.decimals ?? 18 }], label: 'Big transfers' };
  }
  if (id === 'owner') ev = findEvent(events, (n) => n.includes('ownership') || n.includes('ownerchanged') || n === 'ownerset');
  if (id === 'votes') ev = findEvent(events, (n) => n.includes('vote'));
  if (!ev) return null;
  return { ...base, kind: 'event', event: ev.name, events: [ev.fragment], label: id === 'owner' ? 'Ownership changed' : 'New votes' };
}

// ------------------------------------------------------------------ validation
/**
 * Checks a rule (from a chip, the editor or the AI) against the ABI event list.
 * Returns { ok, rule (normalised), error } — error is a short human message.
 */
export function validateRule(input, events) {
  const bad = (error) => ({ ok: false, rule: null, error });
  if (!input || typeof input !== 'object') return bad("I couldn't map that — pick an event");
  const kind = ['event', 'any', 'failed'].includes(input.kind) ? input.kind : input.event ? 'event' : null;
  if (!kind) return bad("I couldn't map that — pick an event");
  const rule = {
    v: 1,
    kind,
    conditions: [],
    unit: clean(input.unit || 'BOT', 10) || 'BOT',
    decimals: Math.max(0, Math.min(36, Number.isInteger(input.decimals) ? input.decimals : 18)),
    name: clean(input.name || '', LIMITS.name),
    quiet: normQuiet(input.quiet),
    label: clean(input.label || '', LIMITS.label),
  };
  if (kind === 'failed') return { ok: true, rule: { ...rule, events: [], label: rule.label || 'Failed calls' }, error: '' };
  if (kind === 'any') {
    const frags = (Array.isArray(input.events) && input.events.length ? input.events.map(parseEventFragment).filter(Boolean) : events).slice(0, LIMITS.events);
    return { ok: true, rule: { ...rule, events: frags.map((e) => e.fragment), label: rule.label || 'Any event' }, error: '' };
  }
  const name = String(input.event || '').replace(/\(.*$/, '').trim();
  const ev = events.find((e) => e.signature === input.event) || events.find((e) => e.name === name) || events.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!ev) return bad("I couldn't map that — pick an event");
  rule.event = ev.name;
  rule.events = [ev.fragment];
  const conds = Array.isArray(input.conditions) ? input.conditions.slice(0, LIMITS.conditions) : [];
  for (const c of conds) {
    const field = ev.inputs.find((i) => i.name === c?.field) || ev.inputs.find((i) => i.name.toLowerCase() === String(c?.field || '').toLowerCase());
    if (!field) return bad(`${ev.name} has no field “${c?.field}”`);
    const op = String(c.op || '').trim();
    if (!opsFor(field.type).includes(op)) return bad(`“${op}” doesn't work on ${field.name} (${field.type})`);
    let value = String(c.value ?? '').trim();
    const out = { field: field.name, op, value };
    if (isNum(field.type)) {
      const decimals = Math.max(0, Math.min(36, parseInt(c.decimals, 10) || 0));
      try { parseUnits(value, decimals); } catch { return bad(`“${value}” isn't a number for ${field.name}`); }
      out.value = value.replace(/[,_\s]/g, '');
      out.decimals = decimals;
    } else if (isAddr(field.type)) {
      if (!isAddress(value)) return bad(`“${value}” isn't an address for ${field.name}`);
      out.value = value.toLowerCase();
    } else if (field.type === 'bool') {
      if (!/^(true|false)$/i.test(value)) return bad(`${field.name} is true or false`);
      out.value = value.toLowerCase();
    } else if (!value) return bad(`Give ${field.name} a value`);
    rule.conditions.push(out);
  }
  if (!rule.label) rule.label = defaultLabel(rule);
  return { ok: true, rule, error: '' };
}

const clean = (s, n) => String(s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function normQuiet(q) {
  if (!q || !/^\d\d:\d\d$/.test(q.from || '') || !/^\d\d:\d\d$/.test(q.to || '') || q.from === q.to) return null;
  return { from: q.from, to: q.to, tz: clean(q.tz || 'UTC', 60) || 'UTC' };
}
function defaultLabel(rule) {
  if (rule.kind !== 'event') return rule.kind === 'failed' ? 'Failed calls' : 'Any event';
  const c = rule.conditions[0];
  return clean(c ? `${rule.event} ${c.field} ${c.op} ${c.value}` : rule.event, LIMITS.label);
}

// ------------------------------------------------------------------ canonical form + hash
export function canonicalRule(rule) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(rule));
}
export const ruleHash = (rule, E) => E.keccak256(E.toUtf8Bytes(canonicalRule(rule)));
export const failedSig = (E) => E.id(FAILED_CALLS_KEY);
/** topic0 stored on-chain: the event's topic, zero for "any event", or the failed-calls marker. */
export function eventSigOf(rule, E) {
  if (rule.kind === 'failed') return failedSig(E);
  if (rule.kind === 'any') return ZERO32;
  return E.id(parseEventFragment(rule.events[0]).signature);
}

// ------------------------------------------------------------------ matching
/** args: { fieldName: bigint | string | boolean } (decoded log). Returns true when every condition holds. */
export function matches(rule, args) {
  if (rule.kind !== 'event') return true;
  return rule.conditions.every((c) => test(c, args[c.field]));
}
function test(c, actual) {
  if (actual === undefined || actual === null) return false;
  if (typeof actual === 'bigint' || typeof actual === 'number') {
    const a = BigInt(actual); const b = parseUnits(c.value, c.decimals || 0);
    return { '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b, '=': a === b, '!=': a !== b }[c.op] ?? false;
  }
  const a = String(actual).toLowerCase(); const b = String(c.value).toLowerCase();
  if (c.op === 'contains') return a.includes(b);
  if (c.op === '=') return a === b;
  if (c.op === '!=') return a !== b;
  return false;
}

/** Decodes a raw log with the rule's fragments. Returns { name, args, signature } or null. */
export function decodeLog(rule, log, E) {
  if (!rule.events?.length) return null;
  let iface;
  try { iface = new E.Interface(rule.events); } catch { return null; }
  try {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    const args = {};
    parsed.fragment.inputs.forEach((inp, i) => { args[inp.name || `arg${i}`] = plain(parsed.args[i]); });
    return { name: parsed.name, args, signature: parsed.signature, inputs: parsed.fragment.inputs.map((i) => ({ name: i.name, type: i.type })) };
  } catch { return null; }
}
const plain = (v) => (typeof v === 'bigint' || typeof v === 'boolean' || typeof v === 'string' ? v : Array.isArray(v) ? [...v].map(plain) : String(v));

// ------------------------------------------------------------------ words
const COND_WORD = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '!=': '≠', contains: 'contains' };
export function describeCondition(c, rule) {
  let v = c.value;
  if (c.decimals) v = `${groupNum(c.value.split('.')[0])}${c.value.includes('.') ? '.' + c.value.split('.')[1] : ''} ${rule.unit || ''}`.trim();
  else if (isAddress(v)) v = shortAddrLong(v);
  else if (/^\d+$/.test(v)) v = groupNum(v);
  return `${c.field} ${COND_WORD[c.op] || c.op} ${v}`;
}
/** "Event Transfer · when value > 1,000 BOT" */
export function describeRule(rule) {
  if (!rule) return '';
  if (rule.kind === 'failed') return 'Failed calls · any transaction to this contract that reverts';
  if (rule.kind === 'any') return `Any event · ${rule.events.length ? rule.events.length + ' known' : 'raw topics'}`;
  const conds = rule.conditions.map((c) => describeCondition(c, rule));
  return `Event ${rule.event}${conds.length ? ' · when ' + conds.join(' and ') : ' · every time'}`;
}

/** Short summary of one matched event for alerts and the feed. */
export function summarize(rule, decoded) {
  if (!decoded) return 'Unknown event';
  const a = decoded.args;
  const vf = decoded.inputs.find((i) => isNum(i.type) && VALUE_NAMES.test(i.name));
  const dec = rule.conditions?.find((c) => vf && c.field === vf.name)?.decimals ?? (vf && /^(value|amount|wad|_value|_amount)$/i.test(vf.name) ? rule.decimals ?? 18 : 0);
  if (decoded.name === 'Transfer' && a.from !== undefined && a.to !== undefined) {
    const what = vf ? `${formatUnits(a[vf.name], dec)} ${rule.unit || ''}`.trim() : a.tokenId !== undefined ? `#${a.tokenId}` : '';
    return `${what} from ${shortAddr(a.from)} to ${shortAddr(a.to)}`.trim();
  }
  if (/ownership/i.test(decoded.name)) {
    const addrs = decoded.inputs.filter((i) => i.type === 'address').map((i) => a[i.name]);
    if (addrs.length === 2) return `owner ${shortAddr(addrs[0])} → ${shortAddr(addrs[1])}`;
  }
  return decoded.inputs.slice(0, 3).map((i) => {
    const v = a[i.name];
    const shown = i.type === 'address' ? shortAddr(v) : vf && i.name === vf.name ? formatUnits(v, dec) : typeof v === 'bigint' ? groupNum(v) : String(v).slice(0, 24);
    return `${i.name} ${shown}`;
  }).join(' · ') || decoded.name;
}

/** "🦉 Hoot! Big transfer on Snack Poll — 2,500 BOT from 0xAB…12 to 0xCD…34 · block #1,234,567" */
export function alertText(watch, rule, hit) {
  const where = rule.name || shortAddrLong(watch.target);
  return `🦉 Hoot! ${watch.label || rule.label} on ${where} — ${hit.summary} · block #${groupNum(hit.block)}`;
}

// ------------------------------------------------------------------ quiet hours
export function localHM(date, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    return `${p.find((x) => x.type === 'hour').value}:${p.find((x) => x.type === 'minute').value}`;
  } catch { return date.toISOString().slice(11, 16); }
}
export function inQuiet(quiet, date = new Date()) {
  if (!quiet) return false;
  const now = localHM(date, quiet.tz);
  return quiet.from < quiet.to ? now >= quiet.from && now < quiet.to : now >= quiet.from || now < quiet.to;
}

// ------------------------------------------------------------------ plain-English fallback (used when the AI is off)
/** Very small keyword parser. Returns a rule draft (unvalidated) or null. */
export function guessRule(sentence, events) {
  const s = String(sentence || '').toLowerCase();
  if (!s.trim()) return null;
  if (/\b(fail|revert|error)/.test(s)) return { kind: 'failed', label: 'Failed calls' };
  if (/\b(any|every|all)\s+(event|thing|activity)|anything/.test(s)) return { kind: 'any', label: 'Any event' };
  let ev = events.find((e) => new RegExp(`\\b${e.name.toLowerCase()}\\b`).test(s.replace(/\s+/g, ' ')));
  if (!ev && /owner/.test(s)) ev = findEvent(events, (n) => n.includes('owner'));
  if (!ev && /vote/.test(s)) ev = findEvent(events, (n) => n.includes('vote'));
  if (!ev && /approv/.test(s)) ev = findEvent(events, (n) => n.includes('approv'));
  if (!ev && /\b(send|sends|sent|transfer|move|moves|moved|buy|sell|whale)/.test(s)) ev = findEvent(events, (n) => n === 'transfer');
  if (!ev && /\b(mint|burn)/.test(s)) ev = findEvent(events, (n) => n === 'transfer') || findEvent(events, (n) => /mint|burn/.test(n));
  if (!ev) return null;
  const rule = { kind: 'event', event: ev.name, conditions: [] };
  const num = s.match(/(more than|greater than|over|above|bigger than|at least|>=|>|less than|under|below|fewer than|at most|<=|<)\s*\$?([\d.,_]+)\s*(k|m|thousand|million)?\b\s*([a-z]{2,8})?/);
  const vf = valueField(ev);
  if (num && vf) {
    const map = { 'at least': '>=', '>=': '>=', 'at most': '<=', '<=': '<=' };
    const op = map[num[1]] || (/less|under|below|fewer|</.test(num[1]) ? '<' : '>');
    let v = num[2].replace(/[,_]/g, '').replace(/\.$/, '');
    const mult = { k: 3, thousand: 3, m: 6, million: 6 }[num[3]] || 0;
    if (mult) v = (parseUnits(v, 6) * 10n ** BigInt(mult) / 10n ** 6n).toString();
    const unitWord = num[4] && !/^(and|or|to|from|in|on|tokens?)$/.test(num[4]) ? num[4].toUpperCase() : '';
    rule.conditions.push({ field: vf.name, op, value: v, decimals: /wei|raw|units?/i.test(num[4] || '') ? 0 : 18 });
    if (unitWord && !/WEI|RAW|UNITS?/.test(unitWord)) rule.unit = unitWord;
  }
  for (const dir of ['from', 'to']) {
    const m = s.match(new RegExp(`\\b${dir}\\s+(0x[0-9a-f]{40})`));
    const f = ev.inputs.find((i) => i.type === 'address' && i.name.toLowerCase() === dir);
    if (m && f) rule.conditions.push({ field: f.name, op: '=', value: m[1] });
  }
  if (ev.name === 'Transfer' && /\bmint/.test(s)) rule.conditions.push({ field: ev.inputs[0].name, op: '=', value: '0x' + '0'.repeat(40) });
  if (ev.name === 'Transfer' && /\bburn/.test(s)) rule.conditions.push({ field: ev.inputs[1].name, op: '=', value: '0x' + '0'.repeat(40) });
  rule.label = sentenceLabel(ev, rule);
  return rule;
}
function sentenceLabel(ev, rule) {
  if (ev.name === 'Transfer' && rule.conditions.some((c) => c.op.startsWith('>'))) return 'Big transfers';
  if (/owner/i.test(ev.name)) return 'Ownership changed';
  if (/vote/i.test(ev.name)) return 'New votes';
  return ev.name;
}

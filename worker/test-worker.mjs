// Worker checks: the scan/alert logic against real BOT Chain mainnet logs, the alert limits, and the HTTP routes.
// Usage (from worker/): npm install && node test-worker.mjs
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import worker, { scanWatch, NETS } from './src/index.js';
import * as R from '../assets/rules.js';

let checks = 0;
const ok = (l) => { checks++; console.log(`  ✓ ${l}`); };
const MONEY = '0xdaaabbd103c95395197c79890858922549a7a5e2'; // a busy verified ERC-20 on mainnet (6 decimals)

// real JSON-RPC
let id = 1;
async function rpcBatch(net, calls) {
  const req = calls.map(([method, params]) => ({ jsonrpc: '2.0', id: id++, method, params }));
  const out = await (await fetch(net.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })).json();
  const by = new Map(out.map((x) => [x.id, x]));
  return req.map((r) => { const x = by.get(r.id); if (x.error) throw new Error(x.error.message); return x.result; });
}
const rpc = async (net, m, p) => (await rpcBatch(net, [[m, p]]))[0];

console.log('Worker · scan against BOT Chain mainnet');
const head = parseInt(await rpc(NETS.mainnet, 'eth_blockNumber', []), 16);
const events = R.templateEvents('erc20');
const anyRule = R.validateRule({ kind: 'event', event: 'Transfer', name: 'Money', unit: 'Money', decimals: 6 }, events).rule;
const w = { id: 1, target: MONEY, chainId: 677, label: 'Every transfer' };
let st = { lastBlock: head - 2000 };
let sent = [];
const io = (now = Date.now()) => ({ rpc, rpcBatch, now: () => now, send: async (t, link) => { sent.push({ t, link }); } });
const found = await scanWatch(w, { rule: anyRule }, st, head, io());
assert.ok(found.length > 0, 'expected transfers in the last 2,000 blocks');
assert.equal(st.lastBlock, head); assert.equal(st.behind, 0);
assert.ok(sent.length > 0 && sent.length <= R.LIMITS.perMinute + 1);
assert.match(sent[0].t, /^🦉 Hoot! Every transfer on Money — [\d,.]+ Money from 0x\w+…\w+ to 0x\w+…\w+ · block #[\d,]+$/);
assert.match(sent[0].link, /^https:\/\/scan\.botchain\.ai\/tx\/0x[0-9a-f]{64}$/);
assert.ok(st.events.length > 0 && st.events.length <= 50 && st.events[0].ts > 0);
ok(`decodes ${found.length} real Transfer logs; first alert: “${sent[0].t.slice(0, 70)}…”`);
if (found.length > R.LIMITS.perMinute) { assert.match(sent.at(-1).t, /Digest/); ok('more than 20 in a minute → one digest message'); }

// a condition that real data can't meet → nothing sent
sent = []; st = { lastBlock: head - 2000 };
const huge = R.validateRule({ event: 'Transfer', conditions: [{ field: 'value', op: '>', value: '999999999999', decimals: 6 }] }, events).rule;
await scanWatch(w, { rule: huge }, st, head, io());
assert.equal(sent.length, 0);
ok('conditions filter: value > 999,999,999,999 → no alerts');

// catching up: from far behind, one run reads at most 3 × 2,000 blocks and reports how far behind it is
st = { lastBlock: head - 10_000 };
await scanWatch(w, { rule: huge }, st, head, io());
assert.equal(st.lastBlock, head - 10_000 + 6000); assert.equal(st.behind, 4000);
ok('far behind → reads 6,000 blocks per run and reports “4,000 blocks behind”');

console.log('Worker · limits with fake logs');
const iface = new ethers.Interface(events.map((e) => e.fragment));
const fakeLog = (n) => ({ ...iface.encodeEventLog('Transfer', ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20), 5_000_000n]), blockNumber: '0x' + (100 + n).toString(16), transactionHash: '0x' + n.toString(16).padStart(64, '0') });
const fakeIo = (logs, now) => ({ now: () => now, rpc: async () => logs, rpcBatch: async (net, calls) => calls.map(([, p]) => ({ number: p[0], timestamp: '0x' + Math.floor(now / 1000).toString(16) })), send: async (t) => sent.push({ t }) });
// quiet hours (Bangkok 23:00–07:00) → held, then one digest after
const quiet = { ...anyRule, quiet: { from: '23:00', to: '07:00', tz: 'Asia/Bangkok' } };
const night = Date.parse('2026-11-10T17:00:00Z'); // 00:00 in Bangkok
sent = []; st = { lastBlock: 99 };
await scanWatch(w, { rule: quiet }, st, 102, fakeIo([fakeLog(0), fakeLog(1), fakeLog(2)], night));
assert.equal(sent.length, 0); assert.equal(st.held.length, 3); assert.equal(st.today, 3);
const morning = Date.parse('2026-11-11T00:30:00Z'); // 07:30 in Bangkok
await scanWatch(w, { rule: quiet }, st, 103, fakeIo([], morning));
assert.equal(sent.length, 1); assert.match(sent[0].t, /Digest .* 3 matches/); assert.equal(st.held.length, 0);
ok('quiet hours hold alerts, then one digest when they end');
// 500/day → auto-pause notice, then silence until tomorrow
sent = []; st = { lastBlock: 0, day: R.LIMITS && new Date(night).toISOString().slice(0, 10), today: R.LIMITS.perDay - 1 };
await scanWatch(w, { rule: anyRule }, st, 3, fakeIo([fakeLog(0), fakeLog(1), fakeLog(2)], night));
assert.equal(st.autoPaused, true); assert.ok(sent.some((s) => /paused/.test(s.t)));
const before = sent.length;
await scanWatch(w, { rule: anyRule }, st, 4, fakeIo([fakeLog(3)], night + 60_000));
assert.equal(sent.length, before);
await scanWatch(w, { rule: anyRule }, st, 5, fakeIo([fakeLog(4)], night + 86_400_000));
assert.equal(st.autoPaused, false); assert.equal(st.today, 1);
ok('after 500 alerts in a day → paused with a notice; resets the next UTC day');

console.log('Worker · routes');
const kv = new Map();
const env = {
  ALLOWED_ORIGINS: 'https://contractwatch.app',
  CW: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) },
};
const call = (path, init = {}) => worker.fetch(new Request('https://w.example' + path, { ...init, headers: { Origin: 'https://contractwatch.app', 'content-type': 'application/json', ...(init.headers || {}) } }), env, {});
let r = await call('/watch/rule', { method: 'POST', body: JSON.stringify({ sentence: 'big transfers', events: events.map((e) => e.fragment) }) });
assert.equal(r.status, 503); assert.equal((await r.json()).error, 'no_ai');
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://contractwatch.app');
ok('/watch/rule without an AI key → 503 (the app falls back to its built-in parser); CORS locked to the site');
r = await call('/watch/save', { method: 'POST', body: JSON.stringify({ net: 'mainnet', id: 0, message: 'x', signature: '0x' }) });
assert.equal(r.status, 503);
ok('/watch/save refuses when no registry is configured');
kv.set('tgcode:abc123', JSON.stringify({ chatId: 42, chat: '@hoot' }));
r = await call('/watch/tg?code=abc123'); assert.deepEqual(await r.json(), { connected: true, chat: '@hoot' });
r = await call('/watch/tg?code=nope'); assert.equal((await r.json()).connected, false);
ok('/watch/tg reports whether the chat pressed Start');
kv.set('idx:mainnet', JSON.stringify([7]));
kv.set('cfg:mainnet:7', JSON.stringify({ rule: anyRule, target: MONEY, label: 'x', channel: 'telegram' }));
kv.set('sec:mainnet:7', JSON.stringify({ type: 'telegram', chatId: 42 }));
kv.set('state:mainnet', JSON.stringify({ day: new Date().toISOString().slice(0, 10), today: 9, watches: { 7: { day: new Date().toISOString().slice(0, 10), today: 9, events: [{ block: 1 }], hourly: {}, behind: 3 } } }));
const pub = await (await call(`/watch/public?net=mainnet&target=${MONEY}`)).json();
assert.deepEqual(Object.keys(pub.rules), ['7']); assert.ok(!JSON.stringify(pub).includes('chatId'));
const stt = await (await call('/watch/state?net=mainnet&ids=7')).json();
assert.equal(stt.watches[7].alertsToday, 9); assert.equal(stt.watches[7].hourly.length, 24); assert.ok(!JSON.stringify(stt).includes('chatId'));
assert.equal((await (await call('/watch/stats?net=mainnet')).json()).alertsToday, 9);
ok('/watch/public, /watch/state, /watch/stats never include channel secrets');
r = await call('/tg', { method: 'POST', body: '{}' }); assert.equal(r.status, 403);
ok('Telegram webhook rejects calls without the secret token');

console.log(`\n${checks} worker checks passed.`);

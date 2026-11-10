// Everything that talks to BOT Chain, the WatchRegistry and the Worker.
// Reads use plain JSON-RPC (no wallet needed). Writes go through MetaMask.
// Preview mode (no registry address configured): watches are stored in this browser,
// but contract code, events and blocks are still read live from BOT Chain.
import { CONFIG } from './config.js';
import { decodeLog, summarize, matches, eventSigOf, failedSig, ZERO32 } from './rules.js';

const params = new URLSearchParams(location.search);
const SK = CONFIG.storageKey;
export const NETS = Object.fromEntries(Object.entries(CONFIG.networks).map(([k, v]) => [k, { ...v, key: k }]));
const regKey = params.get('net') === 'testnet' ? 'testnet' : 'mainnet';
export const NET = NETS[regKey]; // where the registry lives

// localhost only: deploy.html remembers the address it just deployed
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !NET.registry) {
  try { NET.registry = localStorage.getItem(`${SK}.registry.${NET.chainId}`) || ''; } catch { /* ignore */ }
}
export const MODE = NET.registry && params.get('preview') === null ? 'live' : 'preview';
export const netByChainId = (id) => Object.values(NETS).find((n) => n.chainId === Number(id)) || NETS.mainnet;
export const explorerAddress = (a, net = NET) => `${net.explorer}/address/${a}`;
export const explorerTx = (h, net = NET) => `${net.explorer}/tx/${h}`;
export const explorerBlock = (b, net = NET) => `${net.explorer}/block/${b}`;
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ------------------------------------------------------------------ events
const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (what) => [...listeners].forEach((fn) => fn(what));

// ------------------------------------------------------------------ ethers (lazy)
let ethersReady;
export function loadEthers() {
  if (window.ethers) return Promise.resolve(window.ethers);
  ethersReady ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.5/ethers.umd.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.ethers);
    s.onerror = () => { ethersReady = null; reject(new Error('Could not load ethers.js')); };
    document.head.append(s);
  });
  return ethersReady;
}

// ------------------------------------------------------------------ raw JSON-RPC (batched)
let rpcId = 1;
export async function rpc(net, method, params = []) {
  const [r] = await rpcBatch(net, [[method, params]]);
  return r;
}
export async function rpcBatch(net, calls) {
  if (!calls.length) return [];
  const body = calls.map(([method, params]) => ({ jsonrpc: '2.0', id: rpcId++, method, params }));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(net.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const out = await res.json();
    const arr = Array.isArray(out) ? out : [out];
    const byId = new Map(arr.map((x) => [x.id, x]));
    return body.map((b) => {
      const r = byId.get(b.id);
      if (!r || r.error) throw new Error(r?.error?.message || 'RPC error');
      return r.result;
    });
  } finally { clearTimeout(t); }
}
const hex = (n) => '0x' + Number(n).toString(16);
export const blockNumber = async (net = NET) => parseInt(await rpc(net, 'eth_blockNumber'), 16);

/** Which network has code at this address? Returns { net, code } or { net:null }. */
export async function detectNetwork(address) {
  const order = [NETS.mainnet, NETS.testnet];
  const codes = await Promise.all(order.map((n) => rpc(n, 'eth_getCode', [address, 'latest']).catch(() => '0x')));
  const i = codes.findIndex((c) => c && c !== '0x');
  return i < 0 ? { net: null } : { net: order[i], code: codes[i] };
}

/** eth_getLogs in chunks of ≤ 2,000 blocks. */
export async function getLogs(net, filter, from, to) {
  const out = [];
  for (let a = from; a <= to; a += 2000) {
    const b = Math.min(to, a + 1999);
    out.push(...(await rpc(net, 'eth_getLogs', [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }])));
  }
  return out;
}

/** Failed calls to `target` in the last `count` blocks (full blocks + receipts, batched). */
export async function failedCalls(net, target, head, count = 60) {
  const nums = Array.from({ length: count }, (_, i) => head - i);
  const blocks = await rpcBatch(net, nums.map((n) => ['eth_getBlockByNumber', [hex(n), true]]));
  const txs = blocks.flatMap((b) => (b?.transactions || []).filter((t) => sameAddr(t.to, target)).map((t) => ({ ...t, ts: parseInt(b.timestamp, 16) })));
  if (!txs.length) return [];
  const receipts = await rpcBatch(net, txs.map((t) => ['eth_getTransactionReceipt', [t.hash]]));
  return txs.filter((t, i) => receipts[i] && receipts[i].status === '0x0').map((t) => ({
    block: parseInt(t.blockNumber, 16), tx: t.hash, ts: t.ts, summary: `failed call from ${short(t.from)}${t.input?.length >= 10 ? ` · ${t.input.slice(0, 10)}` : ''}`,
  }));
}

/**
 * Browser-side scan for the dashboard when the Worker isn't available: matched events in the last `blocks` blocks.
 * Returns { head, from, hits: [{ block, tx, ts?, summary, args }] }.
 */
export async function scanRecent(watch, rule, blocks = 4000) {
  const E = await loadEthers();
  const net = netByChainId(watch.chainId);
  const head = await blockNumber(net);
  if (rule.kind === 'failed') {
    const hits = await failedCalls(net, watch.target, head, 60);
    return { head, from: head - 59, hits };
  }
  const from = Math.max(0, head - blocks + 1);
  const topics = rule.kind === 'event' ? [eventSigOf(rule, E)] : undefined;
  const logs = await getLogs(net, { address: watch.target, ...(topics ? { topics } : {}) }, from, head);
  const hits = [];
  for (const log of logs) {
    const d = decodeLog(rule, log, E);
    if (rule.kind === 'event' && (!d || !matches(rule, d.args))) continue;
    hits.push({
      block: parseInt(log.blockNumber, 16), tx: log.transactionHash, logIndex: parseInt(log.logIndex, 16),
      name: d?.name || `topic ${log.topics[0]?.slice(0, 10) || '—'}`, summary: d ? summarize(rule, d) : `${log.topics.length} topics · ${Math.max(0, (log.data.length - 2) / 2)} bytes`,
    });
  }
  // timestamps for the newest 40 (one batched call)
  const recent = hits.slice(-40);
  const uniq = [...new Set(recent.map((h) => h.block))];
  if (uniq.length) {
    const bl = await rpcBatch(net, uniq.map((n) => ['eth_getBlockByNumber', [hex(n), false]])).catch(() => []);
    const ts = new Map(bl.filter(Boolean).map((b) => [parseInt(b.number, 16), parseInt(b.timestamp, 16)]));
    recent.forEach((h) => (h.ts = ts.get(h.block)));
  }
  return { head, from, hits: hits.reverse() };
}

/**
 * Verified ABI + name + token info from the BOT Chain explorer (Blockscout, CORS open).
 * Follows proxies to the implementation's ABI. Returns { name, symbol, decimals, abi (JSON string) | '' }.
 */
export async function explorerInfo(net, address) {
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const out = { name: '', symbol: '', decimals: null, abi: '', proxy: '' };
  try {
    const a = await get(`${net.explorer}/api/v2/addresses/${address}`);
    out.name = a.name || a.token?.name || '';
    out.symbol = a.token?.symbol || '';
    out.decimals = a.token?.decimals != null ? Number(a.token.decimals) : null;
    out.proxy = a.implementations?.[0]?.address_hash || a.implementations?.[0]?.address || '';
  } catch { /* unknown to the explorer */ }
  for (const addr of [out.proxy, address].filter(Boolean)) {
    try {
      const r = await get(`${net.explorer}/api?module=contract&action=getabi&address=${addr}`);
      if (r.result && r.result.startsWith('[')) { out.abi = r.result; break; }
    } catch { /* not verified */ }
  }
  return out;
}

// ------------------------------------------------------------------ wallet
export const wallet = { account: '', chainOk: true, hasWallet: typeof window.ethereum !== 'undefined' };
export class ChainError extends Error { constructor(code, message) { super(message); this.code = code; } }
const MESSAGES = {
  EmptyTarget: 'Paste a contract address first.',
  BadLabel: 'Give the watch a label of 1–40 characters.',
  NotOwner: 'Only the wallet that registered this watch can change it.',
  NoWatch: 'That watch doesn’t exist.',
  rejected: 'Cancelled in MetaMask — nothing was sent. You can try again.',
  noWallet: 'Install MetaMask to register a watch. You can still explore templates and public pages.',
  wrongNetwork: 'Switch to BOT Chain to continue.',
  failed: 'The transaction failed — try again.',
};
const fail = (code, extra) => { throw new ChainError(code, MESSAGES[code] || extra || 'Something went wrong.'); };

async function refreshChain() {
  if (!window.ethereum) return;
  const id = await ethereum.request({ method: 'eth_chainId' });
  wallet.chainOk = parseInt(id, 16) === NET.chainId;
}
export async function connect() {
  if (!window.ethereum) fail('noWallet');
  let accounts;
  try { accounts = await ethereum.request({ method: 'eth_requestAccounts' }); } catch (e) { if (e.code === 4001) fail('rejected'); throw e; }
  wallet.account = accounts[0] || '';
  await refreshChain();
  if (!wallet.chainOk) { try { await switchNetwork(); } catch { /* the nav shows "Switch to BOT Chain" */ } }
  emit('wallet');
  return wallet.account;
}
export async function switchNetwork() {
  const chainId = hex(NET.chainId);
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    const unknown = e.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized chain/i.test(e.message || '');
    if (e.code === 4001) fail('rejected');
    if (!unknown) fail('wrongNetwork');
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: NET.name, nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: [NET.explorer] }],
    });
  }
  await refreshChain();
  emit('wallet');
}
export async function restoreWallet() {
  if (!window.ethereum) return;
  try {
    const accounts = await ethereum.request({ method: 'eth_accounts' });
    wallet.account = accounts[0] || '';
    await refreshChain();
  } catch { /* ignore */ }
  ethereum.on?.('accountsChanged', (a) => { wallet.account = a[0] || ''; emit('wallet'); });
  ethereum.on?.('chainChanged', async () => { await refreshChain(); emit('wallet'); });
  emit('wallet');
}
async function signer() {
  if (!window.ethereum) fail('noWallet');
  const { BrowserProvider } = await loadEthers();
  if (!wallet.account) await connect();
  if (!wallet.chainOk) { await switchNetwork(); if (!wallet.chainOk) fail('wrongNetwork'); }
  return new BrowserProvider(window.ethereum).getSigner();
}
/** Signs the ownership proof the Worker checks before saving channels or edits. */
export async function signProof(id, action) {
  const message = `Contract Watch: watch #${id}\nNetwork: ${NET.key}\nAction: ${action}\nTime: ${new Date().toISOString()}`;
  if (MODE === 'preview') return { message, signature: '' };
  const s = await signer();
  try { return { message, signature: await s.signMessage(message) }; } catch (e) { throw liveError(e); }
}

// ------------------------------------------------------------------ registry (live)
const WATCH = 'tuple(address owner,address target,uint32 chainId,bytes32 eventSig,bytes32 ruleHash,string label,bool active,uint64 at)';
export const REGISTRY_ABI = [
  'function register(address,uint32,bytes32,bytes32,string) returns (uint256)',
  'function updateRule(uint256,bytes32)',
  'function setActive(uint256,bool)',
  `function getWatch(uint256) view returns (${WATCH})`,
  `function getWatches(uint256,uint256) view returns (${WATCH}[])`,
  'function watchesFor(address) view returns (uint256[])',
  'function watchesOf(address) view returns (uint256[])',
  'function total() view returns (uint256)',
  'event Registered(uint256 indexed id, address indexed owner, address indexed target)',
  'event RuleUpdated(uint256 indexed id)',
  'event ActiveChanged(uint256 indexed id, bool active)',
  'error EmptyTarget()', 'error BadLabel()', 'error NotOwner()', 'error NoWatch()',
];
// note: read by position — ethers results have a built-in .at() method that shadows a field called `at`
const decodeWatch = (w, id) => ({ id: Number(id), owner: w[0], target: w[1], chainId: Number(w[2]), eventSig: w[3], ruleHash: w[4], label: w[5], active: !!w[6], at: Number(w[7]) });

let reader;
async function readRegistry() {
  if (reader) return reader;
  const { JsonRpcProvider, Contract } = await loadEthers();
  reader = new Contract(NET.registry, REGISTRY_ABI, new JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true }));
  return reader;
}
function liveError(e, iface) {
  if (e instanceof ChainError) return e;
  if (e.code === 'ACTION_REJECTED' || e.code === 4001 || e.info?.error?.code === 4001) return new ChainError('rejected', MESSAGES.rejected);
  const name = e.revert?.name || (() => { try { return iface?.parseError(e.data)?.name; } catch { return null; } })();
  if (name && MESSAGES[name]) return new ChainError(name, MESSAGES[name]);
  return new ChainError('failed', e.shortMessage || e.message || MESSAGES.failed);
}

const live = {
  async total() { return Number(await (await readRegistry()).total()); },
  async getWatch(id) { return decodeWatch(await (await readRegistry()).getWatch(id), id); },
  async all() {
    const c = await readRegistry(); const out = [];
    for (let from = 0; ; from += 100) {
      const page = await c.getWatches(from, 100);
      page.forEach((w, i) => out.push(decodeWatch(w, from + i)));
      if (page.length < 100) return out;
    }
  },
  async ids(kind, addr) { return [...(await (await readRegistry())[kind](addr))].map(Number); },
  async send(method, args, onSent) {
    const s = await signer();
    const c = new (window.ethers.Contract)(NET.registry, REGISTRY_ABI, s);
    try {
      await c[method].estimateGas(...args); // surfaces custom errors before MetaMask opens
      const tx = await c[method](...args);
      onSent?.(tx.hash);
      const receipt = await tx.wait();
      if (receipt.status !== 1) fail('failed');
      const logs = receipt.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      return { hash: tx.hash, logs };
    } catch (e) { throw liveError(e, c.interface); }
  },
};

// ------------------------------------------------------------------ registry (preview)
const PKEY = `${SK}.preview.${NET.key}.v1`;
export const PREVIEW_WALLET = '0x' + 'b0b'.padEnd(39, '0') + '1';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeHash = () => '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
const pload = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '{"watches":[]}'); } catch { return { watches: [] }; } };
const psave = (s) => { try { localStorage.setItem(PKEY, JSON.stringify(s)); } catch { /* ignore */ } };
const me = () => wallet.account || PREVIEW_WALLET;
const preview = {
  async total() { return pload().watches.length; },
  async getWatch(id) { const w = pload().watches[id]; if (!w) fail('NoWatch'); return { ...w, id }; },
  async all() { return pload().watches.map((w, id) => ({ ...w, id })); },
  async ids(kind, addr) {
    return pload().watches.map((w, id) => ({ w, id })).filter(({ w }) => sameAddr(kind === 'watchesFor' ? w.target : w.owner, addr)).map((x) => x.id);
  },
  async send(method, args, onSent) {
    await pause(500); const hash = fakeHash(); onSent?.(hash); await pause(700);
    const s = pload();
    if (method === 'register') {
      const [target, chainId, eventSig, ruleHash, label] = args;
      if (!label || new TextEncoder().encode(label).length > 40) fail('BadLabel');
      const id = s.watches.length;
      s.watches.push({ owner: me(), target, chainId: Number(chainId), eventSig, ruleHash, label, active: true, at: Math.floor(Date.now() / 1000) });
      psave(s);
      return { hash, logs: [{ name: 'Registered', args: { id: BigInt(id) } }] };
    }
    const [id, v] = args; const w = s.watches[Number(id)];
    if (!w) fail('NoWatch');
    if (!sameAddr(w.owner, me())) fail('NotOwner');
    if (method === 'updateRule') w.ruleHash = v;
    if (method === 'setActive') w.active = !!v;
    psave(s);
    return { hash, logs: [] };
  },
};

const R = () => (MODE === 'live' ? live : preview);
export const registry = {
  total: () => R().total(),
  getWatch: (id) => R().getWatch(id),
  all: () => R().all(),
  watchesOf: async (owner) => Promise.all((await R().ids('watchesOf', owner)).map((id) => R().getWatch(id))),
  watchesFor: async (target) => Promise.all((await R().ids('watchesFor', target)).map((id) => R().getWatch(id))),
  async register(target, chainId, eventSig, ruleHash, label, onSent) {
    const { hash, logs } = await R().send('register', [target, chainId, eventSig, ruleHash, label], onSent);
    const ev = logs.find((l) => l.name === 'Registered');
    return { hash, id: Number(ev?.args?.id ?? ev?.args?.[0]) };
  },
  updateRule: (id, h, onSent) => R().send('updateRule', [id, h], onSent),
  setActive: (id, v, onSent) => R().send('setActive', [id, v], onSent),
};
export const currentAccount = () => (MODE === 'preview' ? me() : wallet.account);

// ------------------------------------------------------------------ rules kept in this browser (the chain only has the hash)
const RKEY = `${SK}.rules.${NET.key}.${MODE}`;
export const localRules = {
  all() { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } },
  get(id) { return this.all()[id] || null; },
  set(id, v) { const a = this.all(); a[id] = { ...(a[id] || {}), ...v }; try { localStorage.setItem(RKEY, JSON.stringify(a)); } catch { /* ignore */ } },
  remove(id) { const a = this.all(); delete a[id]; try { localStorage.setItem(RKEY, JSON.stringify(a)); } catch { /* ignore */ } },
};
const HKEY = `${SK}.hidden.${NET.key}.${MODE}`;
export const hidden = {
  all() { try { return new Set(JSON.parse(localStorage.getItem(HKEY) || '[]')); } catch { return new Set(); } },
  add(id) { const s = this.all(); s.add(id); try { localStorage.setItem(HKEY, JSON.stringify([...s])); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ Worker
export const hasWorker = () => !!CONFIG.worker;
async function call(path, { body, method = body ? 'POST' : 'GET', timeout = 20000 } = {}) {
  if (!CONFIG.worker) throw new ChainError('noWorker', 'The alert Worker isn’t connected yet.');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(CONFIG.worker.replace(/\/$/, '') + path, {
      method, signal: ctl.signal, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new ChainError(data.error || 'worker', data.message || `The Worker said no (${res.status}).`);
    return data;
  } catch (e) {
    if (e instanceof ChainError) throw e;
    throw new ChainError('worker', e.name === 'AbortError' ? 'The Worker took too long — try again.' : 'Couldn’t reach the Worker.');
  } finally { clearTimeout(t); }
}
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')).toString();
export const worker = {
  rule: (sentence, events, unit, decimals) => call('/watch/rule', { body: { sentence, events: events.map((e) => e.fragment), unit, decimals } }),
  save: (payload) => call('/watch/save', { body: { net: NET.key, ...payload } }),
  remove: (payload) => call('/watch/delete', { body: { net: NET.key, ...payload } }),
  test: (channel, label) => call('/watch/test', { body: { channel, label } }),
  tgStatus: (code) => call(`/watch/tg?${q({ code })}`),
  state: (ids) => call(`/watch/state?${q({ net: NET.key, ids: ids.join(',') })}`),
  publicRules: (target) => call(`/watch/public?${q({ net: NET.key, target })}`),
  stats: () => call(`/watch/stats?${q({ net: NET.key })}`, { timeout: 8000 }),
};

export { failedSig, ZERO32 };

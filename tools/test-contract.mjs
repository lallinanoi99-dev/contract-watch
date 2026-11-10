// Runs WatchRegistry on an in-memory chain and checks the PRD rules (section 6).
// Usage (from the project root): node tools/compile.mjs && node tools/test-contract.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import * as ethers from 'ethers';
import { ruleHash, eventSigOf, validateRule, templateEvents, failedSig, ZERO32 } from '../assets/rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi, bytecode } = JSON.parse(readFileSync(join(root, 'build/WatchRegistry.json'), 'utf8'));
const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'merge', chainId: 677 }, wallet: { totalAccounts: 3 } });
const provider = new ethers.BrowserProvider(chain);
const [alice, bob] = await Promise.all([0, 1].map((i) => provider.getSigner(i)));
const c = await (await new ethers.ContractFactory(abi, bytecode, alice).deploy()).waitForDeployment();
const as = (s) => c.connect(s);
const reverts = (call, name) => assert.rejects(call, (e) => e.revert?.name === name || (e.message || '').includes(name), `expected ${name}`);
let checks = 0;
const ok = (label) => { checks++; console.log(`  ✓ ${label}`); };
const TOKEN = '0x' + '12'.repeat(20);
const NFT = '0x' + '34'.repeat(20);

console.log('WatchRegistry contract');
assert.equal(await c.total(), 0n);
assert.equal(await c.FAILED_CALLS(), failedSig(ethers));
ok('deploys empty; FAILED_CALLS marker matches the app');

const { rule } = validateRule({ kind: 'event', event: 'Transfer', conditions: [{ field: 'value', op: '>', value: '1000', decimals: 18 }], label: 'Big transfers' }, templateEvents('erc20'));
const sig = eventSigOf(rule, ethers);
assert.equal(sig, ethers.id('Transfer(address,address,uint256)'));
const h = ruleHash(rule, ethers);

await reverts(as(alice).register.staticCall(ethers.ZeroAddress, 677, sig, h, 'x'), 'EmptyTarget');
await reverts(as(alice).register.staticCall(TOKEN, 677, sig, h, ''), 'BadLabel');
await reverts(as(alice).register.staticCall(TOKEN, 677, sig, h, 'x'.repeat(41)), 'BadLabel');
await as(alice).register.staticCall(TOKEN, 677, sig, h, 'x'.repeat(40));
ok('target required; label 1–40 bytes');

const rc = await (await as(alice).register(TOKEN, 677, sig, h, 'Big transfers')).wait();
const ev = c.interface.parseLog(rc.logs[0]);
assert.equal(ev.name, 'Registered');
assert.equal(ev.args.id, 0n); assert.equal(ev.args.owner, alice.address); assert.equal(ev.args.target.toLowerCase(), TOKEN);
await (await as(bob).register(TOKEN, 677, failedSig(ethers), h, 'Failed calls')).wait();
await (await as(alice).register(NFT, 968, ZERO32, h, 'Any event')).wait();
assert.equal(await c.total(), 3n);
ok('register emits Registered(id, owner, target); ids count up');

const w = await c.getWatch(0);
assert.equal(w.owner, alice.address); assert.equal(w.target.toLowerCase(), TOKEN); assert.equal(w.chainId, 677n);
assert.equal(w.eventSig, sig); assert.equal(w.ruleHash, h); assert.equal(w.label, 'Big transfers'); assert.equal(w.active, true);
assert.ok(w[7] > 0n); // by position: ethers results have a built-in .at()
await reverts(c.getWatch(9), 'NoWatch');
ok('getWatch returns every field; unknown id → NoWatch');

assert.deepEqual([...(await c.watchesFor(TOKEN))].map(Number), [0, 1]);
assert.deepEqual([...(await c.watchesFor(NFT))].map(Number), [2]);
assert.deepEqual([...(await c.watchesOf(alice.address))].map(Number), [0, 2]);
assert.deepEqual([...(await c.watchesOf(bob.address))].map(Number), [1]);
const page = await c.getWatches(1, 10);
assert.equal(page.length, 2); assert.equal(page[0].label, 'Failed calls');
assert.equal((await c.getWatches(5, 10)).length, 0);
ok('watchesFor(target), watchesOf(owner), getWatches paging');

const h2 = ethers.id('another rule');
await reverts(as(bob).updateRule.staticCall(0, h2), 'NotOwner');
await reverts(as(bob).setActive.staticCall(0, false), 'NotOwner');
await reverts(as(alice).updateRule.staticCall(7, h2), 'NoWatch');
let r = await (await as(alice).updateRule(0, h2)).wait();
assert.equal(c.interface.parseLog(r.logs[0]).name, 'RuleUpdated');
r = await (await as(alice).setActive(0, false)).wait();
const ac = c.interface.parseLog(r.logs[0]);
assert.equal(ac.name, 'ActiveChanged'); assert.equal(ac.args.active, false);
const w2 = await c.getWatch(0);
assert.equal(w2.ruleHash, h2); assert.equal(w2.active, false);
await (await as(alice).setActive(0, true)).wait();
assert.equal((await c.getWatch(0)).active, true);
ok('updateRule / setActive are owner-only and emit events');

const gas = (await (await as(alice).register(TOKEN, 677, sig, h, 'Big transfers on Snack Poll')).wait()).gasUsed;
ok(`register gas ≈ ${Number(gas).toLocaleString()}`);

console.log(`\n${checks} contract checks passed.`);

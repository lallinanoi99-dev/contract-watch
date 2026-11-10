// Checks the shared rule logic (assets/rules.js) used by the app and the Worker.
// Usage (from the project root): node tools/test-rules.mjs
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import * as R from '../assets/rules.js';

let checks = 0;
const ok = (label) => { checks++; console.log(`  ✓ ${label}`); };
console.log('Rules');

// --- ABI parsing
const erc20 = R.templateEvents('erc20');
assert.equal(erc20[0].signature, 'Transfer(address,address,uint256)');
assert.equal(erc20[0].inputs[0].indexed, true);
const remix = JSON.stringify({ abi: [
  { type: 'event', name: 'VoteCast', inputs: [{ name: 'voter', type: 'address', indexed: true }, { name: 'proposalId', type: 'uint256' }, { name: 'support', type: 'uint8' }, { name: 'weight', type: 'uint256' }, { name: 'reason', type: 'string' }] },
  { type: 'function', name: 'vote', inputs: [], outputs: [] },
] });
const p = R.parseAbi(remix);
assert.equal(p.events.length, 1); assert.equal(p.functions, 1);
assert.equal(R.parseAbi('[{"type":"function","name":"x"}]').events.length, 0);
assert.equal(R.parseAbi('nonsense').error, 'unreadable');
assert.equal(R.parseAbi('event Ping(uint256 n)').events[0].name, 'Ping');
ok('parses JSON ABI, Remix artifacts and human-readable events');

// --- chips
assert.deepEqual(R.chipAvailability(erc20), { big: true, owner: false, votes: false, failed: true, any: true });
assert.equal(R.chipAvailability(p.events).votes, true);
assert.equal(R.ruleFromChip('owner', erc20), null);
const big = R.ruleFromChip('big', erc20, { name: 'Snack Poll' });
assert.equal(big.event, 'Transfer'); assert.equal(big.conditions[0].field, 'value');
assert.equal(R.chipAvailability([]).big, false);
ok('chips follow the ABI (no events → only failed calls / any)');

// --- validation
let v = R.validateRule(big, erc20);
assert.ok(v.ok); assert.equal(v.rule.label, 'Big transfers');
assert.equal(R.validateRule({ kind: 'event', event: 'Nope' }, erc20).error, "I couldn't map that — pick an event");
assert.match(R.validateRule({ event: 'Transfer', conditions: [{ field: 'nope', op: '>', value: '1' }] }, erc20).error, /no field/);
assert.match(R.validateRule({ event: 'Transfer', conditions: [{ field: 'from', op: '>', value: '1' }] }, erc20).error, /doesn't work/);
assert.match(R.validateRule({ event: 'Transfer', conditions: [{ field: 'from', op: '=', value: '0x12' }] }, erc20).error, /isn't an address/);
assert.match(R.validateRule({ event: 'Transfer', conditions: [{ field: 'value', op: '>', value: 'lots' }] }, erc20).error, /isn't a number/);
assert.ok(R.validateRule({ event: 'transfer(address,address,uint256)'.replace('transfer', 'Transfer') }, erc20).ok);
assert.equal(R.validateRule({ kind: 'event', event: 'Transfer', quiet: { from: '23:00', to: '07:00', tz: 'Asia/Bangkok' } }, erc20).rule.quiet.tz, 'Asia/Bangkok');
ok('validation rejects unknown events, fields, bad ops and bad values');

// --- hash is stable regardless of key order
const a = R.canonicalRule({ b: 1, a: { d: 2, c: 3 } });
assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
assert.equal(R.ruleHash(v.rule, ethers), R.ruleHash(JSON.parse(JSON.stringify(v.rule)), ethers));
ok('canonical JSON + hash are stable');

// --- matching + decoding a real-looking log
const iface = new ethers.Interface(erc20.map((e) => e.fragment));
const from = '0x' + 'ab'.repeat(19) + '12'; const to = '0x' + 'cd'.repeat(19) + '34';
const log = iface.encodeEventLog('Transfer', [from, to, ethers.parseUnits('2500', 18)]);
const d = R.decodeLog(v.rule, log, ethers);
assert.equal(d.name, 'Transfer');
assert.ok(R.matches(v.rule, d.args));
const small = R.decodeLog(v.rule, iface.encodeEventLog('Transfer', [from, to, ethers.parseUnits('999.5', 18)]), ethers);
assert.ok(!R.matches(v.rule, small.args));
const toRule = R.validateRule({ event: 'Transfer', conditions: [{ field: 'to', op: '=', value: to.toUpperCase().replace('0X', '0x') }] }, erc20).rule;
assert.ok(R.matches(toRule, d.args));
assert.equal(R.summarize(v.rule, d).toLowerCase(), '2,500 bot from 0xab…12 to 0xcd…34');
const msg = R.alertText({ label: 'Big transfer', target: from }, { ...v.rule, name: 'Snack Poll' }, { summary: R.summarize(v.rule, d), block: 1234567 });
assert.equal(msg.toLowerCase(), '🦉 hoot! big transfer on snack poll — 2,500 bot from 0xab…12 to 0xcd…34 · block #1,234,567');
ok('decodes logs, applies conditions (decimals aware) and writes the alert line');

assert.equal(R.describeRule(v.rule), 'Event Transfer · when value > 1,000 BOT');
assert.equal(R.describeRule({ kind: 'failed' }).startsWith('Failed calls'), true);
ok('describes rules in plain words');

// --- event signature on-chain
assert.equal(R.eventSigOf(v.rule, ethers), ethers.id('Transfer(address,address,uint256)'));
assert.equal(R.eventSigOf({ kind: 'any' }, ethers), R.ZERO32);
ok('eventSig: topic0 / zero for any / marker for failed');

// --- units
assert.equal(R.parseUnits('1,000.5', 18), 1000500000000000000000n);
assert.equal(R.formatUnits(2500n * 10n ** 18n, 18), '2,500');
assert.equal(R.formatUnits(1234567n, 0), '1,234,567');
assert.throws(() => R.parseUnits('1.5', 0));
ok('BigInt units without float drift');

// --- quiet hours (Asia/Bangkok is UTC+7, no DST)
const q = { from: '23:00', to: '07:00', tz: 'Asia/Bangkok' };
assert.equal(R.inQuiet(q, new Date('2026-11-10T17:00:00Z')), true); // 00:00 BKK
assert.equal(R.inQuiet(q, new Date('2026-11-10T05:00:00Z')), false); // 12:00 BKK
assert.equal(R.inQuiet({ from: '09:00', to: '17:00', tz: 'UTC' }, new Date('2026-11-10T10:00:00Z')), true);
assert.equal(R.inQuiet(null), false);
ok('quiet hours wrap past midnight, in the watch timezone');

// --- fallback sentence parser
let g = R.guessRule('Tell me when someone sends more than 1,000 BOT', erc20);
assert.deepEqual(g.conditions, [{ field: 'value', op: '>', value: '1000', decimals: 18 }]);
assert.equal(g.unit, 'BOT');
assert.ok(R.validateRule(g, erc20).ok);
g = R.guessRule('ping me on transfers over 5k to 0x' + 'ab'.repeat(20), erc20);
assert.equal(g.conditions[0].value, '5000'); assert.equal(g.conditions[1].field, 'to');
assert.equal(R.guessRule('every new vote', p.events).event, 'VoteCast');
assert.equal(R.guessRule('when the owner changes', R.templateEvents('ownable')).event, 'OwnershipTransferred');
assert.equal(R.guessRule('failed calls please', erc20).kind, 'failed');
assert.equal(R.guessRule('the weather in Paris', erc20), null);
ok('plain-English fallback covers the suggested replies');

console.log(`\n${checks} rule checks passed.`);

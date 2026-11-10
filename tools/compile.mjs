// Compiles contracts/WatchRegistry.sol and writes build/ artifacts (ABI, bytecode, standard JSON input for explorer verification).
// Usage (from the project root): npm --prefix tools install && node tools/compile.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'WatchRegistry';
const path = `contracts/${name}.sol`;

const input = {
  language: 'Solidity',
  sources: { [path]: { content: readFileSync(join(root, path), 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of output.errors || []) console.error(e.formattedMessage);
if ((output.errors || []).some((e) => e.severity === 'error')) process.exit(1);

const contract = output.contracts[path][name];
const runtime = contract.evm.deployedBytecode.object.length / 2;
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, `build/${name}.standard-input.json`), JSON.stringify(input, null, 2) + '\n');
writeFileSync(
  join(root, `build/${name}.json`),
  JSON.stringify({ compiler: solc.version(), abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2) + '\n',
);
console.log(`${name}: compiled with ${solc.version()} — runtime ${runtime} bytes (limit 24576)`);
if (runtime > 24576) process.exit(1);

# Contract Watch 🦉

**Know the moment it happens.** Pick any BOT Chain contract, say what to watch, and get a Telegram or Discord ping — with a live dashboard and an on-chain record of every watch.

*Free (gas only). No tokens, no payments, no accounts. Read-only — it never touches your keys.*

## Status

| | |
|---|---|
| Live site | _not published yet_ (GitHub Pages + custom domain) |
| WatchRegistry (BOT Chain mainnet, chain ID 677) | [`0x505fc62244B7E490c463B0390492F19C97d51910`](https://scan.botchain.ai/address/0x505fc62244B7E490c463B0390492F19C97d51910) — set in `assets/config.js` and `worker/wrangler.toml`, shown in the footer. Deployed from `0xC34D18461A4fA9f39Eb86c23F3C081DdFBae18E4` in block 29,750,018 |
| WatchRegistry (testnet, chain ID 968) | _not deployed yet_ |
| Worker | _not deployed yet_ — paste its URL into `worker` in `assets/config.js` |

Until the registry address is set, the site runs in **preview mode** (a yellow bar says so): watches are saved in your browser, but contracts, ABIs and events are still read **live** from BOT Chain, so the dashboard shows real matches. Without the Worker, the plain-English box uses a built-in parser and the dashboard scans the last ~4,000 blocks in the browser.

## What's inside

| Route | What it is |
|---|---|
| `/` | Website (Fruitful-style layout, our colours): hero with address input + topic tabs and the animated Hoot → block → paper-plane → phone scene · live trust strip · “We tell you” (pinned, chips drive a dashboard mock) · “Just say what to watch” (self-typing chat → rule card) · 4 feature blocks · 4 steps with a drawn dotted line · who it’s for · FAQ · closing CTA + illustration row · night-watch footer |
| `/app` | Your watches (status, last alert, alerts today) |
| `/app/new` | 5 steps: **Contract** (address → mainnet/testnet auto-detected; verified ABI, name, symbol and decimals loaded from the explorer; or paste JSON / drop a Remix artifact / template) · **What to watch** (template chips or “just say it” → rule card → Looks right / Edit) · **Filters** (event, conditions, from/to, min value with decimals, label, unit, quiet hours in your timezone) · **Where to send** (Telegram connect, Discord webhook + Send test, or dashboard only) · **Register** (tx + signed message) |
| `/app/w/:id` | One watch: KPIs, matches chart, live decoded feed with explorer links, Pause / Resume, Edit rule, Delete |
| `/app/edit/:id` | Same wizard, prefilled; `updateRule` only when the rule hash changes |
| `/w/:contract` | Public page — labels + rules on a contract, never channels |

```
index.html · 404.html (GitHub Pages SPA redirect) · deploy.html (one-click deploy from MetaMask)
assets/
  config.js     ← registry addresses, Worker URL, links (the one place to edit)
  rules.js      rule logic shared by app, Worker and tests: ABI parsing, templates, validation, hash, matching, alert text, quiet hours, plain-English fallback
  chain.js      RPC reads, explorer ABI lookup, wallet, WatchRegistry (live + preview), Worker client
  hoot.js       Hoot 🦉 (watch · bell · sleep · scroll · confused · happy) + flat illustrations + icons
  main.js · home.js · app.js · public.js · ui.js · styles.css
contracts/WatchRegistry.sol
worker/         Cloudflare Worker: cron + /watch/* + Telegram webhook
tools/          compile, tests, dev server
build/          ABI + bytecode + standard JSON input (for explorer verification)
```

## How a watch works

1. **Rule** (JSON, see the top of `assets/rules.js`): `kind` (event / any / failed), event fragment(s) for decoding, conditions (`> >= < <= = != contains`, decimals-aware), unit, token decimals, contract nickname, quiet hours.
2. **On-chain**: `register(target, chainId, eventSig, ruleHash, label)` — `eventSig` is the event topic, `0x0` for any event, or `keccak256("ContractWatch:FailedCalls")`. `ruleHash = keccak256(canonical JSON)`. Channels never go on-chain.
3. **Worker**: the app signs `Contract Watch: watch #12 / Network / Action / Time`; the Worker checks the signer is the on-chain owner, the hash matches, and the signature is fresh and unused, then stores the rule and the channel secret in KV.
4. **Every minute** the cron reads new blocks per watch (`eth_getLogs`, ≤ 2,000 blocks per call, ≤ 3 calls per run, so it catches up and shows “Catching up · N blocks behind”), decodes, tests the rule and sends:
   `🦉 Hoot! Big transfers on Snack Poll — 2,500 BOT from 0xAB…12 to 0xCD…34 · block #1,234,567 · [View tx]`
   Failed calls: receipts with `status = 0` for transactions to the contract, last 200 blocks per run.
5. **Limits**: 20 alerts/min per watch, then one digest · quiet hours → one digest when they end · 500/day → paused with a notice until the next UTC day (or Resume).

BOT Chain makes ~1 block every 0.75 s, so a 1-minute cron is ~80 blocks — alerts arrive within about a minute.

## Contract

`contracts/WatchRegistry.sol` — Solidity ^0.8.20, optimizer 200, EVM `paris`, runtime ≈ 4.2 KB, no tokens or payments.
`register` (label 1–40 bytes) · `updateRule` · `setActive` (owner only) · views `getWatch`, `watchesFor`, `watchesOf`, `total`, `getWatches(from, count)` · events `Registered`, `RuleUpdated`, `ActiveChanged`. Register ≈ 220k gas.

## Run locally

```bash
node tools/serve.mjs
```

Open http://localhost:4625 (unknown paths fall back to `index.html`, like GitHub Pages + `404.html`). Add `?net=testnet` for the testnet registry, `?preview` to force preview mode.

## Tests

```bash
npm --prefix tools install
```

```bash
node tools/compile.mjs && node tools/test-contract.mjs && node tools/test-rules.mjs
```

```bash
npm --prefix worker install && (cd worker && node test-worker.mjs)
```

Contract (7) · rules (10) · Worker (11 — including decoding real mainnet Transfer logs, the 20/min digest, quiet-hours digest and the 500/day pause).

## Deploy

**Contract** — `node tools/serve.mjs`, open http://localhost:4625/deploy.html, deploy to testnet, try a watch, then deploy to mainnet. Paste the address into `assets/config.js` → `registry`, `worker/wrangler.toml` → `REGISTRY_MAINNET`, and the Status table above. Verify on scan.botchain.ai with `build/WatchRegistry.standard-input.json`.

**Worker** (from `worker/`):

```bash
npx wrangler kv namespace create CW
```

Paste the id into `wrangler.toml`, set `ALLOWED_ORIGINS` to your site, then:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

```bash
npx wrangler deploy
```

Point the Telegram bot (create it with @BotFather, e.g. `ContractWatchBot` — match `telegramBot` in `config.js`) at the Worker:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-worker>/tg&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The cron writes one KV key per network per minute (~1,440 writes/day) — over the Workers **free** KV limit of 1,000 writes/day, so use Workers Paid ($5/mo), or change the cron to `*/2 * * * *`.

**AI rule maker** — Claude `claude-opus-5-5` with structured outputs (a JSON schema, so it can only return rule JSON), low effort, and server-side refusal fallback. The Worker validates the result against the ABI; the app shows it as a rule card that you confirm. Without the key, the app’s built-in parser handles the suggested sentences.

**Site** — push to GitHub, enable Pages, add the custom domain. `404.html` handles `/app`, `/w/0x…` etc.

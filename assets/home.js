// The website at "/": 9 sections following the reference layout, plus GSAP motion.
import { CONFIG } from './config.js';
import { $, $$, esc, reduced, gsapReady, countUp } from './ui.js';
import { hoot, art, icon, channelLogo } from './hoot.js';
import { isAddress, guessRule, validateRule, templateEvents, parseEventFragment, describeCondition } from './rules.js';
import { go, addCleanup, siteStats } from './main.js';

const TOPICS = [
  { id: 'big', tab: 'Transfers', emoji: '💸', ch: 'telegram', text: '🦉 Hoot! Big transfer on Snack Poll — 2,500 BOT from 0xAB…12 to 0xCD…34 · block #1,234,567' },
  { id: 'owner', tab: 'Ownership', emoji: '👑', ch: 'discord', text: '🦉 Hoot! Ownership changed on Snack Poll — owner 0x88…67 → 0x3F…a1 · block #1,234,602' },
  { id: 'votes', tab: 'Votes', emoji: '🗳', ch: 'telegram', text: '🦉 Hoot! New vote on Snack DAO — voter 0x5C…9e · proposal 7 · support 1 · block #1,234,655' },
  { id: 'failed', tab: 'Failures', emoji: '⚠️', ch: 'discord', text: '🦉 Hoot! Failed call on Snack Poll — failed call from 0xAB…12 · 0xa9059cbb · block #1,234,690' },
  { id: 'any', tab: 'Any event', emoji: '📣', ch: 'telegram', text: '🦉 Hoot! Any event on Snack Poll — Approval · owner 0xAB…12 · spender 0xCD…34 · block #1,234,711' },
];
const VOTE_EVENT = parseEventFragment('event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)');
const SAY = [
  { opt: 'Big transfers', text: 'Tell me when someone sends more than 1,000 BOT', events: templateEvents('erc20'), ch: 'telegram' },
  { opt: 'Owner changes', text: 'Ping me when the owner changes', events: templateEvents('ownable'), ch: 'discord' },
  { opt: 'Every new vote', text: 'Every new vote on our DAO, but quiet at night', events: [VOTE_EVENT], ch: 'telegram', quiet: true },
];
const DASH = {
  big: { title: 'Big transfers', rule: 'Event Transfer · when value > 1,000 BOT', em: '💸', today: 12, rows: [['2,500 BOT', '0xAB…12 → 0xCD…34', '2m'], ['1,800 BOT', '0x19…f0 → 0xAB…12', '14m'], ['12,000 BOT', '0x77…3c → 0x0a…91', '1h']] },
  owner: { title: 'Ownership changed', rule: 'Event OwnershipTransferred · every time', em: '👑', today: 1, rows: [['New owner', '0x88…67 → 0x3F…a1', '3h'], ['New owner', '0x00…00 → 0x88…67', '9d'], ['—', 'Nothing else yet', '']] },
  votes: { title: 'New votes', rule: 'Event VoteCast · every time', em: '🗳', today: 31, rows: [['Vote · yes', 'voter 0x5C…9e · #7', '1m'], ['Vote · no', 'voter 0xA2…10 · #7', '6m'], ['Vote · yes', 'voter 0x41…ee · #6', '22m']] },
  failed: { title: 'Failed calls', rule: 'Failed calls · any transaction that reverts', em: '⚠️', today: 3, rows: [['Reverted', 'from 0xAB…12 · 0xa9059cbb', '8m'], ['Reverted', 'from 0x3F…a1 · 0x095ea7b3', '41m'], ['Reverted', 'from 0xAB…12 · 0xa9059cbb', '2h']] },
  any: { title: 'Any event', rule: 'Any event · 3 known', em: '📣', today: 86, rows: [['Transfer', 'from 0xAB…12 · value 40', 'now'], ['Approval', 'owner 0xCD…34', '1m'], ['Transfer', 'from 0x19…f0 · value 7', '1m']] },
};
const bars = (seed, n = 24) => Array.from({ length: n }, (_, i) => 12 + Math.round(Math.abs(Math.sin(seed * 7.3 + i * 0.9) * 60 + Math.cos(i * 0.4 + seed) * 22)));

export async function renderHome(root) {
  root.innerHTML = `
  <!-- 1 · Hero -->
  <section class="hero" id="top">
    <div class="wrap hero-in">
      <h1 class="h-hero" data-split>Turn every block<br>into peace of mind.</h1>
      <p class="hero-sub" data-fade>Watch any BOT Chain contract and get a Telegram or Discord ping the moment something happens.</p>
      <form class="hero-input" id="heroForm" data-fade novalidate>
        <input id="heroAddr" placeholder="Paste a contract address — 0x…" spellcheck="false" autocomplete="off" aria-label="Contract address" aria-describedby="heroErr">
        <button class="btn btn-primary" type="submit">Watch it ${icon.right()}</button>
      </form>
      <p class="hero-err" id="heroErr" role="alert"></p>
      <div class="tabs" role="tablist" aria-label="What to watch" data-fade>
        ${TOPICS.map((t, i) => `<button class="tab" role="tab" type="button" data-topic="${t.id}" aria-selected="${i === 0}">${t.emoji} ${t.tab}</button>`).join('')}
      </div>
    </div>
    <div class="wrap">
      <div class="stage" id="stage" aria-label="Hoot watches blocks go by and sends an alert to your phone" role="img">
        <div class="stage-branch"></div>
        <div class="stage-hoot">${hoot('watch')}</div>
        <div class="stage-blocks" id="blocks">${Array.from({ length: 7 }, (_, i) => `<div class="blk" data-i="${i}">${art.block()}<span class="blk-n">#${(1234561 + i).toLocaleString('en-US')}</span></div>`).join('')}</div>
        <div class="stage-plane" id="plane">${art.planeSolo()}</div>
        <div class="phone" id="phone"><div class="phone-screen">
          <div class="phone-notch"></div>
          <div class="phone-time">9:41</div><div class="phone-date">Example alerts</div>
          <div id="notifs">${notif(TOPICS[0])}</div>
        </div></div>
      </div>
    </div>
  </section>

  <!-- 2 · Trust strip -->
  <section class="trust wrap" aria-label="Live numbers">
    <div class="trust-row">
      <a class="bot-badge" href="${CONFIG.links.botchain}" target="_blank" rel="noopener"><img src="assets/botchain-mark.png" alt="" width="34" height="34"><span>Built on BOT Chain<small>Mainnet · chain ID 677</small></span></a>
      ${laurel('stWatches', 'watches registered')}${laurel('stAlerts', 'alerts sent today')}${laurel('stContracts', 'contracts watched')}
    </div>
    <p class="trust-note" id="trustNote">Real numbers, read live from WatchRegistry on BOT Chain. No ratings, no made-up reviews.</p>
  </section>

  <!-- 3 · We tell you -->
  <section class="tell" id="templates">
    <div class="wrap tell-head center"><h2 class="h-big" data-split>We don’t just show events.<br>We tell you.</h2></div>
    <div class="wrap tell-grid" id="tellPin">
      <div class="tell-copy">
        <h3 class="h-md">Never miss a thing.</h3>
        <p>Instead of refreshing the explorer, pick what matters. Hoot watches every block and only pings you when your rule matches — with the amount, the addresses and a link to the transaction.</p>
        <div class="chip-card glass">
          <h4>Made for your contract.</h4>
          <p>Real events. Plain-English alerts.</p>
          <div class="goal-grid" id="goalGrid">
            ${TOPICS.map((t, i) => `<button class="goal" type="button" data-goal="${t.id}" aria-pressed="${i === 0}"><span class="g-ico">${t.emoji}</span>${esc(['Big transfers', 'Ownership changed', 'New votes', 'Failed calls', 'Any event'][i])}<span class="g-check">${icon.check()}</span></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="tell-shot"><div class="browser" aria-label="Dashboard preview"><div class="browser-bar"><i></i><i></i><i></i><span>contractwatch.app/app/w/12</span></div><div class="mock" id="dashMock"></div></div></div>
    </div>
  </section>

  <!-- 4 · Just say it -->
  <section class="section say" id="say">
    <div class="wrap center"><h2 class="h-big" data-split>Just say what to watch.</h2>
      <p class="muted" style="margin-top:14px" data-fade>Type it like you’d text a friend. Hoot turns it into a rule — you check it before anything goes on-chain.</p></div>
    <svg class="branch" viewBox="0 0 560 90" aria-hidden="true"><path d="M280 0 V90"/><circle cx="280" cy="6" r="6"/></svg>
    <div class="wrap"><div class="card say-card">
      <div class="say-left">
        <div class="chat" id="chat">
          <div class="chat-head">${hoot('happy')}<span>What do you want to watch?</span><button type="button" aria-label="Reset">${icon.close()}</button></div>
          <div class="chat-opts" id="chatOpts">${SAY.map((s, i) => `<button class="chat-opt" type="button" data-say="${i}" aria-pressed="false">${esc(s.opt)}</button>`).join('')}</div>
          <div class="chat-input"><span class="typed" id="typed"></span><button class="round-btn" type="button" id="chatSend" aria-label="Make the rule">${icon.arrow()}</button></div>
        </div>
      </div>
      <div class="say-right">
        <div class="rule-card" id="ruleCard">
          <div class="rc-head"><span class="eyebrow">Your rule</span><span class="status">Ready</span></div>
          <div class="rc-chips" id="rcChips"></div>
          <p class="rc-text" id="rcText">Pick a suggestion to see Hoot build the rule.</p>
          <div class="rc-actions"><a class="btn btn-primary btn-sm" id="rcYes" href="app/new" data-link>Looks right</a><a class="btn btn-outline btn-sm" id="rcEdit" href="app/new" data-link>Edit</a></div>
        </div>
        <p class="muted" style="font-size:14px;max-width:420px">The AI only sees your sentence and the contract’s event list. It returns a rule — never a transaction.</p>
      </div>
    </div></div>
  </section>

  <!-- 5 · Feature blocks -->
  <section class="section features" id="features">
    <div class="wrap center"><h2 class="h-big" data-split>Everything Hoot does for you.</h2></div>
    <svg class="branch" viewBox="0 0 560 90" aria-hidden="true"><path id="branchDraw" d="M280 0 V30 Q280 45 265 45 H155 Q140 45 140 60 V90 M280 30 Q280 45 295 45 H405 Q420 45 420 60 V90"/><circle cx="280" cy="6" r="6"/></svg>
    <div class="wrap feat-grid">
      <article class="card feat">
        <div class="feat-vis"><div class="vis-stack">
          <div class="bubble">${channelLogo.telegram()}<div><b>Telegram · Contract Watch bot</b>🦉 Hoot! Big transfer on Snack Poll — 2,500 BOT…</div></div>
          <div class="bubble">${channelLogo.discord()}<div><b>Discord · #alerts</b>🦉 Hoot! Ownership changed on Snack Poll…</div></div>
        </div></div>
        <div class="feat-body"><h3>Telegram &amp; Discord</h3><p>Connect the bot in one tap or paste a channel webhook. Send a test before you save.</p></div>
      </article>
      <article class="card feat">
        <div class="feat-vis"><div class="mini-chart">
          <div class="mc-top"><span class="eyebrow">Matches · 24h</span><b data-count="148">0</b></div>
          <div class="mock-bars" id="featBars">${bars(3).map((h, i) => `<i style="height:${h}%" class="${i === 17 ? 'hot' : ''}"></i>`).join('')}</div>
          <div class="mc-axis"><span>-24h</span><span>-12h</span><span>now</span></div>
        </div></div>
        <div class="feat-body"><h3>Live dashboard</h3><p>Every match, decoded, with explorer links and a 24-hour chart. Pause or edit a watch any time.</p></div>
      </article>
      <article class="card feat">
        <div class="feat-vis"><div class="quiet-vis">
          <div class="quiet-line"><div class="qz2"></div><div class="qz"></div>${[8, 19, 33, 48, 61, 80, 90].map((x) => `<i class="dot" style="left:${x}%"></i>`).join('')}</div>
          <div class="quiet-labels"><span>00:00</span><span>07:00 ☀️</span><span>12:00</span><span>23:00 🌙</span></div>
          <div class="bubble">${channelLogo.telegram()}<div><b>07:00 · Digest</b>🦉 Good morning! 14 matches while you slept — 3 big transfers, 11 votes.</div></div>
        </div></div>
        <div class="feat-body"><h3>Quiet hours &amp; digests</h3><p>Set quiet hours in your timezone. Busy minutes become one digest, never a flood.</p></div>
      </article>
      <article class="card feat">
        <div class="feat-vis"><div class="page-mock">
          <span class="pm-url">contractwatch.app/w/0x12ab…9f3c</span>
          <div class="pm-ok"><span class="tick">${icon.check()}</span>This project watches for ownership changes</div>
          <div class="pm-row">👑 Ownership changed · every time</div><div class="pm-row">💸 Big transfers · value &gt; 10,000 BOT</div>
        </div></div>
        <div class="feat-body"><h3>Public watch page</h3><p>Show your community what you monitor. Labels and rules only — channels stay private.</p></div>
      </article>
    </div>
  </section>

  <!-- 6 · Steps -->
  <section class="section steps" id="how">
    <div class="wrap steps-grid">
      <div class="steps-copy"><h2>It’s all built for you.<span class="soft">Just turn it on,</span><span class="soft">and watch it work.</span></h2>
        <a class="btn btn-primary" href="app/new" data-link>Start watching ${icon.right()}</a></div>
      <div class="steps-list" id="stepsList">
        <svg class="steps-line" preserveAspectRatio="none" viewBox="0 0 4 100" aria-hidden="true"><path d="M2 0 V100" opacity=".35"/><path id="stepsDraw" d="M2 0 V100" style="stroke-dasharray:none"/></svg>
        ${[
          ['Paste it', 'Drop in any BOT Chain contract address. Hoot finds the network and reads its events — or use a template.', stepArt(0)],
          ['Pick it', 'Tap a template or just say it: “more than 1,000 BOT”. Add filters, quiet hours and a label.', stepArt(1)],
          ['Connect it', 'Connect Telegram in one tap or paste a Discord webhook. Send a test to be sure.', stepArt(2)],
          ['Watch it work', 'Register the watch on BOT Chain. Within about a minute of a match, your phone buzzes.', hoot('bell')],
        ].map(([h, p, a], i) => `<article class="card step"><span class="step-num">0${i + 1}</span><div class="step-art">${a}</div><h3>${h}</h3><p>${p}</p></article>`).join('')}
      </div>
    </div>
  </section>

  <!-- 7 · Who it's for -->
  <section class="section who">
    <div class="wrap"><h2 class="h-big" data-split>Who keeps Hoot <span class="soft">on watch.</span></h2>
      <div class="who-grid">
        ${[
          ['Hackathon builders', 'Know the second your demo contract gets its first real call — or its first revert.', art.blocks(), 'Failed calls to this contract'],
          ['DAO / voting projects', 'Every vote, in your community’s Discord, with the voter and the proposal.', ballot(), 'Event VoteCast · every time'],
          ['Token projects', 'Whale moves, mints and burns — with the amount already in BOT.', coins(), 'Transfer · value > 10,000 BOT'],
          ['Judges keeping an eye on demos', 'Watch a team’s contract during demo day without refreshing an explorer.', art.binoculars(), 'Any event · this contract'],
        ].map(([h, p, a, q]) => `<article class="card who-card"><div class="who-art">${a}</div><h3>${h}</h3><p>${p}</p><span class="q">${esc(q)}</span></article>`).join('')}
      </div>
    </div>
  </section>

  <!-- 8 · FAQ -->
  <section class="section" id="faq">
    <div class="wrap"><h2 class="h-big center" data-split>Frequently asked questions</h2>
      <div class="faq-list">
        ${[
          ['Is it free?', 'Yes. Contract Watch has no plans, tokens or payments. Registering a watch is one BOT Chain transaction, so you only pay its small gas fee.'],
          ['Does it hold my keys?', 'No. It’s read-only. Your wallet signs two things: the register transaction and a short message proving you own the watch. Nothing can move your funds.'],
          ['How fast are alerts?', 'About a minute. The Worker checks every watch once a minute, reads new blocks with eth_getLogs, and sends anything that matches. BOT Chain makes a block roughly every second.'],
          ['Where are my Telegram/Discord details stored?', 'Only in the Worker’s private storage — never on-chain and never on the public page. The chain stores the contract, the event, a hash of the rule and your label.'],
          ['Mainnet and testnet?', `Both. Paste an address and Hoot checks BOT Chain mainnet (677) and testnet (968) for you. Need test BOT? Use the <a href="${CONFIG.links.faucet}" target="_blank" rel="noopener">faucet</a>.`],
        ].map(([q, a], i) => `<details class="faq-item"${i === 0 ? ' open' : ''}><summary>${q}${icon.chev()}</summary><div class="faq-a">${a}</div></details>`).join('')}
      </div>
    </div>
  </section>

  <!-- 9 · Closing CTA + illustration row -->
  <section class="section cta">
    <div class="wrap">
      <h2 class="h-big" data-split>Never miss a block again.<br>Start for free.</h2>
      <div class="cta-badges"><div><span class="ib">${icon.bolt()}</span>~1 minute from<br>block to buzz</div><div><span class="ib">${icon.gift()}</span>No payment<br>required</div></div>
      <div class="card cta-card">
        <ul class="checklist">${['No code', 'Telegram or Discord', 'On-chain record', 'Plain-English rules', 'Quiet hours &amp; digests', 'Public watch page'].map((x) => `<li><span class="tick">${icon.check()}</span>${x}</li>`).join('')}</ul>
        <a class="btn btn-primary btn-block" href="app/new" data-link>Start watching</a>
      </div>
      <div class="illus-row" aria-hidden="true">
        <div class="illus">${hoot('sleep')}</div><div class="illus">${art.bell()}</div><div class="illus big">${hoot('watch')}</div>
        <div class="illus">${art.binoculars()}</div><div class="illus">${art.blocks()}</div><div class="illus">${art.plane()}</div><div class="illus">${hoot('scroll')}</div>
      </div>
    </div>
  </section>`;

  bindHero(root);
  bindTell(root);
  bindSay(root);
  loadStats();
  const ok = await gsapReady();
  if (ok && !reduced()) animate(root);
  else staticState(root);
}

// ------------------------------------------------------------------ pieces
function notif(t, old = false) {
  return `<div class="notif${old ? ' old' : ''}" data-topic="${t.id}"><div class="notif-top">${channelLogo[t.ch]()}<b>Contract Watch</b><time>now</time></div><p>${esc(t.text)}</p></div>`;
}
function laurel(id, label) {
  const leaf = `<svg viewBox="0 0 26 60" fill="currentColor" aria-hidden="true"><path d="M20 58C8 50 4 36 8 20" stroke="currentColor" stroke-width="2" fill="none"/>${[[10, 48, -40], [6, 38, -25], [5, 28, -10], [7, 18, 8], [11, 9, 25]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="3.2" ry="6.5" transform="rotate(${r} ${x} ${y})"/>`).join('')}</svg>`;
  return `<div class="laurel">${leaf}<div><b id="${id}">—</b><span>${label}</span></div><span class="l-r">${leaf}</span></div>`;
}
function stepArt(i) {
  if (i === 0) return `<svg viewBox="0 0 220 110" aria-hidden="true"><rect x="6" y="30" width="208" height="50" rx="25" fill="#fff" stroke="#12312A" stroke-opacity=".15" stroke-width="2"/><text x="30" y="61" font-family="JetBrains Mono, monospace" font-size="15" fill="#12312A">0x12ab…9f3c</text><rect x="148" y="40" width="58" height="30" rx="15" fill="#FF8A3D"/><path d="M168 55h18M180 49l6 6-6 6" stroke="#12312A" stroke-width="2.5" fill="none" stroke-linecap="round"/><rect x="126" y="46" width="2.5" height="18" fill="#FF8A3D"/></svg>`;
  if (i === 1) return `<svg viewBox="0 0 220 110" aria-hidden="true"><rect x="2" y="14" width="118" height="34" rx="17" fill="#12312A"/><text x="14" y="36" font-size="12" fill="#fff" font-family="Inter, sans-serif">💸 Big transfers</text><rect x="126" y="14" width="90" height="34" rx="17" fill="#fff" stroke="#12312A" stroke-opacity=".15" stroke-width="2"/><text x="140" y="36" font-size="12" fill="#12312A" font-family="Inter, sans-serif">👑 Owner</text><rect x="6" y="60" width="96" height="34" rx="17" fill="#fff" stroke="#12312A" stroke-opacity=".15" stroke-width="2"/><text x="20" y="82" font-size="13" fill="#12312A" font-family="Inter, sans-serif">🗳 Votes</text><rect x="110" y="60" width="104" height="34" rx="17" fill="#FFE9D8"/><text x="122" y="82" font-size="12" fill="#12312A" font-family="JetBrains Mono, monospace">&gt; 1,000 BOT</text></svg>`;
  return `<svg viewBox="0 0 220 110" aria-hidden="true"><path d="M58 55 H162" stroke="#12312A" stroke-width="3" stroke-dasharray="3 7" stroke-linecap="round"/><circle cx="40" cy="55" r="34" fill="#7CC4F5"/><path d="M24 54 47 45c1-.4 2 .2 1.6 1.8l-4 18.6c-.2 1.2-1.2 1.6-2.2 1l-6-4.4-3 2.8c-.4.4-.6.6-1.2.6l.4-6.2 11.2-10c.4-.4 0-.6-.6-.2L31 58l-6-1.8c-1.2-.4-1.2-1.4.4-2.2z" fill="#fff"/><circle cx="180" cy="55" r="34" fill="#B9A6F5"/><circle cx="172" cy="56" r="4" fill="#fff"/><circle cx="188" cy="56" r="4" fill="#fff"/><path d="M164 44q16-8 32 0M166 68q14 6 28 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="110" cy="55" r="14" fill="#2FA36B"/><path d="m103 55 5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
}
const ballot = () => `<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="34" y="20" width="52" height="40" rx="6" fill="#fff" stroke="#12312A" stroke-width="4" transform="rotate(-8 60 40)"/><path d="m48 40 8 8 16-16" stroke="#2FA36B" stroke-width="5" fill="none" stroke-linecap="round" transform="rotate(-8 60 40)"/><rect x="20" y="56" width="80" height="48" rx="10" fill="#B9A6F5" stroke="#12312A" stroke-width="4"/><rect x="40" y="56" width="40" height="7" rx="3" fill="#12312A"/></svg>`;
const coins = () => `<svg viewBox="0 0 120 120" aria-hidden="true">${[[40, 84], [40, 70], [40, 56]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="26" ry="9" fill="#F6B53B" stroke="#12312A" stroke-width="4"/>`).join('')}<circle cx="80" cy="56" r="28" fill="#FF8A3D" stroke="#12312A" stroke-width="4"/><text x="80" y="65" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="24" fill="#12312A">B</text></svg>`;

// ------------------------------------------------------------------ hero (form + tabs)
let activeTopic = 'big';
function bindHero(root) {
  const form = $('#heroForm', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#heroAddr', root).value.trim();
    if (!isAddress(v)) { $('#heroErr', root).textContent = 'That doesn’t look like a contract address — it starts with 0x and has 40 more characters.'; $('#heroAddr', root).focus(); return; }
    go(`app/new?address=${v}&chip=${activeTopic}`);
  });
  $('#heroAddr', root).addEventListener('input', () => ($('#heroErr', root).textContent = ''));
  $$('.tab', root).forEach((b) => b.addEventListener('click', () => setTopic(root, b.dataset.topic)));
}
function setTopic(root, id) {
  activeTopic = id;
  $$('.tab', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.topic === id)));
  const t = TOPICS.find((x) => x.id === id);
  const box = $('#notifs', root);
  const first = box.firstElementChild;
  if (window.gsap && !reduced() && first) {
    gsap.to(first, { opacity: 0, y: -8, duration: 0.2, onComplete: () => { first.outerHTML = notif(t); gsap.from(box.firstElementChild, { opacity: 0, y: 8, duration: 0.3 }); } });
  } else if (first) first.outerHTML = notif(t);
}

// ------------------------------------------------------------------ S3: chips + dashboard mock
let goal = 'big';
function paintDash(root, id) {
  goal = id;
  const d = DASH[id];
  $$('.goal', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.goal === id)));
  const seed = Object.keys(DASH).indexOf(id) + 1;
  $('#dashMock', root).innerHTML = `
    <div class="mock-top">${hoot('watch')}<div><div class="mock-title">${d.title}</div><div class="mock-sub">Snack Poll · 0x12ab…9f3c</div></div><span class="status" style="margin-left:auto">Watching</span></div>
    <div class="mock-rule">${esc(d.rule)}</div>
    <div class="mock-stats"><div><b>${d.today}</b><span>alerts today</span></div><div><b>${d.rows[0][2] || '—'}</b><span>last alert</span></div><div><b>0</b><span>blocks behind</span></div></div>
    <div class="mock-bars">${bars(seed).map((h, i) => `<i style="height:${h}%" class="${i === 20 ? 'hot' : ''}"></i>`).join('')}</div>
    ${d.rows.map((r) => `<div class="feed-row"><span class="em">${d.em}</span><div class="fr-main"><b>${esc(r[0])}</b><p>${esc(r[1])}</p></div><time>${r[2] ? r[2] + ' ago' : ''}</time></div>`).join('')}`;
  if (window.gsap && !reduced()) {
    gsap.from($$('#dashMock .mock-bars i', root), { scaleY: 0, duration: 0.5, stagger: 0.015, ease: 'power2.out' });
    gsap.from($$('#dashMock .feed-row', root), { opacity: 0, x: 12, duration: 0.35, stagger: 0.06 });
  }
}
function bindTell(root) {
  paintDash(root, 'big');
  $$('.goal', root).forEach((b) => b.addEventListener('click', () => paintDash(root, b.dataset.goal)));
}

// ------------------------------------------------------------------ S4: chat → rule card
let sayTimer; let sayBusy = false;
function ruleChips(i) {
  const s = SAY[i];
  const g = guessRule(s.text, s.events);
  const v = validateRule(g, s.events);
  const r = v.rule;
  const chips = [`<span class="rc-chip ev">Event ${esc(r.event)}</span>`];
  r.conditions.forEach((c) => chips.push(`<span class="rc-chip">${esc(describeCondition(c, r))}</span>`));
  if (!r.conditions.length) chips.push(`<span class="rc-chip">every time</span>`);
  if (s.quiet) chips.push(`<span class="rc-chip q">🌙 quiet 23:00–07:00</span>`);
  chips.push(s.ch === 'telegram' ? `<span class="rc-chip to">→ Telegram</span>` : `<span class="rc-chip dc">→ Discord</span>`);
  return { chips, label: r.label };
}
async function playSay(root, i, { fromUser = false } = {}) {
  if (sayBusy && !fromUser) return;
  sayBusy = true;
  clearTimeout(sayTimer);
  $$('.chat-opt', root).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.say) === i)));
  const typed = $('#typed', root);
  const text = SAY[i].text;
  const animated = window.gsap && !reduced();
  if (animated) {
    typed.textContent = '';
    for (let k = 1; k <= text.length; k++) {
      if (!root.isConnected) return;
      typed.innerHTML = esc(text.slice(0, k)) + '<span class="caret"></span>';
      await new Promise((r) => setTimeout(r, 26));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  typed.textContent = text;
  const { chips, label } = ruleChips(i);
  $('#rcChips', root).innerHTML = chips.join('');
  $('#rcText', root).textContent = `Label: “${label}”. Looks right? You can still edit every part.`;
  const href = `app/new?say=${encodeURIComponent(text)}`;
  $('#rcYes', root).setAttribute('href', href);
  $('#rcEdit', root).setAttribute('href', href);
  if (animated) gsap.from($$('#rcChips .rc-chip', root), { scale: 0.6, opacity: 0, y: 8, duration: 0.4, stagger: 0.18, ease: 'back.out(2)' });
  sayBusy = false;
  if (animated && root.isConnected && !fromUser) sayTimer = setTimeout(() => playSay(root, (i + 1) % SAY.length), 4200);
}
function bindSay(root) {
  $$('.chat-opt', root).forEach((b) => b.addEventListener('click', () => { sayBusy = false; playSay(root, Number(b.dataset.say), { fromUser: true }); }));
  $('#chatSend', root).addEventListener('click', () => go($('#rcYes', root).getAttribute('href')));
  $('.chat-head button', root).addEventListener('click', () => { clearTimeout(sayTimer); $('#typed', root).textContent = ''; $('#rcChips', root).innerHTML = ''; $$('.chat-opt', root).forEach((b) => b.setAttribute('aria-pressed', 'false')); });
  addCleanup(() => clearTimeout(sayTimer));
}

// ------------------------------------------------------------------ live stats (real numbers only)
async function loadStats() {
  const s = await siteStats();
  [['stWatches', s.watches], ['stAlerts', s.alerts], ['stContracts', s.contracts]].forEach(([id, v]) => { const el = $('#' + id); if (el) countUp(el, v); });
}

// ------------------------------------------------------------------ static (reduced motion / no GSAP)
function staticState(root) {
  $$('.blk', root).forEach((b, i) => { b.style.left = `${8 + i * 13}%`; b.style.top = `${30 + Math.sin(i) * 25}%`; });
  $$('.blk', root)[3]?.classList.add('is-glow');
  playSay(root, 0, { fromUser: true });
}

// ------------------------------------------------------------------ motion
function animate(root) {
  const ctx = gsap.context(() => {
    // headlines: lines rise from a mask
    $$('[data-split]', root).forEach((el, n) => {
      SplitText.create(el, {
        type: 'lines', mask: 'lines', autoSplit: true, linesClass: 'split-line',
        onSplit: (self) => gsap.from(self.lines, { yPercent: 110, duration: 0.9, stagger: 0.1, ease: 'power3.out', delay: n === 0 ? 0.1 : 0, scrollTrigger: n === 0 ? undefined : { trigger: el, start: 'top 85%', once: true } }),
      });
    });
    gsap.from($$('.hero [data-fade]', root), { opacity: 0, y: 18, duration: 0.8, stagger: 0.1, delay: 0.35, ease: 'power2.out' });
    gsap.from('#stage', { opacity: 0, y: 40, duration: 1, delay: 0.5, ease: 'power3.out' });
    $$('[data-fade]', root).filter((el) => !el.closest('.hero')).forEach((el) => gsap.from(el, { opacity: 0, y: 16, duration: 0.7, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));

    heroScene(root);

    // S3: pin and walk through the chips while scrolling (desktop)
    const mm = gsap.matchMedia();
    mm.add('(min-width: 961px)', () => {
      const ids = TOPICS.map((t) => t.id);
      ScrollTrigger.create({
        trigger: '#tellPin', start: 'center center', end: '+=1600', pin: true, anticipatePin: 1,
        onUpdate: (self) => { const id = ids[Math.min(ids.length - 1, Math.floor(self.progress * ids.length))]; if (id !== goal) paintDash(root, id); },
      });
    });
    gsap.from('.tell-shot', { opacity: 0, x: 40, duration: 0.9, scrollTrigger: { trigger: '#tellPin', start: 'top 80%', once: true } });

    // S4: start the chat when it scrolls into view
    ScrollTrigger.create({ trigger: '#chat', start: 'top 75%', once: true, onEnter: () => playSay(root, 0) });

    // S5: branch draws, cards rise, bars grow, counters tick
    $$('.branch path', root).forEach((p) => gsap.from(p, { drawSVG: 0, duration: 1.2, ease: 'power2.inOut', scrollTrigger: { trigger: p, start: 'top 85%', once: true } }));
    gsap.from($$('.feat', root), { y: 50, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.feat-grid', start: 'top 85%', once: true } });
    gsap.from($$('#featBars i', root), { scaleY: 0, duration: 0.7, stagger: 0.03, ease: 'power2.out', scrollTrigger: { trigger: '#featBars', start: 'top 90%', once: true } });
    $$('[data-count]', root).forEach((el) => {
      const o = { v: 0 };
      gsap.to(o, { v: Number(el.dataset.count), duration: 1.4, ease: 'power2.out', onUpdate: () => (el.textContent = Math.round(o.v)), scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
    });
    gsap.from($$('.quiet-line .dot', root), { scale: 0, duration: 0.4, stagger: 0.08, ease: 'back.out(3)', scrollTrigger: { trigger: '.quiet-line', start: 'top 90%', once: true } });

    // S6: the dotted line draws through the 4 steps as you scroll
    gsap.from('#stepsDraw', { drawSVG: 0, ease: 'none', scrollTrigger: { trigger: '#stepsList', start: 'top 70%', end: 'bottom 60%', scrub: true } });
    $$('.step', root).forEach((s) => {
      gsap.from(s, { opacity: 0, y: 40, duration: 0.7, scrollTrigger: { trigger: s, start: 'top 85%', once: true } });
      gsap.from($('.step-num', s), { scale: 0, duration: 0.4, ease: 'back.out(3)', scrollTrigger: { trigger: s, start: 'top 70%', once: true } });
    });

    // S7: cards drift in at their staggered heights
    gsap.from($$('.who-card', root), { y: 80, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.who-grid', start: 'top 85%', once: true } });

    // S9: illustrations pop in and bob on hover
    gsap.from($$('.illus', root), { y: 40, opacity: 0, duration: 0.6, stagger: 0.07, ease: 'back.out(2)', scrollTrigger: { trigger: '.illus-row', start: 'top 92%', once: true } });
  }, root);
  $$('.illus, .who-art', root).forEach((el) => {
    const t = el.querySelector('svg') || el;
    el.addEventListener('mouseenter', () => gsap.to(t, { y: -10, rotate: -3, duration: 0.35, ease: 'power2.out', yoyo: true, repeat: 1 }));
  });
  addCleanup(() => ctx.revert());
}

function heroScene(root) {
  const stage = $('#stage', root);
  const box = $('#blocks', root);
  const blocks = $$('.blk', root);
  const W = () => box.clientWidth;
  // Hoot scans left and right
  gsap.to('.stage-hoot .hoot-body', { rotation: 5, transformOrigin: '50% 95%', duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  gsap.fromTo('.stage-hoot .hoot-bino', { x: -5 }, { x: 6, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  // blocks float past (right → left, wrapping) and bob
  blocks.forEach((b, i) => {
    const h = box.clientHeight;
    gsap.set(b, { x: (i / blocks.length) * (W() + 60), y: h * (0.25 + 0.5 * ((i * 37) % 10) / 10) });
    gsap.to(b, { x: '-=' + (W() + 60), duration: 22, ease: 'none', repeat: -1, modifiers: { x: gsap.utils.unitize((x) => gsap.utils.wrap(-60, W(), parseFloat(x))) } });
    gsap.to($('svg', b), { y: -8, duration: 1.4 + (i % 3) * 0.3, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  });
  // every few seconds: one block glows → paper plane flies to the phone → phone buzzes with the alert
  const plane = $('#plane', root);
  const phone = $('#phone', root);
  let n = 0;
  const cycle = () => {
    if (!root.isConnected) return;
    const sr = stage.getBoundingClientRect();
    const mid = sr.left + sr.width * 0.42;
    const blk = blocks.reduce((best, b) => (Math.abs(b.getBoundingClientRect().left - mid) < Math.abs(best.getBoundingClientRect().left - mid) ? b : best), blocks[0]);
    const br = blk.getBoundingClientRect();
    const pr = phone.getBoundingClientRect();
    const start = { x: br.left - sr.left, y: br.top - sr.top };
    const end = { x: pr.left - sr.left + pr.width * 0.3, y: pr.top - sr.top + 150 };
    const peak = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 90 };
    const t = TOPICS.find((x) => x.id === activeTopic) || TOPICS[n % TOPICS.length];
    blk.classList.add('is-glow');
    $('svg', blk).outerHTML = art.block(true);
    const tl = gsap.timeline({ onComplete: () => { $('svg', blk).outerHTML = art.block(false); blk.classList.remove('is-glow'); } });
    tl.to(blk, { scale: 1.25, duration: 0.25, ease: 'back.out(3)' })
      .set(plane, { opacity: 1, x: start.x, y: start.y, rotation: 0 })
      .to(plane, { duration: 1.3, ease: 'power1.inOut', motionPath: { path: [start, peak, end], curviness: 1.3, autoRotate: true } })
      .to(plane, { opacity: 0, scale: 0.4, duration: 0.2 }, '-=0.15')
      .set(plane, { scale: 1 })
      .add(() => pushNotif(root, t))
      .to(phone, { keyframes: { x: [0, -6, 6, -4, 4, 0] }, duration: 0.45, ease: 'none' }, '<')
      .to(blk, { scale: 1, duration: 0.3 }, '<');
    n++;
  };
  const timer = setInterval(() => { if (!document.hidden) cycle(); }, 4200);
  setTimeout(cycle, 1600);
  addCleanup(() => clearInterval(timer));
}
function pushNotif(root, t) {
  const box = $('#notifs', root);
  if (!box) return;
  box.insertAdjacentHTML('afterbegin', notif(t));
  const items = [...box.children];
  items.slice(1).forEach((el) => { el.classList.add('old'); $('time', el).textContent = '1m'; });
  items.slice(3).forEach((el) => el.remove());
  gsap.from(box.firstElementChild, { y: -30, opacity: 0, scale: 0.9, duration: 0.45, ease: 'back.out(2)' });
}

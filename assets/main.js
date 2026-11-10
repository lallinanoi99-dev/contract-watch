// Shell: router, nav + wallet button, preview bar, footer (Hoot's night watch, live block + counts).
import { CONFIG } from './config.js';
import * as chain from './chain.js';
import { $, $$, esc, toast, copyText, fmt, gsapReady, reduced } from './ui.js';
import { hoot, hootMark, icon } from './hoot.js';
import { renderHome } from './home.js';
import { renderDashboard, renderWizard, renderWatch } from './app.js';
import { renderPublic } from './public.js';

const BASE = window.CW_BASE || '/';
const view = $('#view');
let cleanup = [];
export const addCleanup = (fn) => cleanup.push(fn);

// ------------------------------------------------------------------ routing
export const routePath = () => decodeURIComponent(location.pathname.slice(BASE.length - 1)).replace(/\/+$/, '') || '/';
export function go(href, { replace = false } = {}) {
  const url = new URL(href, document.baseURI);
  if (url.origin !== location.origin) { location.href = href; return; }
  if (url.pathname + url.search === location.pathname + location.search && url.hash) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    scrollToHash(url.hash);
    return;
  }
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  render();
}
function scrollToHash(hash) {
  const el = hash && document.getElementById(hash.slice(1));
  if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

async function render() {
  cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanup = [];
  if (window.ScrollTrigger) ScrollTrigger.getAll().forEach((t) => t.kill());
  closeMenu();
  const path = routePath();
  const inApp = path.startsWith('/app') || path.startsWith('/w/');
  document.body.classList.toggle('in-app', inApp);
  $$('[data-nav]').forEach((a) => a.removeAttribute('aria-current'));
  view.innerHTML = '';
  window.scrollTo(0, 0);
  let m;
  try {
    if (path === '/') { document.title = 'Contract Watch — know the moment it happens'; await renderHome(view); }
    else if (path === '/app') { mark('app'); document.title = 'Dashboard · Contract Watch'; await renderDashboard(view); }
    else if (path === '/app/new') { document.title = 'New watch · Contract Watch'; await renderWizard(view); }
    else if ((m = path.match(/^\/app\/edit\/(\d+)$/))) { document.title = 'Edit watch · Contract Watch'; await renderWizard(view, Number(m[1])); }
    else if ((m = path.match(/^\/app\/w\/(\d+)$/))) { mark('app'); document.title = `Watch #${m[1]} · Contract Watch`; await renderWatch(view, Number(m[1])); }
    else if ((m = path.match(/^\/w\/(0x[0-9a-fA-F]{40})$/))) { document.title = 'Public watch page · Contract Watch'; await renderPublic(view, m[1]); }
    else notFound();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="nf wrap">${hoot('confused')}<h1 class="h-md">Something went sideways.</h1><p class="muted" style="margin-top:8px">${esc(e.message || 'Unknown error')}</p><p style="margin-top:24px"><a class="btn btn-primary" href="./" data-link>Back home</a></p></section>`;
  }
  if (location.hash) setTimeout(() => scrollToHash(location.hash), 80);
  if (window.ScrollTrigger) setTimeout(() => ScrollTrigger.refresh(), 300);
}
function notFound() {
  document.title = 'Not found · Contract Watch';
  view.innerHTML = `<section class="nf wrap">${hoot('confused', { title: 'Hoot looks confused' })}<h1 class="h-md">Hoot can’t find that page.</h1><p class="muted" style="margin-top:8px">Nothing to watch here.</p><p style="margin-top:24px"><a class="btn btn-primary" href="./" data-link>Back home</a></p></section>`;
}
const mark = (key) => $(`[data-nav="${key}"]`)?.setAttribute('aria-current', 'page');

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('popstate', render);

// ------------------------------------------------------------------ nav
$('#brandMark').innerHTML = hootMark();
$('#navMenu').innerHTML = icon.menu();
function closeMenu() { $('#nav').classList.remove('open'); $('#navMenu').setAttribute('aria-expanded', 'false'); }
$('#navMenu').addEventListener('click', () => {
  const open = !$('#nav').classList.contains('open');
  $('#nav').classList.toggle('open', open);
  $('#navMenu').setAttribute('aria-expanded', String(open));
});
addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scrollY > 10), { passive: true });

function paintWallet() {
  const b = $('#walletBtn');
  const w = chain.wallet;
  if (chain.MODE === 'live' && w.account && !w.chainOk) { b.innerHTML = 'Switch to BOT Chain'; b.dataset.act = 'switch'; return; }
  if (w.account) { b.innerHTML = `<span class="wallet-dot"></span><span class="mono">${chain.short(w.account)}</span>`; b.dataset.act = 'menu'; b.title = w.account; return; }
  b.textContent = 'Connect wallet'; b.dataset.act = 'connect';
}
$('#walletBtn').addEventListener('click', async () => {
  const act = $('#walletBtn').dataset.act;
  try {
    if (act === 'switch') await chain.switchNetwork();
    else if (act === 'menu') copyText(chain.wallet.account, 'Address copied');
    else {
      if (!chain.wallet.hasWallet) { toast('MetaMask not found — install it to register watches. You can still explore.', true); return; }
      await chain.connect();
      toast('Wallet connected ✓');
    }
  } catch (e) { toast(e.message, true); }
});
chain.onChange((what) => { if (what === 'wallet') paintWallet(); });
paintWallet();

// ------------------------------------------------------------------ preview bar
if (chain.MODE === 'preview') {
  const bar = $('#previewBar');
  bar.hidden = false;
  bar.innerHTML = `<b>Preview mode</b> — WatchRegistry isn’t deployed yet, so watches are saved in this browser. Contracts and events are still read live from BOT Chain.`;
  document.body.classList.add('has-preview');
}

// ------------------------------------------------------------------ footer: Hoot's night watch
const MAIN = CONFIG.networks.mainnet;
const regAddr = MAIN.registry || (chain.NET.key === 'mainnet' ? chain.NET.registry : '');
function footer() {
  const stars = Array.from({ length: 26 }, () => `<i class="f-star" style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 60).toFixed(1)}%"></i>`).join('');
  const blocks = Array.from({ length: 12 }, (_, i) => `<i class="${i === 7 ? 'lit' : ''}"></i>`).join('');
  const addrHtml = regAddr
    ? `<button class="addr-copy" type="button" id="fCopy" title="Copy ${regAddr}">${esc(chain.short(regAddr))} ${icon.copy()}</button>
       <a class="pill-tan" href="${MAIN.explorer}/address/${regAddr}" target="_blank" rel="noopener">View on explorer ${icon.ext()}</a>`
    : `<span class="addr-copy">WatchRegistry · deploying to mainnet</span>
       <a class="pill-tan" href="${MAIN.explorer}" target="_blank" rel="noopener">View on explorer ${icon.ext()}</a>`;
  $('#footer').innerHTML = `
  <div class="f-sky" aria-hidden="true">${stars}<div class="f-moon"></div></div>
  <div class="wrap">
    <div class="f-top">
      <div class="f-scene">
        <div class="f-branch" aria-hidden="true">${blocks}</div>
        <div class="f-hoot">${hoot('watch', { title: 'Hoot keeping watch at night' })}</div>
        <a class="f-lantern" id="fLantern" href="${CONFIG.links.botchain}" target="_blank" rel="noopener" aria-label="BOT Chain — opens botchain.ai">
          <span class="rope"></span><span class="lamp"><img src="assets/botchain-logo.png" alt="BOT Chain" width="409" height="80"></span>
          <span class="f-lantern-label">Built on BOT Chain ↗</span>
        </a>
      </div>
      <div class="f-alert">
        <div class="f-alert-line">🦉 Watching WatchRegistry · last block <span class="mono" id="fBlock">#—</span> <span class="live-dot off" id="fLive">connecting</span></div>
        <div class="f-addr">${addrHtml}</div>
        <div class="f-counts">WATCHES <b id="fWatches">—</b> · ALERTS TODAY <b id="fAlerts">—</b></div>
      </div>
    </div>
    <div class="f-cols">
      <div><h4>Product</h4><ul>
        <li><a href="app/new" data-link>Start watching</a></li>
        <li><a href="./#templates" data-link>Templates</a></li>
        <li><a href="${regAddr ? `w/${regAddr}` : './#features'}" data-link>Public watch pages</a></li>
      </ul></div>
      <div><h4>Help</h4><ul>
        <li><a href="./#how" data-link>How it works</a></li>
        <li><a href="./#faq" data-link>FAQ</a></li>
        <li><a href="${CONFIG.links.docs}" target="_blank" rel="noopener">BOT Chain docs</a></li>
        <li><a href="${CONFIG.links.faucet}" target="_blank" rel="noopener">Faucet</a></li>
      </ul></div>
      <div><h4>Social</h4><ul>
        <li><a href="${CONFIG.links.x}" target="_blank" rel="noopener">X</a></li>
        <li><a href="https://t.me/${CONFIG.telegramBot}" target="_blank" rel="noopener">Telegram bot</a></li>
      </ul></div>
    </div>
    <div class="f-bottom"><span>© 2026 Contract Watch · read-only — we never touch your keys</span><span>Made with 🦉 for BOT Chain</span></div>
  </div>`;
  $('#fCopy')?.addEventListener('click', () => copyText(regAddr, 'Contract address copied'));
}
footer();

// live: latest block every 5s while the footer is near the screen
let footVisible = false;
new IntersectionObserver(([e]) => { footVisible = e.isIntersecting; if (footVisible) tickBlock(); }, { rootMargin: '300px' }).observe($('#footer'));
async function tickBlock() {
  try {
    const n = await chain.blockNumber(MAIN);
    $('#fBlock').textContent = '#' + fmt(n);
    $('#fLive').className = 'live-dot'; $('#fLive').textContent = 'live';
  } catch { $('#fLive').className = 'live-dot off'; $('#fLive').textContent = 'offline'; }
}
setInterval(() => { if (footVisible && !document.hidden) tickBlock(); }, 5000);

export async function siteStats() {
  const out = { watches: null, contracts: null, alerts: null };
  try {
    const all = await chain.registry.all();
    out.watches = all.length;
    out.contracts = new Set(all.map((w) => w.target.toLowerCase())).size;
  } catch { /* registry not reachable */ }
  if (chain.hasWorker()) { try { out.alerts = (await chain.worker.stats()).alertsToday ?? null; } catch { /* ignore */ } }
  else if (out.watches !== null) out.alerts = 0;
  return out;
}
siteStats().then((s) => { $('#fWatches').textContent = fmt(s.watches); $('#fAlerts').textContent = fmt(s.alerts); });

// lantern sway (GSAP on hover)
gsapReady().then((ok) => {
  if (!ok || reduced()) return;
  const lantern = $('#fLantern');
  lantern.addEventListener('mouseenter', () => gsap.fromTo(lantern, { rotate: 0 }, { keyframes: [{ rotate: 6 }, { rotate: -5 }, { rotate: 3 }, { rotate: -1.5 }, { rotate: 0 }], duration: 1.6, ease: 'sine.inOut' }));
  gsap.to('.f-branch .lit', { opacity: 0.55, repeat: -1, yoyo: true, duration: 1.2, ease: 'sine.inOut' });
});

// ------------------------------------------------------------------ start
chain.restoreWallet();
render();

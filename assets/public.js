// Public watch page /w/:contract — which watches exist on a contract (labels + rules, never channels).
import * as chain from './chain.js';
import { $, esc, copyText } from './ui.js';
import { hoot, icon } from './hoot.js';
import * as R from './rules.js';
import { sigName } from './app.js';

export async function renderPublic(root, target) {
  root.innerHTML = `<section class="app wrap"><div id="pBody"><div class="card panel"><div class="row"><span class="spin"></span> Looking up watches…</div></div></div></section>`;
  const body = $('#pBody', root);
  await chain.loadEthers().catch(() => {});
  const [det, watches, pub] = await Promise.all([
    chain.detectNetwork(target).catch(() => ({ net: null })),
    chain.registry.watchesFor(target).catch((e) => ({ error: e.message })),
    chain.hasWorker() && chain.MODE === 'live' ? chain.worker.publicRules(target).catch(() => null) : null,
  ]);
  const net = det.net || chain.NET;
  const info = det.net ? await chain.explorerInfo(net, target).catch(() => ({})) : {};
  if (watches.error) { body.innerHTML = `<div class="notice bad">Couldn’t read WatchRegistry: ${esc(watches.error)}</div>`; return; }
  const rules = pub?.rules || {};
  const items = watches.map((w) => ({ w, rule: rules[w.id] || chain.localRules.get(w.id)?.rule || null }));
  const active = items.filter((x) => x.w.active);
  const name = info.name || items.find((x) => x.rule?.name)?.rule.name || chain.short(target);
  const headline = active.length
    ? `This project watches for ${active.slice(0, 2).map((x) => esc(x.w.label.toLowerCase())).join(' and ')}${active.length > 2 ? ` and ${active.length - 2} more` : ''} ✓`
    : items.length ? 'All watches on this contract are paused.' : 'No watches on this contract yet.';

  body.innerHTML = `
    <div class="card pub-hero">
      ${hoot(items.length ? 'scroll' : 'confused', { title: items.length ? 'Hoot holds the on-chain record' : 'No events yet' })}
      <div>
        <span class="eyebrow">Public watch page</span>
        <h1 class="h-md" style="margin-top:6px">${esc(name)}</h1>
        <p class="row" style="margin-top:8px"><span class="mono">${esc(target)}</span> <span class="net-tag ${net.key === 'testnet' ? 'test' : ''}">${net.key === 'testnet' ? 'Testnet' : 'Mainnet'}</span></p>
        <p style="margin-top:14px;font-size:18px;font-weight:600">${headline}</p>
        <div class="row" style="margin-top:16px">
          <a class="btn btn-primary btn-sm" href="app/new?address=${target}" data-link>${icon.plus()} Watch this contract</a>
          <a class="btn btn-outline btn-sm" href="${chain.explorerAddress(target, net)}" target="_blank" rel="noopener">View on explorer ${icon.ext()}</a>
          <button class="btn btn-ghost btn-sm" type="button" id="pCopy">${icon.copy()} Copy link</button>
        </div>
      </div>
    </div>
    ${items.length ? `<div class="pub-list">${items.slice().reverse().map(({ w, rule }) => `
      <div class="card pub-item ${w.active ? '' : 'off'}"><span class="tick">${w.active ? icon.check() : icon.pause()}</span>
        <div style="min-width:0;flex:1"><b>${esc(w.label)}</b><div class="mono hint">${esc(rule ? R.describeRule(rule) : sigName(w.eventSig))}</div></div>
        <span class="hint" style="text-align:right">${w.active ? 'Watching' : 'Paused'}<br>since ${new Date(w.at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>`).join('')}</div>
      <p class="hint" style="margin-top:16px">Labels and rules come from WatchRegistry on BOT Chain. Where alerts are sent is never shown.</p>`
    : `<div class="card empty" style="margin-top:18px"><h2>Be the first to watch it</h2><p>Set a watch on ${esc(name)} and it will show up here for everyone.</p><a class="btn btn-primary" href="app/new?address=${target}" data-link>Start watching</a></div>`}`;
  $('#pCopy', body).addEventListener('click', () => copyText(location.href, 'Link copied'));
}

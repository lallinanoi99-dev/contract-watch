// Small DOM helpers shared by every page.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US'));

let toastTimer;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(`${label} ✓`); } catch { toast('Couldn’t copy — select it by hand', true); }
}

/** Resolves when GSAP + plugins are loaded (or after 4s without them). */
export function gsapReady() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function check() {
      if (window.gsap && window.ScrollTrigger && window.SplitText && window.MotionPathPlugin && window.DrawSVGPlugin) {
        gsap.registerPlugin(ScrollTrigger, SplitText, MotionPathPlugin, DrawSVGPlugin);
        resolve(true);
      } else if (Date.now() - t0 > 4000) resolve(!!window.gsap);
      else setTimeout(check, 40);
    })();
  });
}

export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Count a number up when it scrolls into view (or set it right away with reduced motion). */
export function countUp(el, to) {
  if (to === null || to === undefined || Number.isNaN(Number(to))) { el.textContent = '—'; return; }
  if (reduced() || !window.gsap) { el.textContent = fmt(to); return; }
  const o = { v: 0 };
  gsap.to(o, { v: Number(to), duration: 1.4, ease: 'power2.out', onUpdate: () => (el.textContent = fmt(Math.round(o.v))), scrollTrigger: window.ScrollTrigger ? { trigger: el, start: 'top 90%', once: true } : undefined });
}

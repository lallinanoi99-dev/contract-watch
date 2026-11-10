// Hoot 🦉 — a round little night owl in a tangerine scarf. Flat, friendly, our own art.
// hoot(pose) returns an SVG string. Poses: watch (binoculars), bell, sleep, scroll, confused, happy.
const C = {
  body: '#8A6A50', shade: '#6F533E', face: '#FBF0DC', belly: '#F4E2C4', chev: '#D9BE94',
  ink: '#12312A', beak: '#F6B53B', scarf: '#FF8A3D', scarf2: '#E46F22', sky: '#7CC4F5', mint: '#DDF2E8', branch: '#6B4A33',
};

const eyes = {
  open: `<circle cx="76" cy="100" r="24" fill="${C.face}"/><circle cx="124" cy="100" r="24" fill="${C.face}"/>
    <g class="hoot-pupils"><circle cx="78" cy="102" r="10" fill="${C.ink}"/><circle cx="122" cy="102" r="10" fill="${C.ink}"/>
    <circle cx="81.5" cy="98" r="3.4" fill="#fff"/><circle cx="125.5" cy="98" r="3.4" fill="#fff"/></g>`,
  happy: `<circle cx="76" cy="100" r="24" fill="${C.face}"/><circle cx="124" cy="100" r="24" fill="${C.face}"/>
    <path d="M66 104 q10 -12 20 0" stroke="${C.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M114 104 q10 -12 20 0" stroke="${C.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  closed: `<circle cx="76" cy="100" r="24" fill="${C.face}"/><circle cx="124" cy="100" r="24" fill="${C.face}"/>
    <path d="M66 100 q10 9 20 0" stroke="${C.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M114 100 q10 9 20 0" stroke="${C.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  confused: `<circle cx="76" cy="100" r="24" fill="${C.face}"/><circle cx="124" cy="100" r="24" fill="${C.face}"/>
    <circle cx="78" cy="103" r="7" fill="${C.ink}"/><circle cx="122" cy="101" r="12" fill="${C.ink}"/>
    <circle cx="80" cy="100" r="2.4" fill="#fff"/><circle cx="126" cy="97" r="3.6" fill="#fff"/>
    <path d="M60 74 q14 -8 28 2" stroke="${C.shade}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  bino: `<g class="hoot-bino">
    <rect x="88" y="92" width="24" height="14" rx="5" fill="${C.ink}"/>
    <circle cx="74" cy="99" r="22" fill="${C.ink}"/><circle cx="126" cy="99" r="22" fill="${C.ink}"/>
    <circle cx="74" cy="99" r="14" fill="${C.sky}"/><circle cx="126" cy="99" r="14" fill="${C.sky}"/>
    <path d="M66 92 q5 -5 11 -4" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M118 92 q5 -5 11 -4" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/></g>`,
};

function base(face, { wings = 'down', extra = '', under = '', over = '', beak = true } = {}) {
  const wingShapes = {
    down: `<ellipse cx="42" cy="146" rx="15" ry="34" fill="${C.shade}" transform="rotate(12 42 146)"/>
           <ellipse cx="158" cy="146" rx="15" ry="34" fill="${C.shade}" transform="rotate(-12 158 146)"/>`,
    up: `<ellipse cx="54" cy="122" rx="14" ry="34" fill="${C.shade}" transform="rotate(38 54 122)"/>
         <ellipse cx="146" cy="122" rx="14" ry="34" fill="${C.shade}" transform="rotate(-38 146 122)"/>`,
    right: `<ellipse cx="42" cy="146" rx="15" ry="34" fill="${C.shade}" transform="rotate(12 42 146)"/>
            <ellipse cx="164" cy="116" rx="14" ry="32" fill="${C.shade}" transform="rotate(-50 164 116)"/>`,
    front: `<ellipse cx="62" cy="162" rx="14" ry="30" fill="${C.shade}" transform="rotate(-38 62 162)"/>
            <ellipse cx="138" cy="162" rx="14" ry="30" fill="${C.shade}" transform="rotate(38 138 162)"/>`,
  };
  return `${under}
  <g class="hoot-body">
    <path d="M50 84 L40 42 L80 68 Z" fill="${C.body}"/><path d="M150 84 L160 42 L120 68 Z" fill="${C.body}"/>
    <ellipse cx="100" cy="132" rx="66" ry="72" fill="${C.body}"/>
    <ellipse cx="100" cy="166" rx="40" ry="34" fill="${C.belly}"/>
    <g stroke="${C.chev}" stroke-width="3" fill="none" stroke-linecap="round">
      <path d="M84 156 q5 5 10 0"/><path d="M106 156 q5 5 10 0"/><path d="M95 170 q5 5 10 0"/><path d="M84 184 q5 5 10 0"/><path d="M106 184 q5 5 10 0"/>
    </g>
    <ellipse cx="84" cy="206" rx="10" ry="5" fill="${C.beak}"/><ellipse cx="116" cy="206" rx="10" ry="5" fill="${C.beak}"/>
    <g class="hoot-scarf">
      <path d="M44 126 Q100 152 156 126 L154 142 Q100 168 46 142 Z" fill="${C.scarf}"/>
      <path d="M126 146 L142 186 L126 184 L116 150 Z" fill="${C.scarf2}"/>
      <path d="M58 136 l4 6 M74 141 l4 6 M90 144 l4 6 M106 144 l4 6 M122 141 l4 6 M138 136 l4 6" stroke="#FFC08F" stroke-width="2.5" stroke-linecap="round"/>
    </g>
    ${wingShapes[wings]}
    <g class="hoot-head">${face}${beak ? `<path d="M92 114 Q100 132 108 114 Q100 108 92 114 Z" fill="${C.beak}"/>` : ''}</g>
    ${extra}
  </g>${over}`;
}

const POSES = {
  watch: () => base(eyes.bino, { wings: 'up' }),
  happy: () => base(eyes.happy),
  bell: () => base(eyes.happy, {
    wings: 'right',
    over: `<g class="hoot-bell" transform="translate(168 62)">
      <path d="M0 -14 v-6" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>
      <path d="M-16 14 Q-16 -14 0 -14 Q16 -14 16 14 L20 20 L-20 20 Z" fill="${C.beak}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="0" cy="24" r="5" fill="${C.ink}"/>
      <path d="M22 -10 l6 -5 M24 4 l6 0 M-22 -10 l-6 -5" stroke="${C.scarf}" stroke-width="3.5" stroke-linecap="round"/></g>`,
  }),
  sleep: () => base(eyes.closed, {
    over: `<rect x="0" y="206" width="200" height="12" rx="6" fill="${C.branch}"/>
      <path d="M150 212 q16 -8 26 -24" stroke="${C.branch}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <ellipse cx="180" cy="184" rx="11" ry="6" fill="#4FA36F" transform="rotate(-30 180 184)"/>
      <g class="hoot-z" fill="${C.ink}" font-family="Bricolage Grotesque, sans-serif" font-weight="700">
        <text x="150" y="58" font-size="22">z</text><text x="168" y="38" font-size="16">z</text><text x="182" y="22" font-size="12">z</text></g>`,
  }),
  scroll: () => base(eyes.open, {
    wings: 'front',
    over: `<g class="hoot-scroll">
      <rect x="62" y="150" width="76" height="46" rx="4" fill="#FFFDF7" stroke="${C.ink}" stroke-width="3"/>
      <rect x="56" y="144" width="12" height="58" rx="6" fill="${C.belly}" stroke="${C.ink}" stroke-width="3"/>
      <rect x="132" y="144" width="12" height="58" rx="6" fill="${C.belly}" stroke="${C.ink}" stroke-width="3"/>
      <path d="M76 164 h48 M76 174 h36 M76 184 h42" stroke="${C.ink}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      <circle cx="122" cy="186" r="6" fill="${C.scarf}"/></g>`,
  }),
  confused: () => base(eyes.confused, {
    over: `<text class="hoot-q" x="150" y="52" font-size="44" font-family="Bricolage Grotesque, sans-serif" font-weight="700" fill="${C.scarf}">?</text>`,
  }),
};

/** Full Hoot SVG. `title` becomes the accessible name (empty → decorative). */
export function hoot(pose = 'happy', { title = '', cls = '' } = {}) {
  const a11y = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
  return `<svg class="hoot hoot-${pose} ${cls}" viewBox="0 0 200 220" ${a11y} xmlns="http://www.w3.org/2000/svg">${(POSES[pose] || POSES.happy)()}</svg>`;
}

/** Hoot's face only (logo mark). */
export function hootMark(cls = '') {
  return `<svg class="hoot-mark ${cls}" viewBox="30 36 140 116" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 84 L40 42 L80 68 Z" fill="${C.body}"/><path d="M150 84 L160 42 L120 68 Z" fill="${C.body}"/>
    <ellipse cx="100" cy="118" rx="64" ry="54" fill="${C.body}"/>
    <path d="M44 126 Q100 152 156 126 L154 142 Q100 168 46 142 Z" fill="${C.scarf}"/>
    ${eyes.open}<path d="M92 114 Q100 132 108 114 Q100 108 92 114 Z" fill="${C.beak}"/></svg>`;
}

// ------------------------------------------------------------------ small flat illustrations
export const art = {
  bell: () => `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="${C.mint}"/>
    <path d="M60 26 v-6" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
    <path d="M36 74 Q36 30 60 30 Q84 30 84 74 L90 82 L30 82 Z" fill="${C.beak}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="60" cy="88" r="7" fill="${C.ink}"/><path d="M92 40 l10 -8 M96 58 h12 M28 40 l-10 -8" stroke="${C.scarf}" stroke-width="4" stroke-linecap="round"/></svg>`,
  binoculars: () => `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#E6F3FC"/>
    <rect x="50" y="46" width="20" height="16" rx="5" fill="${C.ink}"/>
    <rect x="22" y="40" width="30" height="44" rx="12" fill="${C.ink}"/><rect x="68" y="40" width="30" height="44" rx="12" fill="${C.ink}"/>
    <circle cx="37" cy="76" r="11" fill="${C.sky}"/><circle cx="83" cy="76" r="11" fill="${C.sky}"/>
    <path d="M32 72 q3 -4 8 -4 M78 72 q3 -4 8 -4" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  blocks: () => `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#FFE9D8"/>
    ${[[44, 82], [64, 82], [54, 62], [44, 42], [64, 42]].map(([x, y], i) => `<g transform="translate(${x - 10} ${y - 10})"><rect width="20" height="20" rx="4" fill="${i === 2 ? C.scarf : C.branch}"/><rect x="3" y="3" width="14" height="6" rx="2" fill="#fff" opacity=".25"/></g>`).join('')}
    <path d="M60 32 q-14 -10 -4 -20 q10 8 4 20" fill="#4FA36F"/><path d="M60 32 q14 -10 24 -4 q-10 10 -24 4" fill="#2FA36B"/></svg>`,
  plane: () => `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#EEE9FD"/>
    <path d="M24 60 L96 30 L80 92 L60 72 Z" fill="#fff" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M60 72 L96 30 L52 66 L56 86 Z" fill="${C.scarf}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M14 82 q10 4 18 -2 M18 96 q8 2 14 -2" stroke="${C.ink}" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="2 6"/></svg>`,
  /** paper plane used in flight (no background) */
  planeSolo: () => `<svg viewBox="0 0 80 64" aria-hidden="true"><path d="M4 32 L76 4 L60 60 L40 42 Z" fill="#fff" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M40 42 L76 4 L32 38 L36 56 Z" fill="${C.scarf}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/></svg>`,
  block: (glow = false) => `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="10" fill="${glow ? C.scarf : '#fff'}" stroke="${C.ink}" stroke-width="3"/>
    <path d="M14 18 h20 M14 26 h14 M14 34 h18" stroke="${glow ? '#fff' : C.ink}" stroke-width="3" stroke-linecap="round" opacity="${glow ? 1 : 0.35}"/></svg>`,
};

// ------------------------------------------------------------------ simple line icons (inherit currentColor)
const I = (d, extra = '') => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  arrow: () => I('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  right: () => I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  ext: () => I('<path d="M7 17 17 7M8 7h9v9"/>'),
  check: () => I('<path d="m5 12 5 5 9-10"/>'),
  copy: () => I('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  plus: () => I('<path d="M12 5v14M5 12h14"/>'),
  chev: () => I('<path d="m6 9 6 6 6-6"/>'),
  send: () => I('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),
  pause: () => I('<path d="M9 5v14M15 5v14"/>'),
  play: () => I('<path d="M7 5l12 7-12 7z"/>'),
  edit: () => I('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: () => I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  moon: () => I('<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>'),
  bolt: () => I('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  gift: () => I('<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z"/>'),
  menu: () => I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: () => I('<path d="M6 6l12 12M18 6 6 18"/>'),
  wallet: () => I('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2M3 10h18"/>'),
  globe: () => I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
};

export const channelLogo = {
  telegram: () => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#7CC4F5"/><path d="M5.5 11.6 17 7.2c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.6.8-1.1.5l-3-2.2-1.5 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5c.2-.2 0-.3-.3-.1L8.2 13.6 5.3 12.7c-.6-.2-.6-.7.2-1.1z" fill="#fff"/></svg>`,
  discord: () => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#B9A6F5"/><path d="M16.9 8.1a11 11 0 0 0-2.8-.9l-.3.7a10 10 0 0 0-3.6 0l-.4-.7a11 11 0 0 0-2.7.9C5.4 10.6 5 13 5.2 15.4a11 11 0 0 0 3.4 1.7l.7-1.1a7 7 0 0 1-1.1-.5l.3-.2a7.8 7.8 0 0 0 7 0l.3.2-1.1.5.7 1.1a11 11 0 0 0 3.4-1.7c.3-2.8-.5-5.2-1.9-7.3zM9.8 14c-.7 0-1.2-.6-1.2-1.4s.5-1.4 1.2-1.4 1.2.6 1.2 1.4-.5 1.4-1.2 1.4zm4.4 0c-.7 0-1.2-.6-1.2-1.4s.5-1.4 1.2-1.4 1.2.6 1.2 1.4-.5 1.4-1.2 1.4z" fill="#fff"/></svg>`,
};

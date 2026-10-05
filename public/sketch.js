// Papier-en-inktstijl: achtergrondarcering, met de hand getekende randen en Clawd.
// Alles is zaadgestuurd, zodat elk element bij elke render dezelfde lijnen krijgt.
const rough = window.rough;
const gen = rough.generator();
const NS = 'http://www.w3.org/2000/svg';
export const INK = '#1D2033', PEN = '#4A67CF', ORANGE = '#DE7F52';

const prng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; }; };
const hash = str => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const paths = (drawable, extra = '') => gen.toPaths(drawable).map(p => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}" stroke-linecap="round" ${extra}/>`).join('');

/* ---------- papier met arcering in de hoeken ---------- */
export function paintPaper() {
  let canvas = document.getElementById('paper');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'paper'; canvas.setAttribute('aria-hidden', 'true'); document.body.prepend(canvas); }
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  const rnd = prng(42), small = Math.min(W, H) < 700;
  const reach = Math.min(W, H) * (small ? .2 : .3);
  const corner = (cx, cy, sx, sy, count) => {
    for (let i = 0; i < count; i++) {
      const r = Math.pow(rnd(), 1.6) * reach, a = rnd() * Math.PI / 2;
      const px = cx + sx * Math.cos(a) * r, py = cy + sy * Math.sin(a) * r;
      const dens = 1 - r / reach, size = 26 + rnd() * 54;
      const ang = (rnd() < .5 ? 38 : -52) + rnd() * 18;
      ctx.strokeStyle = `rgba(57,65,122,${Math.min(.55, .18 + dens * .45)})`; ctx.lineWidth = .7 + rnd() * .5;
      const n = 3 + Math.floor(dens * 7);
      for (let k = 0; k < n; k++) {
        const t = (ang * Math.PI) / 180, off = (k - n / 2) * (4 + rnd() * 2), len = size * (.6 + rnd() * .5);
        const ox = px + Math.cos(t + Math.PI / 2) * off, oy = py + Math.sin(t + Math.PI / 2) * off;
        ctx.beginPath(); ctx.moveTo(ox - Math.cos(t) * len / 2, oy - Math.sin(t) * len / 2);
        ctx.quadraticCurveTo(ox + rnd() * 3, oy + rnd() * 3, ox + Math.cos(t) * len / 2, oy + Math.sin(t) * len / 2); ctx.stroke();
      }
    }
  };
  const c = small ? 40 : 95;
  corner(0, 0, 1, 1, c); corner(W, 0, -1, 1, c * .8); corner(0, H, 1, -1, c * .8); corner(W, H, -1, -1, c);
  // een paar passercirkels en kruisjes als ondertekening
  ctx.strokeStyle = 'rgba(74,103,207,.16)'; ctx.lineWidth = 1.2;
  [[W * .82, H * .78, Math.min(W, H) * .32], [W * .12, H * .3, Math.min(W, H) * .22]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); });
  ctx.strokeStyle = 'rgba(74,103,207,.35)';
  [[W * .55, H * .12], [W * .93, H * .45], [W * .05, H * .7]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke(); });
}

/* ---------- met de hand getekende randen om .ink-elementen ---------- */
const drawn = new WeakMap();
function inkOutline(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const key = `${w}x${h}`;
  if (drawn.get(el) === key) return;
  drawn.set(el, key);
  let svg = el.querySelector(':scope > svg.ink-svg');
  if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ink-svg'); svg.setAttribute('aria-hidden', 'true'); el.prepend(svg); }
  const cs = getComputedStyle(el);
  const color = cs.getPropertyValue('--ink-line').trim() || INK;
  const width = parseFloat(cs.getPropertyValue('--ink-width')) || 2.2;
  const shade = parseFloat(cs.getPropertyValue('--ink-shade'));
  const sd = Number.isFinite(shade) ? shade : 8;
  const pad = 6 + sd, seed = (hash(el.className + key) % 2 ** 31) || 1;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
  svg.setAttribute('width', w + pad * 2); svg.setAttribute('height', h + pad * 2);
  svg.style.left = svg.style.top = `${-pad}px`;
  let shadow = '';
  if (sd > 0) {
    const id = `sh${seed}`;
    shadow = `<clipPath id="${id}"><path clip-rule="evenodd" d="M${sd} ${sd}h${w}v${h}h${-w}z M0 0h${w}v${h}h${-w}z"/></clipPath><g clip-path="url(#${id})">`
      + paths(gen.rectangle(sd, sd, w, h, { roughness: .6, stroke: 'none', fill: 'rgba(57,65,122,.7)', fillStyle: 'hachure', hachureGap: 5, hachureAngle: -45, fillWeight: 1.1, seed }))
      + paths(gen.rectangle(sd, sd, w, h, { roughness: .6, stroke: 'none', fill: 'rgba(57,65,122,.45)', fillStyle: 'hachure', hachureGap: 7, hachureAngle: 25, fillWeight: .9, seed: seed + 3 }))
      + '</g>';
  }
  svg.innerHTML = shadow + paths(gen.rectangle(1, 1, w - 2, h - 2, { roughness: 1.1, bowing: .8, stroke: color, strokeWidth: width, seed, disableMultiStroke: true }))
    + paths(gen.rectangle(2, 2, w - 3, h - 3, { roughness: 1.6, bowing: 1.2, stroke: color, strokeWidth: width * .45, seed: seed + 7, disableMultiStroke: true }), 'opacity=".5"');
}
const resize = new ResizeObserver(entries => entries.forEach(e => inkOutline(e.target)));
function watch(root = document) {
  root.querySelectorAll('.ink').forEach(el => { if (!el.dataset.inked) { el.dataset.inked = '1'; resize.observe(el); } inkOutline(el); });
}
export function startInk() {
  new MutationObserver(() => watch()).observe(document.getElementById('app'), { childList: true, subtree: true });
  watch();
}

/* ---------- Clawd ---------- */
// pose: 'point' (stok naar `angle` graden, 0 = recht vooruit, negatief = omhoog), 'wave' of 'happy'
export function clawd({ angle = -30, face = 1, pose = 'point', star = false, label = 'Clawd, the Claude Code character' } = {}) {
  const U = 12, LEG = 1.4 * U, BODY = 4 * U;
  const top = -LEG - BODY, rnd = prng(7);
  const r = (x, y, w, h, seed, o = {}) => paths(gen.rectangle(x, y, w, h, { roughness: .9, bowing: .6, stroke: INK, strokeWidth: 2.2, fill: o.fill || '#E07F4F', fillStyle: 'solid', seed, ...o }));
  let streaks = '';
  for (let i = 0; i < 26; i++) {
    const y = top + 3 + rnd() * (BODY - 6), x0 = -4.4 * U + rnd() * 3 * U, len = 2 * U + rnd() * 5 * U;
    streaks += `<path d="M${x0} ${y} q ${len / 2} ${(rnd() - .5) * 3} ${len} ${(rnd() - .5) * 2}" stroke="${rnd() < .7 ? '#B4552B' : '#F2B08C'}" stroke-width="${.8 + rnd()}" opacity="${.35 + rnd() * .3}" fill="none"/>`;
  }
  const hand = { x: 5.6 * U, y: top + 2.1 * U };
  const a = (pose === 'wave' ? -70 : angle) * Math.PI / 180, L = 9 * U;
  const tip = { x: hand.x + Math.cos(a) * L, y: hand.y + Math.sin(a) * L };
  const nx = -Math.sin(a), ny = Math.cos(a);
  const stick = `<g class="clawd-stick" style="transform-origin:${hand.x}px ${hand.y}px">
      <polygon points="${hand.x - Math.cos(a) * 10 + nx * 3.4},${hand.y - Math.sin(a) * 10 + ny * 3.4} ${tip.x + nx * 1.2},${tip.y + ny * 1.2} ${tip.x - nx * 1.2},${tip.y - ny * 1.2} ${hand.x - Math.cos(a) * 10 - nx * 3.4},${hand.y - Math.sin(a) * 10 - ny * 3.4}" fill="#6E4424"/>
      <circle cx="${tip.x}" cy="${tip.y}" r="2.6" fill="#F1E2C2" stroke="${INK}" stroke-width="1"/>
      <circle cx="${hand.x}" cy="${hand.y}" r="4.5" fill="#4A2C16"/></g>`;
  const starSvg = star || pose === 'happy' ? `<g transform="translate(0 ${top - 42})"><g class="clawd-star"><circle r="30" fill="none" stroke="${PEN}" stroke-width="1.4" opacity=".6"/>${Array.from({ length: 12 }, (_, k) => { const q = k * Math.PI / 6; return `<line x1="${Math.cos(q) * 30}" y1="${Math.sin(q) * 30}" x2="${Math.cos(q) * 36}" y2="${Math.sin(q) * 36}" stroke="${PEN}" stroke-width="1.2" opacity=".6"/>`; }).join('')}<path d="${Array.from({ length: 16 }, (_, k) => { const q = -Math.PI / 2 + k * Math.PI / 8, rr = k % 2 ? 7 : 22; return `${k ? 'L' : 'M'}${(Math.cos(q) * rr).toFixed(1)} ${(Math.sin(q) * rr).toFixed(1)}`; }).join('')}Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/></g></g>` : '';
  const minX = -6 * U - 4, maxX = Math.max(6 * U, tip.x) + 8, minY = Math.min(top - (starSvg ? 82 : 6), tip.y - 8), maxY = 14;
  const w = maxX - minX, h = maxY - minY;
  return `<svg class="clawd clawd-${pose}" viewBox="${minX} ${minY} ${w} ${h}" width="${w * 1.6}" height="${h * 1.6}" role="img" aria-label="${label}" style="${face < 0 ? 'transform:scaleX(-1)' : ''}">
    <ellipse cx="0" cy="4" rx="${6 * U}" ry="5" fill="rgba(29,32,51,.14)"/>
    <g class="clawd-body">
      ${[-3.6, -2.2, 1.2, 2.6].map((x, i) => r(x * U, -LEG, U, LEG, 11 + i, { fill: '#B95B3D' })).join('')}
      ${r(-5.5 * U, top + 1.6 * U, U + 2, U, 21)}${r(4.5 * U - 2, top + 1.6 * U, U + 2, U, 22)}
      ${r(-4.5 * U, top, 9 * U, BODY, 31)}
      <clipPath id="clawd-clip"><rect x="${-4.5 * U}" y="${top}" width="${9 * U}" height="${BODY}"/></clipPath><g clip-path="url(#clawd-clip)">${streaks}</g>
      <g class="clawd-eyes"><rect x="${-2.6 * U}" y="${top + .9 * U}" width="${U}" height="${1.5 * U}" rx="1.5" fill="${INK}"/><rect x="${1.6 * U}" y="${top + .9 * U}" width="${U}" height="${1.5 * U}" rx="1.5" fill="${INK}"/></g>
    </g>
    ${stick}${starSvg}</svg>`;
}

/* ---------- woordwolk ---------- */
export function wordCloud(answers) {
  const counts = new Map();
  for (const raw of answers) {
    const word = String(raw).trim().toLowerCase().replace(/[.!?,;:"']+$/g, '');
    if (word) counts.set(word, (counts.get(word) || 0) + 1);
  }
  const words = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60);
  const max = words[0]?.[1] || 1;
  const colors = [INK, '#2B40B5', '#B65A30', INK, '#4A67CF'];
  // grootste woorden in het midden
  const ordered = [];
  words.forEach((w, i) => (i % 2 ? ordered.push(w) : ordered.unshift(w)));
  return ordered.map(([word, n]) => {
    const h = hash(word), size = 1 + (n / max) * 2.6, rot = (h % 7) - 3;
    return { word, n, size, rot, color: colors[h % colors.length] };
  });
}
export const isShortAnswers = answers => answers.length > 0 && answers.every(a => String(a).trim().split(/\s+/).length <= 3);

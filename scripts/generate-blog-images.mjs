/**
 * Generates the 30 article illustrations as lightweight, responsive SVGs.
 *
 *   node scripts/generate-blog-images.mjs
 *
 * Every illustration is built from the same composition — soft paper
 * background, dot texture, a large white medallion holding one hero icon, two
 * or three small icon chips, a homeowner standing on the floor line and the
 * site badge — so the set reads as one family while each article still gets its
 * own subject and accent colour.
 *
 * All geometry is hand-drawn from a 100×100 icon grid: no embedded fonts, no
 * raster data and no external references, so each file stays a few kilobytes
 * and renders crisply at any size.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const outDir = resolve(root, 'public/images/blog')
mkdirSync(outDir, { recursive: true })

const W = 1200
const H = 675
const FLOOR = 566

const palette = {
  navy: '#0f2f3d',
  navyDeep: '#082029',
  teal: '#0d9488',
  tealLight: '#5eead4',
  sand: '#f5efe4',
  sandDeep: '#e7dcc9',
  cream: '#fbf8f2',
  amber: '#f2b544',
  skin: '#e8b48f',
  hair: '#3a2a21',
  shirt: '#e7eef2',
  shirtBlue: '#bcd6e2',
  denim: '#2f4f6b',
  white: '#ffffff',
  grey: '#94a3b8',
  greyDark: '#64748b',
  metal: '#dbe4ea',
  green: '#3f7d5c',
}

/* ------------------------------- primitives ------------------------------- */

const rect = (x, y, w, h, fill, rx = 0, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra}/>`
const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra}/>`
const ellipse = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${extra}/>`
const box = (x, y, w, h, rx = 4) => rect(x, y, w, h, palette.white, rx, ' stroke="#cfd9df" stroke-width="2.5"')
const line = (d, color, width = 3, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`

/* --------------------------------- icons ---------------------------------- */
/* Each icon is drawn inside a 100×100 box and scaled to size by the caller.  */

const icons = {
  oven: () =>
    rect(9, 16, 82, 70, palette.navyDeep, 9) +
    rect(15, 22, 70, 15, '#123b4b', 5) +
    rect(15, 43, 70, 36, '#123b4b', 6, ' stroke="#1c5568" stroke-width="2"') +
    rect(21, 51, 58, 6, palette.greyDark, 3) +
    rect(21, 64, 58, 6, palette.greyDark, 3) +
    circle(24, 29.5, 3.4, palette.tealLight) +
    circle(36, 29.5, 3.4, palette.amber),
  fridge: () =>
    box(27, 4, 46, 92, 8) +
    rect(31, 10, 38, 32, palette.cream, 4) +
    rect(31, 46, 38, 46, palette.cream, 4) +
    rect(61, 16, 4, 20, palette.grey, 2) +
    rect(61, 54, 4, 26, palette.grey, 2),
  washer: () =>
    box(12, 8, 76, 84, 8) +
    rect(18, 14, 64, 14, palette.cream, 4) +
    circle(26, 21, 3.2, palette.amber) +
    circle(50, 60, 27, '#dfe8ee') +
    circle(50, 60, 20, '#c3d4de') +
    circle(50, 60, 12, palette.tealLight, ' opacity="0.7"'),
  outlet: () =>
    rect(28, 14, 44, 68, palette.cream, 9, ' stroke="#d6cfc2" stroke-width="2.5"') +
    rect(44, 24, 12, 18, palette.navyDeep, 3) +
    circle(38, 56, 4.6, palette.navyDeep) +
    circle(62, 56, 4.6, palette.navyDeep) +
    circle(50, 70, 4, palette.navyDeep),
  panel: () =>
    rect(22, 6, 56, 88, palette.metal, 7, ' stroke="#b9c7d1" stroke-width="2.5"') +
    rect(28, 12, 44, 16, palette.navyDeep, 4) +
    [0, 1, 2, 3]
      .map((row) =>
        [0, 1, 2]
          .map((col) =>
            rect(31 + col * 14, 36 + row * 13, 10, 9, row === 1 && col === 2 ? palette.amber : '#8fa8b6', 2),
          )
          .join(''),
      )
      .join(''),
  breaker: () =>
    rect(30, 6, 40, 88, palette.metal, 6, ' stroke="#b9c7d1" stroke-width="2.5"') +
    rect(35, 12, 30, 12, palette.navyDeep, 3) +
    [0, 1, 2, 3, 4, 5]
      .map((i) =>
        rect(38, 30 + i * 10, 24, 7, i === 3 ? palette.amber : '#8fa8b6', 2) +
        (i === 3 ? '' : ''),
      )
      .join(''),
  faucet: () =>
    line('M34,86 V54 q0,-18 18,-18 h16', palette.greyDark, 8) +
    line('M68,36 q10,0 10,10 v6', palette.greyDark, 8) +
    rect(24, 46, 10, 8, palette.teal, 2) +
    circle(78, 62, 5, '#7dd3e8') +
    circle(78, 76, 3.4, '#7dd3e8', ' opacity="0.7"') +
    rect(20, 84, 40, 8, palette.sandDeep, 3),
  waterHeater: () =>
    rect(24, 18, 52, 70, palette.white, 26, ' stroke="#cfd9df" stroke-width="2.5"') +
    rect(30, 24, 40, 12, palette.cream, 6) +
    circle(50, 54, 11, palette.cream, ' stroke="#d6cfc2" stroke-width="2"') +
    line('M50,54 L57,47', palette.amber, 3) +
    line('M40,18 V8 h20 V18', palette.greyDark, 5) +
    line('M50,88 v6', palette.teal, 5),
  acUnit: () =>
    box(5, 32, 90, 36, 8) +
    rect(11, 38, 78, 10, palette.cream, 4) +
    [0, 1, 2].map((i) => rect(11, 52 + i * 5, 78, 3, '#dbe6ec', 1.5)).join('') +
    line('M78,68 v8 q0,6 -6,10', '#7dd3e8', 4),
  furnace: () =>
    box(24, 8, 52, 84, 7) +
    rect(30, 14, 40, 12, palette.cream, 4) +
    [0, 1, 2, 3].map((i) => rect(30, 34 + i * 5, 40, 3, '#dbe6ec', 1.5)).join('') +
    circle(50, 70, 12, palette.cream, ' stroke="#d6cfc2" stroke-width="2"') +
    line('M50,70 q-5,-8 0,-13 q5,5 0,13', palette.amber, 3),
  roof: () =>
    line('M6,54 L50,16 L94,54', palette.navy, 7) +
    line('M16,50 L50,22 L84,50', palette.teal, 4) +
    rect(74, 18, 12, 22, '#c9d3da', 3) +
    rect(74, 14, 12, 6, palette.navy, 2) +
    rect(20, 54, 60, 8, palette.sandDeep, 3),
  house: () =>
    line('M10,50 L50,16 L90,50', palette.navy, 6) +
    rect(20, 50, 60, 40, palette.white, 3) +
    rect(42, 62, 16, 28, palette.teal, 2) +
    rect(26, 58, 12, 12, palette.cream, 2, ' stroke="#cfd9df" stroke-width="2"') +
    rect(62, 58, 12, 12, palette.cream, 2, ' stroke="#cfd9df" stroke-width="2"'),
  ladder: () =>
    line('M32,6 V92', palette.greyDark, 6) +
    line('M68,6 V92', palette.greyDark, 6) +
    [0, 1, 2, 3, 4].map((i) => line(`M32,${18 + i * 16} H68`, palette.greyDark, 6)).join(''),
  storm: () =>
    ellipse(50, 40, 30, 18, '#cbd7de') +
    ellipse(34, 46, 18, 13, '#cbd7de') +
    ellipse(66, 46, 18, 13, '#cbd7de') +
    line('M34,64 L28,78', '#7dd3e8', 4) +
    line('M50,64 L44,82', '#7dd3e8', 4) +
    line('M66,64 L60,78', '#7dd3e8', 4),
  droplet: () =>
    `<path d="M50,12 q26,30 26,48 a26,26 0 0 1 -52,0 q0,-18 26,-48 z" fill="#7dd3e8"/>` +
    `<path d="M40,60 q-4,12 6,18" fill="none" stroke="#e6f7fb" stroke-width="4" stroke-linecap="round"/>`,
  mold: () =>
    circle(50, 50, 30, '#9fb79a', ' opacity="0.35"') +
    circle(38, 42, 9, palette.green) +
    circle(58, 38, 7, palette.green) +
    circle(62, 56, 10, palette.green, ' opacity="0.85"') +
    circle(42, 60, 8, palette.green, ' opacity="0.9"') +
    circle(50, 50, 4, '#2f5f45'),
  bug: () =>
    ellipse(50, 54, 18, 24, palette.navy) +
    circle(50, 28, 11, palette.navy) +
    line('M44,20 l-8,-8', palette.navy, 3) +
    line('M56,20 l8,-8', palette.navy, 3) +
    line('M32,44 l-14,-6', palette.navy, 3) +
    line('M32,56 l-16,0', palette.navy, 3) +
    line('M32,68 l-14,6', palette.navy, 3) +
    line('M68,44 l14,-6', palette.navy, 3) +
    line('M68,56 l16,0', palette.navy, 3) +
    line('M68,68 l14,6', palette.navy, 3),
  mouse: () =>
    ellipse(48, 58, 26, 18, '#9aa9b4') +
    ellipse(28, 44, 10, 10, '#9aa9b4') +
    circle(28, 44, 5, palette.skin) +
    circle(24, 52, 2.4, palette.navyDeep) +
    line('M74,58 q14,0 12,-12 q-2,-8 -10,-6', '#9aa9b4', 4) +
    line('M30,74 l-4,6', '#9aa9b4', 3) +
    line('M58,74 l-4,6', '#9aa9b4', 3),
  kitchen: () =>
    rect(10, 54, 80, 6, palette.navy, 3) +
    rect(14, 60, 72, 34, palette.white, 3) +
    line('M50,60 V94', '#dbe4ea', 3) +
    rect(20, 66, 24, 6, palette.sandDeep, 3) +
    rect(56, 66, 24, 6, palette.sandDeep, 3) +
    rect(22, 22, 20, 30, palette.cream, 3, ' stroke="#d6cfc2" stroke-width="2"') +
    rect(46, 14, 30, 38, palette.white, 3, ' stroke="#cfd9df" stroke-width="2"') +
    circle(61, 33, 4, palette.amber),
  calendar: () =>
    box(14, 16, 72, 74, 8) +
    rect(14, 16, 72, 18, palette.teal, 8) +
    rect(14, 28, 72, 6, palette.teal, 0) +
    rect(30, 8, 6, 14, palette.navy, 3) +
    rect(64, 8, 6, 14, palette.navy, 3) +
    [0, 1, 2].map((row) => [0, 1, 2].map((col) => circle(32 + col * 18, 48 + row * 15, 4.4, row === 0 && col === 1 ? palette.amber : '#cfd9df')).join('')).join(''),
  shower: () =>
    line('M26,12 v14 q0,8 8,8 h10', palette.greyDark, 5) +
    `<path d="M44,22 q16,0 16,14 h-32 q0,-14 16,-14 z" fill="${palette.greyDark}"/>` +
    line('M34,46 v10', '#7dd3e8', 3) +
    line('M44,46 v14', '#7dd3e8', 3) +
    line('M54,46 v10', '#7dd3e8', 3) +
    rect(16, 74, 68, 8, palette.sandDeep, 3),
  tub: () =>
    `<path d="M12,48 h76 v14 a26,26 0 0 1 -26,26 h-24 a26,26 0 0 1 -26,-26 z" fill="${palette.white}" stroke="#cfd9df" stroke-width="2.5"/>` +
    line('M12,48 h76', palette.teal, 4) +
    line('M22,90 v4', palette.greyDark, 4) +
    line('M78,90 v4', palette.greyDark, 4) +
    line('M50,20 q-6,10 0,18', '#7dd3e8', 4),
  window: () =>
    box(16, 14, 68, 72, 5) +
    line('M50,14 V86', '#cfd9df', 3) +
    line('M16,50 H84', '#cfd9df', 3) +
    rect(12, 84, 76, 6, palette.sandDeep, 3) +
    `<path d="M24,30 l14,-8 v14 l-14,8 z" fill="#dceef2" opacity="0.9"/>`,
  door: () =>
    box(26, 10, 48, 84, 4) +
    rect(34, 20, 32, 28, palette.cream, 3, ' stroke="#dcd2c2" stroke-width="2"') +
    rect(34, 56, 32, 28, palette.cream, 3, ' stroke="#dcd2c2" stroke-width="2"') +
    circle(66, 52, 3.4, palette.amber) +
    rect(18, 94, 64, 4, palette.sandDeep, 2),
  slab: () =>
    `<path d="M10,70 L50,44 L90,70 L50,94 z" fill="${palette.metal}" stroke="#b9c7d1" stroke-width="2.5"/>` +
    line('M30,58 L70,82', '#b9c7d1', 2) +
    line('M50,44 V94', '#c7d3db', 2) +
    line('M90,70 v4', palette.greyDark, 3) +
    line('M10,70 v4', palette.greyDark, 3),
  crack: () =>
    rect(10, 26, 80, 54, palette.metal, 4, ' stroke="#b9c7d1" stroke-width="2.5"') +
    line('M42,26 L52,44 L40,56 L54,64 L44,80', palette.navyDeep, 4) +
    line('M52,44 L68,40', palette.navyDeep, 3),
  key: () =>
    circle(36, 50, 18, palette.cream, ' stroke="#d6cfc2" stroke-width="3"') +
    circle(36, 50, 7, palette.navy) +
    line('M54,50 H86', palette.amber, 8) +
    line('M72,50 v12', palette.amber, 7) +
    line('M82,50 v9', palette.amber, 7),
  clipboard: () =>
    box(20, 14, 60, 80, 6) +
    rect(38, 8, 24, 12, palette.navy, 4) +
    rect(30, 32, 40, 5, palette.sandDeep, 2.5) +
    rect(30, 44, 40, 5, palette.sandDeep, 2.5) +
    rect(30, 56, 26, 5, palette.sandDeep, 2.5) +
    line('M32,74 l6,7 l12,-14', palette.green, 5),
  speech: () =>
    `<path d="M14,22 h72 a8,8 0 0 1 8,8 v34 a8,8 0 0 1 -8,8 h-34 l-16,16 v-16 h-22 a8,8 0 0 1 -8,-8 v-34 a8,8 0 0 1 8,-8 z" fill="${palette.white}" stroke="#cfd9df" stroke-width="2.5"/>` +
    circle(34, 47, 4, palette.teal) +
    circle(50, 47, 4, palette.teal) +
    circle(66, 47, 4, palette.teal),
}

/* --------------------------------- chips ---------------------------------- */

const chips = {
  check: () => circle(50, 50, 34, palette.green, ' opacity="0.16"') + line('M34,50 l11,11 l22,-24', palette.green, 7),
  star: () =>
    `<path d="M50,16 l10,22 l24,3 l-17,17 l4,24 l-21,-12 l-21,12 l4,-24 l-17,-17 l24,-3 z" fill="${palette.amber}"/>`,
  gauge: () =>
    circle(50, 50, 32, palette.cream, ' stroke="#d6cfc2" stroke-width="3"') +
    line('M50,50 L70,34', palette.teal, 5) +
    circle(50, 50, 5, palette.navyDeep),
  money: () =>
    circle(50, 50, 32, palette.amber, ' opacity="0.25"') +
    circle(50, 50, 24, palette.amber) +
    line('M50,36 v28', palette.navyDeep, 5) +
    line('M42,42 h12 a6,6 0 0 1 0,12 h-8 a6,6 0 0 0 0,12 h12', palette.navyDeep, 4),
  document: () =>
    `<path d="M26,10 h34 l16,16 v64 h-50 z" fill="#eef2f5" stroke="#b9c7d1" stroke-width="2.5"/>` +
    line('M60,10 v16 h16', '#b9c7d1', 2.5) +
    [0, 1, 2].map((i) => rect(34, 40 + i * 11, 32, 4, palette.sandDeep, 2)).join(''),
  clock: () =>
    circle(50, 50, 32, palette.white, ' stroke="#cfd9df" stroke-width="3"') +
    line('M50,50 V32', palette.navy, 4) +
    line('M50,50 L64,58', palette.teal, 4) +
    circle(50, 50, 4, palette.navy),
  shield: () =>
    `<path d="M50,12 l30,10 v22 q0,26 -30,40 q-30,-14 -30,-40 v-22 z" fill="${palette.teal}"/>` +
    line('M36,48 l10,11 l20,-22', palette.cream, 7),
  wrench: () =>
    `<path d="M30,68 l30,-30 a14,14 0 1 1 12,12 l-30,30 a9,9 0 0 1 -12,-12 z" fill="${palette.greyDark}"/>` +
    circle(62, 30, 7, palette.cream),
  ruler: () =>
    rect(12, 34, 76, 28, palette.amber, 3) +
    [0, 1, 2, 3, 4].map((i) => line(`M${24 + i * 13},34 v${i % 2 ? 12 : 18}`, palette.navyDeep, 2.5)).join(''),
  leaf: () =>
    `<path d="M72,20 q4,34 -20,44 q-18,8 -26,-6 q-6,-16 14,-26 q18,-9 32,-12 z" fill="${palette.green}"/>` +
    line('M30,74 q18,-20 38,-40', '#e9f2ea', 3),
  sun: () =>
    circle(50, 50, 20, palette.amber) +
    [0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => {
        const rad = (deg * Math.PI) / 180
        return line(
          `M${50 + Math.cos(rad) * 28},${50 + Math.sin(rad) * 28} L${50 + Math.cos(rad) * 38},${50 + Math.sin(rad) * 38}`,
          palette.amber,
          4,
        )
      })
      .join(''),
  bolt: () => `<path d="M56,8 L28,56 h18 l-6,36 l30,-50 h-18 z" fill="${palette.amber}"/>`,
  calendar: () =>
    rect(16, 20, 68, 68, palette.white, 6, ' stroke="#cfd9df" stroke-width="2.5"') +
    rect(16, 20, 68, 16, palette.teal, 6) +
    rect(31, 12, 6, 14, palette.navy, 3) +
    rect(63, 12, 6, 14, palette.navy, 3) +
    [0, 1, 2].map((row) => [0, 1, 2].map((col) => circle(33 + col * 17, 50 + row * 14, 4, row === 1 && col === 1 ? palette.amber : '#cfd9df')).join('')).join(''),
  droplet: () =>
    `<path d="M50,14 q24,28 24,44 a24,24 0 0 1 -48,0 q0,-16 24,-44 z" fill="#7dd3e8"/>`,
  house: () =>
    `<path d="M50,14 L92,50 H80 v38 H58 V62 H42 v26 H20 V50 H8 z" fill="${palette.navy}"/>`,
  phone: () =>
    rect(30, 10, 40, 80, palette.navyDeep, 7) +
    rect(35, 18, 30, 58, palette.cream, 3) +
    circle(50, 83, 3.4, palette.cream),
}

/* --------------------------------- person --------------------------------- */

const person = (x, y, scale, { shirt = palette.shirtBlue, trousers = palette.denim, skin = palette.skin } = {}) => {
  const s = scale
  return `<g>
    ${circle(x, y - 64 * s, 13 * s, skin)}
    <path d="M${x - 14 * s},${y - 68 * s} q4,-12 ${14 * s},-12 q10,0 ${14 * s},12 q-14,${-6 * s} ${-28 * s},0 z" fill="${palette.hair}"/>
    <path d="M${x - 17 * s},${y - 50 * s} q${17 * s},${-9 * s} ${34 * s},0 l${3 * s},${30 * s} q-${20 * s},${8 * s} ${-40 * s},0 z" fill="${shirt}"/>
    <path d="M${x - 15 * s},${y - 20 * s} l${6 * s},${26 * s} h${8 * s} l${4 * s},${-16 * s} l${4 * s},${16 * s} h${8 * s} l${6 * s},${-26 * s} z" fill="${trousers}"/>
    ${rect(x - 16 * s, y + 2 * s, 12 * s, 5 * s, palette.navyDeep, 2)}
    ${rect(x + 4 * s, y + 2 * s, 12 * s, 5 * s, palette.navyDeep, 2)}
  </g>`
}

/* --------------------------------- scene ---------------------------------- */

const drawIcon = (name, cx, cy, size) => {
  const scale = size / 100
  return `<g transform="translate(${cx - 50 * scale},${cy - 50 * scale}) scale(${scale})">${icons[name]()}</g>`
}

const drawChip = (name, cx, cy, r) =>
  `<g>
    ${circle(cx, cy + 4, r, palette.navy, ' opacity="0.06"')}
    ${circle(cx, cy, r, palette.cream, ' stroke="#e6ddcd" stroke-width="3"')}
    <g transform="translate(${cx - r * 0.62},${cy - r * 0.62}) scale(${(r * 1.24) / 100})">${chips[name]()}</g>
  </g>`

const scene = ({ title, desc, bg, accent, hero, satellites = [], person: human = true }) => {
  const parts = []

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`)
  parts.push(`<title id="t">${title}</title>`)
  parts.push(`<desc id="d">${desc}</desc>`)
  parts.push(`<defs>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="2.4" fill="${accent}" opacity="0.14"/>
    </pattern>
  </defs>`)

  // Background and texture
  parts.push(rect(0, 0, W, H, bg))
  parts.push(rect(0, 0, W, H, 'url(#dots)'))
  parts.push(circle(1090, 40, 210, accent, ' opacity="0.10"'))
  parts.push(circle(60, 640, 150, accent, ' opacity="0.08"'))

  // Floor
  parts.push(rect(0, FLOOR, W, H - FLOOR, accent, 0, ' opacity="0.10"'))
  parts.push(rect(0, FLOOR - 2, W, 4, accent, 0, ' opacity="0.22"'))

  // Medallion
  parts.push(circle(392, 320, 186, palette.navy, ' opacity="0.05"'))
  parts.push(circle(392, 312, 180, palette.white, ' stroke="#e6ddcd" stroke-width="3"'))
  parts.push(circle(392, 312, 146, palette.cream))
  parts.push(drawIcon(hero, 392, 312, 258))

  // Satellite chips
  for (const chip of satellites) parts.push(drawChip(chip.icon, chip.x, chip.y, chip.r ?? 54))

  // Homeowner on the floor line
  if (human) parts.push(person(1092, 604, 1.38, { shirt: accent === palette.amber ? palette.shirt : palette.shirtBlue }))

  // Badge
  parts.push(rect(48, 584, 468, 46, palette.navy, 23, ' opacity="0.94"'))
  parts.push(`<text x="74" y="614" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="21" font-weight="600" fill="${palette.cream}">safehomenetwork.com</text>`)

  parts.push('</svg>')
  return parts.join('\n')
}

/* --------------------------------- scenes --------------------------------- */

const scenes = [
  {
    file: 'common-appliance-problems-when-to-call-a-repair-professional.svg',
    title: 'Common appliance problems and when to call a repair professional',
    desc: 'An oven shown in a medallion, with a wrench and gauge beside it, in a warm kitchen palette.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'oven',
    satellites: [
      { icon: 'wrench', x: 690, y: 196 },
      { icon: 'gauge', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'refrigerator-not-cooling-common-causes.svg',
    title: 'Refrigerator not cooling: common causes',
    desc: 'A refrigerator in a medallion with a temperature gauge and a snowflake beside it.',
    bg: palette.cream,
    accent: palette.navy,
    hero: 'fridge',
    satellites: [
      { icon: 'gauge', x: 690, y: 200 },
      { icon: 'star', x: 748, y: 448, r: 46 },
      { icon: 'bolt', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'how-to-choose-a-reliable-appliance-repair-service.svg',
    title: 'How to choose a reliable appliance repair service',
    desc: 'A washing machine in a medallion with a checklist and a review star beside it.',
    bg: palette.sand,
    accent: palette.amber,
    hero: 'washer',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'star', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'warning-signs-your-home-may-have-electrical-problems.svg',
    title: 'Warning signs your home may have electrical problems',
    desc: 'A wall outlet in a medallion with a warning bolt and a plug beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'outlet',
    satellites: [
      { icon: 'bolt', x: 690, y: 196 },
      { icon: 'wrench', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'when-should-you-hire-a-licensed-electrician.svg',
    title: 'When should you hire a licensed electrician?',
    desc: 'A residential electrical panel in a medallion with a licence document and a shield beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'panel',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'shield', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'common-causes-of-circuit-breaker-trips.svg',
    title: 'Common causes of circuit breaker trips',
    desc: 'A breaker strip with one breaker in the tripped position, with a gauge and a bolt beside it.',
    bg: palette.cream,
    accent: palette.navy,
    hero: 'breaker',
    satellites: [
      { icon: 'bolt', x: 690, y: 196 },
      { icon: 'gauge', x: 742, y: 446, r: 46 },
      { icon: 'clock', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'warning-signs-you-need-a-plumber.svg',
    title: 'Warning signs you need a plumber',
    desc: 'A kitchen faucet in a medallion with falling drops, a wrench and a water droplet beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'faucet',
    satellites: [
      { icon: 'gauge', x: 690, y: 196 },
      { icon: 'wrench', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'water-heater-problems-repair-or-replace.svg',
    title: 'Water heater problems: repair or replace?',
    desc: 'A tank water heater in a medallion with a temperature gauge and a coin beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'waterHeater',
    satellites: [
      { icon: 'gauge', x: 690, y: 196 },
      { icon: 'clock', x: 742, y: 446, r: 46 },
      { icon: 'money', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'ac-not-cooling-troubleshooting-guide.svg',
    title: 'Air conditioner not cooling: a homeowner troubleshooting guide',
    desc: 'A wall-mounted air conditioner in a medallion with a sun and a gauge beside it.',
    bg: palette.cream,
    accent: palette.navy,
    hero: 'acUnit',
    satellites: [
      { icon: 'sun', x: 690, y: 196 },
      { icon: 'gauge', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'furnace-maintenance-checklist.svg',
    title: 'A yearly furnace maintenance checklist',
    desc: 'A home furnace in a medallion with a calendar and a checklist beside it.',
    bg: palette.sand,
    accent: palette.amber,
    hero: 'furnace',
    satellites: [
      { icon: 'calendar', x: 690, y: 196 },
      { icon: 'shield', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'roof-leak-warning-signs.svg',
    title: 'Roof leak warning signs every homeowner should know',
    desc: 'A pitched roof in a medallion with rain drops and a warning sign beside it.',
    bg: palette.cream,
    accent: palette.navy,
    hero: 'roof',
    satellites: [
      { icon: 'droplet', x: 690, y: 196 },
      { icon: 'clock', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'how-to-choose-a-roofing-contractor.svg',
    title: 'How to choose a roofing contractor',
    desc: 'A house in a medallion with a written quote and a review star beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'house',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'star', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'roof-repair-vs-replacement.svg',
    title: 'Roof repair or full replacement: how to decide',
    desc: 'A stepladder in a medallion with a coin and a roof beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'ladder',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'wrench', x: 742, y: 446, r: 46 },
      { icon: 'house', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'storm-damage-roof-repair-and-insurance.svg',
    title: 'Storm damage roof repair and insurance claims',
    desc: 'A storm cloud with rain in a medallion, with a document and a house beside it.',
    bg: palette.sand,
    accent: palette.navy,
    hero: 'storm',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'house', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'first-24-hours-after-water-damage.svg',
    title: 'The first 24 hours after water damage',
    desc: 'A large water droplet in a medallion with a clock and a fan-worthy shield beside it.',
    bg: palette.cream,
    accent: palette.teal,
    hero: 'droplet',
    satellites: [
      { icon: 'clock', x: 690, y: 196 },
      { icon: 'shield', x: 742, y: 446, r: 46 },
      { icon: 'phone', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'hidden-mold-after-a-leak.svg',
    title: 'Hidden mold after a leak: what to look for',
    desc: 'A cluster of mold spores in a medallion with a shield and a droplet beside it.',
    bg: palette.sand,
    accent: palette.green,
    hero: 'mold',
    satellites: [
      { icon: 'droplet', x: 690, y: 196 },
      { icon: 'shield', x: 742, y: 446, r: 46 },
      { icon: 'leaf', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'termite-warning-signs.svg',
    title: 'Termite warning signs around your home',
    desc: 'An insect in a medallion with a magnifier-like document and a house beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'bug',
    satellites: [
      { icon: 'house', x: 690, y: 196 },
      { icon: 'shield', x: 742, y: 446, r: 46 },
      { icon: 'document', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'rodent-proofing-your-home.svg',
    title: 'Rodent proofing: keeping mice out of your home',
    desc: 'A mouse in a medallion with a shield and a house beside it.',
    bg: palette.sand,
    accent: palette.navy,
    hero: 'mouse',
    satellites: [
      { icon: 'shield', x: 690, y: 196 },
      { icon: 'check', x: 742, y: 446, r: 46 },
      { icon: 'house', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'kitchen-remodel-cost-breakdown.svg',
    title: 'Kitchen remodel costs: a line-by-line breakdown',
    desc: 'A kitchen counter with cabinets in a medallion with a coin and a ruler beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'kitchen',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'kitchen-remodel-timeline.svg',
    title: 'How long does a kitchen remodel take?',
    desc: 'A calendar in a medallion with a clock and a wrench beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'calendar',
    satellites: [
      { icon: 'clock', x: 690, y: 196 },
      { icon: 'wrench', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'bathroom-remodel-planning-checklist.svg',
    title: 'Bathroom remodel planning checklist',
    desc: 'A shower head in a medallion with a checklist and a ruler beside it.',
    bg: palette.cream,
    accent: palette.teal,
    hero: 'shower',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'small-bathroom-remodel-that-adds-value.svg',
    title: 'Small bathroom remodels that add value',
    desc: 'A bathtub in a medallion with a coin and a ruler beside it.',
    bg: palette.sand,
    accent: palette.amber,
    hero: 'tub',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'star', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'window-replacement-cost-and-signs.svg',
    title: 'Window replacement: cost and the signs it is time',
    desc: 'A four-pane window in a medallion with a coin and a ruler beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'window',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'energy-efficient-windows-guide.svg',
    title: 'Energy efficient windows: what the ratings mean',
    desc: 'A window in a medallion with a sun and a leaf beside it.',
    bg: palette.cream,
    accent: palette.green,
    hero: 'window',
    satellites: [
      { icon: 'sun', x: 690, y: 196 },
      { icon: 'leaf', x: 742, y: 446, r: 46 },
      { icon: 'gauge', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'front-door-replacement-guide.svg',
    title: 'Front door replacement guide',
    desc: 'A panelled front door in a medallion with a key and a shield beside it.',
    bg: palette.sand,
    accent: palette.navy,
    hero: 'door',
    satellites: [
      { icon: 'shield', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'star', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'driveway-replacement-cost.svg',
    title: 'Driveway replacement cost',
    desc: 'A concrete driveway slab in a medallion with a coin and a ruler beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'slab',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'ruler', x: 742, y: 446, r: 46 },
      { icon: 'calendar', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'concrete-repair-vs-replace.svg',
    title: 'Concrete repair or replace?',
    desc: 'A cracked concrete slab in a medallion with a wrench and a coin beside it.',
    bg: palette.sand,
    accent: palette.navy,
    hero: 'crack',
    satellites: [
      { icon: 'wrench', x: 690, y: 196 },
      { icon: 'money', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'rekey-vs-replace-locks.svg',
    title: 'Rekey or replace your locks?',
    desc: 'A key in a medallion with a padlock and a shield beside it.',
    bg: palette.cream,
    accent: palette.teal,
    hero: 'key',
    satellites: [
      { icon: 'shield', x: 690, y: 196 },
      { icon: 'money', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'how-to-compare-home-service-estimates.svg',
    title: 'How to compare home service estimates',
    desc: 'A clipboard with a checked line in a medallion with a coin and a document beside it.',
    bg: palette.sand,
    accent: palette.teal,
    hero: 'clipboard',
    satellites: [
      { icon: 'money', x: 690, y: 196 },
      { icon: 'document', x: 742, y: 446, r: 46 },
      { icon: 'check', x: 946, y: 300, r: 66 },
    ],
  },
  {
    file: 'questions-to-ask-before-hiring-a-home-service-professional.svg',
    title: 'Questions to ask before hiring a home service professional',
    desc: 'A speech bubble in a medallion with a checklist and a star beside it.',
    bg: palette.cream,
    accent: palette.amber,
    hero: 'speech',
    satellites: [
      { icon: 'document', x: 690, y: 196 },
      { icon: 'star', x: 742, y: 446, r: 46 },
      { icon: 'shield', x: 946, y: 300, r: 66 },
    ],
  },
]

let written = 0
for (const entry of scenes) {
  writeFileSync(resolve(outDir, entry.file), scene(entry), 'utf8')
  written++
}

/* Sanity check: every image referenced by the article JSON must exist here. */
const contentDir = resolve(root, 'api/database/content/articles')
const referenced = readdirSync(contentDir)
  .filter((file) => file.endsWith('.json'))
  .flatMap((file) => JSON.parse(readFileSync(resolve(contentDir, file), 'utf8')))
const missing = referenced
  .map((article) => article.image)
  .filter((image) => !scenes.some((entry) => `/images/blog/${entry.file}` === image))
const unused = scenes
  .map((entry) => `/images/blog/${entry.file}`)
  .filter((image) => referenced.length > 0 && !referenced.some((article) => article.image === image))

console.log(`blog images written: ${written}`)
if (missing.length) console.log(`MISSING (referenced by an article): ${missing.join(', ')}`)
if (unused.length) console.log(`UNUSED (no article points here): ${unused.join(', ')}`)
if (referenced.length !== scenes.length) {
  console.log(`NOTE: ${referenced.length} articles vs ${scenes.length} scenes.`)
}

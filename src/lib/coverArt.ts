/**
 * Deterministic generative cover artwork.
 *
 * Real covers will be uploaded to object storage (R2-ready via StorageService).
 * Seeded books without uploaded art render a deterministic SVG so the
 * marketplace, library and template gallery are never visually empty.
 */

export interface Palette {
  id: string;
  name: string;
  colors: [string, string, string];
  ink: string;
  paper: string;
  /** Accent colour used for rules, drop caps and chapter ornaments. */
  accent: string;
}

export const palettes: Palette[] = [
  { id: 'midnight', name: 'Midnight', colors: ['#0b1220', '#1e3a8a', '#38bdf8'], ink: '#f8fafc', paper: '#0b1220', accent: 'midnight' },
  { id: 'ember', name: 'Ember', colors: ['#1c0f0a', '#b45309', '#fb923c'], ink: '#fff7ed', paper: '#1c0f0a', accent: 'ember' },
  { id: 'lavender', name: 'Lavender', colors: ['#2e1065', '#7c3aed', '#c4b5fd'], ink: '#f5f3ff', paper: '#2e1065', accent: 'lavender' },
  { id: 'forest', name: 'Forest', colors: ['#052e26', '#0f766e', '#7dd3a8'], ink: '#ecfdf5', paper: '#052e26', accent: 'forest' },
  { id: 'rose', name: 'Rose', colors: ['#4c0519', '#be123c', '#fda4af'], ink: '#fff1f2', paper: '#4c0519', accent: 'rose' },
  { id: 'sand', name: 'Sand', colors: ['#3f2d1a', '#a16207', '#eab308'], ink: '#fefce8', paper: '#3f2d1a', accent: 'sand' },
  { id: 'ocean', name: 'Ocean', colors: ['#082f49', '#0369a1', '#7dd3fc'], ink: '#f0f9ff', paper: '#082f49', accent: 'ocean' },
  { id: 'plum', name: 'Plum', colors: ['#1e1b4b', '#4338ca', '#a5b4fc'], ink: '#eef2ff', paper: '#1e1b4b', accent: 'plum' },
  { id: 'charcoal', name: 'Charcoal', colors: ['#18181b', '#3f3f46', '#a1a1aa'], ink: '#fafafa', paper: '#18181b', accent: 'charcoal' },
  { id: 'mint', name: 'Mint', colors: ['#042f2e', '#14b8a6', '#99f6e4'], ink: '#f0fdfa', paper: '#042f2e', accent: 'mint' },
  { id: 'sunset', name: 'Sunset', colors: ['#431407', '#ea580c', '#fdba74'], ink: '#fff7ed', paper: '#431407', accent: 'sunset' },
  { id: 'ink', name: 'Ink', colors: ['#f5f3ef', '#1f2937', '#8b5cf6'], ink: '#1f2937', paper: '#f5f3ef', accent: 'ink' },
];

export const coverStyles = [
  'geometric',
  'sunrise',
  'waves',
  'mountain',
  'botanical',
  'orbit',
  'blocks',
  'aurora',
  'grid',
  'type-driven',
] as const;

export type CoverStyle = (typeof coverStyles)[number];

export function paletteById(id: string): Palette {
  return palettes.find((entry) => entry.id === id) ?? palettes[0];
}

/** Small deterministic PRNG so the same seed always renders the same art. */
function rng(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function encode(svg: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

const W = 400;
const H = 600;

function art(seed: number, palette: Palette, style: CoverStyle, withTitle: boolean) {
  const random = rng(seed);
  const [dark, mid, light] = palette.colors;
  const layers: string[] = [];
  const id = `g${seed.toString(36)}`;

  layers.push(
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  );

  const styleIndex = coverStyles.indexOf(style);

  switch (style) {
    case 'geometric': {
      for (let i = 0; i < 7; i += 1) {
        const size = 70 + random() * 220;
        layers.push(
          `<circle cx="${random() * W}" cy="${random() * H}" r="${size / 2}" fill="${i % 2 ? light : mid}" opacity="${(0.06 + random() * 0.2).toFixed(2)}"/>`,
        );
      }
      layers.push(`<rect x="34" y="${H - 190}" width="${W - 68}" height="4" fill="${light}" opacity="0.8"/>`);
      break;
    }
    case 'sunrise': {
      layers.push(`<circle cx="${W / 2}" cy="${H * 0.46}" r="110" fill="${light}" opacity="0.9"/>`);
      for (let i = 0; i < 6; i += 1) {
        layers.push(
          `<rect x="0" y="${H * 0.42 + i * 26}" width="${W}" height="${12 - i}" fill="${dark}" opacity="${(0.85 - i * 0.1).toFixed(2)}"/>`,
        );
      }
      layers.push(`<path d="M0 ${H} L0 ${H - 120} Q ${W / 2} ${H - 210} ${W} ${H - 120} L ${W} ${H} Z" fill="${dark}" opacity="0.92"/>`);
      break;
    }
    case 'waves': {
      for (let i = 0; i < 5; i += 1) {
        const y = H * 0.35 + i * 46;
        layers.push(
          `<path d="M0 ${y} C ${W * 0.25} ${y - 60}, ${W * 0.6} ${y + 50}, ${W} ${y - 10} L ${W} ${H} L 0 ${H} Z" fill="${i % 2 ? light : mid}" opacity="${(0.14 + i * 0.13).toFixed(2)}"/>`,
        );
      }
      break;
    }
    case 'mountain': {
      layers.push(`<circle cx="${W * 0.7}" cy="${H * 0.22}" r="46" fill="${light}" opacity="0.85"/>`);
      layers.push(`<path d="M0 ${H} L ${W * 0.32} ${H * 0.5} L ${W * 0.54} ${H * 0.72} L ${W * 0.74} ${H * 0.44} L ${W} ${H} Z" fill="${mid}" opacity="0.95"/>`);
      layers.push(`<path d="M0 ${H} L ${W * 0.22} ${H * 0.68} L ${W * 0.46} ${H * 0.86} L ${W * 0.66} ${H * 0.62} L ${W} ${H} Z" fill="${dark}" opacity="0.98"/>`);
      break;
    }
    case 'botanical': {
      for (let i = 0; i < 9; i += 1) {
        const cx = random() * W;
        const cy = random() * H;
        const r = 26 + random() * 54;
        layers.push(
          `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 0.45).toFixed(1)}" fill="${i % 3 ? light : mid}" opacity="${(0.1 + random() * 0.24).toFixed(2)}" transform="rotate(${(random() * 180).toFixed(0)} ${cx} ${cy})"/>`,
        );
      }
      layers.push(`<path d="M0 ${H * 0.86} Q ${W * 0.5} ${H * 0.7} ${W} ${H * 0.9}" stroke="${light}" stroke-width="2" fill="none" opacity="0.7"/>`);
      break;
    }
    case 'orbit': {
      for (let i = 0; i < 4; i += 1) {
        layers.push(
          `<ellipse cx="${W / 2}" cy="${H * 0.48}" rx="${(60 + i * 42).toFixed(0)}" ry="${(24 + i * 16).toFixed(0)}" fill="none" stroke="${light}" stroke-width="2" opacity="${(0.5 - i * 0.09).toFixed(2)}" transform="rotate(${(-18 + i * 12).toFixed(0)} ${W / 2} ${H * 0.48})"/>`,
        );
      }
      layers.push(`<circle cx="${W / 2}" cy="${H * 0.48}" r="26" fill="${light}"/>`);
      break;
    }
    case 'blocks': {
      let x = 0;
      while (x < W) {
        const w = 34 + random() * 78;
        if (random() > 0.32) {
          layers.push(
            `<rect x="${x.toFixed(0)}" y="0" width="${w.toFixed(0)}" height="${H}" fill="${random() > 0.5 ? light : mid}" opacity="${(0.08 + random() * 0.2).toFixed(2)}"/>`,
          );
        }
        x += w;
      }
      layers.push(`<rect x="0" y="${H * 0.6}" width="${W}" height="6" fill="${light}" opacity="0.65"/>`);
      break;
    }
    case 'aurora': {
      for (let i = 0; i < 5; i += 1) {
        const y = 60 + i * 70;
        layers.push(
          `<path d="M0 ${y} C ${W * 0.3} ${y - 80}, ${W * 0.7} ${y + 90}, ${W} ${y - 30} L ${W} ${y - 10} L 0 ${y + 20} Z" fill="${light}" opacity="${(0.08 + i * 0.06).toFixed(2)}"/>`,
        );
      }
      for (let i = 0; i < 40; i += 1) {
        layers.push(`<circle cx="${(random() * W).toFixed(0)}" cy="${(random() * H * 0.7).toFixed(0)}" r="${(0.6 + random() * 1.4).toFixed(1)}" fill="#ffffff" opacity="${(0.25 + random() * 0.5).toFixed(2)}"/>`);
      }
      break;
    }
    case 'grid': {
      for (let i = 0; i <= 10; i += 1) {
        layers.push(`<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}" stroke="${light}" stroke-width="1" opacity="0.14"/>`);
        layers.push(`<line x1="0" y1="${i * 60}" x2="${W}" y2="${i * 60}" stroke="${light}" stroke-width="1" opacity="0.14"/>`);
      }
      layers.push(`<rect x="80" y="${H * 0.28}" width="${W - 160}" height="${H * 0.34}" fill="${mid}" opacity="0.55" rx="4"/>`);
      layers.push(`<rect x="80" y="${H * 0.28}" width="${W - 160}" height="${H * 0.34}" fill="none" stroke="${light}" stroke-width="2" opacity="0.8" rx="4"/>`);
      break;
    }
    default: {
      layers.push(`<rect x="0" y="0" width="${W}" height="${H * 0.55}" fill="${mid}" opacity="0.45"/>`);
      layers.push(`<rect x="${W * 0.14}" y="${H * 0.62}" width="${W * 0.72}" height="3" fill="${light}" opacity="0.85"/>`);
      layers.push(`<rect x="${W * 0.3}" y="${H * 0.68}" width="${W * 0.4}" height="3" fill="${light}" opacity="0.5"/>`);
      break;
    }
  }

  if (withTitle) {
    layers.push(
      `<rect width="${W}" height="${H}" fill="${dark}" opacity="${styleIndex >= 0 ? 0.18 : 0.1}"/>`,
    );
  }

  return { body: layers.join(''), palette };
}

export interface CoverArtOptions {
  seed?: number | string;
  paletteId?: string;
  style?: CoverStyle;
  title?: string;
  author?: string;
  showText?: boolean;
  tagline?: string;
}

/** Returns a data URL suitable for <img src> / background-image. */
export function coverArtUrl(options: CoverArtOptions = {}): string {
  const seed =
    typeof options.seed === 'number'
      ? options.seed
      : hashString(String(options.seed ?? options.title ?? 'scriptora'));
  const palette = paletteById(options.paletteId ?? palettes[seed % palettes.length].id);
  const style = options.style ?? coverStyles[seed % coverStyles.length];
  const { body } = art(seed, palette, style, Boolean(options.showText));

  let text = '';
  if (options.showText && options.title) {
    const titleWords = options.title.split(' ');
    const lines: string[] = [];
    let line = '';
    titleWords.forEach((word) => {
      if ((line + ' ' + word).trim().length > 16) {
        lines.push(line.trim());
        line = word;
      } else {
        line = `${line} ${word}`;
      }
    });
    if (line.trim()) lines.push(line.trim());

    const startY = 300;
    text += `<rect x="34" y="${startY - 66}" width="52" height="4" fill="${palette.ink}" opacity="0.9"/>`;
    lines.slice(0, 4).forEach((line, i) => {
      text += `<text x="34" y="${startY + i * 58}" font-family="Georgia, serif" font-size="52" font-weight="700" fill="${palette.ink}" letter-spacing="-1">${escapeXml(line)}</text>`;
    });
    if (options.author) {
      text += `<text x="34" y="${H - 46}" font-family="Inter, sans-serif" font-size="19" font-weight="600" letter-spacing="3.4" fill="${palette.ink}" opacity="0.92">${escapeXml(options.author.toUpperCase())}</text>`;
    }
    if (options.tagline) {
      text += `<text x="34" y="${startY + lines.length * 58 + 18}" font-family="Inter, sans-serif" font-size="16" fill="${palette.ink}" opacity="0.78">${escapeXml(options.tagline)}</text>`;
    }
  }

  return encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}${text}</svg>`,
  );
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Decorative page background patterns used by the design mode. */
export function patternUrl(kind: string, color = '#8b5cf6'): string {
  const patterns: Record<string, string> = {
    dots: `<circle cx="10" cy="10" r="1.6" fill="${color}" opacity="0.35"/><circle cx="50" cy="50" r="1.6" fill="${color}" opacity="0.35"/><circle cx="50" cy="10" r="1.6" fill="${color}" opacity="0.2"/><circle cx="10" cy="50" r="1.6" fill="${color}" opacity="0.2"/>`,
    grid: `<path d="M0 0H80M0 0V80" stroke="${color}" stroke-width="1" opacity="0.22"/>`,
    lines: `<path d="M0 20H80M0 40H80M0 60H80" stroke="${color}" stroke-width="1" opacity="0.18"/>`,
    waves: `<path d="M0 20 Q 20 0 40 20 T 80 20" stroke="${color}" stroke-width="1.4" fill="none" opacity="0.3"/><path d="M0 50 Q 20 30 40 50 T 80 50" stroke="${color}" stroke-width="1.4" fill="none" opacity="0.2"/>`,
    confetti: `<rect x="8" y="12" width="6" height="6" rx="1" fill="${color}" opacity="0.35" transform="rotate(20 11 15)"/><rect x="52" y="42" width="6" height="6" rx="1" fill="${color}" opacity="0.3" transform="rotate(-15 55 45)"/><rect x="30" y="64" width="6" height="6" rx="1" fill="${color}" opacity="0.25"/>`,
    crosses: `<path d="M20 14v12M14 20h12" stroke="${color}" stroke-width="1.4" opacity="0.3"/><path d="M60 54v12M54 60h12" stroke="${color}" stroke-width="1.4" opacity="0.22"/>`,
  };
  const body = patterns[kind] ?? patterns.dots;
  return encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">${body}</svg>`,
  );
}

/** Cover thumbnail strip used in marketplace cards when art is unavailable. */
export function spineColor(seed: number | string) {
  const hash = typeof seed === 'number' ? seed : hashString(seed);
  return palettes[hash % palettes.length].colors[1];
}

export { hashString };

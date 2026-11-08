/** The icon set, as data (`ARCHITECTURE.md` §10).
 *
 *  Icons are shapes in a record rather than a dependency, for three reasons:
 *
 *  * **A desktop app is shipped, and shipped offline.** An icon font is a
 *    network request or a 200 kB file; this is 3 kB of numbers.
 *  * **They inherit `currentColor`.** An icon in a button is the button's ink, in
 *    every theme, including one a plugin contributed — no `fill` to override.
 *  * **They are stroke-based at one width.** A filled set and a stroked set next
 *    to each other look like two products.
 *
 *  Every icon is drawn on a 24 × 24 grid with a 1.5px stroke, which is why none
 *  of them carries a size: `Icon` scales the whole drawing.
 */

/** One part of an icon. A record rather than an SVG string so `Icon.tsx` can
 *  render real elements — a string would mean `innerHTML`, and the day somebody
 *  makes an icon name a variable is the day that matters. */
export type IconShape =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    };

const path = (d: string): IconShape => ({ kind: 'path', d });
const circle = (cx: number, cy: number, r: number): IconShape => ({ kind: 'circle', cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx = 0): IconShape => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

/** Every icon the window may use.
 *
 *  The union is the API: a component cannot ask for an icon that does not exist,
 *  and adding one is a line here plus nothing anywhere else.
 */
export const ICONS = {
  check: [path('M20 6 9 17l-5-5')],
  close: [path('M18 6 6 18M6 6l12 12')],
  plus: [path('M12 5v14M5 12h14')],
  minus: [path('M5 12h14')],
  'chevron-down': [path('m6 9 6 6 6-6')],
  'chevron-up': [path('m18 15-6-6-6 6')],
  'chevron-left': [path('m15 18-6-6 6-6')],
  'chevron-right': [path('m9 18 6-6-6-6')],
  'chevron-first': [path('m17 18-6-6 6-6'), path('M7 6v12')],
  'chevron-last': [path('m7 18 6-6-6-6'), path('M17 6v12')],
  trash: [path('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14')],
  copy: [rect(9, 9, 11, 11, 2), path('M5 15H4V4h11v1')],
  folder: [
    path(
      'M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l1 1.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    ),
  ],
  film: [
    path('M3 5h18v14H3z'),
    path('M7.5 5v14M16.5 5v14'),
    path('M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21'),
  ],
  play: [path('M8 5.5v13l11-6.5z')],
  pause: [path('M9.5 5v14M14.5 5v14')],
  skip: [path('m6 6 9 6-9 6z'), path('M18 6v12')],
  search: [circle(11, 11, 7), path('m20 20-4.3-4.3')],
  info: [circle(12, 12, 9), path('M12 11v5'), path('M12 8h.01')],
  warning: [
    path('M10.3 4 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z'),
    path('M12 9.5v4'),
    path('M12 17h.01'),
  ],
  alert: [circle(12, 12, 9), path('M12 7.5v5'), path('M12 16h.01')],
  'check-circle': [circle(12, 12, 9), path('m8 12 3 3 5-6')],
  settings: [
    circle(12, 12, 3),
    path(
      'M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6',
    ),
  ],
  'more-horizontal': [circle(5, 12, 1.4), circle(12, 12, 1.4), circle(19, 12, 1.4)],
  'more-vertical': [circle(12, 5, 1.4), circle(12, 12, 1.4), circle(12, 19, 1.4)],
  download: [path('M12 3.5v11m0 0 4-4m-4 4-4-4'), path('M4 19.5h16')],
  upload: [path('M12 20.5v-11m0 0 4 4m-4-4-4 4'), path('M4 4.5h16')],
  undo: [path('M9 14 4 9l5-5'), path('M4 9h11a5 5 0 0 1 0 10h-6')],
  redo: [path('m15 14 5-5-5-5'), path('M20 9H9a5 5 0 0 0 0 10h6')],
  grip: [
    circle(9, 6, 1.3),
    circle(15, 6, 1.3),
    circle(9, 12, 1.3),
    circle(15, 12, 1.3),
    circle(9, 18, 1.3),
    circle(15, 18, 1.3),
  ],
  eye: [
    path('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'),
    circle(12, 12, 3),
  ],
  'eye-off': [
    path('M3 3l18 18'),
    path(
      'M10.6 5.7A10.7 10.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.3 4.2M6.7 6.8A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5a10.5 10.5 0 0 0 4.4-.9',
    ),
    path('M9.9 9.9a3 3 0 0 0 4.2 4.2'),
  ],
  scissors: [
    circle(6, 6, 2.4),
    circle(6, 18, 2.4),
    path('M8 7.7 20 18M8 16.3 20 6M12 12l8 6M12 12l8-6'),
  ],
  sparkles: [
    path('M11 3.5 12.8 8.2 17.5 10 12.8 11.8 11 16.5 9.2 11.8 4.5 10 9.2 8.2z'),
    path('m17.5 15 .8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z'),
  ],
  captions: [
    path(
      'M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z',
    ),
    path('M9.5 10.5a2.5 2.5 0 1 0 0 3'),
    path('M16 10.5a2.5 2.5 0 1 0 0 3'),
  ],
} as const satisfies Readonly<Record<string, readonly IconShape[]>>;

export type IconName = keyof typeof ICONS;

/** Every icon name there is. Used by the test that walks them all, and by a
 *  settings screen that lets a plugin pick one. */
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/** One icon, drawn from `icons.ts` (`ARCHITECTURE.md` §10).
 *
 *  Two rules:
 *
 *  * **An icon is decorative by default.** It carries no accessible name until
 *    it is given one, because an unlabelled icon inside a labelled button is
 *    announced twice, and an unlabelled icon *outside* one is announced as
 *    nothing at all — which is worse.
 *  * **It inherits `currentColor` and nothing else.** No `fill`, no hardcoded
 *    stroke: the icon is the colour of the text it sits beside, in every theme,
 *    including a theme a plugin wrote.
 */

import { cx, type ClassValue } from './cx';
import type { IconName, IconShape } from './icons';
import { ICONS } from './icons';

/** The size of the drawing, in pixels. `md` is a 16px icon beside 14px text,
 *  which is the size that lines up with the type without being measured. */
export type IconSize = 'sm' | 'md' | 'lg' | number;

const SIZE_PX: Record<Exclude<IconSize, number>, number> = {
  sm: 14,
  md: 16,
  lg: 20,
};

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  /** The accessible name. Given: the icon becomes an image with that name.
   *  Omitted: it is decorative and hidden from assistive technology. */
  readonly label?: string;
  /** Extra classes for the `svg` — colour and margin, mostly. */
  readonly className?: ClassValue;
}

function shapeElement(shape: IconShape, index: number): React.JSX.Element {
  switch (shape.kind) {
    case 'path':
      return <path key={index} d={shape.d} />;
    case 'circle':
      return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case 'line':
      return <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
    case 'rect':
      return (
        <rect
          key={index}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
        />
      );
  }
}

export function Icon({ name, size = 'md', label, className }: IconProps): React.JSX.Element {
  const px = typeof size === 'number' ? size : SIZE_PX[size];
  const shapes = ICONS[name];

  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // `inline-block` rather than the default `inline`: an icon in a line of
      // text that sits on the baseline rather than the text's own is an icon
      // that looks a pixel too low in every browser.
      className={cx('inline-block shrink-0', className)}
      // Decorative until it has a name of its own to give.
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      data-icon={name}
    >
      {shapes.map(shapeElement)}
    </svg>
  );
}

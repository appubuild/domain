/** An overlay rendered at the end of `<body>`, out of its parent's context.
 *
 *  An overlay has to escape. A modal inside a panel that has `overflow: hidden`
 *  is clipped, a menu inside a `transform`ed ancestor is positioned against the
 *  wrong origin, and a tooltip inside a stacking context is behind the thing it
 *  is supposed to be in front of. Rendering into a node appended to `<body>` is
 *  the only answer to all three, and it is why React ships `createPortal`.
 *
 *  Two details that are not optional:
 *
 *  * **The node is created once and removed on unmount.** A portal that leaves
 *    its `div` behind on every open leaks one element per modal the user ever
 *    opened.
 *  * **The node is mounted before the children render.** A `ref` measured in a
 *    child's layout effect has to find an element that is already in the
 *    document, so the state is set during render — the one legitimate use of
 *    the "derive state during render" pattern, and the reason it is commented.
 */

import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PortalProps {
  readonly children: ReactNode;
  /** Where to append. `<body>` by default; a test passes a container it owns so
   *  it can assert on what was rendered and clean up after itself. */
  readonly container?: HTMLElement;
}

export function Portal({ children, container }: PortalProps): React.JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (container !== undefined) {
      setHost(container);
      // A container handed in from outside was not made by this component and
      // must not be removed by it.
      return;
    }
    if (typeof document === 'undefined') return;
    const node = document.createElement('div');
    node.dataset['novaPortal'] = '';
    document.body.append(node);
    setHost(node);
    return () => {
      node.remove();
    };
  }, [container]);

  // Nothing is rendered until the host exists: an overlay in the wrong place is
  // worse than an overlay one frame late.
  if (host === null) return null;
  return createPortal(children, host);
}

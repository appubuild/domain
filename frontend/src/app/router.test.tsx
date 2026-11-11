// @vitest-environment jsdom
/** The router, which is a pure function wearing a context.
 *
 *  What is tested is mostly `parseRoute`, because that is where the bugs live:
 *  an address is text a user can edit, a build can change and a project id can
 *  outlive. The component test is only there to prove the round trip — that
 *  clicking writes the address and the address moves the screen, rather than
 *  the click moving the screen and the address being decoration.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RouterProvider } from './router';
import { useRouter } from './router-context';
import { HOME, parseRoute, routeHref } from './routes';

function ShowRoute(): React.JSX.Element {
  const { route, navigate } = useRouter();
  return (
    <>
      <span data-testid="route">
        {route.name === 'editor' ? `editor:${route.projectId}` : 'home'}
      </span>
      <button
        type="button"
        onClick={() => {
          navigate({ name: 'editor', projectId: 'a b/c' });
        }}
      >
        open
      </button>
    </>
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('reading an address', () => {
  it('says home for everything it does not recognise', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/home',
      '#/nonsense',
      '#/editor',
      '#/editor/',
      '#/a/b/c',
    ]) {
      expect(parseRoute(hash), hash).toEqual(HOME);
    }
  });

  it('reads a project out of an editor address', () => {
    expect(parseRoute('#/editor/abc')).toEqual({ name: 'editor', projectId: 'abc' });
    // Without the leading hash as well: a link's `href` and a `location.hash`
    // are not the same string, and both are handed to this.
    expect(parseRoute('/editor/abc')).toEqual({ name: 'editor', projectId: 'abc' });
  });

  it('decodes what `routeHref` encoded, and survives a hand-edited one', () => {
    const route = { name: 'editor', projectId: 'a b/c?d' } as const;
    expect(parseRoute(routeHref(route))).toEqual(route);
    // A `%` that is not an escape is still a route — nonsense, but not a crash.
    expect(parseRoute('#/editor/100%')).toEqual({ name: 'editor', projectId: '100%' });
  });

  it('writes the address back out', () => {
    expect(routeHref(HOME)).toBe('#/');
    expect(routeHref({ name: 'editor', projectId: 'a b/c' })).toBe('#/editor/a%20b%2Fc');
  });
});

describe('a window with an address', () => {
  it('starts where the address says', () => {
    window.location.hash = '#/editor/abc';
    render(
      <RouterProvider>
        <ShowRoute />
      </RouterProvider>,
    );
    expect(screen.getByTestId('route').textContent).toBe('editor:abc');
  });

  it('writes the address when it is asked to move, and moves with it', () => {
    render(
      <RouterProvider initial={HOME}>
        <ShowRoute />
      </RouterProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'open' }));

    expect(window.location.hash).toBe('#/editor/a%20b%2Fc');
    expect(screen.getByTestId('route').textContent).toBe('editor:a b/c');
  });

  it('follows an address it did not write', () => {
    render(
      <RouterProvider initial={HOME}>
        <ShowRoute />
      </RouterProvider>,
    );

    // A back button, or a link pasted into the address bar.
    window.location.hash = '#/editor/from-history';
    // A `HashChangeEvent` jsdom does not construct, but the name is all the
    // router listens for: it reads the address rather than the event.
    fireEvent(window, new Event('hashchange'));

    expect(screen.getByTestId('route').textContent).toBe('editor:from-history');
  });

  it('starts at home when there is no address at all', () => {
    render(
      <RouterProvider>
        <ShowRoute />
      </RouterProvider>,
    );
    expect(screen.getByTestId('route').textContent).toBe('home');
  });
});

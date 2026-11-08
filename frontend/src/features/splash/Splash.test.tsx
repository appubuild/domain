// @vitest-environment jsdom
/** The splash, as a view of a state it was handed.
 *
 *  What is being pinned is that **the first screen tells the truth**. A window
 *  that says "Starting…" forever is indistinguishable from a crash, and a window
 *  that shows a red error two milliseconds after launch is a lie: a local
 *  service takes a moment to bind its port.
 *
 *  The state arrives as a prop, so these tests are about what the user reads and
 *  not about how the answer was obtained — which is `useServiceInfo`'s own suite.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SystemInfoResponse } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { Splash } from './Splash';
import type { ServiceState } from './useServiceInfo';

const INFO: SystemInfoResponse = {
  version: '0.1.0',
  project_format_version: 3,
  data_dir: '/home/user/.nova',
  host: '127.0.0.1',
  port: 8765,
  pid: 4242,
  platform: 'Linux-6.8.0',
  python: '3.11.9',
  implementation: 'CPython',
  frozen: false,
};

function unreachable(problem: ApiProblem): ServiceState {
  return { kind: 'unreachable', problem };
}

/** The splash inside the one provider it cannot do without.
 *
 *  Not a convenience wrapper: a component that renders without a translator
 *  throws, and a test that only ever wrapped its component in a provider it did
 *  not need would not notice the day the component started needing one.
 */
function renderSplash(state: ServiceState, locale = 'en'): void {
  render(
    <I18nProvider locale={locale}>
      <Splash state={state} />
    </I18nProvider>,
  );
}

describe('while the service is starting', () => {
  it('says it is starting rather than showing nothing', () => {
    renderSplash({ kind: 'connecting' });
    expect(screen.getByRole('status').textContent).toContain('Starting the editor');
  });

  it('does not call a splash that is still waiting a failure', () => {
    renderSplash({ kind: 'connecting' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('when the service answers', () => {
  it('says who it is, so a bug report can name the build', () => {
    renderSplash({ kind: 'ready', info: INFO });

    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('/home/user/.nova')).toBeTruthy();
  });
});

describe('when the service is not there', () => {
  it('names the failure instead of hanging on "starting"', () => {
    renderSplash(
      unreachable({
        kind: 'transport',
        status: 0,
        code: 'transport/unreachable',
        detail: 'fetch failed',
      }),
    );

    expect(screen.getByRole('alert').textContent).toContain('unreachable');
  });

  it('tells a slow start apart from a dead service', () => {
    renderSplash(
      unreachable({
        kind: 'timeout',
        status: 0,
        code: 'transport/timeout',
        detail: 'the service did not answer in time',
      }),
    );

    expect(screen.getByRole('alert').textContent).toContain('still be starting');
  });
});

describe('in another language', () => {
  it('the same screen says the same thing, in it', () => {
    renderSplash({ kind: 'connecting' }, 'bn');

    // Proves the wiring rather than the translation: the English string is gone
    // and the document now claims to be Bangla, which is what a screen reader
    // picks its voice from.
    expect(screen.getByRole('status').textContent).not.toContain('Starting');
    expect(screen.getByRole('status').textContent).toContain('এডিটর');
    expect(document.documentElement.getAttribute('lang')).toBe('bn');
  });
});

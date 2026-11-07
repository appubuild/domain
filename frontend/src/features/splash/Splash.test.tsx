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

describe('while the service is starting', () => {
  it('says it is starting rather than showing nothing', () => {
    render(<Splash state={{ kind: 'connecting' }} />);
    expect(screen.getByRole('status').textContent).toContain('Starting the editor');
  });

  it('does not call a splash that is still waiting a failure', () => {
    render(<Splash state={{ kind: 'connecting' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('when the service answers', () => {
  it('says who it is, so a bug report can name the build', () => {
    render(<Splash state={{ kind: 'ready', info: INFO }} />);

    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('/home/user/.nova')).toBeTruthy();
  });
});

describe('when the service is not there', () => {
  it('names the failure instead of hanging on "starting"', () => {
    render(
      <Splash
        state={unreachable({
          kind: 'transport',
          status: 0,
          code: 'transport/unreachable',
          detail: 'fetch failed',
        })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('unreachable');
  });

  it('tells a slow start apart from a dead service', () => {
    render(
      <Splash
        state={unreachable({
          kind: 'timeout',
          status: 0,
          code: 'transport/timeout',
          detail: 'the service did not answer in time',
        })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('still be starting');
  });
});

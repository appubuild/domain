// @vitest-environment jsdom
/** The splash, rendered against a stubbed client.
 *
 * What is being pinned is that **the first screen tells the truth**. A window
 * that says "Starting…" forever is indistinguishable from a crash, and a window
 * that shows a red error two milliseconds after launch is a lie: a local
 * service takes a moment to bind its port. So the three states are tested as
 * three states, and the client behind them is a stub — a component test that
 * needed a running editor would not be run by anybody.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../core/api/context';
import type { ApiClient } from '../../core/api/client';
import type { SystemInfoResponse } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { err, ok, type Result } from '../../core/result';
import { Splash } from './Splash';

type Answer = Result<SystemInfoResponse, ApiProblem>;

/** A client that has exactly one answer, however many times it is asked.
 *
 *  Cast through `unknown` on purpose: a double for a two-method interface is
 *  not the interface, and pretending otherwise is how a test ends up testing
 *  the stub.
 */
function stub(answer: Answer): ApiClient {
  return {
    run: () => Promise.resolve(answer),
    url: () => '',
  } as ApiClient;
}

/** A client that never answers, which is what "still starting" looks like. */
function silent(): ApiClient {
  return { run: () => new Promise<never>(() => {}), url: () => '' } as ApiClient;
}

function renderWith(client: ApiClient): void {
  render(
    <ApiContext.Provider value={client}>
      <Splash />
    </ApiContext.Provider>,
  );
}

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

describe('while the service is starting', () => {
  it('says it is starting rather than showing nothing', () => {
    renderWith(silent());
    expect(screen.getByRole('status').textContent).toContain('Starting the editor');
  });
});

describe('when the service answers', () => {
  it('says who it is, so a bug report can name the build', async () => {
    renderWith(stub(ok(INFO)));

    await waitFor(() => {
      expect(screen.queryByText('Service')).not.toBeNull();
    });
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('/home/user/.nova')).toBeTruthy();
  });
});

describe('when the service is not there', () => {
  it('names the failure instead of hanging on "starting"', async () => {
    renderWith(
      stub(
        err({
          kind: 'transport',
          status: 0,
          code: 'transport/unreachable',
          detail: 'fetch failed',
        }),
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toContain('unreachable');
  });

  it('tells a slow start apart from a dead service', async () => {
    renderWith(
      stub(
        err({
          kind: 'timeout',
          status: 0,
          code: 'transport/timeout',
          detail: 'the service did not answer in time',
        }),
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toContain('still be starting');
  });
});

describe('the context it needs', () => {
  it('refuses to render without a client rather than silently doing nothing', () => {
    expect(() => render(<Splash />)).toThrow(/no ApiClient/);
  });
});

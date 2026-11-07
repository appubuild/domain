// @vitest-environment jsdom
/** The wiring, which is the only logic in this file.
 *
 *  The store and the stream are both tested on their own. What is left to pin is
 *  the part a unit test cannot see: **who connects them, and what happens before
 *  anything arrives**.
 *
 *  * A refresh on mount, because a service that has been up for an hour has no
 *    event to tell us what it is already holding.
 *  * A `project.*` event refreshes; any other topic does not — a store that
 *    reacted to everything would refetch on every frame of a scrub.
 *  * A gap the bus could not repair refreshes too (`onStale`), because the
 *    stream is the only thing that can notice one.
 *  * The subscription is given back on unmount: a provider that leaked it would
 *    keep refreshing a store nobody is looking at.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../core/api/client';
import type { EventEnvelope } from '../core/events/protocol';
import { useStreamHealth } from '../core/events/useEventStream';
import type { ProjectSummary } from '../core/api/contract';
import { ok } from '../core/result';
import { useProjectStore } from '../stores/project';
import type { SocketLike } from '../core/events/bridge';
import { WorkspaceProviders } from './providers';

function summary(id: string): ProjectSummary {
  return {
    project_id: id,
    name: `project ${id}`,
    path: null,
    dirty: false,
    clip_count: 0,
    duration_frames: 0,
    pending_commands: 0,
    commands_until_checkpoint: 200,
    autosave_due: false,
    journal_sequence: 0,
    checkpoint_sequence: 0,
  };
}

/** A client that answers `listProjects` and counts how many times it was asked. */
function client(calls: { listProjects: number }): ApiClient {
  return {
    run: (id: string) => {
      if (id === 'listProjects') {
        calls.listProjects += 1;
        return Promise.resolve(ok({ projects: [summary('a')] }));
      }
      return Promise.resolve(ok(undefined));
    },
    url: () => '',
  } as unknown as ApiClient;
}

/** A socket double whose handlers the test can fire. */
class FakeSocket implements SocketLike {
  static last: FakeSocket | undefined;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(): void {}
  close(): void {}

  say(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
}

function socketFactory(url: string): SocketLike {
  return new FakeSocket(url);
}

function event(topic: string, seq: number): EventEnvelope {
  return { type: 'event', topic, seq, ts: 1_700_000_000_000 + seq };
}

/** A child that reads both contexts, so a missing provider fails loudly, and
 *  that shows the socket's health the way a status line will: by watching it
 *  rather than by being handed the stream. */
function Probe(): React.JSX.Element {
  const projects = useProjectStore((state) => state.projects);
  const health = useStreamHealth();
  return (
    <div>
      <span data-testid="count">{projects.length}</span>
      <span data-testid="status">{health.status}</span>
    </div>
  );
}

function renderTree(calls: { listProjects: number }): void {
  render(
    <WorkspaceProviders client={client(calls)} socketFactory={socketFactory}>
      <Probe />
    </WorkspaceProviders>,
  );
}

describe('WorkspaceProviders', () => {
  it('asks once on mount, before any event arrives', async () => {
    const calls = { listProjects: 0 };
    renderTree(calls);

    await waitFor(() => {
      expect(screen.getByTestId('count').textContent).toBe('1');
    });
    expect(calls.listProjects).toBe(1);
  });

  it('opens the socket, so the tree below it has one to ask for', async () => {
    const calls = { listProjects: 0 };
    renderTree(calls);

    await waitFor(() => {
      expect(FakeSocket.last).toBeDefined();
    });
    FakeSocket.last?.say({ type: 'hello', seq: 0, topics: null, heartbeat_seconds: 15 });
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('live');
    });
  });

  it('a project event asks again, and any other topic does not', async () => {
    const calls = { listProjects: 0 };
    renderTree(calls);
    await waitFor(() => {
      expect(calls.listProjects).toBe(1);
    });

    FakeSocket.last?.say(event('timeline.clip.moved', 1));
    await Promise.resolve();
    expect(calls.listProjects).toBe(1);

    FakeSocket.last?.say(event('project.opened', 2));
    await waitFor(() => {
      expect(calls.listProjects).toBeGreaterThan(1);
    });
  });

  it('a gap the bus could not repair asks again', async () => {
    const calls = { listProjects: 0 };
    renderTree(calls);
    await waitFor(() => {
      expect(calls.listProjects).toBe(1);
    });

    // An event with a hole in front of it, then a replay that admits it cannot
    // reach back: the store has to refetch, and only the stream can say so.
    FakeSocket.last?.say({ type: 'hello', seq: 0, topics: null, heartbeat_seconds: 15 });
    FakeSocket.last?.say(event('project.saved', 1));
    await waitFor(() => {
      expect(calls.listProjects).toBe(2);
    });
    FakeSocket.last?.say(event('project.saved', 9));
    FakeSocket.last?.say({
      type: 'resync',
      since: 1,
      events: [],
      last_seq: 9,
      oldest_seq: 8,
      complete: false,
    });
    await waitFor(() => {
      expect(calls.listProjects).toBe(3);
    });
  });

  it('gives the subscription back on unmount', async () => {
    const calls = { listProjects: 0 };
    const view = renderTreeWithUnmount(calls);
    await waitFor(() => {
      expect(calls.listProjects).toBe(1);
    });

    FakeSocket.last?.say(event('project.opened', 1));
    await waitFor(() => {
      expect(calls.listProjects).toBe(2);
    });

    view.unmount();
    const after = calls.listProjects;
    FakeSocket.last?.say(event('project.opened', 2));
    await Promise.resolve();
    // A provider that leaked its subscription would keep asking after the tree
    // that needed the answer is gone.
    expect(calls.listProjects).toBe(after);
  });
});

function renderTreeWithUnmount(calls: { listProjects: number }) {
  return render(
    <WorkspaceProviders client={client(calls)} socketFactory={socketFactory}>
      <Probe />
    </WorkspaceProviders>,
  );
}

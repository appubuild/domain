/** The bridge, against a socket that is a test double.
 *
 *  What is being pinned is the part a store cannot check for itself: the
 *  sequence arithmetic. A stream that loses an event, duplicates one, or hands
 *  over a history it cannot complete, is a stream whose every downstream bug
 *  looks like a rendering bug — so the gap, the replay and the admission of
 *  failure are all asserted here, where the sequence lives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventStream, matches, type EventStream, type SocketLike } from './bridge';
import type { EventEnvelope } from './protocol';

class FakeSocket implements SocketLike {
  static last: FakeSocket | undefined;

  readonly sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.(new Event('close') as CloseEvent);
  }

  /** What a socket reports, without a real one to report it. */
  opened(): void {
    this.onopen?.(new Event('open'));
  }

  /** What the far end reports when the connection goes. */
  dropped(): void {
    this.onclose?.(new Event('close') as CloseEvent);
  }

  /** What the server would say. */
  say(frame: unknown): void {
    const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.onmessage?.({ data } as MessageEvent);
  }
}

function event(seq: number, topic = 'timeline.clip.moved', payload: unknown = {}): EventEnvelope {
  return { type: 'event', topic, seq, ts: 1_700_000_000_000 + seq, payload } as EventEnvelope;
}

interface Harness {
  stream: EventStream;
  socket: () => FakeSocket;
  stale: string[];
  errors: unknown[];
  health: ReturnType<EventStream['health']>[];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function harness(extra: Partial<Parameters<typeof createEventStream>[0]> = {}): Harness {
  const stale: string[] = [];
  const errors: unknown[] = [];
  const health: ReturnType<EventStream['health']>[] = [];
  const stream = createEventStream({
    socketFactory: (url) => new FakeSocket(url),
    url: 'ws://127.0.0.1/ws',
    onStale: (reason) => stale.push(reason),
    onError: (error) => errors.push(error),
    onHealth: (next) => health.push(next),
    // Injected so the tests use vitest's fake timers: the default is the
    // global, which is what a real run wants.
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (handle) => {
      clearTimeout(handle as unknown as NodeJS.Timeout);
    },
    ...extra,
  });
  return {
    stream,
    socket: () => {
      if (!FakeSocket.last) throw new Error('no socket was opened');
      return FakeSocket.last;
    },
    stale,
    errors,
    health,
  };
}

/** Open a socket and complete the handshake, which is what makes a stream live. */
function connect(h: Harness, seq = 0, heartbeatSeconds = 15): FakeSocket {
  h.stream.open();
  const socket = h.socket();
  socket.opened();
  socket.say({ type: 'hello', seq, topics: null, heartbeat_seconds: heartbeatSeconds });
  return socket;
}

describe('topics', () => {
  it('an exact pattern matches only that topic', () => {
    expect(matches('timeline.clip.moved', 'timeline.clip.moved')).toBe(true);
    expect(matches('timeline.clip.moved', 'timeline.clip.added')).toBe(false);
  });

  it('a prefix pattern matches everything under it', () => {
    expect(matches('timeline.*', 'timeline.clip.moved')).toBe(true);
    expect(matches('timeline.*', 'timeline.track.added')).toBe(true);
    expect(matches('timeline.*', 'timelinex')).toBe(false);
  });

  it('star matches everything', () => {
    expect(matches('*', 'anything.at.all')).toBe(true);
  });
});

describe('the handshake', () => {
  it('a hello is what makes a stream live, not the open event', () => {
    const h = harness();
    h.stream.open();
    expect(h.stream.health().status).toBe('connecting');
    h.socket().opened();
    expect(h.stream.health().status).toBe('connecting');
    h.socket().say({ type: 'hello', seq: 0, topics: null, heartbeat_seconds: 15 });
    expect(h.stream.health().status).toBe('live');
  });

  it('a session that restarted behind us is admitted, not resynced blindly', () => {
    const h = harness();
    const socket = connect(h, 49); // contiguous with what follows
    socket.say(event(50));
    expect(h.stream.health().lastSeq).toBe(50);
    // A new service, a sequence that starts over: there is no hole to replay,
    // because the numbers we hold belong to a session that no longer exists.
    socket.say({ type: 'hello', seq: 3, topics: null, heartbeat_seconds: 15 });
    expect(h.stale.at(-1)).toBe('the service restarted');
    expect(h.stream.health().lastSeq).toBe(3);
  });
});

describe('delivery', () => {
  it('hands an event to every handler whose pattern matches', () => {
    const h = harness();
    const socket = connect(h);
    const all: EventEnvelope[] = [];
    const timeline: EventEnvelope[] = [];
    const other: EventEnvelope[] = [];
    h.stream.subscribe('*', (e) => all.push(e));
    h.stream.subscribe('timeline.*', (e) => timeline.push(e));
    h.stream.subscribe('media.*', (e) => other.push(e));

    socket.say(event(1));
    expect(all).toHaveLength(1);
    expect(timeline).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const h = harness();
    const socket = connect(h);
    const seen: EventEnvelope[] = [];
    const off = h.stream.subscribe('*', (e) => seen.push(e));
    socket.say(event(1));
    off();
    socket.say(event(2));
    expect(seen.map((e) => e.seq)).toEqual([1]);
  });

  it('a handler that throws does not take the socket with it', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', () => {
      throw new Error('a panel had a bad day');
    });
    h.stream.subscribe('*', (e) => seen.push(e.seq));

    socket.say(event(1));
    expect(seen).toEqual([1]);
    expect(h.errors).toHaveLength(1);
    expect(h.stream.health().status).toBe('live');
  });

  it('a frame it does not understand is skipped, not fatal', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say({ type: 'something-from-a-newer-server', seq: 9 });
    socket.say('not json at all');
    socket.say(event(1));
    expect(seen).toEqual([1]);
    expect(h.stream.health().status).toBe('live');
  });
});

describe('sequence gaps', () => {
  it('a gap asks for a replay from the last sequence we applied', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(1));
    socket.say(event(5)); // hole: 2, 3 and 4 are missing
    // Nothing is delivered ahead of the hole, and the hole is requested.
    expect(seen).toEqual([1]);
    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toEqual({ type: 'resync', since: 1 });
  });

  it('a replay fills the hole, and the event that found it goes out last', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(1));
    socket.say(event(5)); // held until 2..4 arrive
    socket.say({
      type: 'resync',
      since: 1,
      events: [event(1), event(2), event(3), event(4)],
      last_seq: 4,
      oldest_seq: 1,
      complete: true,
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(h.stale).toEqual([]);
  });

  it('an event that arrives after the hole is filled goes out immediately', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(1));
    socket.say(event(3)); // held
    socket.say({
      type: 'resync',
      since: 1,
      events: [event(2)],
      last_seq: 2,
      oldest_seq: 1,
      complete: true,
    });
    socket.say(event(4));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('a replay that cannot reach back far enough is admitted, not hidden', () => {
    const h = harness();
    const socket = connect(h);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(1));
    socket.say(event(9)); // held
    socket.say({
      type: 'resync',
      since: 1,
      events: [],
      last_seq: 9,
      oldest_seq: 7,
      complete: false,
    });
    // The admission comes first, and the held event still goes out: a store
    // that refetched would otherwise be handed a stream that stopped talking.
    expect(h.stale.at(-1)).toContain('before 7');
    expect(seen).toEqual([1, 9]);
  });

  it('a replay that never arrives is admitted, and the held events go out', () => {
    const h = harness();
    const socket = connect(h, 0, 1); // a beat every second, so the deadline is 2 s
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(1));
    socket.say(event(3)); // held; the server never answers
    vi.advanceTimersByTime(2500);
    expect(h.stale.at(-1)).toContain('did not answer');
    expect(seen).toEqual([1, 3]);
  });

  it('an out-of-order duplicate never reaches a handler twice', () => {
    const h = harness();
    const socket = connect(h, 2);
    const seen: number[] = [];
    h.stream.subscribe('*', (e) => seen.push(e.seq));
    socket.say(event(3));
    socket.say(event(3));
    expect(seen).toEqual([3]);
    expect(h.stale).toEqual([]);
  });
});

describe('health', () => {
  it('a heartbeat reports what the bus dropped for us', () => {
    const h = harness();
    const socket = connect(h);
    socket.say({ type: 'heartbeat', seq: 12, dropped: 7, at_ms: 1 });
    const health = h.stream.health();
    expect(health.dropped).toBe(7);
    expect(health.lastSeq).toBe(12);
  });

  it('health changes are announced, so a status line can subscribe to one thing', () => {
    const h = harness();
    connect(h);
    expect(h.health.at(-1)?.status).toBe('live');
  });
});

describe('reconnection', () => {
  it('a dropped socket is reopened, and the delay backs off', () => {
    // Jitter is half to all of the ceiling, so the assertions are bounds
    // rather than exact milliseconds: a retry that always fired on the same
    // millisecond is a retry that would synchronise a hundred windows.
    const h = harness({ retryMs: 100, maxRetryMs: 400 });
    const first = connect(h);
    first.close();
    expect(h.stream.health().status).toBe('reconnecting');
    expect(h.stream.health().attempts).toBe(1);

    vi.advanceTimersByTime(40);
    expect(FakeSocket.last).toBe(first); // the first retry waits at least 50 ms
    vi.advanceTimersByTime(70); // 110 ms in: the first window has closed
    expect(FakeSocket.last).not.toBe(first);

    const second = FakeSocket.last;
    second?.close();
    expect(h.stream.health().attempts).toBe(2); // the second ceiling is 200 ms
    vi.advanceTimersByTime(90);
    expect(FakeSocket.last).toBe(second);
    vi.advanceTimersByTime(120); // 210 ms in
    expect(FakeSocket.last).not.toBe(second);
  });

  it('a hello clears the attempt count, so a hiccup is not held against us', () => {
    const h = harness({ retryMs: 10 });
    const first = connect(h);
    first.close();
    expect(h.stream.health().attempts).toBe(1);
    vi.advanceTimersByTime(20);
    connect(h);
    expect(h.stream.health().attempts).toBe(0);
  });

  it('silence longer than the tolerated silence reopens the socket', () => {
    // Fake timers move the clock with them, so `now()` and the watchdog agree.
    const h = harness();
    const first = connect(h, 0, 1); // the server promised a beat every second
    vi.advanceTimersByTime(3000);
    expect(FakeSocket.last).toBe(first); // three beats of silence are allowed
    vi.advanceTimersByTime(1000);
    expect(h.stream.health().status).toBe('reconnecting');
  });

  it('a goodbye closes our side, because nothing else will', () => {
    const h = harness();
    const socket = connect(h);
    socket.say({ type: 'goodbye', seq: 4 });
    expect(socket.closed).toBe(true);
  });
});

describe('closing', () => {
  it('says unsubscribe and stays closed', () => {
    const h = harness();
    const socket = connect(h);
    h.stream.close();
    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toEqual({ type: 'unsubscribe' });
    expect(socket.closed).toBe(true);
    expect(h.stream.health().status).toBe('idle');
  });

  it('a socket that drops after we closed is not reopened', () => {
    const h = harness({ retryMs: 10 });
    connect(h);
    h.stream.close();
    h.socket().dropped();
    vi.advanceTimersByTime(1000);
    expect(h.stream.health().status).toBe('idle');
  });

  it('open is idempotent while live', () => {
    const h = harness();
    const socket = connect(h);
    h.stream.open();
    expect(h.socket()).toBe(socket);
  });
});

/** The socket's wire format (`api.md` §6, `nova_studio/api/ws.py`).
 *
 *  This is the one file in `src/` that is hand-written against the backend
 *  rather than generated from the OpenAPI document, because a WebSocket has no
 *  place in an OpenAPI document to be generated from. That makes it the one
 *  file that can silently drift, so two things hold it in place:
 *
 *  * `WS_PROTOCOL_VERSION` is asserted equal to `nova_studio.WS_PROTOCOL_VERSION`
 *    by a Python test (`tests/api/test_ws_protocol_mirror.py`) — the same
 *    trick the generated contract uses, applied to the one file it cannot reach.
 *  * **A frame we do not recognise is skipped, never fatal.** `parseFrame`
 *    returns `null` for anything it does not understand instead of throwing:
 *    a server one version ahead sends frames this client has never heard of,
 *    and a socket that closed because of an unknown frame is a bug the user
 *    pays for. This is the rule the backend keeps for its own incoming frames,
 *    and it is the only rule that lets the two ends version independently.
 *
 *  Frames are a closed set the client switches on, which is why `type` is a
 *  string literal union and not an enum: it has to read the same in both
 *  languages.
 */

/** Bumped when the frame set or its meaning changes. Mirrors
 *  `nova_studio.WS_PROTOCOL_VERSION`, and asserted against it from Python. */
export const WS_PROTOCOL_VERSION = 1;

/** What the server may send. */
export type FrameKind = 'hello' | 'event' | 'heartbeat' | 'pong' | 'resync' | 'goodbye';

/** The envelope every event carries, and the shape `GET /api/v1/events`
 *  returns — the two are the same on purpose, so one parser handles both. */
export interface EventEnvelope {
  readonly type: 'event';
  readonly topic: string;
  readonly seq: number;
  readonly ts: number;
  readonly payload?: Record<string, unknown> | null;
  readonly source?: string | null;
  readonly command_id?: string | null;
}

export interface HelloFrame {
  readonly type: 'hello';
  readonly seq: number;
  /** Topics this socket carries; `null` means every topic. */
  readonly topics: readonly string[] | null;
  readonly heartbeat_seconds: number;
}

export interface HeartbeatFrame {
  readonly type: 'heartbeat';
  readonly seq: number;
  /** Events the bus dropped for *this* stream because we fell behind. */
  readonly dropped: number;
  readonly at_ms: number;
}

export interface PongFrame {
  readonly type: 'pong';
  readonly seq: number;
}

export interface GoodbyeFrame {
  readonly type: 'goodbye';
  readonly seq: number;
}

/** The answer to a `resync`, and the only frame that admits a limit.
 *
 *  `complete: false` means history could not reach back far enough: the
 *  honest answer, and the signal to refetch over REST. A partial replay
 *  dressed up as complete is a UI showing a state that never existed.
 */
export interface ResyncFrame {
  readonly type: 'resync';
  readonly since: number;
  readonly events: readonly EventEnvelope[];
  readonly last_seq: number;
  readonly oldest_seq: number | null;
  readonly complete: boolean;
}

export type ServerFrame =
  | HelloFrame
  | EventFrameOf<Record<string, unknown>>
  | HeartbeatFrame
  | PongFrame
  | GoodbyeFrame
  | ResyncFrame;

/** An event frame, typed by its payload when the caller knows it. */
export type EventFrameOf<T> = Omit<EventEnvelope, 'payload'> & { readonly payload?: T | null };

/** What the client may send. The server ignores anything else. */
export type ClientFrame =
  | { readonly type: 'ping' }
  | { readonly type: 'resync'; readonly since: number }
  | { readonly type: 'unsubscribe' };

/** Read one text frame, or `null` when it is not one we understand.
 *
 *  Never throws: a JSON error here is a malformed frame, and a malformed frame
 *  is one frame, not a reason to close the socket.
 */
export function parseFrame(text: string): ServerFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const frame = value as { type?: unknown; seq?: unknown };
  if (typeof frame.type !== 'string') return null;

  switch (frame.type) {
    case 'hello': {
      const hello = value as Partial<HelloFrame> & { seq?: unknown };
      return {
        type: 'hello',
        seq: numberOr(hello.seq, 0),
        topics: Array.isArray(hello.topics) ? hello.topics.map(String) : null,
        // A non-positive interval is a server that cannot heartbeat, and a
        // fallback beats a watchdog armed for zero milliseconds.
        heartbeat_seconds:
          typeof hello.heartbeat_seconds === 'number' && hello.heartbeat_seconds > 0
            ? hello.heartbeat_seconds
            : 15,
      };
    }
    case 'event':
      return parseEvent(value);
    case 'heartbeat': {
      const beat = value as Partial<HeartbeatFrame> & { seq?: unknown };
      return {
        type: 'heartbeat',
        seq: numberOr(beat.seq, 0),
        dropped: numberOr(beat.dropped, 0),
        at_ms: numberOr(beat.at_ms, 0),
      };
    }
    case 'pong':
    case 'goodbye':
      return { type: frame.type, seq: numberOr(frame.seq, 0) };
    case 'resync': {
      const resync = value as Partial<ResyncFrame>;
      return {
        type: 'resync',
        since: numberOr(resync.since, 0),
        // Each member is an event frame, not a text frame: they arrive already
        // parsed, and re-serialising one to parse it back is how a replay
        // quietly arrives empty.
        events: Array.isArray(resync.events)
          ? resync.events.map(parseEvent).filter((item): item is EventEnvelope => item !== null)
          : [],
        last_seq: numberOr(resync.last_seq, 0),
        oldest_seq: typeof resync.oldest_seq === 'number' ? resync.oldest_seq : null,
        complete: resync.complete === true,
      };
    }
    default:
      // A frame from a newer server. Skip it and keep the socket: this is the
      // whole reason the protocol is versioned rather than negotiated.
      return null;
  }
}

/** One client frame, as the text the socket wants. */
export function encodeFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/** Read one event envelope from an already-parsed value.
 *
 *  Separate from :func:`parseFrame` because a replay arrives carrying event
 *  frames as *objects*, and the only way to read one is not to stringify it
 *  first.
 */
export function parseEvent(value: unknown): EventEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Partial<EventEnvelope> & {
    type?: unknown;
    topic?: unknown;
    seq?: unknown;
  };
  // `type` is required even here: a replay member that is not an event frame is
  // not an event, whatever else it happens to carry.
  if (event.type !== 'event' || typeof event.topic !== 'string') return null;
  return {
    type: 'event',
    topic: event.topic,
    seq: numberOr(event.seq, 0),
    ts: numberOr(event.ts, 0),
    ...(event.payload === undefined || event.payload === null ? {} : { payload: event.payload }),
    ...(typeof event.source === 'string' ? { source: event.source } : {}),
    ...(typeof event.command_id === 'string' ? { command_id: event.command_id } : {}),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

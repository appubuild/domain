/** The wire parser.
 *
 *  The property under test is the one the protocol depends on: **an
 *  unrecognisable frame is skipped, not fatal**. A server one version ahead
 *  sends frames this client has never heard of, and closing the socket over one
 *  is a bug the user pays for — so every shape of nonsense below has to come
 *  back as `null` rather than as an exception.
 */

import { describe, expect, it } from 'vitest';

import { encodeFrame, parseEvent, parseFrame, WS_PROTOCOL_VERSION } from './protocol';

describe('the version', () => {
  it('is mirrored by a Python test rather than trusted', () => {
    // `tests/api/test_ws_protocol_mirror.py` asserts this equals
    // `nova_studio.WS_PROTOCOL_VERSION` — the one file the generator cannot
    // reach is held by hand.
    expect(WS_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('frames it understands', () => {
  it('a hello carries the topics and the heartbeat interval', () => {
    const frame = parseFrame('{"type":"hello","seq":7,"topics":["a.b"],"heartbeat_seconds":30}');
    expect(frame).toEqual({ type: 'hello', seq: 7, topics: ['a.b'], heartbeat_seconds: 30 });
  });

  it('a hello with no topics means every topic, not none', () => {
    const frame = parseFrame('{"type":"hello","seq":0,"topics":null,"heartbeat_seconds":15}');
    expect(frame).toMatchObject({ topics: null });
  });

  it('an event carries its envelope, and its command when it has one', () => {
    const frame = parseFrame(
      '{"type":"event","topic":"timeline.clip.moved","seq":3,"ts":1700000000000,"payload":{"a":1},"source":"timeline","command_id":"c1"}',
    );
    expect(frame).toEqual({
      type: 'event',
      topic: 'timeline.clip.moved',
      seq: 3,
      ts: 1_700_000_000_000,
      payload: { a: 1 },
      source: 'timeline',
      command_id: 'c1',
    });
  });

  it('an event with no payload omits it rather than sending a null', () => {
    expect(parseFrame('{"type":"event","topic":"a.b","seq":1,"ts":2}')).toEqual({
      type: 'event',
      topic: 'a.b',
      seq: 1,
      ts: 2,
    });
  });

  it('a heartbeat carries how many events the bus dropped for us', () => {
    expect(parseFrame('{"type":"heartbeat","seq":9,"dropped":4,"at_ms":1700000000000}')).toEqual({
      type: 'heartbeat',
      seq: 9,
      dropped: 4,
      at_ms: 1_700_000_000_000,
    });
  });

  it('a pong and a goodbye are just a sequence', () => {
    expect(parseFrame('{"type":"pong","seq":2}')).toEqual({ type: 'pong', seq: 2 });
    expect(parseFrame('{"type":"goodbye","seq":2}')).toEqual({ type: 'goodbye', seq: 2 });
  });

  it('a resync carries its events already parsed, and admits when it cannot', () => {
    const frame = parseFrame(
      '{"type":"resync","since":4,"events":[{"type":"event","topic":"a.b","seq":5,"ts":1}],"last_seq":5,"oldest_seq":5,"complete":false}',
    );
    expect(frame).toEqual({
      type: 'resync',
      since: 4,
      events: [{ type: 'event', topic: 'a.b', seq: 5, ts: 1 }],
      last_seq: 5,
      oldest_seq: 5,
      complete: false,
    });
  });

  it('a resync with no events is an empty replay, not a null one', () => {
    const frame = parseFrame('{"type":"resync","since":0,"events":null,"last_seq":0}');
    expect(frame).toMatchObject({ events: [], complete: false });
  });
});

describe('frames it does not', () => {
  it.each([
    ['a frame from a newer server', '{"type":"something.else","seq":1}'],
    ['no type at all', '{"seq":1}'],
    ['not an object', '[1,2,3]'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['malformed json', '{not json'],
    ['an event with no topic', '{"type":"event","seq":1,"ts":1}'],
    ['an empty frame', ''],
  ])('%s comes back as nothing rather than throwing', (_label, text) => {
    expect(parseFrame(text)).toBeNull();
  });

  it('a replay member that is not an event is dropped, not fatal', () => {
    const frame = parseFrame('{"type":"resync","since":0,"events":[1,"two",null],"last_seq":0}');
    expect(frame).toMatchObject({ events: [] });
  });
});

describe('defaults', () => {
  it('a missing number is a zero, not a NaN nobody checks for', () => {
    const frame = parseFrame('{"type":"heartbeat"}');
    expect(frame).toEqual({ type: 'heartbeat', seq: 0, dropped: 0, at_ms: 0 });
  });

  it('a heartbeat interval that makes no sense falls back to the default', () => {
    expect(
      parseFrame('{"type":"hello","seq":0,"topics":null,"heartbeat_seconds":0}'),
    ).toMatchObject({ heartbeat_seconds: 15 });
  });
});

describe('what we send', () => {
  it('a ping is a frame the server understands', () => {
    expect(encodeFrame({ type: 'ping' })).toBe('{"type":"ping"}');
  });

  it('a resync names the sequence we last applied', () => {
    expect(encodeFrame({ type: 'resync', since: 41 })).toBe('{"type":"resync","since":41}');
  });

  it('an unsubscribe is how we say goodbye first', () => {
    expect(encodeFrame({ type: 'unsubscribe' })).toBe('{"type":"unsubscribe"}');
  });
});

describe('parseEvent', () => {
  it('reads an envelope out of an object that was never a text frame', () => {
    expect(parseEvent({ type: 'event', topic: 'a.b', seq: 4, ts: 5 })).toEqual({
      type: 'event',
      topic: 'a.b',
      seq: 4,
      ts: 5,
    });
  });

  it('refuses anything that is not an envelope', () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent({ topic: 'a.b' })).toBeNull(); // no type: not a frame
    expect(parseEvent({ type: 'heartbeat', topic: 'a.b' })).toBeNull(); // not an event
    expect(parseEvent({ type: 'event' })).toBeNull(); // no topic
  });
});

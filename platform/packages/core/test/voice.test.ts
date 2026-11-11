import { describe, expect, it, vi } from 'vitest';
import { VoiceSession } from '../src/voice/session.js';

describe('voice session turn taking', () => {
  it('walks connecting → listening → user-speaking → thinking → assistant-speaking → listening', () => {
    const phases: string[] = [];
    const v = new VoiceSession('gemini-live', { onPhase: (p) => phases.push(p) });
    v.connect();
    v.connected();
    v.micLevel(true);
    v.userTranscript('what is the weather', true);
    v.assistantTranscriptDelta('Let me check.');
    v.assistantAudioStart();
    v.assistantAudioEnd();
    expect(phases).toEqual(['connecting', 'listening', 'user-speaking', 'thinking', 'assistant-speaking', 'listening']);
    expect(v.transcript.some((l) => l.role === 'assistant' && l.final)).toBe(true);
  });

  it('supports barge-in interruption during assistant speech', () => {
    const onInterruptPlayback = vi.fn();
    const v = new VoiceSession('openai-realtime', { onInterruptPlayback });
    v.connected();
    v.assistantTranscriptDelta('This is a long answer');
    // Adapter opens the speech phase on audio start; barge-in is tracked during it.
    v.beginAssistantSpeech();
    v.micLevel(true);
    expect(v.phase).toBe('interrupted');
    expect(onInterruptPlayback).toHaveBeenCalledTimes(1);
    const last = v.transcript[v.transcript.length - 1];
    expect(last?.text).toMatch(/\[interrupted\]/);
    expect(last?.final).toBe(true);
  });

  it('does not pretend a disconnected provider is connected', () => {
    const onError = vi.fn();
    const v = new VoiceSession('none', { onError });
    v.connect();
    v.connected();
    expect(v.phase).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/No voice provider is configured/));
  });

  it('distinguishes connection loss from a clean end', () => {
    const onError = vi.fn();
    const v = new VoiceSession('gemini-live', { onError });
    v.connected();
    v.connectionLost('socket closed (1006)');
    expect(v.phase).toBe('error');
    expect(onError.mock.calls[0]?.[0]).toMatch(/reconnect/);
    v.close();
    expect(v.phase).toBe('closed');
  });

  it('merges partial user transcripts into one line', () => {
    const v = new VoiceSession('gemini-live');
    v.connected();
    v.micLevel(true);
    v.userTranscript('hel', false);
    v.userTranscript('hello', false);
    v.userTranscript('hello world', true);
    const userLines = v.transcript.filter((l) => l.role === 'user');
    expect(userLines).toHaveLength(2);
    expect(userLines[1]?.text).toBe('hello world');
    expect(userLines[1]?.final).toBe(true);
  });
});

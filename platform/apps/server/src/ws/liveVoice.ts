import type WebSocket from 'ws';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { GoogleLiveBridge } from '../services/voice.js';
import { redactSecrets } from '@aura/core';

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), characterId: z.string(), provider: z.enum(['gemini-live']).default('gemini-live') }),
  z.object({ type: z.literal('audio'), data: z.string().max(200_000) }),
  z.object({ type: z.literal('activity-start') }),
  z.object({ type: z.literal('activity-end') }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('ping') }),
]);

/**
 * Browser ⇄ server ⇄ Gemini Live WebSocket bridge. The API key never leaves the server.
 * Protocol (JSON over ws):
 *   client → {type:'start'|'audio'|'activity-start'|'activity-end'|'stop'}
 *   server → {type:'ready'|'phase'|'transcript'|'audio'|'interrupt'|'error'|'closed'}
 */
export function attachLiveVoice(ctx: AppContext, ws: WebSocket, url: URL): void {
  let bridge: GoogleLiveBridge | null = null;
  let closed = false;

  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  send({ type: 'hello', note: 'Send {type:"start", characterId} to begin a live voice session.' });

  ws.on('message', async (raw) => {
    let parsed: z.infer<typeof clientMessage>;
    try {
      parsed = clientMessage.parse(JSON.parse(raw.toString()));
    } catch (err) {
      send({ type: 'error', message: `Invalid message: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (parsed.type === 'ping') {
      send({ type: 'pong', at: Date.now() });
      return;
    }
    if (parsed.type === 'start') {
      if (bridge) {
        send({ type: 'error', message: 'A live session is already running on this socket.' });
        return;
      }
      const character = ctx.db.characters.get(parsed.characterId);
      if (!character) {
        send({ type: 'error', message: 'Character not found.' });
        return;
      }
      const key = await ctx.getApiKey('google');
      if (!key) {
        send({
          type: 'error',
          code: 'not_configured',
          message: 'Gemini Live requires a Google AI Studio key (Settings → AI Providers). Text-to-speech via OpenAI or browser speech is still available.',
        });
        return;
      }
      bridge = new GoogleLiveBridge(key, process.env.AURA_GEMINI_LIVE_MODEL ?? 'models/gemini-2.0-flash-live-001', character.config.personality.systemPrompt);
      bridge.on('phase', (e) => send({ type: 'phase', ...(e as object) }));
      bridge.on('transcript', (line) => send({ type: 'transcript', line }));
      bridge.on('audio', (e) => send({ type: 'audio', ...(e as object) }));
      bridge.on('interrupt', () => send({ type: 'interrupt' }));
      bridge.on('error', (e) => send({ type: 'error', ...(e as object) }));
      bridge.on('closed', (e) => {
        send({ type: 'closed', ...(e as object) });
        bridge = null;
      });
      try {
        await bridge.connect();
        ctx.db.audit.log({ actor: `character:${character.id}`, action: 'voice.live.start', outcome: 'success', detail: { model: process.env.AURA_GEMINI_LIVE_MODEL ?? 'default' } });
        send({ type: 'ready', provider: 'gemini-live', characterId: character.id, emotionBaseline: character.config.personality.communicationStyle });
      } catch (err) {
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        send({ type: 'error', code: 'connect_failed', message: `Could not open Gemini Live session: ${message}` });
        bridge?.close();
        bridge = null;
      }
      return;
    }
    if (!bridge) {
      send({ type: 'error', message: 'No live session. Send start first.' });
      return;
    }
    if (parsed.type === 'audio') bridge.sendAudio(parsed.data);
    else if (parsed.type === 'activity-start') bridge.notifyActivity();
    else if (parsed.type === 'activity-end') bridge.endTurn();
    else if (parsed.type === 'stop') {
      bridge.close();
      bridge = null;
      send({ type: 'closed', code: 1000 });
    }
  });

  ws.on('close', () => {
    closed = true;
    if (!closed) return;
    bridge?.close();
    bridge = null;
  });

  void url;
}

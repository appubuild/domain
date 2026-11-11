import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { textToVisemeFrames } from '@aura/core';
import type { AppContext } from '../context.js';
import { HttpError, json, parseBody, readJson } from '../http.js';

export async function handleVoice(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/voice/voices' && method === 'GET') {
    const list = await ctx.voice.voices();
    json(res, 200, {
      ...list,
      geminiLive: Boolean(await ctx.getApiKey('google')),
      openaiRealtime: Boolean(await ctx.getApiKey('openai')),
      tip: 'Browser speech synthesis works without any key; provider voices sound better and support live streaming.',
    });
    return true;
  }

  if (pathname === '/api/voice/tts' && method === 'POST') {
    const body = parseBody(
      z.object({
        text: z.string().min(1).max(4000),
        voice: z.string().max(60).default('alloy'),
        speed: z.number().min(0.5).max(2).default(1),
        format: z.enum(['mp3', 'opus', 'wav']).default('mp3'),
        withVisemes: z.boolean().default(true),
      }),
      await readJson(req),
    );
    const result = await ctx.voice.synthesize({ text: body.text, voice: body.voice ?? 'alloy', speed: body.speed ?? 1, format: body.format ?? 'mp3' });
    if ('error' in result && result.error) {
      throw new HttpError(result.kind === 'not_configured' ? 501 : 502, result.error);
    }
    const audio = (result as { audio: Buffer }).audio;
    const headers: Record<string, string> = {
      'content-type': (result as { mime: string }).mime,
      'content-length': String(audio.length),
      'cache-control': 'no-store',
      'x-tts-provider': 'openai',
      'x-lipsync-mode': body.withVisemes ? 'phoneme-estimate' : 'amplitude',
    };
    if (body.withVisemes) {
      const frames = textToVisemeFrames(body.text, 13.5 * (body.speed ?? 1));
      headers['x-visemes'] = Buffer.from(JSON.stringify(frames.slice(0, 900))).toString('base64');
    }
    res.writeHead(200, headers);
    res.end(audio);
    return true;
  }

  if (pathname === '/api/voice/visemes' && method === 'POST') {
    const body = parseBody(z.object({ text: z.string().min(1).max(4000), charsPerSecond: z.number().min(5).max(30).default(13.5) }), await readJson(req));
    json(res, 200, { mode: 'phoneme-estimate', frames: textToVisemeFrames(body.text, body.charsPerSecond) });
    return true;
  }

  return false;
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppContext } from './context.js';
import { HttpError, json, matchRoute, readJson } from './http.js';
import { handleSystem } from './routes/system.js';
import { handleCharacters } from './routes/characters.js';
import { handleChat } from './routes/chat.js';
import { handleMemory } from './routes/memory.js';
import { handleTasks } from './routes/tasks.js';
import { handleSkills } from './routes/skills.js';
import { handleProviders } from './routes/providers.js';
import { handleLicensing } from './routes/licensing.js';
import { handleDocuments } from './routes/documents.js';
import { handleIntegrations } from './routes/integrations.js';
import { handleVoice } from './routes/voice.js';
import { attachLiveVoice } from './ws/liveVoice.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export type AppServer = {
  server: Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
};

/**
 * The app server serves the REST API, SSE chat, WebSocket live-voice bridge and (when
 * built) the static SPA. Security posture: bind configurable, no directory traversal,
 * strict content types, JSON error envelope, per-route validation.
 */
export function createApp(ctx: AppContext, opts: { staticDir?: string } = {}): AppServer {
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/ws/live-voice') {
      wss.handleUpgrade(req, socket, head, (ws) => attachLiveVoice(ctx, ws, url));
    } else if (url.pathname === '/ws/events') {
      wss.handleUpgrade(req, socket, head, (ws) => attachEvents(ctx, ws));
    } else {
      socket.destroy();
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    try {
      if (url.pathname.startsWith('/api/')) {
        if (method === 'OPTIONS') {
          res.writeHead(204, corsHeaders(req));
          res.end();
          return;
        }
        const handlers = [
          () => handleSystem(ctx, req, res, url.pathname, method),
          () => handleCharacters(ctx, req, res, url.pathname, method),
          () => handleChat(ctx, req, res, url.pathname, method),
          () => handleMemory(ctx, req, res, url.pathname, method),
          () => handleTasks(ctx, req, res, url.pathname, method),
          () => handleSkills(ctx, req, res, url.pathname, method),
          () => handleProviders(ctx, req, res, url.pathname, method),
          () => handleLicensing(ctx, req, res, url.pathname, method),
          () => handleDocuments(ctx, req, res, url.pathname, method),
          () => handleIntegrations(ctx, req, res, url.pathname, method),
          () => handleVoice(ctx, req, res, url.pathname, method),
        ];
        for (const run of handlers) {
          if (await run()) return;
        }
        json(res, 404, { error: `No route for ${method} ${url.pathname}` });
        return;
      }
      serveStatic(url.pathname, res, opts.staticDir);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) json(res, status, { error: message, ...(err instanceof HttpError && err.detail ? { issues: err.detail } : {}) });
      else res.end();
      if (status >= 500) {
        ctx.db.audit.log({ actor: 'system', action: `http.${method}`, target: url.pathname, outcome: 'failure', detail: { message: message.slice(0, 300) } });
      }
    } finally {
      const ms = Date.now() - started;
      if (ms > 3000) ctx.events.emit('slow.request', { path: url.pathname, ms });
    }
  }

  function serveStatic(pathname: string, res: ServerResponse, staticDir?: string): void {
    if (!staticDir || !existsSync(staticDir)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('AURA API is running. Build the web app (npm run build) to serve the UI from this server.');
      return;
    }
    const root = resolve(staticDir);
    const decoded = decodeURIComponent(pathname);
    let file = normalize(join(root, decoded === '/' ? 'index.html' : decoded));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback
      file = join(root, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
    }
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  }

  return {
    server,
    listen() {
      return new Promise((resolveP, reject) => {
        server.once('error', reject);
        server.listen(ctx.config.port, ctx.config.host, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : ctx.config.port;
          resolveP({ port });
        });
      });
    },
    close() {
      return new Promise((resolveP) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolveP());
        server.closeAllConnections?.();
      });
    },
  };
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = String(req.headers.origin ?? '*');
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-file-name,x-character-id',
    'access-control-max-age': '600',
  };
}

/** Broadcasts app events (task updates, logs, emergency stop) to /ws/events clients. */
function attachEvents(ctx: AppContext, ws: WebSocket): void {
  const topics = ['task.updated', 'task.log', 'settings.changed', 'character.updated', 'emergency-stop', 'skill.log', 'skill.event', 'slow.request'];
  const unsubs = topics.map((t) => ctx.events.on(t, (data) => safeSend(ws, { topic: t, data, at: Date.now() })));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string };
      if (msg.type === 'ping') safeSend(ws, { topic: 'pong', data: {}, at: Date.now() });
    } catch {
      /* ignore */
    }
  });
  ws.on('close', () => unsubs.forEach((u) => u()));
  safeSend(ws, { topic: 'hello', data: { schemaVersion: ctx.schemaVersion }, at: Date.now() });
}

export function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export { readJson, matchRoute };

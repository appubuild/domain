import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

export function notFound(res: ServerResponse, what = 'Resource'): void {
  json(res, 404, { error: `${what} not found` });
}

export async function readJson(req: IncomingMessage, limitBytes = 25 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new HttpError(413, 'Request body too large');
    chunks.push(buf);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

export async function readBuffer(req: IncomingMessage, limitBytes = 50 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new HttpError(413, 'File too large (50 MB limit)');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Parses with the schema's *output* type (Zod defaults make some fields optional on input). */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, `Validation failed: ${formatZodError(parsed.error)}`, parsed.error.issues);
  }
  return parsed.data;
}

export function formatZodError(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** Route matcher: `/api/characters/:id` against `/api/characters/chr_123`. */
export function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const pat = p[i]!;
    const seg = s[i]!;
    if (pat.startsWith(':')) params[pat.slice(1)] = decodeURIComponent(seg);
    else if (pat !== seg) return null;
  }
  return params;
}

/** Standard SSE writer. */
export function sseInit(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
}

export function sseSend(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Typed API client. Every call returns parsed JSON or throws `ApiError` with the
 * server's human message — the UI always shows the real reason, never a generic
 * "something went wrong".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: unknown,
    readonly needsConfirmation = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Init = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean };

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const { body, raw, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message = typeof parsed === 'object' && parsed?.error ? String(parsed.error) : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed?.issues, res.status === 428);
  }
  return parsed as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
/** PUT/PATCH helpers for endpoints that use them (kept explicit so the HTTP verb is obvious). */
export const apiSend = <T>(path: string, method: 'PUT' | 'PATCH' | 'POST', body?: unknown) => api<T>(path, { method, body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

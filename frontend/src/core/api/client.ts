/** The typed transport: one function per shape of request, and no throwing.
 *
 * Three decisions, and each is the difference between a client and a liability:
 *
 * * **Types come from the contract, paths come from the contract.** `run()` is
 *   keyed by operation, so a misspelled parameter, a body the route does not
 *   take, or a response read as the wrong type is a compile error rather than a
 *   422 discovered at runtime. Hand-written path strings are how a frontend
 *   silently drifts from its backend.
 * * **Nothing throws.** A network failure, a timeout, a cancellation and a
 *   `NS-PROJECT-4041` are all `Err(ApiProblem)`. The service never answers with
 *   an exception, so the window has no reason to either — and an exception
 *   raised three components from the request that caused it is unattributable.
 * * **Every request has a deadline.** The desktop shell and the service live in
 *   one process tree, but the service can still be busy; a request without a
 *   deadline is a promise that may never settle, and a promise that never
 *   settles is a panel that never updates.
 *
 * What is deliberately not here: retries (whether a failure is worth retrying
 * is the caller's to know, not the transport's), caching (`api.md` §13), and a
 * request queue (the service throttles by job, not by connection).
 */

import { OPERATIONS } from './contract';
import type { ProblemResponse, Schemas } from './contract';
import { fromProblemResponse, type ApiProblem } from './problem';
import { err, ok, type Result } from '../result';

export type OperationId = keyof typeof OPERATIONS;

type Spec<Id extends OperationId> = (typeof OPERATIONS)[Id];

/** Path parameters, all of them: an endpoint with `{project_id}` will not
 *  compile without one, and a parameter the route does not take is an error. */
export type PathParamsOf<Id extends OperationId> = Record<
  Spec<Id>['pathParams'][number],
  string | number
>;

export type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean>;

/** Query parameters, all optional: a route's defaults are the service's
 *  business, and a client that sent every default would drift from them. */
export type QueryParamsOf<Id extends OperationId> = Partial<
  Record<Spec<Id>['queryParams'][number], QueryValue>
>;

export type BodyOf<Id extends OperationId> = Spec<Id>['requestBody'] extends keyof Schemas
  ? Schemas[Spec<Id>['requestBody']]
  : undefined;

export type ResponseOf<Id extends OperationId> = Spec<Id>['response'] extends keyof Schemas
  ? Schemas[Spec<Id>['response']]
  : Blob;

export interface ApiRequest<Id extends OperationId> {
  readonly params?: PathParamsOf<Id>;
  readonly query?: QueryParamsOf<Id>;
  readonly body?: BodyOf<Id>;
  readonly signal?: AbortSignal;
  /** Override the client's deadline. Zero means "no deadline". */
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiClientOptions {
  /** Where the service is. Empty means same-origin, which is the desktop case. */
  readonly baseUrl?: string;
  /** The session token, or a thunk that reads it — read per request, because a
   *  shell hands the window its token after the window has already booted. */
  readonly token?: string | (() => string | undefined);
  /** The default deadline: long enough for a probe, short enough that a hung
   *  service shows up as a hung service. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiClient {
  /** Call one operation by name. Always resolves; never throws. */
  run<Id extends OperationId>(
    id: Id,
    request?: ApiRequest<Id>,
  ): Promise<Result<ResponseOf<Id>, ApiProblem>>;
  /** The URL one request would ask for — for logs, and for the one or two
   *  places a plain link really is the right shape. */
  url<Id extends OperationId>(id: Id, request?: ApiRequest<Id>): string;
}

export const DEFAULT_TIMEOUT_MS: number = 15_000;

const PLACEHOLDER = /\{([^{}]+)\}/g;

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function token(): string | undefined {
    return typeof options.token === 'function' ? options.token() : options.token;
  }

  function buildUrl<Id extends OperationId>(
    spec: Spec<Id>,
    request: ApiRequest<Id>,
  ): Result<string, ApiProblem> {
    const params = (request.params ?? {}) as Record<string, string | number | undefined>;
    const missing: string[] = [];
    const path = spec.path.replace(PLACEHOLDER, (_match, name: string) => {
      const value = params[name];
      if (value === undefined || value === '') {
        missing.push(name);
        return '';
      }
      return encodeURIComponent(String(value));
    });
    if (missing.length > 0) {
      return err({
        kind: 'contract',
        status: 0,
        code: 'transport/missing-path-param',
        detail: `${spec.method.toUpperCase()} ${spec.path} needs ${missing.join(', ')}`,
      });
    }

    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value === undefined) continue;
      for (const member of Array.isArray(value) ? value : [value]) {
        search.append(name, String(member));
      }
    }
    const query = search.toString();
    return ok(`${baseUrl}${path}${query ? `?${query}` : ''}`);
  }

  async function run<Id extends OperationId>(
    id: Id,
    request: ApiRequest<Id> = {},
  ): Promise<Result<ResponseOf<Id>, ApiProblem>> {
    const spec = OPERATIONS[id] as Spec<Id>;
    const built = buildUrl(spec, request);
    if (!built.ok) return err(built.error);

    const headers = new Headers(options.headers);
    const bearer = token();
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    const hasBody = request.body !== undefined;
    headers.set('Accept', spec.responseFormat === 'blob' ? 'image/*' : 'application/json');
    if (hasBody) headers.set('Content-Type', 'application/json');
    for (const [name, value] of Object.entries(request.headers ?? {})) headers.set(name, value);

    const deadline = combine(request.signal, request.timeoutMs ?? defaultTimeout);
    try {
      const response = await fetchImpl(built.value, {
        method: spec.method.toUpperCase(),
        headers,
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        ...(deadline.signal ? { signal: deadline.signal } : {}),
      });
      return await read<Id>(spec, response);
    } catch (failure) {
      return err(classify(failure, request.signal?.aborted === true, deadline.timedOut()));
    } finally {
      deadline.dispose();
    }
  }

  return {
    run,
    url<Id extends OperationId>(id: Id, request: ApiRequest<Id> = {}): string {
      const built = buildUrl(OPERATIONS[id] as Spec<Id>, request);
      return built.ok ? built.value : '';
    },
  };
}

// -- reading a response ------------------------------------------------------

async function read<Id extends OperationId>(
  spec: Spec<Id>,
  response: Response,
): Promise<Result<ResponseOf<Id>, ApiProblem>> {
  if (!response.ok) {
    return err(
      fromProblemResponse(
        response.status,
        await jsonBody<ProblemResponse>(response),
        `${response.status} ${response.statusText}`,
      ),
    );
  }
  if (spec.responseFormat === 'blob') {
    return ok((await response.blob()) as ResponseOf<Id>);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return ok(undefined as unknown as ResponseOf<Id>);
  }
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await jsonBody<unknown>(response) : null;
  if (body === null) {
    return err({
      kind: 'decode',
      status: response.status,
      code: 'transport/decode',
      detail: `expected ${type.includes('json') ? 'JSON' : 'a document'} from ${spec.path}, got ${type || 'nothing'}`,
    });
  }
  return ok(body as ResponseOf<Id>);
}

/** Parse a JSON body, or `null` when there is nothing parseable to return.
 *
 *  An empty body is `null` rather than a failure: a 204 has nothing to say, and
 *  a half-written body is a `decode` problem for the caller to report with the
 *  status that came with it.
 */
async function jsonBody<T>(response: Response): Promise<T | null> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

// -- cancellation and deadlines ---------------------------------------------

interface Deadline {
  readonly signal: AbortSignal | undefined;
  /** Stop the clock and unhook the caller's signal. */
  readonly dispose: () => void;
  /** Whether *we* aborted it, as opposed to the caller. */
  readonly timedOut: () => boolean;
}

/** The caller's signal and our deadline, as one signal.
 *
 * A request the user cancelled and a request that outlived its deadline are
 * different failures with different remedies, so the deadline gets its own
 * timer and its own flag rather than being conflated with the caller's.
 */
function combine(caller: AbortSignal | undefined, timeoutMs: number): Deadline {
  if (!caller && timeoutMs <= 0) {
    return { signal: undefined, dispose: () => {}, timedOut: () => false };
  }
  const controller = new AbortController();
  let expired = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          expired = true;
          controller.abort(new DOMException('the request outlived its deadline', 'TimeoutError'));
        }, timeoutMs)
      : undefined;
  const onCallerAbort = (): void => {
    controller.abort(caller?.reason);
  };
  if (caller?.aborted) {
    // An already-cancelled caller gets no timer and no request that pretends
    // otherwise: `fetch` rejects on an aborted signal, and relying on that
    // implementation detail in every client is worse than saying it here.
    onCallerAbort();
  }
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
    timedOut: () => expired,
  };
}

function classify(failure: unknown, callerAborted: boolean, timedOut: boolean): ApiProblem {
  const aborted = failure instanceof Error && failure.name === 'AbortError';
  if (callerAborted || (aborted && !timedOut)) {
    return {
      kind: 'aborted',
      status: 0,
      code: 'transport/aborted',
      detail: 'the request was cancelled',
    };
  }
  if (timedOut) {
    return {
      kind: 'timeout',
      status: 0,
      code: 'transport/timeout',
      detail: 'the service did not answer in time',
    };
  }
  return {
    kind: 'transport',
    status: 0,
    code: 'transport/unreachable',
    detail: failure instanceof Error ? failure.message : String(failure),
  };
}

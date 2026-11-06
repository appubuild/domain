/** Every failure the transport can produce, in one shape (`api.md` §5).
 *
 * The backend answers errors as `problem+json`, and every one of them carries a
 * stable `NS-<DOMAIN>-<NNNN>` code — that code is the localisation key, so the
 * window must never lose it. A failure that never reached the service (the
 * laptop slept, the service restarted, the request took too long) has no code
 * from the backend, so it gets one from here: `transport/*`. A UI that renders
 * one kind and logs the other is a UI where the user can tell the difference
 * between "your file is unreadable" and "the editor is not running".
 */

import type { ProblemResponse, ValidationField } from './contract';

/** Where a failure came from, which is what decides who can fix it. */
export type ProblemKind =
  /** Nothing answered: the service is down, or the network said no. */
  | 'transport'
  /** The request was given a deadline and outlived it. */
  | 'timeout'
  /** Somebody called `abort()` — usually a new request superseding this one. */
  | 'aborted'
  /** The service answered, and it was an error. `code` is an `NS-*` code. */
  | 'api'
  /** The service answered 200 with bytes that are not what we asked for. */
  | 'decode'
  /** The caller asked for an endpoint with a path parameter it did not give. */
  | 'contract';

export interface ApiProblem {
  readonly kind: ProblemKind;
  /** HTTP status, or `0` when there was no response at all. */
  readonly status: number;
  /** `NS-<DOMAIN>-<NNNN>` for an API failure, `transport/*` otherwise. */
  readonly code: string;
  /** Developer-facing text, for the log line. Never shown raw to a user. */
  readonly detail: string;
  /** Short human sentence, when the service supplied one. */
  readonly title?: string;
  /** What the user could do about it, when the service knows. */
  readonly remedy?: string;
  /** Path of the request that failed. */
  readonly instance?: string;
  /** Per-field detail for a request that failed validation. */
  readonly fields?: readonly ValidationField[];
}

/** One line for a log or a toast. `code` first: it is the only part that is
 *  guaranteed to mean something to whoever reads it next. */
export function describe(problem: ApiProblem): string {
  const parts = [problem.code];
  if (problem.title) parts.push(problem.title);
  if (problem.detail) parts.push(problem.detail);
  return parts.join(' — ');
}

export function isApiProblem(value: unknown): value is ApiProblem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ApiProblem>;
  return typeof candidate.kind === 'string' && typeof candidate.code === 'string';
}

/** A `problem+json` body as our own shape, keeping everything the service sent.
 *
 * A body that is not a problem document — a proxy's 502, a crash dump — is not
 * thrown away: its status becomes the code, so the log still says what
 * happened even when the service could not say it properly.
 */
export function fromProblemResponse(
  status: number,
  body: ProblemResponse | null,
  fallbackDetail: string,
): ApiProblem {
  if (!body) {
    return {
      kind: 'api',
      status,
      code: `http/${status}`,
      detail: fallbackDetail,
    };
  }
  const problem: {
    kind: ProblemKind;
    status: number;
    code: string;
    detail: string;
    title?: string;
    remedy?: string;
    instance?: string;
    fields?: readonly ValidationField[];
  } = {
    kind: 'api',
    status,
    code: body.code,
    detail: body.detail,
  };
  if (typeof body.title === 'string') problem.title = body.title;
  if (typeof body.remedy === 'string') problem.remedy = body.remedy;
  if (typeof body.instance === 'string') problem.instance = body.instance;
  if (Array.isArray(body.fields)) problem.fields = body.fields;
  return problem;
}

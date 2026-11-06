/** `core/result.ts` — the shape every fallible call answers in.
 *
 * Small, and worth pinning anyway: it is the one type every feature leans on,
 * so a mistake here is a mistake everywhere, and the interesting parts are the
 * ones a caller can get wrong — a `map` that loses the error, or a `match` that
 * forgets a branch (which the types make impossible, and that is the point).
 */

import { describe, expect, it } from 'vitest';
import { andThen, err, isErr, isOk, map, mapErr, match, ok, unwrapOr, type Result } from './result';

/** A result the checker cannot narrow by assignment.
 *
 *  Which is the whole point: a caller holding a `Result` does not know which
 *  one it is, and a test that declared `const good = ok(1)` would let the type
 *  checker prove the branch for it.
 */
function asResult<T>(result: Result<T, string>): Result<T, string> {
  return result;
}

/** The value of a success, or `undefined` — the guard does the narrowing. */
function valueOf(result: Result<number, string>): number | undefined {
  return isOk(result) ? result.value : undefined;
}

/** The error of a failure, or `undefined`. */
function errorOf(result: Result<number, string>): string | undefined {
  return isErr(result) ? result.error : undefined;
}

describe('building one', () => {
  it('an ok carries its value and an err carries its error, and they differ', () => {
    // Read through functions, so the narrowing is the type guard's and not the
    // type checker's control-flow analysis of a literal two lines above.
    const good = asResult<number>(ok(42));
    const bad = asResult<number>(err('nope'));

    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(valueOf(good)).toBe(42);

    expect(isOk(bad)).toBe(false);
    expect(errorOf(bad)).toBe('nope');
  });

  it('ok with no value is the void success', () => {
    const done: Result<void, string> = asResult(ok());
    expect(isOk(done)).toBe(true);
    expect(isOk(done) ? done.value : 'not void').toBeUndefined();
  });
});

describe('composing', () => {
  it('map touches a success and nothing else', () => {
    const good = asResult<number>(ok(2));
    const bad = asResult<number>(err('boom'));

    expect(map(good, (n) => n * 2)).toEqual(ok(4));
    expect(map(bad, (n) => n)).toEqual(err('boom'));
  });

  it('mapErr touches a failure and nothing else', () => {
    expect(mapErr(err('boom'), (message) => message.toUpperCase())).toEqual(err('BOOM'));
    expect(mapErr(ok(1), (message: string) => message)).toEqual(ok(1));
  });

  it('andThen chains a step that can fail, and stops at the first failure', () => {
    const halve = (n: number) => (n % 2 === 0 ? ok(n / 2) : err(`${n} is odd`));
    const failed: string[] = [];

    expect(andThen(ok(8), halve)).toEqual(ok(4));
    expect(andThen(andThen(ok(8), halve), halve)).toEqual(ok(2));

    const stopped = andThen(err('first'), (n: number) => {
      failed.push(`ran with ${n}`);
      return ok(n);
    });
    expect(stopped).toEqual(err('first'));
    expect(failed).toEqual([]);
  });
});

describe('reading one', () => {
  it('unwrapOr never throws and never invents a value', () => {
    const good = asResult<number>(ok(1));
    const bad = asResult<number>(err('boom'));
    expect(unwrapOr(good, 0)).toBe(1);
    expect(unwrapOr(bad, 0)).toBe(0);
  });

  it('match answers both branches, so a caller cannot forget one', () => {
    const describe = (result: Result<number, string>) =>
      match(result, { ok: (n) => `got ${n}`, err: (message) => `failed: ${message}` });

    const good = asResult<number>(ok(3));
    const bad = asResult<number>(err('nope'));
    expect(describe(good)).toBe('got 3');
    expect(describe(bad)).toBe('failed: nope');
  });
});

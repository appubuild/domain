import type { SkillResult } from '../skills/types.js';

/**
 * Verification layer. A step is only marked verified when there is evidence:
 *  - skill returned evidence.verified = true, or
 *  - output matches the declarative assertion (all args produced/consumed), or
 *  - an explicit manual check is required (reported as unverified, never as success).
 */
export type VerificationOutcome = { verified: boolean; detail: string };

export function verifyStepOutput(input: {
  result: SkillResult;
  verify: { kind: 'assertion' | 'manual' | 'none'; expression?: string; description?: string };
}): VerificationOutcome {
  const { result, verify } = input;
  if (!result.ok) return { verified: false, detail: `Skill reported failure: ${result.summary}` };
  if (result.evidence) {
    return { verified: result.evidence.verified, detail: result.evidence.detail };
  }
  switch (verify.kind) {
    case 'assertion': {
      if (!verify.expression) return { verified: false, detail: 'No assertion expression supplied.' };
      try {
        const ok = evaluateAssertion(verify.expression, result);
        return { verified: ok, detail: ok ? `Assertion passed: ${verify.expression}` : `Assertion failed: ${verify.expression}` };
      } catch (err) {
        return { verified: false, detail: `Assertion could not be evaluated: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    case 'manual':
      return { verified: false, detail: `Needs manual confirmation: ${verify.description ?? 'review the result'}` };
    case 'none':
      return { verified: true, detail: 'No verification required for this step.' };
  }
}

/**
 * Tiny, side-effect-free assertion language over the skill result:
 *   ok                    → result.ok === true
 *   data.count == 3       → deep property equality (numbers, strings, booleans)
 *   data.items.length > 0
 * Anything else throws (never silently "passes").
 */
export function evaluateAssertion(expression: string, result: SkillResult): boolean {
  const expr = expression.trim();
  if (expr === 'ok') return result.ok === true;
  const m = expr.match(/^([a-zA-Z0-9_.]+)\s*(==|===|!=|!==|>=|<=|>|<)\s*(.+)$/);
  if (!m || /^[<>=!]/.test((m[3] ?? '').trim())) throw new Error(`Unsupported assertion syntax: ${expression}`);
  const [, path, op, rawExpected] = m;
  const actual = resolvePath(result as unknown as Record<string, unknown>, path ?? '');
  const expected = parseLiteral(rawExpected ?? '');
  switch (op) {
    case '==':
    case '===':
      return actual === expected;
    case '!=':
    case '!==':
      return actual !== expected;
    case '>':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '<':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '>=':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case '<=':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    default:
      throw new Error(`Unsupported operator ${op}`);
  }
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (key === 'length' && (Array.isArray(cur) || typeof cur === 'string')) return cur.length;
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

function parseLiteral(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (/^true$/.test(t)) return true;
  if (/^false$/.test(t)) return false;
  if (/^null$/.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const quoted = t.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2] ?? '' : t;
}

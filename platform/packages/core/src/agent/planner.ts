import type { PlanStep } from '../db/tasksRepo.js';
import type { SkillManifest } from '../skills/types.js';
import { RISK_BY_PERMISSION } from '../skills/types.js';
import { decomposeGoal } from '../skills/builtin.js';
import { newId } from '../util/ids.js';

export type PlanContext = {
  availableSkills: SkillManifest[];
  characterPermissions: {
    allowComputerControl: boolean;
    allowBrowserAutomation: boolean;
    allowFileSystem: boolean;
    allowNetworkResearch: boolean;
    disabledSkillIds: string[];
  };
};

export type DraftPlan = {
  title: string;
  steps: PlanStep[];
  /** Human-readable warnings, e.g. skills that are disabled or permissions missing. */
  notes: string[];
};

/**
 * Deterministic planner used when no LLM provider is configured (and as the grounding
 * pass for the LLM planner). Produces real, executable steps referencing real skills.
 */
export function planDeterministic(goal: string, ctx: PlanContext): DraftPlan {
  const raw = decomposeGoal(goal, 6);
  const enabled = new Set(ctx.availableSkills.filter((s) => !ctx.characterPermissions.disabledSkillIds.includes(s.id)).map((s) => s.id));
  const notes: string[] = [];
  const steps: PlanStep[] = raw.map((s, i) => {
    const skillId = pickSkillForStep(s.title, goal, ctx, enabled);
    const manifest = ctx.availableSkills.find((m) => m.id === skillId);
    if (!manifest) notes.push(`Step ${i + 1}: no skill matched; it will run as an analysis step.`);
    const risk = manifest ? maxRisk(manifest) : 'low';
    return {
      id: newId('stp', 8),
      title: s.title,
      description: s.detail,
      skillId: manifest ? manifest.id : null,
      args: manifest ? defaultArgsFor(manifest.id, goal) : {},
      risk,
      requiresConfirmation: risk !== 'low',
      verify: manifest?.verification.kind === 'assertion' ? { kind: 'assertion', expression: 'ok', description: manifest.verification.description } : { kind: 'none' as const, description: 'No automated verification.' },
      status: 'pending',
    };
  });
  return { title: titleFor(goal), steps, notes };
}

function titleFor(goal: string): string {
  const trimmed = goal.replace(/\s+/g, ' ').trim();
  return trimmed.length > 70 ? `${trimmed.slice(0, 67)}…` : trimmed;
}

function maxRisk(m: SkillManifest): 'low' | 'medium' | 'high' {
  const order = ['low', 'medium', 'high', 'critical'] as const;
  let best: (typeof order)[number] = 'low';
  for (const p of m.permissions) {
    const r = RISK_BY_PERMISSION[p];
    if (order.indexOf(r) > order.indexOf(best)) best = r;
  }
  return best === 'critical' ? 'high' : best;
}

function pickSkillForStep(stepTitle: string, goal: string, ctx: PlanContext, enabled: Set<string>): string | null {
  const g = goal.toLowerCase();
  const t = stepTitle.toLowerCase();
  const has = (id: string) => enabled.has(id) && ctx.availableSkills.some((m) => m.id === id);
  if (/gather sources|search/.test(t) && has('web.search')) return 'web.search';
  if (/inspect|list file|re-list/.test(t) && has('files.search') && ctx.characterPermissions.allowFileSystem) return 'files.search';
  if (/summar/.test(t) && has('productivity.save_note') && ctx.characterPermissions.allowFileSystem) return 'productivity.save_note';
  if (/understand|clarify/.test(t) && has('agent.plan')) return null;
  if (/research|compare|find|look up|investigate/.test(g) && has('web.search')) return 'web.search';
  if (/time|date|today|now/.test(g) && has('system.time')) return 'system.time';
  if (/calculate|convert|how much|how many/.test(g) && has('math.calculate')) return 'math.calculate';
  return null;
}

function defaultArgsFor(skillId: string, goal: string): Record<string, unknown> {
  switch (skillId) {
    case 'web.search':
      return { query: goal.slice(0, 280), limit: 5 };
    case 'files.search':
      return { query: '*', directory: '.' };
    case 'productivity.save_note':
      return { title: goal.slice(0, 60), content: `Summary for: ${goal}\n\n(pending step results)` };
    case 'math.calculate':
      return { expression: '0' };
    case 'system.time':
      return {};
    default:
      return {};
  }
}

/** Tools exported to the model for native tool calling. */
export function toToolDefinitions(manifests: SkillManifest[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return manifests.map((m) => ({
    name: m.id.replace(/\./g, '__'),
    description: `${m.name}: ${m.description}`,
    parameters: m.inputSchema,
  }));
}

export function fromToolName(name: string): string {
  return name.replace(/__/g, '.');
}

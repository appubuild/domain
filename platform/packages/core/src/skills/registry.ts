import type { SkillDefinition, SkillInfo, SkillManifest } from './types.js';
import { skillManifestSchema } from './types.js';

/** In-memory execution registry. Persistence of enable/config state lives in SkillsRepo. */
export class SkillRegistry {
  private skills = new Map<string, { def: SkillDefinition; origin: SkillInfo['origin'] }>();

  register(def: SkillDefinition, origin: SkillInfo['origin'] = 'builtin'): void {
    const parsed = skillManifestSchema.parse(def.manifest);
    this.skills.set(parsed.id, { def: { ...def, manifest: parsed }, origin });
  }

  get(id: string): SkillDefinition | null {
    return this.skills.get(id)?.def ?? null;
  }

  originOf(id: string): SkillInfo['origin'] | null {
    return this.skills.get(id)?.origin ?? null;
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  list(): SkillInfo[] {
    return [...this.skills.values()]
      .map(({ def, origin }) => ({
        ...def.manifest,
        origin,
        enabled: def.manifest.enabledByDefault,
        config: {},
        canonicalId: def.manifest.id,
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  manifests(): SkillManifest[] {
    return [...this.skills.values()].map((s) => s.def.manifest);
  }

  remove(id: string): void {
    this.skills.delete(id);
  }
}

/**
 * Validates an imported (user-provided) skill. Imported skills are *untrusted*:
 * we check manifest shape, reject shell execution unless explicitly dangerous, and
 * refuse unknown permission strings. Execution still requires user enablement.
 */
export function validateImportedSkill(raw: unknown): { ok: true; manifest: SkillManifest } | { ok: false; errors: string[] } {
  const parsed = skillManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`) };
  }
  const errors: string[] = [];
  if (parsed.data.dangerouslyRequiresShell) errors.push('Imported skills may not request unrestricted shell execution.');
  if (parsed.data.permissions.includes('finance.transact')) errors.push('Imported skills may not request financial transaction permission.');
  return errors.length ? { ok: false, errors } : { ok: true, manifest: parsed.data };
}

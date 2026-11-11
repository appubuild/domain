import type { AuditRepo } from '../db/auditRepo.js';
import { RISK_BY_PERMISSION, type Permission } from '../skills/types.js';

export type Decision = 'allow' | 'ask' | 'deny';
export type PermissionStore = {
  get(permission: Permission): Decision;
  set(permission: Permission, decision: Decision): void;
};

export type PermissionCheck = {
  allowed: boolean;
  needsConfirmation: boolean;
  reason: string;
  requiredPermission?: Permission;
};

/**
 * Permission engine. Three layers, checked in order:
 *  1. emergency stop — everything denied while engaged
 *  2. character permissions (what the character is allowed to do at all)
 *  3. global permission decisions (user's standing grant: allow / ask / deny) by risk tier
 * High/critical risk always needs explicit per-action confirmation unless the user has
 * explicitly granted standing `allow` for that exact permission.
 */
export class PermissionEngine {
  private emergencyStopped = false;
  constructor(
    private readonly store: PermissionStore,
    private readonly audit: AuditRepo | null = null,
  ) {}

  engageEmergencyStop(): void {
    this.emergencyStopped = true;
    this.audit?.log({ actor: 'user', action: 'emergency_stop.engaged', outcome: 'allowed' });
  }

  releaseEmergencyStop(): void {
    this.emergencyStopped = false;
    this.audit?.log({ actor: 'user', action: 'emergency_stop.released', outcome: 'allowed' });
  }

  get isStopped(): boolean {
    return this.emergencyStopped;
  }

  check(input: {
    permission: Permission | null;
    characterPermissions: {
      allowComputerControl: boolean;
      allowBrowserAutomation: boolean;
      allowFileSystem: boolean;
      allowNetworkResearch: boolean;
    };
    /** User already confirmed this exact action in the UI. */
    confirmedByUser?: boolean;
  }): PermissionCheck {
    if (this.emergencyStopped) {
      return { allowed: false, needsConfirmation: false, reason: 'Emergency stop is engaged. Release it before running actions.' };
    }
    const perm = input.permission;
    if (!perm) return { allowed: true, needsConfirmation: false, reason: 'No privileged permission required.' };

    const charGate = charAllows(perm, input.characterPermissions);
    if (!charGate) {
      return {
        allowed: false,
        needsConfirmation: false,
        reason: `This character is not allowed to use "${perm}". Enable it in Character Studio → Permissions.`,
        requiredPermission: perm,
      };
    }

    const risk = RISK_BY_PERMISSION[perm];
    const standing = this.store.get(perm);
    if (standing === 'deny') {
      return { allowed: false, needsConfirmation: false, reason: `Permission "${perm}" is set to Deny in Settings → Permissions.`, requiredPermission: perm };
    }
    const needsConfirm = standing === 'ask' || (risk === 'critical' && !input.confirmedByUser);
    if (needsConfirm && !input.confirmedByUser) {
      return {
        allowed: false,
        needsConfirmation: true,
        reason:
          risk === 'critical'
            ? `"${perm}" is a critical action and always requires explicit confirmation.`
            : `"${perm}" requires your confirmation before it runs.`,
        requiredPermission: perm,
      };
    }
    return { allowed: true, needsConfirmation: false, reason: `Allowed (${risk} risk).`, requiredPermission: perm };
  }

  logDecision(input: { action: string; target?: string; check: PermissionCheck; characterId: string }): void {
    this.audit?.log({
      actor: `character:${input.characterId}`,
      action: input.action,
      target: input.target,
      outcome: input.check.allowed ? 'allowed' : input.check.needsConfirmation ? 'pending' : 'denied',
      detail: { permission: input.check.requiredPermission, reason: input.check.reason },
    });
  }
}

function charAllows(perm: Permission, c: { allowComputerControl: boolean; allowBrowserAutomation: boolean; allowFileSystem: boolean; allowNetworkResearch: boolean }): boolean {
  switch (perm) {
    case 'computer.control':
    case 'computer.input':
    case 'computer.screenshot':
    case 'apps.launch':
      return c.allowComputerControl;
    case 'browser.automation':
      return c.allowBrowserAutomation;
    case 'files.read':
    case 'files.write':
    case 'files.delete':
      return c.allowFileSystem;
    case 'network.access':
      return c.allowNetworkResearch;
    case 'communication.send':
    case 'finance.transact':
    case 'system.settings':
    case 'shell.execute':
    case 'clipboard.read':
    case 'clipboard.write':
      return c.allowComputerControl;
  }
}

/** In-memory store used by tests and by the server default before settings load. */
export class MemoryPermissionStore implements PermissionStore {
  private map = new Map<Permission, Decision>();
  get(p: Permission): Decision {
    return this.map.get(p) ?? 'ask';
  }
  set(p: Permission, d: Decision): void {
    this.map.set(p, d);
  }
  snapshot(): Record<string, Decision> {
    return Object.fromEntries(this.map);
  }
}

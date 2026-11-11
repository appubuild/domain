import { z } from 'zod';

export const FEATURES = [
  'characters.unlimited',
  'avatar.procedural',
  'avatar.vrm',
  'voice.live',
  'voice.tts',
  'agent.tasks',
  'agent.browser',
  'agent.computer_control',
  'memory.long_term',
  'memory.knowledge',
  'skills.custom',
  'mcp.servers',
  'world_monitor',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Features available in local development mode — the full product, unlicensed. */
export const DEV_FEATURES: Feature[] = [...FEATURES];

export const licensePayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('license'),
  plan: z.enum(['lifetime', 'trial']),
  subject: z.string().min(1),
  email: z.string().email().optional(),
  features: z.array(z.string()),
  deviceId: z.string().min(1),
  issuedAt: z.string(),
  /** null = perpetual (lifetime) */
  expiresAt: z.string().nullable(),
  licenseKeyHint: z.string(),
});
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export const subscriptionPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('subscription'),
  plan: z.enum(['cloud-starter', 'cloud-pro', 'cloud-ultra']),
  subject: z.string().min(1),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing']),
  features: z.array(z.string()),
  quotaTokensPerMonth: z.number(),
  periodEnd: z.string(),
  issuedAt: z.string(),
});
export type SubscriptionPayload = z.infer<typeof subscriptionPayloadSchema>;

export type LicenseState = {
  mode: 'development' | 'licensed' | 'unlicensed' | 'grace' | 'expired';
  plan: 'lifetime' | 'trial' | 'none';
  features: Feature[];
  /** Reason shown in UI — always honest about why features are/aren't available. */
  reason: string;
  subject: string | null;
  expiresAt: string | null;
  lastValidatedAt: string | null;
  offlineGraceUntil: string | null;
  deviceId: string;
};

export type SubscriptionState = {
  status: 'none' | 'active' | 'past_due' | 'canceled' | 'trialing' | 'unverified';
  plan: string | null;
  features: string[];
  quotaTokensPerMonth: number;
  periodEnd: string | null;
  reason: string;
  lastValidatedAt: string | null;
};

export type Entitlements = {
  license: LicenseState;
  subscription: SubscriptionState;
};

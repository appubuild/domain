import { z } from 'zod';

export const TEMPLATE_KEYS = [
  'jarvis-holographic',
  'friendly-male',
  'friendly-female',
  'anime-female-a',
  'anime-female-b',
  'coding-expert',
  'professional-assistant',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const CHARACTER_TYPES = ['assistant', 'companion', 'specialist', 'custom'] as const;
export type CharacterType = (typeof CHARACTER_TYPES)[number];

export const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'hi', 'bn', 'ja', 'ko', 'zh', 'ar'] as const;

/* ------------------------------------------------------------------ avatar */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb');

export const avatarSpecSchema = z.object({
  palette: z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    glow: hex,
    skin: hex,
    hair: hex,
    eye: hex,
  }),
  head: z.object({
    shape: z.enum(['crystalline', 'rounded', 'soft', 'angular', 'oval', 'arc']),
    width: z.number().min(0.6).max(1.6),
    height: z.number().min(0.8).max(1.6),
    jawTaper: z.number().min(0).max(1),
    material: z.enum(['wireframe', 'solid', 'toon', 'glass']),
  }),
  hair: z.object({
    style: z.enum(['slick', 'short', 'long-straight', 'twin-tail', 'bob-curly', 'spiky', 'none']),
    volume: z.number().min(0).max(1.5),
    accentStrand: hex.optional(),
  }),
  eyes: z.object({
    shape: z.enum(['round', 'almond', 'sharp', 'glow']),
    scale: z.number().min(0.5).max(1.8),
    emissive: z.number().min(0).max(2),
  }),
  body: z.object({
    style: z.enum(['suit', 'hoodie', 'techsuit', 'dress', 'coat', 'hologram']),
    collar: z.enum(['tie', 'open', 'high', 'none']),
    shoulderWidth: z.number().min(0.7).max(1.4),
  }),
  accessory: z.enum(['headset', 'visor', 'hairpin', 'earpiece', 'glasses', 'none', 'antenna']),
  halo: z.boolean(),
  gridFloor: z.boolean(),
  glowIntensity: z.number().min(0).max(1),
  background: z.enum(['void', 'holo-room', 'gradient']),
});
export type AvatarSpec = z.infer<typeof avatarSpecSchema>;

/* ------------------------------------------------------------- personality */

export const personalitySchema = z.object({
  systemPrompt: z.string().min(1).max(12_000),
  traits: z.array(z.string().min(1).max(40)).max(12),
  speakingStyle: z.string().max(600),
  responseLength: z.enum(['concise', 'balanced', 'detailed']),
  formality: z.number().min(0).max(1),
  humor: z.number().min(0).max(1),
  communicationStyle: z.enum(['direct', 'warm', 'analytical', 'playful', 'encouraging']),
  emotionalExpression: z.number().min(0).max(1),
  customInstructions: z.string().max(6000).default(''),
});
export type PersonalityConfig = z.infer<typeof personalitySchema>;

/* ------------------------------------------------------------------- voice */

export const voiceSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['auto', 'openai', 'gemini', 'browser']),
  voiceId: z.string().max(120),
  voiceName: z.string().max(120),
  language: z.string().max(16),
  speed: z.number().min(0.5).max(2),
  pitch: z.number().min(0.5).max(1.5),
  style: z.enum(['natural', 'calm', 'energetic', 'professional', 'warm']),
  autoSpeak: z.boolean(),
  outputDeviceId: z.string().max(160).default(''),
  inputDeviceId: z.string().max(160).default(''),
});
export type VoiceConfig = z.infer<typeof voiceSchema>;

/* -------------------------------------------------------------- intelligence */

export const intelligenceSchema = z.object({
  provider: z.enum(['auto', 'openai', 'anthropic', 'google', 'openai-compatible']).default('auto'),
  model: z.string().max(160).default(''),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(32_000),
  reasoning: z.enum(['off', 'low', 'medium', 'high']),
  memoryAccess: z.boolean(),
  knowledgeAccess: z.boolean(),
  skillAccess: z.boolean(),
  fallbackProvider: z.enum(['none', 'openai', 'anthropic', 'google']).default('none'),
  contextMessages: z.number().int().min(4).max(200).default(30),
});
export type IntelligenceConfig = z.infer<typeof intelligenceSchema>;

/* ------------------------------------------------------------- permissions */

export const characterPermissionsSchema = z.object({
  allowComputerControl: z.boolean(),
  allowBrowserAutomation: z.boolean(),
  allowFileSystem: z.boolean(),
  allowNetworkResearch: z.boolean(),
  disabledSkillIds: z.array(z.string()).default([]),
});
export type CharacterPermissions = z.infer<typeof characterPermissionsSchema>;

export const memorySettingsSchema = z.object({
  autoExtract: z.boolean(),
  retentionDays: z.number().int().min(0).max(3650),
  shareLongTermAcrossCharacters: z.boolean().default(false),
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

/* ---------------------------------------------------------------- character */

export const characterConfigSchema = z.object({
  description: z.string().max(2000).default(''),
  visualStyle: z.string().max(120).default(''),
  characterType: z.enum(CHARACTER_TYPES).default('custom'),
  ageSetting: z.number().int().min(18).max(999).nullable().default(null),
  language: z.string().max(16).default('en'),
  expertise: z.array(z.string().min(1).max(60)).max(20).default([]),
  personality: personalitySchema,
  voice: voiceSchema,
  intelligence: intelligenceSchema,
  permissions: characterPermissionsSchema,
  memory: memorySettingsSchema,
});
export type CharacterConfig = z.infer<typeof characterConfigSchema>;

export const characterInputSchema = z.object({
  name: z.string().min(1).max(60),
  templateKey: z.enum(TEMPLATE_KEYS),
  avatarModel: z.enum(['procedural', 'vrm']).default('procedural'),
  avatarVariant: z.string().max(80),
  avatarSpec: avatarSpecSchema,
  profileImage: z.string().max(2_000_000).nullable().default(null),
  config: characterConfigSchema,
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

export const characterSchema = characterInputSchema.extend({
  id: z.string(),
  isDefault: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z
    .object({ memoryCount: z.number(), conversationCount: z.number() })
    .optional(),
});
export type Character = z.infer<typeof characterSchema>;

export const characterExportSchema = z.object({
  format: z.literal('aura.character'),
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  character: characterInputSchema,
});
export type CharacterExport = z.infer<typeof characterExportSchema>;

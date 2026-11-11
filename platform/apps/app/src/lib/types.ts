/** Wire types mirrored from @aura/core (kept explicit so the client is decoupled). */
export type TemplateKey =
  | 'jarvis-holographic'
  | 'friendly-male'
  | 'friendly-female'
  | 'anime-female-a'
  | 'anime-female-b'
  | 'coding-expert'
  | 'professional-assistant';

export type AvatarSpec = {
  palette: { primary: string; secondary: string; accent: string; glow: string; skin: string; hair: string; eye: string };
  head: { shape: 'crystalline' | 'rounded' | 'soft' | 'angular' | 'oval' | 'arc'; width: number; height: number; jawTaper: number; material: 'wireframe' | 'solid' | 'toon' | 'glass' };
  hair: { style: 'slick' | 'short' | 'long-straight' | 'twin-tail' | 'bob-curly' | 'spiky' | 'none'; volume: number; accentStrand?: string };
  eyes: { shape: 'round' | 'almond' | 'sharp' | 'glow'; scale: number; emissive: number };
  body: { style: 'suit' | 'hoodie' | 'techsuit' | 'dress' | 'coat' | 'hologram'; collar: 'tie' | 'open' | 'high' | 'none'; shoulderWidth: number };
  accessory: 'headset' | 'visor' | 'hairpin' | 'earpiece' | 'glasses' | 'none' | 'antenna';
  halo: boolean;
  gridFloor: boolean;
  glowIntensity: number;
  background: 'void' | 'holo-room' | 'gradient';
};

export type PersonalityConfig = {
  systemPrompt: string;
  traits: string[];
  speakingStyle: string;
  responseLength: 'concise' | 'balanced' | 'detailed';
  formality: number;
  humor: number;
  communicationStyle: 'direct' | 'warm' | 'analytical' | 'playful' | 'encouraging';
  emotionalExpression: number;
  customInstructions: string;
};

export type VoiceConfig = {
  enabled: boolean;
  provider: 'auto' | 'openai' | 'gemini' | 'browser';
  voiceId: string;
  voiceName: string;
  language: string;
  speed: number;
  pitch: number;
  style: 'natural' | 'calm' | 'energetic' | 'professional' | 'warm';
  autoSpeak: boolean;
  outputDeviceId: string;
  inputDeviceId: string;
};

export type IntelligenceConfig = {
  provider: 'auto' | 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  model: string;
  temperature: number;
  maxTokens: number;
  reasoning: 'off' | 'low' | 'medium' | 'high';
  memoryAccess: boolean;
  knowledgeAccess: boolean;
  skillAccess: boolean;
  fallbackProvider: 'none' | 'openai' | 'anthropic' | 'google';
  contextMessages: number;
};

export type CharacterPermissions = {
  allowComputerControl: boolean;
  allowBrowserAutomation: boolean;
  allowFileSystem: boolean;
  allowNetworkResearch: boolean;
  disabledSkillIds: string[];
};

export type CharacterConfig = {
  description: string;
  visualStyle: string;
  characterType: 'assistant' | 'companion' | 'specialist' | 'custom';
  ageSetting: number | null;
  language: string;
  expertise: string[];
  personality: PersonalityConfig;
  voice: VoiceConfig;
  intelligence: IntelligenceConfig;
  permissions: CharacterPermissions;
  memory: { autoExtract: boolean; retentionDays: number; shareLongTermAcrossCharacters: boolean };
};

export type Character = {
  id: string;
  name: string;
  templateKey: TemplateKey;
  avatarModel: 'procedural' | 'vrm';
  avatarVariant: string;
  avatarSpec: AvatarSpec;
  profileImage: string | null;
  config: CharacterConfig;
  isDefault: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: { memoryCount: number; conversationCount: number };
};

export type Template = {
  key: TemplateKey;
  name: string;
  tagline: string;
  visualStyle: string;
  accent: string;
  renderFamily: 'hologram' | 'natural' | 'anime' | 'tech' | 'corporate';
  avatar: AvatarSpec;
  suggestedSkills: string[];
  personalityPreview: { traits: string[]; communicationStyle: string; responseLength: string; humor: number; formality: number };
  defaultVoice: { name: string; style: string };
  expertise: string[];
  characterType: string;
};

export type Conversation = {
  id: string;
  characterId: string;
  title: string;
  mode: 'companion' | 'agent';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messageCount?: number;
};

export type Message = {
  id: string;
  conversationId: string;
  characterId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type Memory = {
  id: string;
  characterId: string;
  layer: 'short_term' | 'long_term' | 'episodic' | 'knowledge';
  category: 'preference' | 'fact' | 'instruction' | 'relationship' | 'project' | 'event' | 'summary' | 'knowledge';
  content: string;
  importance: number;
  confidence: number;
  source: string;
  tags: string[];
  pinned: boolean;
  accessCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanStep = {
  id: string;
  title: string;
  description: string;
  skillId: string | null;
  args: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  verify: { kind: 'assertion' | 'manual' | 'none'; expression?: string; description?: string };
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
};

export type Task = {
  id: string;
  characterId: string;
  conversationId: string | null;
  title: string;
  goal: string;
  status: 'queued' | 'planning' | 'awaiting_confirmation' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  plan: PlanStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  requiresConfirmation: boolean;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  stepId: string | null;
  level: 'info' | 'warn' | 'error' | 'success';
  type: string;
  message: string;
  createdAt: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  origin: 'builtin' | 'user' | 'mcp' | 'taught';
  enabled: boolean;
  permissions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  verification: { kind: 'assertion' | 'manual' | 'none'; description: string };
  config: Record<string, unknown>;
};

export type ProviderState = {
  key: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  label: string;
  configured: boolean;
  keyHint: string | null;
  baseUrl: string | null;
  lastStatus: string;
  lastVerifiedAt: string | null;
  docsUrl: string;
  keyUrl: string;
  requiresBaseUrl: boolean;
};

export type ModelInfo = {
  id: string;
  label: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
};

export type UsageSummary = {
  today: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  last7: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  byProvider: Array<{ provider: string; model: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  recent: Array<{ id: string; provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; createdAt: string }>;
};

export type LicenseState = {
  mode: 'development' | 'licensed' | 'unlicensed' | 'grace' | 'expired';
  plan: string;
  features: string[];
  reason: string;
  subject: string | null;
  expiresAt: string | null;
  lastValidatedAt: string | null;
  deviceId: string;
};

export type SubscriptionState = {
  status: string;
  plan: string | null;
  features: string[];
  quotaTokensPerMonth: number;
  periodEnd: string | null;
  reason: string;
  lastValidatedAt: string | null;
};

export type Health = {
  ok: boolean;
  version: string;
  schemaVersion: number;
  uptimeSeconds: number;
  dataDir: string;
  database: { path: string; sizeBytes: number };
  workspaceRoot: string;
  vaultKeyPath?: string;
};

export type SystemInfo = {
  platform: string;
  release: string;
  hostname: string;
  cpuCount: number;
  totalMemMb: number;
  freeMemMb: number;
  node: string;
  dataDir: string;
  capabilityMode: 'server' | 'desktop';
  capabilities: { browserAutomation: boolean; computerControl: boolean; fileSystem: boolean; knowledge: boolean };
  devMode: boolean;
  recommendedDataDir: string;
};

export type Integration = {
  key: string;
  name: string;
  category: string;
  how: string;
  needs: string;
  status: string;
  lastError: string | null;
  hasConfig: boolean;
};

export type DeviceState = { kind: 'audioinput' | 'audiooutput'; deviceId: string; label: string };

export type CharacterExport = {
  format: 'aura.character';
  formatVersion: 1;
  exportedAt: string;
  character: Omit<Character, 'id' | 'isDefault' | 'archived' | 'createdAt' | 'updatedAt' | 'stats'>;
};

export type McpServer = {
  id: string;
  name: string;
  transport: string;
  endpoint: string;
  enabled: number;
  status: string;
  tools_json: string;
  last_error: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Canonical ids from @aura/core PERMISSIONS — the server rejects anything else. */
export type PermissionId =
  | 'computer.control' | 'computer.input' | 'computer.screenshot' | 'browser.automation'
  | 'files.read' | 'files.write' | 'files.delete' | 'network.access'
  | 'clipboard.read' | 'clipboard.write' | 'apps.launch' | 'communication.send'
  | 'finance.transact' | 'system.settings' | 'shell.execute';

export type PermissionsResponse = {
  permissions: Array<{ permission: PermissionId; decision: 'allow' | 'ask' | 'deny'; risk: 'low' | 'medium' | 'high' | 'critical' }>;
  emergencyStop: boolean;
};

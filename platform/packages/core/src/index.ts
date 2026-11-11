/* Utilities */
export { newId, shortId } from './util/ids.js';
export { nowIso, minutesFromNow, daysFromNow, timeAgo, isExpired } from './util/time.js';
export { safeParse, toJson } from './util/json.js';
export { deepMerge } from './util/merge.js';
export { tokenize, fnv1a, normalizeForHash, truncate, toFtsQuery, estimateTokens } from './util/text.js';
export { redactSecrets, redactObject } from './util/redact.js';

/* Database */
export type { SqlDriver, SqlValue, Migration } from './db/types.js';
export { MIGRATIONS } from './db/migrations.js';
export { migrate, currentSchemaVersion, MigrationError } from './db/migrate.js';
export { NodeSqlDriver } from './db/nodeDriver.js';
export { Db } from './db/db.js';
export { bm25ToScore, MEMORY_LAYERS, MEMORY_CATEGORIES } from './db/memoryRepo.js';
export type { MemoryRow, MemoryLayer, MemoryCategory, MemoryCreateInput, MemorySearchParams } from './db/memoryRepo.js';
export type { Message, MessageRole, Conversation } from './db/conversationsRepo.js';
export type { SkillRecord } from './db/skillsRepo.js';
export { TASK_STATUSES } from './db/tasksRepo.js';
export type { Task, TaskStatus, PlanStep, TaskEvent, PlanStepStatus } from './db/tasksRepo.js';
export type { DocumentRecord, ChunkRecord } from './db/documentsRepo.js';
export type { DocumentsRepo } from './db/documentsRepo.js';
export type { CredentialRecord } from './db/credentialsRepo.js';
export type { UsageSummary, UsageEvent } from './db/usageRepo.js';
export type { AuditEntry } from './db/auditRepo.js';
export type { EntitlementRecord } from './db/licenseRepo.js';
export type { SettingsShape, SettingKey } from './db/settingsRepo.js';
export { DEFAULT_SETTINGS } from './db/settingsRepo.js';

/* Characters */
export * from './characters/types.js';
export { CHARACTER_TEMPLATES, getTemplate, requireTemplate, AVATAR_FAMILIES } from './characters/templates.js';
export type { CharacterTemplate } from './characters/templates.js';

/* Avatar */
export { AVATAR_STATES, CharacterStateMachine } from './avatar/state.js';
export type { AvatarState, StateChange } from './avatar/state.js';
export { EXPRESSIONS, FACE_PRESETS, STATE_EXPRESSION, ExpressionController, blendFace, inferExpressionFromText, lerp } from './avatar/expressions.js';
export type { Expression, FaceParams, EmotionCue } from './avatar/expressions.js';
export { VISEMES, VISEME_SHAPES, LipSyncEngine, textToVisemeFrames, shapeToMouth, smoothMouth, rmsFromFrequencyData } from './avatar/visemes.js';
export type { Viseme, MouthShape, MouthFrame, VisemeFrame, LipSyncMode } from './avatar/visemes.js';
export { AvatarEngine } from './avatar/engine.js';
export type { AvatarPose } from './avatar/engine.js';
export { EnergyVad, DEFAULT_VAD, rmsTimeDomain, zeroCrossingRate } from './avatar/vad.js';
export type { VadConfig, VadDecision } from './avatar/vad.js';

/* Memory */
export { MemoryEngine, extractMemoryCandidates, scoreImportance } from './memory/engine.js';
export type { MemoryCandidate, PersistResult } from './memory/engine.js';
export type { ExtractionResult as MemoryExtractionResult } from './memory/engine.js';
export { embedText, cosineSimilarity, EMBEDDING_DIM, EMBEDDING_MODEL } from './memory/embed.js';

/* Secrets */
export { SecretVault, keyHint, validateKeyShape } from './secrets/vault.js';

/* Providers */
export * from './providers/types.js';
export { OpenAiProvider, toProviderError } from './providers/openai.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { GoogleProvider } from './providers/google.js';
export { parseSse } from './providers/sse.js';
export { estimatedCost, modelPricing } from './providers/pricing.js';
export { ModelRouter, DEFAULT_MODELS } from './router/router.js';
export type { RouterTarget, RouterDeps } from './router/router.js';

/* Skills */
export * from './skills/types.js';
export { SkillRegistry, validateImportedSkill } from './skills/registry.js';
export {
  BUILTIN_SKILLS,
  SKILL_ARG_VALIDATORS,
  evaluateArithmetic,
  parseDuckDuckGo,
  htmlToText,
  decomposeGoal,
  jsonSchemaToZod,
} from './skills/builtin.js';

/* Agent */
export { PermissionEngine, MemoryPermissionStore } from './agent/permissions.js';
export type { Decision, PermissionCheck, PermissionStore } from './agent/permissions.js';
export { verifyStepOutput, evaluateAssertion } from './agent/verification.js';
export { TaskOrchestrator } from './agent/orchestrator.js';
export type { RunTaskInput, OrchestratorEvents } from './agent/orchestrator.js';
export { planDeterministic, toToolDefinitions, fromToolName } from './agent/planner.js';
export type { DraftPlan, PlanContext } from './agent/planner.js';
export { buildSystemPrompt, selectContext, scanForInjection } from './agent/prompt.js';

/* Platform */
export * from './platform/capabilities.js';

/* Licensing */
export { LicensingEngine, LicenseVerifier, decodeLicenseKey, DEV_MODE_REASON } from './licensing/engine.js';
export * from './licensing/types.js';

/* Voice */
export { VoiceSession } from './voice/session.js';
export type { VoicePhase, TranscriptLine, VoiceProviderKind, VoiceSessionEvents } from './voice/session.js';

/* Chat */
export { ChatService } from './chat/service.js';
export type { ChatStreamChunk, ChatServiceDeps } from './chat/service.js';

/* Knowledge */
export { extractText, detectFormat, chunkText, extractPdfText, readZip } from './knowledge/extract.js';
export type { ExtractionResult, Inflate } from './knowledge/extract.js';

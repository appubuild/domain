import {
  Db,
  NodeSqlDriver,
  SecretVault,
  ModelRouter,
  MemoryEngine,
  SkillRegistry,
  PermissionEngine,
  TaskOrchestrator,
  LicensingEngine,
  LicenseVerifier,
  ChatService,
  BUILTIN_SKILLS,
  NodeFileSystemAdapter,
  DEFAULT_SETTINGS,
  type ProviderKey,
  type Character,
  type SkillExecutionContext,
  type Decision,
  type Permission,
} from '@aura/core';
import type { ServerConfig } from './config.js';
import { loadOrCreateVaultKey, getDeviceId } from './config.js';
import { createFileIo } from './services/fileIo.js';
import { startScheduler } from './services/scheduler.js';
import { WorkspaceKnowledge } from './services/knowledge.js';
import { SkillCapabilityFactory } from './services/capabilities.js';
import { EventBus } from './services/events.js';
import { DocumentService } from './services/documents.js';
import { VoiceGateway } from './services/voice.js';
import { pathJoin, pathResolve } from './services/paths.js';

export type AppContext = Awaited<ReturnType<typeof createContext>>;

/** Loads the pinned Ed25519 license public key from the build environment. */
function loadLicensePublicKey(): Record<string, unknown> | null {
  const raw = process.env.AURA_LICENSE_PUBLIC_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function createContext(config: ServerConfig) {
  const driver = new NodeSqlDriver(config.dbPath);
  const db = new Db(driver);
  const schemaVersion = db.migrate();

  const vault = await SecretVault.fromKeyBytes(loadOrCreateVaultKey(config.keyPath));
  const deviceId = getDeviceId(config.dataDir);

  /** Decrypted-key cache, invalidated whenever the stored ciphertext changes. */
  const decryptCache = new Map<string, { ciphertext: string; plaintext: string }>();
  async function getApiKey(provider: ProviderKey): Promise<string | null> {
    const rec = db.credentials.get(provider);
    if (!rec) return null;
    const cached = decryptCache.get(provider);
    if (cached && cached.ciphertext === rec.encryptedKey) return cached.plaintext;
    try {
      const plaintext = await vault.decrypt(rec.encryptedKey);
      decryptCache.set(provider, { ciphertext: rec.encryptedKey, plaintext });
      return plaintext;
    } catch {
      return null;
    }
  }

  const router = new ModelRouter({
    getApiKey,
    getBaseUrl: async (p) => db.credentials.get(p)?.baseUrl ?? null,
  });

  const memory = new MemoryEngine(db.memories);
  const registry = new SkillRegistry();
  for (const skill of BUILTIN_SKILLS) registry.register(skill, 'builtin');

  const permissions = new PermissionEngine(
    {
      get(permission: Permission): Decision {
        const row = driver.get<{ decision: string }>('SELECT decision FROM permissions WHERE permission = ?', [permission]);
        const d = row?.decision;
        return d === 'allow' || d === 'deny' || d === 'ask' ? d : 'ask';
      },
      set(permission: Permission, decision: Decision): void {
        driver.run(
          'INSERT INTO permissions (permission, decision, scope_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(permission) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at',
          [permission, decision, '{}', new Date().toISOString()],
        );
      },
    },
    db.audit,
  );

  const events = new EventBus();
  const tasks = new TaskOrchestrator(db.tasks, registry, permissions, db.audit, {
    onTaskUpdate: (task) => events.emit('task.updated', { task }),
    onLog: (entry) => events.emit('task.log', entry),
  });

  // Scheduled tasks that came due while the app was closed run on boot, then on every tick.
  const scheduler = startScheduler({
    tasks,
    db,
    runTask: (taskId, character) =>
      tasks.enqueue({
        taskId,
        characterPermissions: { ...character.config.permissions, disabledSkillIds: character.config.permissions.disabledSkillIds },
        buildContext: (cid) => buildSkillContext(db.characters.get(cid)),
      }),
  });

  // Tasks that were mid-flight when the previous process died are reconciled here, before the
  // HTTP server accepts traffic, so the UI never shows an eternally "running" task.
  const recoveredTasks = tasks.recoverOrphans();
  if (recoveredTasks > 0) {
    events.emit('task.log', {
      taskId: 'system',
      level: 'warn',
      message: `Marked ${recoveredTasks} interrupted task(s) as failed after restart.`,
    });
  }

  const files = new NodeFileSystemAdapter(config.workspaceRoot, createFileIo(), {
    join: pathJoin,
    resolve: pathResolve,
  });
  const knowledge = new WorkspaceKnowledge(db.documents, db, memory);
  const capabilities = new SkillCapabilityFactory({ config, db, files, knowledge });
  const documents = new DocumentService(db, knowledge, config);
  const voice = new VoiceGateway({ db, router, getApiKey, events });

  const licensing = new LicensingEngine(db.license, {
    devMode: config.devMode,
    deviceId,
    verifier: new LicenseVerifier(loadLicensePublicKey() as never),
  });

  function buildSkillContext(
    character: Character | null,
    opts: { taskId?: string | null; conversationId?: string | null; signal?: AbortSignal } = {},
  ): SkillExecutionContext {
    const characterId = character?.id ?? 'chr_system';
    return {
      characterId,
      taskId: opts.taskId ?? null,
      conversationId: opts.conversationId ?? null,
      workspaceRoot: character?.config.permissions.allowFileSystem === false ? null : config.workspaceRoot,
      logger: (level, message) => events.emit('skill.log', { level, message, characterId }),
      signal: opts.signal ?? new AbortController().signal,
      capabilities: capabilities.forCharacter(character),
      emit: (e) => events.emit('skill.event', { ...e, characterId }),
    };
  }

  /** Tools exposed to the model for one character, with the same permission gates as tasks. */
  function buildToolBridge(character: Character) {
    const manifests = registry.manifests().filter((m) => !character.config.permissions.disabledSkillIds.includes(m.id));
    return {
      definitions: manifests.map((m) => ({
        name: m.id.replace(/\./g, '__'),
        description: `${m.name}: ${m.description}`,
        parameters: m.inputSchema,
      })),
      execute: async (name: string, args: Record<string, unknown>): Promise<string> => {
        const skillId = name.replace(/__/g, '.');
        const skill = registry.get(skillId);
        if (!skill) return JSON.stringify({ ok: false, error: `Unknown tool ${skillId}` });
        const permission = (skill.manifest.permissions[0] as Permission | undefined) ?? null;
        const check = permissions.check({
          permission,
          characterPermissions: {
            allowComputerControl: character.config.permissions.allowComputerControl,
            allowBrowserAutomation: character.config.permissions.allowBrowserAutomation,
            allowFileSystem: character.config.permissions.allowFileSystem,
            allowNetworkResearch: character.config.permissions.allowNetworkResearch,
          },
        });
        if (!check.allowed) return JSON.stringify({ ok: false, error: check.reason, needsConfirmation: check.needsConfirmation });
        try {
          const result = await skill.run(args, buildSkillContext(character));
          return JSON.stringify(result).slice(0, 30_000);
        } catch (err) {
          return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    };
  }

  /** ChatService bound to a single character's memory, knowledge and tool surface. */
  function chatFor(character: Character): ChatService {
    return new ChatService({
      db,
      router,
      memory,
      knowledge: {
        search: (characterId: string | null, query: string, limit: number) =>
          knowledge.chunks(characterId, query, limit).map((c) => ({ content: c.content })),
      },
      tools: buildToolBridge(character),
      environmentNote: `Platform: ${config.capabilityMode === 'desktop' ? 'Windows desktop' : 'local server'}. Workspace root: ${config.workspaceRoot}.`,
    });
  }

  function settings() {
    return db.settings.all();
  }

  function ensureDefaultSettings(): void {
    if (driver.get('SELECT 1 AS one FROM app_settings LIMIT 1')) return;
    db.settings.set('appearance', DEFAULT_SETTINGS.appearance);
    db.settings.set('general', DEFAULT_SETTINGS.general);
    db.settings.set('voice', DEFAULT_SETTINGS.voice);
    db.settings.set('memory', DEFAULT_SETTINGS.memory);
    db.settings.set('privacy', DEFAULT_SETTINGS.privacy);
    db.settings.set('hotkeys', DEFAULT_SETTINGS.hotkeys);
    db.settings.set('worldMonitor', DEFAULT_SETTINGS.worldMonitor);
    db.settings.set('onboarding', { completed: false });
  }

  return {
    config,
    driver,
    db,
    schemaVersion,
    vault,
    deviceId,
    getApiKey,
    router,
    memory,
    registry,
    permissions,
    events,
    tasks,
    files,
    knowledge,
    capabilities,
    documents,
    voice,
    licensing,
    buildSkillContext,
    chatFor,
    settings,
    ensureDefaultSettings,
    scheduler,
    close() {
      scheduler.stop();
      db.close();
    },
  };
}

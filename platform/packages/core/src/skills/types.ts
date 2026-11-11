import { z } from 'zod';

export const SKILL_CATEGORIES = [
  'Computer Control',
  'Browser Automation',
  'File Management',
  'Coding & Development',
  'Research & Web Search',
  'Google Workspace',
  'Microsoft Office',
  'Communication',
  'PDF & Document Processing',
  'Data Analysis',
  'Media Processing',
  'Productivity',
  'Platform',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const PERMISSIONS = [
  'computer.control',
  'computer.input',
  'computer.screenshot',
  'browser.automation',
  'files.read',
  'files.write',
  'files.delete',
  'network.access',
  'clipboard.read',
  'clipboard.write',
  'apps.launch',
  'communication.send',
  'finance.transact',
  'system.settings',
  'shell.execute',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const RISK_BY_PERMISSION: Record<Permission, 'low' | 'medium' | 'high' | 'critical'> = {
  'computer.control': 'high',
  'computer.input': 'high',
  'computer.screenshot': 'medium',
  'browser.automation': 'medium',
  'files.read': 'low',
  'files.write': 'medium',
  'files.delete': 'high',
  'network.access': 'low',
  'clipboard.read': 'medium',
  'clipboard.write': 'low',
  'apps.launch': 'medium',
  'communication.send': 'high',
  'finance.transact': 'critical',
  'system.settings': 'high',
  'shell.execute': 'critical',
};

export const skillManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/, 'Skill id must be dot.separated_lowercase'),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Semver required'),
  category: z.enum(SKILL_CATEGORIES),
  permissions: z.array(z.enum(PERMISSIONS)),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  verification: z.object({
    kind: z.enum(['assertion', 'manual', 'none']),
    description: z.string().max(400),
  }),
  enabledByDefault: z.boolean().default(true),
  dangerouslyRequiresShell: z.boolean().default(false),
});
export type SkillManifest = z.infer<typeof skillManifestSchema>;

export type SkillEmitEvent = { type: string; message: string; data?: Record<string, unknown> };

export type SkillExecutionContext = {
  characterId: string;
  taskId: string | null;
  conversationId: string | null;
  /** Scoped filesystem root the skill may touch (user-approved workspace). */
  workspaceRoot: string | null;
  logger: (level: 'info' | 'warn' | 'error', message: string) => void;
  signal: AbortSignal;
  /** Ask the host platform to perform a capability (defined in platform adapters). */
  capabilities: SkillCapabilities;
  /** Progress events surfaced live in the task UI. */
  emit?: (event: SkillEmitEvent) => void;
};

export type SkillCapabilities = {
  browser: {
    open(url: string): Promise<{ ok: boolean; title: string; text: string; url: string }>;
    screenshot(path: string): Promise<{ ok: boolean; path: string }>;
    fillForm(selector: string, value: string): Promise<{ ok: boolean }>;
    click(selector: string): Promise<{ ok: boolean }>;
    download(url: string, targetPath: string): Promise<{ ok: boolean; path: string }>;
    upload(selector: string, filePath: string): Promise<{ ok: boolean }>;
    readPage(): Promise<{ url: string; title: string; text: string }>;
  } | null;
  computer: {
    launchApp(name: string): Promise<{ ok: boolean; pid?: number; message: string }>;
    listWindows(): Promise<Array<{ id: string; title: string; app: string }>>;
    focusWindow(id: string): Promise<{ ok: boolean }>;
    typeText(text: string): Promise<{ ok: boolean }>;
    keyCombo(keys: string[]): Promise<{ ok: boolean }>;
    click(x: number, y: number, button?: 'left' | 'right'): Promise<{ ok: boolean }>;
    screenshotBase64(): Promise<{ ok: boolean; png: string }>;
  } | null;
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    list(dir: string): Promise<Array<{ path: string; name: string; isDir: boolean; size: number }>>;
    search(root: string, query: string): Promise<Array<{ path: string; name: string; size: number }>>;
    move(from: string, to: string): Promise<void>;
    copy(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
  } | null;
  http: { fetchJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> };
  knowledge: { chunks(query: string, limit: number): Promise<Array<{ documentId: string; content: string }>> };
  emit?: (event: SkillEmitEvent) => void;
};

export type SkillResult = {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  /** Machine-verifiable evidence that the outcome actually happened. */
  evidence?: { verified: boolean; detail: string };
};

export type SkillDefinition = {
  manifest: SkillManifest;
  /** Handler receives validated args. Must be side-effect honest: no fake success. */
  run(args: Record<string, unknown>, ctx: SkillExecutionContext): Promise<SkillResult>;
};

export type SkillInfo = SkillManifest & {
  origin: 'builtin' | 'user' | 'mcp' | 'taught';
  enabled: boolean;
  config: Record<string, unknown>;
  canonicalId: string;
};

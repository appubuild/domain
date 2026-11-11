import { z } from 'zod';

/**
 * Platform capability contract. Shared logic depends only on this interface; each OS
 * supplies an adapter (Windows UIA/Win32, macOS Accessibility, Web DOM/extension, iOS
 * unavailable). `supported: false` is honest — features degrade, never fake success.
 */
export const capabilityReportSchema = z.object({
  platform: z.enum(['windows', 'macos', 'web', 'ios', 'linux', 'node']),
  browserAutomation: z.boolean(),
  computerControl: z.boolean(),
  screenshots: z.boolean(),
  clipboard: z.boolean(),
  credentialStore: z.boolean(),
  transparentWindow: z.boolean(),
  alwaysOnTop: z.boolean(),
  globalHotkeys: z.boolean(),
  systemTray: z.boolean(),
  fileSystem: z.boolean(),
  audioDevices: z.boolean(),
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

export type BrowserSession = { url: string; title: string; text: string };

export interface BrowserAdapter {
  readonly name: string;
  readonly kind: 'playwright' | 'web-dom' | 'extension';
  isAvailable(): Promise<boolean>;
  open(url: string): Promise<BrowserSession>;
  readPage(): Promise<BrowserSession>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  screenshot(path: string): Promise<string>;
  download(url: string, targetPath: string): Promise<void>;
  close(): Promise<void>;
}

export interface ComputerAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  launchApp(name: string): Promise<{ ok: boolean; pid?: number; message: string }>;
  listWindows(): Promise<Array<{ id: string; title: string; app: string }>>;
  focusWindow(id: string): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKeys(keys: string[]): Promise<void>;
  click(x: number, y: number, button?: 'left' | 'right'): Promise<void>;
  screenshot(): Promise<{ pngBase64: string; width: number; height: number }>;
  getClipboard(): Promise<string>;
  setClipboard(text: string): Promise<void>;
}

export interface FileSystemAdapter {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(dir: string): Promise<Array<{ path: string; name: string; isDir: boolean; size: number }>>;
  search(root: string, query: string): Promise<Array<{ path: string; name: string; size: number }>>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  isWithinRoot(root: string, target: string): boolean;
}

export interface PlatformAdapter {
  readonly report: CapabilityReport;
  readonly browser: BrowserAdapter | null;
  readonly computer: ComputerAdapter | null;
  readonly files: FileSystemAdapter | null;
}

/** Path traversal guard shared by every filesystem adapter. Pure and unit-tested. */
export function isWithinRoot(root: string, target: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/\.\.(?=\/|$)/g, '/..').replace(/\/+$/, '');
  const r = norm(root).toLowerCase();
  const t = norm(target).toLowerCase();
  if (!r) return false;
  if (t === r) return true;
  const rootWithSlash = r.endsWith('/') ? r : `${r}/`;
  if (!t.startsWith(rootWithSlash)) return false;
  return !t.split('/').includes('..');
}

export const NODE_ADAPTER_REPORT: CapabilityReport = {
  platform: 'node',
  browserAutomation: false,
  computerControl: false,
  screenshots: false,
  clipboard: false,
  credentialStore: false,
  transparentWindow: false,
  alwaysOnTop: false,
  globalHotkeys: false,
  systemTray: false,
  fileSystem: true,
  audioDevices: false,
};

export const WINDOWS_REPORT: CapabilityReport = {
  platform: 'windows',
  browserAutomation: true,
  computerControl: true,
  screenshots: true,
  clipboard: true,
  credentialStore: true,
  transparentWindow: true,
  alwaysOnTop: true,
  globalHotkeys: true,
  systemTray: true,
  fileSystem: true,
  audioDevices: true,
};

export const WEB_REPORT: CapabilityReport = {
  platform: 'web',
  browserAutomation: false,
  computerControl: false,
  screenshots: false,
  clipboard: true,
  credentialStore: false,
  transparentWindow: false,
  alwaysOnTop: false,
  globalHotkeys: false,
  systemTray: false,
  fileSystem: false,
  audioDevices: true,
};

export const MACOS_REPORT: CapabilityReport = { ...WINDOWS_REPORT, platform: 'macos' };
export const IOS_REPORT: CapabilityReport = {
  ...WEB_REPORT,
  platform: 'ios',
  browserAutomation: false,
  fileSystem: false,
};

/** Platform-agnostic filesystem adapter used by the server/desktop with a sandbox root. */
export class NodeFileSystemAdapter implements FileSystemAdapter {
  constructor(
    private readonly root: string,
    private readonly fs: {
      readFile(p: string): Promise<string>;
      writeFile(p: string, c: string): Promise<void>;
      readdir(p: string): Promise<Array<{ name: string; isDir: boolean; size: number }>>;
      move(from: string, to: string): Promise<void>;
      copy(from: string, to: string): Promise<void>;
      remove(p: string): Promise<void>;
      /**
       * Optional symlink resolution. When the host supplies it, containment is checked against
       * the *real* path, so a symlink planted inside the workspace cannot be used to read
       * `C:\Windows\System32\config\SAM` or `~/.ssh/id_rsa`. Adapters without it (in-memory,
       * browser) keep the lexical guard, which is sufficient there because no symlinks exist.
       */
      realpath?(p: string): Promise<string>;
    },
    private readonly io: { join(...parts: string[]): string; resolve(p: string): string },
  ) {}

  private ensure(abs: string, original: string): string {
    if (!isWithinRoot(this.root, abs)) throw new Error(`Path escapes the workspace: ${original}`);
    return abs;
  }

  private check(p: string): string {
    return this.ensure(this.io.resolve(this.io.join(this.root, p)), p);
  }

  /**
   * Resolve the path (following symlinks where the host supports it) and verify the *target*
   * is still inside the workspace. Recursive symlinks are rejected rather than followed.
   */
  private async safe(p: string): Promise<string> {
    const lexical = this.check(p);
    if (!this.fs.realpath) return lexical;
    let real: string;
    try {
      real = await this.fs.realpath(lexical);
    } catch {
      // Not created yet (write path) — the deepest existing ancestor is what matters.
      const cut = Math.max(lexical.lastIndexOf('/'), lexical.lastIndexOf('\\'));
      const parent = cut > 0 ? lexical.slice(0, cut) : lexical;
      const leaf = cut > 0 ? lexical.slice(cut + 1) : '';
      try {
        const realParent = await this.fs.realpath(parent);
        return this.ensure(this.io.resolve(this.io.join(realParent, leaf)), p);
      } catch {
        return lexical;
      }
    }
    return this.ensure(this.io.resolve(real), p);
  }

  async read(path: string): Promise<string> {
    return this.fs.readFile(await this.safe(path));
  }
  async write(path: string, content: string): Promise<void> {
    return this.fs.writeFile(await this.safe(path), content);
  }
  async list(dir: string): Promise<Array<{ path: string; name: string; isDir: boolean; size: number }>> {
    const abs = await this.safe(dir);
    const entries = await this.fs.readdir(abs);
    return entries.map((e) => ({ path: this.io.join(abs, e.name), name: e.name, isDir: e.isDir, size: e.size }));
  }
  async search(root: string, query: string): Promise<Array<{ path: string; name: string; size: number }>> {
    const abs = await this.safe(root);
    const out: Array<{ path: string; name: string; size: number }> = [];
    // `*`, an empty string or a whitespace-only query means "everything" — the planner uses
    // `query: "*"` for folder inspection, and treating it as a literal substring matched
    // nothing at all.
    const needle = query.trim().toLowerCase();
    const matchAll = needle === '' || needle === '*';
    // Glob-ish inputs (`*.md`) match on extension/suffix instead of the literal asterisk.
    const suffix = needle.startsWith('*.') ? needle.slice(1) : null;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || out.length > 200) return;
      const entries = await this.fs.readdir(dir).catch(() => []);
      for (const e of entries) {
        const p = this.io.join(dir, e.name);
        const lower = e.name.toLowerCase();
        if (e.isDir) await walk(p, depth + 1);
        else if (matchAll || (suffix ? lower.endsWith(suffix) : lower.includes(needle))) out.push({ path: p, name: e.name, size: e.size });
      }
    };
    await walk(abs, 0);
    return out;
  }
  async move(from: string, to: string): Promise<void> {
    return this.fs.move(await this.safe(from), await this.safe(to));
  }
  async copy(from: string, to: string): Promise<void> {
    return this.fs.copy(await this.safe(from), await this.safe(to));
  }
  async remove(path: string): Promise<void> {
    return this.fs.remove(await this.safe(path));
  }
  isWithinRoot(_root: string, target: string): boolean {
    return isWithinRoot(this.root, target);
  }
}

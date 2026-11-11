import type { Character, FileSystemAdapter, SkillCapabilities } from '@aura/core';
import type { ServerConfig } from '../config.js';
import type { Db } from '@aura/core';
import type { WorkspaceKnowledge } from './knowledge.js';

/**
 * Builds the capability surface handed to skills. Server mode has files + http +
 * knowledge; browser/computer are only available when a desktop bridge is attached
 * (Tauri sidecar) — otherwise they are `null` and skills report the honest reason.
 */
export class SkillCapabilityFactory {
  private browser: SkillCapabilities['browser'] = null;
  private computer: SkillCapabilities['computer'] = null;

  constructor(
    private readonly deps: {
      config: ServerConfig;
      db: Db;
      files: FileSystemAdapter;
      knowledge: WorkspaceKnowledge;
    },
  ) {}

  attachBrowser(browser: SkillCapabilities['browser']): void {
    this.browser = browser;
  }

  attachComputer(computer: SkillCapabilities['computer']): void {
    this.computer = computer;
  }

  forCharacter(character: Character | null): SkillCapabilities {
    const allowFiles = character?.config.permissions.allowFileSystem ?? false;
    const allowBrowser = character?.config.permissions.allowBrowserAutomation ?? false;
    const allowComputer = character?.config.permissions.allowComputerControl ?? false;
    const files = this.deps.files;
    return {
      browser: allowBrowser ? this.browser : null,
      computer: allowComputer ? this.computer : null,
      files: allowFiles
        ? {
            read: (p) => files.read(p),
            write: (p, c) => files.write(p, c),
            list: (d) => files.list(d),
            search: (root, q) => files.search(root, q),
            move: (a, b) => files.move(a, b),
            copy: (a, b) => files.copy(a, b),
            remove: (p) => files.remove(p),
          }
        : null,
      http: {
        fetchJson: async (url, init) => {
          const res = await fetch(url, init);
          if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
          return res.json() as Promise<unknown>;
        },
      },
      knowledge: {
        chunks: async (query, limit) => this.deps.knowledge.chunks(character?.id ?? null, query, limit).map((c) => ({ documentId: c.documentId, content: c.content })),
      },
    };
  }
}

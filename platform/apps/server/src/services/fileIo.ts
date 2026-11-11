import { promises as fs } from 'node:fs';
import type { FileSystemAdapter } from '@aura/core';

/** Thin promise wrapper over node:fs used by the sandboxed workspace adapter. */
export function createFileIo() {
  return {
    readFile: (p: string) => fs.readFile(p, 'utf8'),
    writeFile: async (p: string, c: string) => {
      const dir = p.split(/[\\/]/).slice(0, -1).join('/');
      if (dir) await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(p, c, 'utf8');
    },
    readdir: async (p: string) => {
      const entries = await fs.readdir(p, { withFileTypes: true });
      const out: Array<{ name: string; isDir: boolean; size: number }> = [];
      for (const e of entries) {
        let size = 0;
        try {
          if (!e.isDirectory()) size = (await fs.stat(`${p}/${e.name}`)).size;
        } catch {
          /* skip unreadable */
        }
        out.push({ name: e.name, isDir: e.isDirectory(), size });
      }
      return out;
    },
    move: (from: string, to: string) => fs.rename(from, to),
    copy: (from: string, to: string) => fs.copyFile(from, to),
    remove: (p: string) => fs.rm(p, { force: true, recursive: false }),
    /**
     * Symlink resolution. The workspace adapter checks containment against the real target, so a
     * malicious symlink inside `workspace/` cannot reach outside of it.
     */
    realpath: (p: string) => fs.realpath(p),
  };
}

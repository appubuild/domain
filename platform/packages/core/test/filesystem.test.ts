import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeFileSystemAdapter, isWithinRoot } from '../src/platform/capabilities.js';
import { createRequire } from 'node:module';

/**
 * Real filesystem behaviour of the agent's workspace sandbox.
 *
 * These run against a temporary directory — no mocks — because the guards here are the only
 * thing standing between a hallucinated path and a real file operation.
 */
const nodeFs = {
  readdir: async (dir: string) => {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    const stat = (await import('node:fs/promises')).stat;
    return Promise.all(
      entries.map(async (e) => {
        const full = join(dir, e.name);
        const s = await stat(full).catch(() => ({ size: 0 }));
        return { name: e.name, isDir: e.isDirectory(), size: s.size };
      }),
    );
  },
  readFile: async (p: string) => (await import('node:fs/promises')).readFile(p, 'utf8'),
  writeFile: async (p: string, data: string) => (await import('node:fs/promises')).writeFile(p, data, 'utf8'),
  mkdirp: async (p: string) => (await import('node:fs/promises')).mkdir(p, { recursive: true }),
  remove: async (p: string) => (await import('node:fs/promises')).rm(p, { recursive: true, force: true }),
  stat: async (p: string) => (await import('node:fs/promises')).stat(p),
  realpath: async (p: string) => (await import('node:fs/promises')).realpath(p),
  rename: async (a: string, b: string) => (await import('node:fs/promises')).rename(a, b),
  copy: async (a: string, b: string) => (await import('node:fs/promises')).copyFile(a, b),
};

const io = {
  join: (...parts: string[]) => join(...parts),
  resolve: (p: string) => p,
  dirname: (p: string) => p.replace(/[/\\][^/\\]*$/, ''),
  basename: (p: string) => p.split(/[/\\]/).pop() ?? p,
  extname: (p: string) => {
    const b = p.split(/[/\\]/).pop() ?? '';
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  },
};

let root: string;
let adapter: NodeFileSystemAdapter;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aura-fs-'));
  mkdirSync(join(root, 'notes'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'brief.md'), '# Brief\nDeadline Friday.');
  writeFileSync(join(root, 'notes', 'todo.md'), '- ship it');
  writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;');
  adapter = new NodeFileSystemAdapter(root, nodeFs as never, io);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('workspace filesystem adapter', () => {
  it('lists everything for a wildcard query (the planner uses "*")', async () => {
    const all = await adapter.search('.', '*');
    expect(all.map((f) => f.name).sort()).toEqual(['brief.md', 'main.ts', 'todo.md']);
  });

  it('treats an empty query as "everything" instead of "nothing"', async () => {
    expect(await adapter.search('.', '   ')).toHaveLength(3);
  });

  it('matches extensions with a glob-ish query', async () => {
    const md = await adapter.search('.', '*.md');
    expect(md.map((f) => f.name).sort()).toEqual(['brief.md', 'todo.md']);
  });

  it('matches substrings case-insensitively and reports sizes', async () => {
    const hits = await adapter.search('.', 'BRIEF');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.size).toBeGreaterThan(0);
  });

  it('reads a file inside the workspace', async () => {
    await expect(adapter.read('brief.md')).resolves.toContain('Deadline Friday.');
  });

  it('refuses to read outside the workspace', async () => {
    await expect(adapter.read('../../etc/passwd')).rejects.toThrow(/escapes the workspace/i);
    // An absolute path is reinterpreted *inside* the sandbox rather than passed through, so it
    // can never reach the host's real /etc/passwd.
    const abs = await adapter.read('/etc/passwd').catch((e: Error) => e);
    expect(abs).toBeInstanceOf(Error);
    expect(String(abs)).not.toContain('root:');
  });

  it('refuses a symlink that points outside the workspace', async () => {
    // Regression: the guard used to be purely lexical, so `link/secret.txt` — where `link` is a
    // symlink to an outside directory — read real files outside the sandbox. Containment is now
    // checked against the resolved real path.
    const outside = mkdtempSync(join(tmpdir(), 'aura-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'do not read me');
    try {
      symlinkSync(outside, join(root, 'link'), 'dir');
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // symlink creation unavailable (e.g. Windows without privilege)
    }
    const result = await adapter.read('link/secret.txt').catch((e: Error) => e);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/escapes the workspace/i);
    rmSync(outside, { recursive: true, force: true });
  });

  it('writes, then reads back, inside the workspace', async () => {
    await adapter.write('notes/new.md', 'hello');
    await expect(adapter.read('notes/new.md')).resolves.toBe('hello');
  });

  it('lists a directory with entries and sizes', async () => {
    const entries = await adapter.list('.');
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('brief.md');
    expect(names).toContain('notes');
    expect(entries.find((e) => e.name === 'notes')?.isDir).toBe(true);
  });

  it('rejects traversal in the pure guard', () => {
    expect(isWithinRoot('/work/agent', '/work/agent/a.txt')).toBe(true);
    expect(isWithinRoot('/work/agent', '/work/agentical/a.txt')).toBe(false);
    expect(isWithinRoot('/work/agent', '/work/agent/../../etc/passwd')).toBe(false);
    expect(isWithinRoot('/work/agent', 'C:\\work\\agent\\..\\..\\windows')).toBe(false);
  });
});

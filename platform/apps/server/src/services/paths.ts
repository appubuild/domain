import path from 'node:path';

export function pathJoin(...parts: string[]): string {
  return path.join(...parts);
}

export function pathResolve(p: string): string {
  return path.resolve(p);
}

export function pathRelativeSafe(from: string, to: string): string {
  return path.relative(from, to);
}

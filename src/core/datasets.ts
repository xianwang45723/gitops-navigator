import * as path from 'path';
import { readDirSafe } from './fsUtil';

export const DEFAULT_DATASET_PATTERN = 'datasets/${dataset}/structure.sql';

export interface DatasetFile {
  name: string;
  file: string;
}

type Case = 'any' | 'upper' | 'lower';

const PLACEHOLDERS: Record<string, { case: Case; capture: string }> = {
  dataset: { case: 'any', capture: '(.+?)' },
  dataset_upper: { case: 'upper', capture: '([^a-z]+?)' },
  dataset_lower: { case: 'lower', capture: '([^A-Z]+?)' },
};

/** One path segment of a pattern: a literal name, or a regex with dataset captures. */
interface Segment {
  literal?: string;
  regex?: RegExp;
  cases: Case[];
}

/**
 * Splits a pattern like `some/folder/${dataset_upper}_blah.sql` into path segments. Undefined if it
 * has no dataset placeholder (there would be no name to take), or is absolute / climbs out of the repo.
 */
export function compileDatasetPattern(pattern: string): Segment[] | undefined {
  const parts = pattern.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || path.isAbsolute(pattern) || parts.includes('..')) return undefined;

  let placeholders = 0;
  const segments = parts.map((part): Segment => {
    if (!/\$\{\w+\}|\*/.test(part)) return { literal: part, cases: [] };
    const cases: Case[] = [];
    const source = part
      .split(/(\$\{\w+\}|\*)/)
      .map((piece) => {
        const key = /^\$\{(\w+)\}$/.exec(piece)?.[1];
        if (key && PLACEHOLDERS[key]) {
          placeholders++;
          cases.push(PLACEHOLDERS[key].case);
          return PLACEHOLDERS[key].capture;
        }
        if (piece === '*') return '[^/]*?';
        return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { regex: new RegExp(`^${source}$`), cases };
  });
  return placeholders ? segments : undefined;
}

/** Every file in `repoDir` matching the pattern, named by its (consistent) dataset placeholder values. */
export async function findDatasets(repoDir: string, pattern: string): Promise<DatasetFile[]> {
  const segments = compileDatasetPattern(pattern);
  if (!segments) return [];
  const out: DatasetFile[] = [];

  const walk = async (dir: string, i: number, name: string | undefined): Promise<void> => {
    const seg = segments[i];
    const last = i === segments.length - 1;
    if (seg.literal !== undefined) {
      const next = path.join(dir, seg.literal);
      if (last) return void (await addIfFile(next, name));
      return walk(next, i + 1, name);
    }
    for (const entry of await readDirSafe(dir)) {
      if (last ? !entry.isFile() : !entry.isDirectory()) continue;
      const m = seg.regex!.exec(entry.name);
      if (!m) continue;
      const found = mergeName(name, m.slice(1), seg.cases);
      if (found === null) continue;
      const next = path.join(dir, entry.name);
      if (last) {
        if (found) out.push({ name: found, file: next });
      } else {
        await walk(next, i + 1, found);
      }
    }
  };

  const addIfFile = async (file: string, name: string | undefined) => {
    const entries = await readDirSafe(path.dirname(file));
    if (name && entries.some((e) => e.isFile() && e.name === path.basename(file))) out.push({ name, file });
  };

  await walk(repoDir, 0, undefined);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Folds this segment's captures into the name so far. Upper-case captures are lowercased. Null if
 * the same placeholder used twice gives different names (e.g. `ORDERS/refunds.sql`).
 */
function mergeName(name: string | undefined, captures: string[], cases: Case[]): string | undefined | null {
  for (let i = 0; i < captures.length; i++) {
    const value = cases[i] === 'upper' ? captures[i].toLowerCase() : captures[i];
    if (name !== undefined && name.toLowerCase() !== value.toLowerCase()) return null;
    name ??= value;
  }
  return name;
}

/** The pattern as a glob (placeholders → `*`), for file watchers and tab-label rules. */
export function datasetPatternGlob(pattern: string): string {
  return pattern.split(/[\\/]+/).filter(Boolean).map((part) => part.replace(/\$\{\w+\}/g, '*')).join('/');
}

import { existsSync, statSync } from 'fs';
import * as path from 'path';
import { isScalar, parseDocument, visit } from 'yaml';

export interface TextRef {
  start: number;
  end: number;
}

export const DEFAULT_REPO_KEY = 'repo';

/**
 * The component repo URL in a cicd.yaml / ci.yaml, and where it is in the text. `key` is
 * `gitopsNav.repoKey`: a top-level key, or a dotted path to a nested one (`source.repo`).
 */
export function repoValue(text: string, key = DEFAULT_REPO_KEY): (TextRef & { url: string }) | undefined {
  const keyPath = key.split('.').filter(Boolean);
  if (!keyPath.length) return undefined;
  try {
    const node = parseDocument(text).getIn(keyPath, true);
    if (isScalar(node) && typeof node.value === 'string' && node.value.trim() && node.range) {
      return { url: node.value.trim(), start: node.range[0], end: node.range[1] };
    }
  } catch {
    // Half-typed YAML: no repo
  }
  return undefined;
}

/**
 * String values in a pipeline that name an existing file relative to the pipeline's folder,
 * e.g. `script: extract.py`. Doesn't depend on which key holds them, so both pipeline
 * flavours work.
 */
export function fileRefs(text: string, dir: string): (TextRef & { file: string })[] {
  const out: (TextRef & { file: string })[] = [];
  let doc;
  try {
    doc = parseDocument(text);
  } catch {
    return out;
  }
  const check = (node: unknown) => {
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return;
    const value = node.value.trim();
    if (!value || value.startsWith('-') || value.includes('://') || /\s/.test(value)) return;
    const file = path.resolve(dir, value);
    if (!file.startsWith(dir + path.sep)) return;
    if (existsSync(file) && statSync(file).isFile()) out.push({ start: node.range[0], end: node.range[1], file });
  };
  visit(doc, {
    Pair: (_, pair) => check(pair.value),
    Seq: (_, seq) => seq.items.forEach(check),
  });
  return out;
}

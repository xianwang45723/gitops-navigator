import { Dirent, promises as fs } from 'fs';

/**
 * A folder's entries, or none if it can't be read (missing, no permission). Typed explicitly:
 * `readdir(...).catch(() => [])` gives `Dirent[] | never[]`, which some TypeScript versions can't
 * contextually type callbacks against, leaving their parameters implicitly `any`.
 */
export async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

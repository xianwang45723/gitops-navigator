import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { readDirSafe } from './fsUtil';

/** A repo as Bitbucket Server knows it: project key + repo slug. */
export interface RemoteRef {
  host: string;
  project: string;
  slug: string;
}

/** Stable identity for matching a `repo:` URL to a local clone, whatever the URL style. */
export function remoteKey(ref: RemoteRef): string {
  return `${ref.project}/${ref.slug}`.toLowerCase();
}

/**
 * Parses the remote URL styles Bitbucket Server hands out:
 *   ssh://git@host:7999/proj/repo.git
 *   git@host:proj/repo.git
 *   https://[user@]host[/context]/scm/proj/repo.git
 */
export function parseRemote(url: string): RemoteRef | undefined {
  url = url.trim();
  let host: string;
  let segments: string[];

  const scp = /^[^@/\s]+@([^:/\s]+):(?!\d+\/)(.+)$/.exec(url);
  if (scp) {
    host = scp[1];
    segments = scp[2].split('/');
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    host = parsed.hostname;
    segments = parsed.pathname.split('/');
  }

  segments = segments.filter(Boolean);
  const scm = segments.indexOf('scm');
  if (scm >= 0) segments = segments.slice(scm + 1);
  if (segments.length < 2) return undefined;

  const [project, slug] = segments.slice(-2);
  return { host, project, slug: slug.replace(/\.git$/, '') };
}

/**
 * Repo name from the end of a clone URL: `.../project/some-component-app.git` → `some-component-app`.
 * Works for any URL style, including ones parseRemote can't split into project/slug.
 */
export function repoNameFromUrl(url: string): string | undefined {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop();
  const name = last?.replace(/\.git$/, '');
  return name || undefined;
}

export interface GitInfo {
  remoteUrl?: string;
  branch?: string;
  /** Branches that exist on origin, as far as the local clone knows. */
  remoteBranches: Set<string>;
}

/** Reads origin URL and current branch straight from .git, without spawning git. */
export async function readGitInfo(repoDir: string): Promise<GitInfo | undefined> {
  const gitDir = await resolveGitDir(repoDir);
  if (!gitDir) return undefined;

  const info: GitInfo = { remoteBranches: new Set() };

  const config = await readText(path.join(gitDir, 'config'));
  if (config) info.remoteUrl = originUrl(config);

  const head = await readText(path.join(gitDir, 'HEAD'));
  const ref = head && /^ref: refs\/heads\/(.+)$/m.exec(head);
  if (ref) info.branch = ref[1].trim();

  const packed = await readText(path.join(gitDir, 'packed-refs'));
  for (const m of packed?.matchAll(/ refs\/remotes\/origin\/(.+)$/gm) ?? []) {
    info.remoteBranches.add(m[1].trim());
  }
  for (const b of await listRefs(path.join(gitDir, 'refs', 'remotes', 'origin'))) {
    if (b !== 'HEAD') info.remoteBranches.add(b);
  }
  return info;
}

async function resolveGitDir(repoDir: string): Promise<string | undefined> {
  const dotGit = path.join(repoDir, '.git');
  const stat = await fs.stat(dotGit).catch(() => undefined);
  if (stat?.isDirectory()) return dotGit;
  if (stat?.isFile()) {
    // Worktrees and submodules: ".git" is a file pointing at the real git dir
    const m = /^gitdir: (.+)$/m.exec((await readText(dotGit)) ?? '');
    if (m) return path.resolve(repoDir, m[1].trim());
  }
  return undefined;
}

function originUrl(config: string): string | undefined {
  let inOrigin = false;
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    const url = inOrigin && /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
    if (url) return url[1];
  }
  return undefined;
}

async function listRefs(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readDirSafe(dir);
  const out: string[] = [];
  for (const e of entries) {
    const name = prefix + e.name;
    if (e.isDirectory()) out.push(...(await listRefs(path.join(dir, e.name), name + '/')));
    else out.push(name);
  }
  return out;
}

async function readText(file: string): Promise<string | undefined> {
  return fs.readFile(file, 'utf8').catch(() => undefined);
}

/**
 * `git clone url dir`, never prompting: credentials or passphrases make it fail fast instead of
 * hanging, so the caller can fall back to a terminal.
 */
export function cloneRepo(url: string, dir: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
    };
    execFile('git', ['clone', '--', url, dir], { env, signal }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve();
    });
  });
}

import * as path from 'path';
import { RemoteRef } from './git';
import { Repo } from './index';

export interface BitbucketOptions {
  /** e.g. https://bitbucket.invalid — empty means https://<remote host>. */
  baseUrl?: string;
  /** Fallback branch per repo folder name. */
  defaultBranches?: Record<string, string>;
}

/** Browse URL on Bitbucket Server / Data Center for a repo, or a file/folder inside it. */
export function browseUrl(
  remote: RemoteRef,
  opts: BitbucketOptions,
  extra: { relPath?: string; branch?: string } = {},
): string {
  const base = (opts.baseUrl || `https://${remote.host}`).replace(/\/+$/, '');
  // Personal repos live under ~username in clone URLs, and /users/username on the web
  const owner = remote.project.startsWith('~')
    ? `users/${encodeURIComponent(remote.project.slice(1))}`
    : `projects/${encodeURIComponent(remote.project.toUpperCase())}`;
  const rel = extra.relPath ? '/' + extra.relPath.split(path.sep).map(encodeURIComponent).join('/') : '';
  const at = extra.branch ? `?at=${encodeURIComponent(`refs/heads/${extra.branch}`)}` : '';
  return `${base}/${owner}/repos/${encodeURIComponent(remote.slug)}/browse${rel}${at}`;
}

/** Checked-out branch if origin has it, else the configured default, else Bitbucket's default. */
export function linkBranch(repo: Repo, opts: BitbucketOptions): string | undefined {
  if (repo.branch && repo.remoteBranches.has(repo.branch)) return repo.branch;
  return opts.defaultBranches?.[repo.name];
}

/** Browse URL for a local file or folder inside a cloned repo. */
export function urlForPath(repo: Repo, target: string, opts: BitbucketOptions): string | undefined {
  if (!repo.remote) return undefined;
  return browseUrl(repo.remote, opts, {
    relPath: path.relative(repo.dir, target) || undefined,
    branch: linkBranch(repo, opts),
  });
}

import { promises as fs } from 'fs';
import * as path from 'path';
import { LineCounter, parseDocument } from 'yaml';
import { parseRemote, readGitInfo, remoteKey, RemoteRef, repoNameFromUrl } from './git';
import { compileDatasetPattern, findDatasets } from './datasets';
import { repoValue } from './refs';
import { readDirSafe } from './fsUtil';
import { Logger, silentLogger } from './log';

export interface Config {
  root: string;
  gitopsRepo: string;
  /** `path` is the folder inside the repo to search, relative to the repo root. */
  pipelineRepos: { repo: string; path?: string; flavour?: string }[];
  databaseRepo: string;
  /** Key in cicd.yaml / ci.yaml holding the component repo URL (dotted for nested). */
  repoKey: string;
  /** Where dataset files sit in the database repo, e.g. `datasets/${dataset}/structure.sql`. */
  datasetPattern: string;
}

export interface Repo {
  /** Folder name under the root. */
  name: string;
  dir: string;
  remote?: RemoteRef;
  branch?: string;
  remoteBranches: Set<string>;
}

export interface App {
  /** `<namespace>/<app>` */
  id: string;
  namespace: string;
  name: string;
  /** The app's folder in the gitops repo. */
  dir: string;
  /** cicd.yaml, values*.yaml etc. that exist in `dir`. */
  files: string[];
  /** The cicd.yaml or ci.yaml holding the `repo:` key (or the first of them, if neither has it). */
  configFile: string;
  repoUrl?: string;
  remote?: RemoteRef;
  /** Local clone of the chart repo, if there is one. */
  chartRepo?: Repo;
  /** How chartRepo was found: its git remote matched repo:, or its folder is named after repo:. */
  matchedBy?: 'remote' | 'name';
  /** Folder holding Chart.yaml inside the chart repo. */
  chartDir?: string;
}

export interface Pipeline {
  name: string;
  file: string;
  /** 0-based line of the `name:` key. */
  line: number;
  repo: Repo;
  flavour?: string;
}

export interface Dataset {
  name: string;
  file: string;
}

export interface Index {
  config: Config;
  repos: Map<string, Repo>;
  apps: App[];
  pipelines: Pipeline[];
  datasets: Dataset[];
}

/** Files in a gitops app folder that may hold its `repo:` key, in the order they're checked. */
export const GITOPS_CONFIG_FILES = ['cicd.yaml', 'ci.yaml'];
export const GITOPS_APP_FILES = [...GITOPS_CONFIG_FILES, 'values.yaml', 'values-dev.yaml', 'values-ci.yaml'];

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.terraform', '.idea', '.vscode']);

export async function buildIndex(config: Config, log: Logger = silentLogger): Promise<Index> {
  const started = Date.now();
  log.info(`Scanning ${config.root}`);
  log.debug(
    `Config: gitops=${config.gitopsRepo}, repoKey=${config.repoKey}, database=${config.databaseRepo}, ` +
      `datasetPattern=${config.datasetPattern}, pipelineRepos=${JSON.stringify(config.pipelineRepos)}`,
  );

  const repos = await scanRepos(config.root, log);
  const byRemote = new Map<string, Repo>();
  for (const r of repos.values()) if (r.remote) byRemote.set(remoteKey(r.remote), r);
  const byName = new Map<string, Repo>();
  for (const r of repos.values()) byName.set(r.name.toLowerCase(), r);

  if (!repos.has(config.gitopsRepo)) log.warn(`No gitops repo: "${config.gitopsRepo}" isn't a git repo in ${config.root} (gitopsNav.gitopsRepo)`);

  const [apps, pipelines, datasets] = await Promise.all([
    scanApps(config, byRemote, byName, log),
    scanPipelines(config, repos, log),
    scanDatasets(config, repos, log),
  ]);
  log.info(
    `Found ${repos.size} repos, ${apps.length} apps, ${pipelines.length} pipelines, ${datasets.length} datasets in ${Date.now() - started} ms`,
  );
  return { config, repos, apps, pipelines, datasets };
}

/** Every direct child of root that is a git repo. Anything else sitting alongside is ignored. */
async function scanRepos(root: string, log: Logger): Promise<Map<string, Repo>> {
  const repos = new Map<string, Repo>();
  const entries = await readDirSafe(root);
  if (!entries.length) log.warn(`Can't read ${root}, or it's empty (gitopsNav.root)`);
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map(async (e) => {
        const dir = path.join(root, e.name);
        const git = await readGitInfo(dir);
        if (!git) {
          log.debug(`Skipped ${e.name}: not a git repo`);
          return;
        }
        const remote = git.remoteUrl ? parseRemote(git.remoteUrl) : undefined;
        if (!git.remoteUrl) log.debug(`Repo ${e.name}: no origin remote`);
        else if (!remote) log.warn(`Repo ${e.name}: can't read project/repo from origin ${git.remoteUrl}`);
        log.debug(`Repo ${e.name}: branch ${git.branch ?? '(detached)'}, origin ${remote ? remoteKey(remote) : git.remoteUrl ?? '(none)'}`);
        repos.set(e.name, { name: e.name, dir, remote, branch: git.branch, remoteBranches: git.remoteBranches });
      }),
  );
  return repos;
}

/**
 * Apps are `<ns>/<app>` folders in gitops with a cicd.yaml or ci.yaml. The folder name needn't
 * match the component repo: the repo comes from the `repo:` URL, matched to a sibling clone by its
 * git remote, or failing that by a sibling folder named after the end of the URL.
 */
async function scanApps(config: Config, byRemote: Map<string, Repo>, byName: Map<string, Repo>, log: Logger): Promise<App[]> {
  const gitopsDir = path.join(config.root, config.gitopsRepo);
  const apps: App[] = [];
  const chartDirs = new Map<Repo, Promise<string | undefined>>();

  for (const ns of await subdirs(gitopsDir)) {
    for (const name of await subdirs(path.join(gitopsDir, ns))) {
      const dir = path.join(gitopsDir, ns, name);
      const id = `${ns}/${name}`;
      const appConfig = await readAppConfig(dir, config.repoKey);
      if (!appConfig) {
        log.debug(`Skipped gitops/${id}: no ${GITOPS_CONFIG_FILES.join(' or ')}`);
        continue;
      }

      const { repoUrl, configFile } = appConfig;
      const remote = repoUrl ? parseRemote(repoUrl) : undefined;
      const urlName = repoUrl && repoNameFromUrl(repoUrl);
      const byRemoteMatch = remote && byRemote.get(remoteKey(remote));
      const byNameMatch = !byRemoteMatch && urlName ? byName.get(urlName.toLowerCase()) : undefined;
      const chartRepo = byRemoteMatch ?? byNameMatch;
      const matchedBy = byRemoteMatch ? 'remote' : byNameMatch ? 'name' : undefined;
      if (chartRepo && !chartDirs.has(chartRepo)) chartDirs.set(chartRepo, findChartDir(chartRepo.dir));
      const chartDir = chartRepo && (await chartDirs.get(chartRepo));

      const cfg = path.basename(configFile);
      if (!repoUrl) log.warn(`App ${id}: no "${config.repoKey}" key in ${cfg}, so no component repo (gitopsNav.repoKey)`);
      else if (!chartRepo) log.debug(`App ${id}: ${repoUrl} (from ${cfg}) isn't cloned: no sibling with that remote or named "${urlName}"`);
      else {
        log.debug(`App ${id}: ${repoUrl} (from ${cfg}) → ${chartRepo.name}/ (matched by ${matchedBy}), chart at ${chartDir ? path.relative(chartRepo.dir, chartDir) || '.' : '(no Chart.yaml)'}`);
        if (!chartDir) log.warn(`App ${id}: component repo ${chartRepo.name} has no Chart.yaml`);
      }

      const present = await Promise.all(GITOPS_APP_FILES.map((f) => exists(path.join(dir, f))));
      apps.push({
        id,
        namespace: ns,
        name,
        dir,
        files: GITOPS_APP_FILES.filter((_, i) => present[i]).map((f) => path.join(dir, f)),
        configFile,
        repoUrl,
        remote,
        chartRepo,
        matchedBy,
        chartDir,
      });
    }
  }
  const cloned = apps.filter((a) => a.chartRepo).length;
  const noKey = apps.filter((a) => !a.repoUrl).length;
  log.info(`Apps: ${apps.length} (${cloned} cloned, ${apps.length - cloned - noKey} not cloned, ${noKey} without a repo key)`);
  return apps.sort((a, b) => a.id.localeCompare(b.id));
}

/** The first of cicd.yaml / ci.yaml with the repo key; undefined if the folder has neither file. */
async function readAppConfig(dir: string, repoKey: string): Promise<{ configFile: string; repoUrl?: string } | undefined> {
  let firstFound: string | undefined;
  for (const name of GITOPS_CONFIG_FILES) {
    const file = path.join(dir, name);
    const text = await fs.readFile(file, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    firstFound ??= file;
    const repoUrl = repoValue(text, repoKey)?.url;
    if (repoUrl) return { configFile: file, repoUrl };
  }
  return firstFound ? { configFile: firstFound } : undefined;
}


/** Shallowest folder containing Chart.yaml. */
async function findChartDir(repoDir: string): Promise<string | undefined> {
  let level = [repoDir];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      const entries = await readDirSafe(dir);
      if (entries.some((e) => e.isFile() && e.name === 'Chart.yaml')) return dir;
      for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) next.push(path.join(dir, e.name));
    }
    level = next;
  }
  return undefined;
}

async function scanPipelines(config: Config, repos: Map<string, Repo>, log: Logger): Promise<Pipeline[]> {
  const pipelines: Pipeline[] = [];
  if (!config.pipelineRepos.length) log.info('No pipeline repos configured (gitopsNav.pipelineRepos)');
  for (const { repo: repoName, path: sub = '', flavour } of config.pipelineRepos) {
    const repo = repos.get(repoName);
    if (!repo) {
      log.warn(`Pipeline repo "${repoName}" isn't a git repo in ${config.root} (gitopsNav.pipelineRepos)`);
      continue;
    }
    const files = await findFiles(path.join(repo.dir, sub), (n) => n === 'pipeline');
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      const parsed = readPipelineName(text);
      const { name, line } = parsed ?? { name: path.basename(path.dirname(file)), line: 0 };
      if (!parsed) log.debug(`Pipeline ${path.relative(config.root, file)}: no name: key, using folder name "${name}"`);
      log.trace(`Pipeline ${name}: ${path.relative(config.root, file)}`);
      pipelines.push({ name, file, line, repo, flavour });
    }
    log.info(`Pipelines in ${repoName}${sub ? `/${sub}` : ''}${flavour ? ` (${flavour})` : ''}: ${files.length}`);
  }
  return pipelines.sort((a, b) => a.name.localeCompare(b.name));
}

export function readPipelineName(text: string): { name: string; line: number } | undefined {
  try {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter });
    const node = doc.get('name', true) as { value?: unknown; range?: [number, number, number] } | undefined;
    if (!node || typeof node.value !== 'string') return undefined;
    return { name: node.value, line: node.range ? lineCounter.linePos(node.range[0]).line - 1 : 0 };
  } catch {
    return undefined;
  }
}

async function scanDatasets(config: Config, repos: Map<string, Repo>, log: Logger): Promise<Dataset[]> {
  if (!repos.has(config.databaseRepo)) {
    log.warn(`Database repo "${config.databaseRepo}" isn't a git repo in ${config.root} (gitopsNav.databaseRepo)`);
    return [];
  }
  if (!compileDatasetPattern(config.datasetPattern)) {
    log.warn(`Dataset pattern "${config.datasetPattern}" needs a \${dataset} placeholder and must stay inside the repo (gitopsNav.datasetPattern)`);
    return [];
  }
  const datasets = await findDatasets(path.join(config.root, config.databaseRepo), config.datasetPattern);
  for (const d of datasets) log.trace(`Dataset ${d.name}: ${path.relative(config.root, d.file)}`);
  log.info(`Datasets matching ${config.databaseRepo}/${config.datasetPattern}: ${datasets.length}`);
  return datasets;
}

/** Apps whose gitops folder or chart repo contains `file`. */
export function appsForFile(index: Index, file: string): { app: App; side: 'gitops' | 'chart' }[] {
  const out: { app: App; side: 'gitops' | 'chart' }[] = [];
  for (const app of index.apps) {
    if (path.dirname(file) === app.dir) out.push({ app, side: 'gitops' });
    else if (app.chartRepo && isInside(file, app.chartRepo.dir)) out.push({ app, side: 'chart' });
  }
  return out;
}

export function repoForFile(index: Index, file: string): Repo | undefined {
  for (const repo of index.repos.values()) if (isInside(file, repo.dir)) return repo;
  return undefined;
}

export const DEFAULT_COMPONENT_OPEN_ORDER = ['README.md', 'Dockerfile', '${chart}/values.yaml'];

/**
 * First file in `order` that exists in the app's component repo. Entries are relative to the
 * repo root; `${chart}` is the folder holding Chart.yaml (entries using it are skipped if there
 * is no chart). Entries pointing outside the repo are ignored.
 */
export async function componentTarget(app: App, order: string[]): Promise<string | undefined> {
  const repo = app.chartRepo;
  if (!repo) return undefined;
  for (const entry of order) {
    if (entry.includes('${chart}') && !app.chartDir) continue;
    const rel = entry.replace(/\$\{chart\}/g, app.chartDir ? path.relative(repo.dir, app.chartDir) || '.' : '');
    const file = path.resolve(repo.dir, rel);
    if (!isInside(file, repo.dir)) continue;
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat?.isFile()) return file;
  }
  return undefined;
}

/**
 * True for `dir` itself or anything under it. Tolerates trailing separators, and on macOS and
 * Windows (case-insensitive file systems) differences in case.
 */
export function isSameOrInside(file: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => {
    const n = path.resolve(p);
    return platform === 'darwin' || platform === 'win32' ? n.toLowerCase() : n;
  };
  const rel = path.relative(norm(dir), norm(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readDirSafe(dir);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
}

async function findFiles(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readDirSafe(dir);
  await Promise.all(
    entries.map(async (e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) out.push(...(await findFiles(p, match)));
      else if (e.isFile() && match(e.name)) out.push(p);
    }),
  );
  return out;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

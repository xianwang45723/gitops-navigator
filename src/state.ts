import * as path from 'path';
import * as vscode from 'vscode';
import { BitbucketOptions } from './core/bitbucket';
import { buildIndex, Config, DEFAULT_COMPONENT_OPEN_ORDER, Index } from './core/index';
import { DEFAULT_DATASET_PATTERN, datasetPatternGlob } from './core/datasets';
import { Recent } from './core/recent';
import { DEFAULT_REPO_KEY } from './core/refs';

const ARGO_CD_VARIANTS: Record<string, { setting: string; label: string }> = {
  'values-dev.yaml': { setting: 'argoCdDevUrl', label: 'Argo CD (dev)' },
  'values-ci.yaml': { setting: 'argoCdCiUrl', label: 'Argo CD (CI)' },
};

/** Holds the current index and rebuilds it when settings or watched files change. */
export class State implements vscode.Disposable {
  private current?: Promise<Index>;
  private watchers: vscode.FileSystemWatcher[] = [];
  private timer?: NodeJS.Timeout;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];

  readonly onDidChange = this.changed.event;
  readonly recent: Recent;

  constructor(workspaceState: vscode.Memento, readonly log: vscode.LogOutputChannel) {
    this.recent = new Recent(workspaceState);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gitopsNav')) this.refresh('settings changed');
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh('workspace folders changed')),
    );
  }

  index(): Promise<Index | undefined> {
    if (!this.current) this.refresh('first use');
    return this.current ?? Promise.resolve(undefined);
  }

  /** Rebuilds the index; `reason` is only for the log. */
  refresh(reason = 'requested'): void {
    const config = readConfig();
    if (!config) {
      this.log.info(`Not scanning (${reason}): no folder open and gitopsNav.root not set`);
      this.current = undefined;
      return;
    }
    this.log.debug(`Rescan: ${reason}`);
    this.watch(config);
    this.current = buildIndex(config, this.log);
    this.current.then(
      () => this.changed.fire(),
      (err) => {
        this.log.error(`Indexing failed: ${err instanceof Error ? err.stack ?? err.message : err}`);
        vscode.window.showErrorMessage(`GitOps Nav: indexing failed: ${err}`, 'Show Log').then((c) => c && this.log.show());
      },
    );
  }

  bitbucket(): BitbucketOptions {
    const cfg = vscode.workspace.getConfiguration('gitopsNav');
    return {
      baseUrl: cfg.get<string>('bitbucketUrl') || undefined,
      defaultBranches: cfg.get<Record<string, string>>('defaultBranches'),
    };
  }

  /** Branch the gitops repo should be on; undefined = don't check. */
  gitopsBranch(): string | undefined {
    return vscode.workspace.getConfiguration('gitopsNav').get<string>('gitopsBranch') || undefined;
  }

  gitopsTint(): 'accent' | 'muted' | 'off' {
    return vscode.workspace.getConfiguration('gitopsNav').get('gitopsTint', 'accent');
  }

  componentOpenMode(): 'file' | 'folder' {
    return vscode.workspace.getConfiguration('gitopsNav').get('componentOpenMode', 'file');
  }

  componentOpenOrder(): string[] {
    return vscode.workspace.getConfiguration('gitopsNav').get<string[]>('componentOpenOrder', DEFAULT_COMPONENT_OPEN_ORDER);
  }

  /**
   * Argo CD link for a file in a gitops app folder. values-dev.yaml and values-ci.yaml configure
   * the dev chart (in <ns>-dev) and the CI chart (which lays down the Tekton pipeline), so each can
   * point at its own Argo CD app; if its setting is empty, the app's main link is used.
   */
  argoCdLink(fileName: string): { label: string; template?: string } {
    const cfg = vscode.workspace.getConfiguration('gitopsNav');
    const main = { label: 'Argo CD', template: cfg.get<string>('argoCdUrl') || undefined };
    const variant = ARGO_CD_VARIANTS[fileName];
    const template = variant && (cfg.get<string>(variant.setting) || undefined);
    return template ? { label: variant.label, template } : main;
  }

  dashboardUrlTemplate(): string | undefined {
    return vscode.workspace.getConfiguration('gitopsNav').get<string>('pipelineDashboardUrl') || undefined;
  }

  decorations(): 'both' | 'topBar' | 'inline' {
    return vscode.workspace.getConfiguration('gitopsNav').get('decorations', 'both');
  }

  private watch(config: Config) {
    this.watchers.forEach((w) => w.dispose());
    const at = (dir: string, glob: string) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), glob));
    this.watchers = [
      at(config.root, '**/{pipeline,cicd.yaml,ci.yaml,Chart.yaml}'),
      at(path.join(config.root, config.databaseRepo), datasetPatternGlob(config.datasetPattern)),
    ];
    const debounced = (what: string) => (uri: vscode.Uri) => {
      this.log.trace(`File ${what}: ${path.relative(config.root, uri.fsPath)}`);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(`${path.relative(config.root, uri.fsPath)} ${what}`), 500);
    };
    for (const w of this.watchers) {
      w.onDidCreate(debounced('created'));
      w.onDidChange(debounced('changed'));
      w.onDidDelete(debounced('deleted'));
    }
  }

  dispose() {
    clearTimeout(this.timer);
    this.watchers.forEach((w) => w.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

export function readConfig(): Config | undefined {
  const cfg = vscode.workspace.getConfiguration('gitopsNav');
  const root = cfg.get<string>('root') || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return undefined;
  return {
    root,
    gitopsRepo: cfg.get('gitopsRepo', 'gitops'),
    pipelineRepos: cfg.get('pipelineRepos', []),
    databaseRepo: cfg.get('databaseRepo', 'database'),
    repoKey: cfg.get<string>('repoKey') || DEFAULT_REPO_KEY,
    datasetPattern: cfg.get('datasetPattern', DEFAULT_DATASET_PATTERN),
  };
}

import * as path from 'path';
import * as vscode from 'vscode';
import { readGitInfo } from './core/git';
import { State } from './state';

/** Amber status bar item while the gitops repo isn't on its usual branch (`gitopsNav.gitopsBranch`). */
export class GitopsBranchWarning implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('gitopsNav.branch', vscode.StatusBarAlignment.Left, 100);
  private headWatcher?: vscode.FileSystemWatcher;
  private watchedDir?: string;
  private shown = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private state: State) {
    this.item.name = 'GitOps branch';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.command = 'gitopsNav.gitopsBranchWarning';
    this.disposables.push(
      this.item,
      state.onDidChange(() => this.update()),
      vscode.window.onDidChangeWindowState((w) => w.focused && this.update()),
      vscode.commands.registerCommand('gitopsNav.gitopsBranchWarning', () => this.explain()),
    );
    this.update();
  }

  private async gitopsDir() {
    const index = await this.state.index();
    return index && path.join(index.config.root, index.config.gitopsRepo);
  }

  private async update() {
    const dir = await this.gitopsDir();
    this.watchHead(dir);
    const expected = this.state.gitopsBranch();
    const git = dir && expected ? await readGitInfo(dir) : undefined;
    if (!git || git.branch === expected) {
      if (this.shown) this.state.log.info(`gitops is back on ${expected}`);
      this.shown = false;
      this.item.hide();
      return;
    }
    if (!this.shown) this.state.log.warn(`gitops is on ${git.branch ?? 'a detached HEAD'}, not ${expected} (gitopsNav.gitopsBranch)`);
    this.shown = true;
    this.item.text = `$(warning) gitops: ${git.branch ?? 'detached HEAD'}`;
    this.item.tooltip = `The gitops repo is usually on ${expected}. Click for details.`;
    this.item.show();
  }

  /** Re-check whenever HEAD moves (checkout, switch), not just when watched files change. */
  private watchHead(dir: string | undefined) {
    if (dir === this.watchedDir) return;
    this.watchedDir = dir;
    this.headWatcher?.dispose();
    if (!dir) return;
    this.headWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(dir, '.git')), 'HEAD'));
    this.headWatcher.onDidChange(() => this.update());
    this.headWatcher.onDidCreate(() => this.update());
  }

  private async explain() {
    const dir = await this.gitopsDir();
    const expected = this.state.gitopsBranch();
    const git = dir && (await readGitInfo(dir));
    if (!dir || !expected || !git) return;
    const choice = await vscode.window.showWarningMessage(
      `The gitops repo is on ${git.branch ?? 'a detached HEAD'}, not ${expected}.`,
      { modal: true, detail: `Changes made here won't reach ${expected}, so they won't deploy until merged.` },
      `Switch to ${expected}`,
    );
    if (!choice) return;
    // In a terminal, so git's own output (e.g. "your local changes would be overwritten") is visible
    const terminal = vscode.window.createTerminal({ name: 'gitops', cwd: dir });
    terminal.sendText(`git switch ${expected}`);
    terminal.show();
  }

  dispose() {
    this.headWatcher?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Index, isSameOrInside } from './core/index';
import { State } from './state';

/**
 * Tints the gitops folder and the folders under it (not files) in the explorer, using
 * one of our contributed colours (which default to theme colours, so it adapts to any theme).
 * Extensions can't change row backgrounds, so this is the closest available. `gitopsNav.gitopsTint`.
 */
export class GitopsTint implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private gitopsDir?: string;
  private readonly disposables: vscode.Disposable[];

  constructor(private state: State) {
    this.disposables = [
      this.changed,
      vscode.window.registerFileDecorationProvider(this),
      state.onDidChange(async () => {
        const index: Index | undefined = await state.index();
        this.gitopsDir = index && path.join(index.config.root, index.config.gitopsRepo);
        this.changed.fire(undefined);
      }),
    ];
  }

  async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
    const tint = this.state.gitopsTint();
    if (tint === 'off' || !this.gitopsDir || uri.scheme !== 'file') return undefined;
    if (!isSameOrInside(uri.fsPath, this.gitopsDir)) return undefined;
    if (!(await fs.stat(uri.fsPath).catch(() => undefined))?.isDirectory()) return undefined;
    return new vscode.FileDecoration(undefined, 'gitops', new vscode.ThemeColor(tint === 'muted' ? 'gitopsNav.gitopsMuted' : 'gitopsNav.gitopsAccent'));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

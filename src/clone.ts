import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { cloneRepo } from './core/git';
import { App } from './core/index';
import { State } from './state';

/**
 * Clones an app's component repo next to the others. Returns true once it's cloned and indexed.
 * If git can't clone without prompting (password, passphrase), offers to run it in a terminal.
 */
export async function cloneComponent(state: State, app: App): Promise<boolean> {
  const index = await state.index();
  if (!index || !app.repoUrl || !app.remote) return false;

  const dir = path.join(index.config.root, app.remote.slug);
  if (await fs.stat(dir).then(() => true, () => false)) {
    vscode.window.showErrorMessage(`GitOps Nav: can't clone ${app.remote.slug}: ${dir} already exists but isn't a clone of ${app.repoUrl}.`);
    return false;
  }

  state.log.info(`Cloning ${app.repoUrl} into ${dir}`);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Cloning ${app.remote.slug}…`, cancellable: true },
      (_, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return cloneRepo(app.repoUrl!, dir, abort.signal);
      },
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      state.log.info(`Clone of ${app.remote.slug} cancelled`);
      return false;
    }
    state.log.warn(`Clone of ${app.remote.slug} failed: ${(err as Error).message}`);
    const choice = await vscode.window.showErrorMessage(
      `GitOps Nav: cloning ${app.remote.slug} failed: ${(err as Error).message}`,
      'Clone in Terminal',
    );
    if (choice) {
      // The index picks the repo up by itself once its Chart.yaml lands
      const terminal = vscode.window.createTerminal({ name: `clone ${app.remote.slug}`, cwd: index.config.root });
      terminal.sendText(`git clone ${shellQuote(app.repoUrl)} ${shellQuote(app.remote.slug)}`);
      terminal.show();
    }
    return false;
  }

  state.log.info(`Cloned ${app.remote.slug}`);
  state.refresh(`cloned ${app.remote.slug}`);
  await state.index();
  return true;
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

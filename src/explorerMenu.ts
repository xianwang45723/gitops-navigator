import * as path from 'path';
import * as vscode from 'vscode';
import { App } from './core/index';
import { openComponent, openHelmConfig } from './search';
import { State } from './state';

/**
 * Explorer right-click menu: "Jump to repo" on a gitops app folder, and "Jump to Gitops" on a
 * component repo folder (its root, or the folder holding Chart.yaml). The menus show only on those
 * folders, via context keys listing their paths, kept in step with the index.
 */
export class ExplorerMenu implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];

  constructor(private state: State) {
    this.disposables = [
      state.onDidChange(() => this.update()),
      vscode.commands.registerCommand('gitopsNav.jumpToRepo', (uri?: vscode.Uri) => this.jumpToRepo(uri)),
      vscode.commands.registerCommand('gitopsNav.jumpToValues', (uri?: vscode.Uri) => this.jumpToValues(uri)),
    ];
  }

  private async update() {
    const apps = (await this.state.index())?.apps ?? [];
    const appDirs = apps.filter((a) => a.repoUrl).map((a) => key(a.dir));
    const componentDirs = apps.flatMap((a) => (a.chartRepo ? [a.chartRepo.dir, a.chartDir ?? a.chartRepo.dir] : [])).map(key);
    await vscode.commands.executeCommand('setContext', 'gitopsNav.appDirs', [...new Set(appDirs)]);
    await vscode.commands.executeCommand('setContext', 'gitopsNav.componentDirs', [...new Set(componentDirs)]);
  }

  /** Shows the app's component repo folder in the explorer, expanded; offers a clone if it isn't cloned. */
  private async jumpToRepo(uri?: vscode.Uri) {
    if (!uri) return;
    const app = (await this.state.index())?.apps.find((a) => key(a.dir) === key(uri.fsPath));
    if (!app) return;
    if (!app.chartRepo) {
      await openComponent(this.state, app);
      return;
    }
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(app.chartRepo.dir));
    await vscode.commands.executeCommand('list.expand');
  }

  /** Opens the values.yaml of the gitops app deploying this repo; asks which if several do. */
  private async jumpToValues(uri?: vscode.Uri) {
    if (!uri) return;
    const dir = key(uri.fsPath);
    const apps = ((await this.state.index())?.apps ?? []).filter(
      (a) => a.chartRepo && (key(a.chartRepo.dir) === dir || (a.chartDir && key(a.chartDir) === dir)),
    );
    const app = apps.length > 1 ? await pickApp(apps) : apps[0];
    if (app) await openHelmConfig(app);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

async function pickApp(apps: App[]): Promise<App | undefined> {
  const picked = await vscode.window.showQuickPick(
    apps.map((app) => ({ label: app.id, description: path.basename(app.configFile), app })),
    { title: 'Jump to Gitops', placeHolder: `${apps.length} gitops apps deploy this repo` },
  );
  return picked?.app;
}

/** The path as the explorer's `resourcePath` has it (e.g. a lowercase drive letter on Windows). */
const key = (p: string) => vscode.Uri.file(path.resolve(p)).fsPath;

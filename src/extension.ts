import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitopsBranchWarning } from './branchWarning';
import { chooseBrowser, defaultToChromeOnWindows } from './browser';
import { ExplorerMenu } from './explorerMenu';
import { GitopsTint } from './gitopsTint';
import { cloneComponent } from './clone';
import { workspaceFileContent } from './core/workspaceFile';
import { registerProviders } from './providers';
import { goTo, openComponent, openUrl, revealGitops } from './search';
import { readConfig, State } from './state';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('GitOps Nav', { log: true });
  log.info(`GitOps Nav ${context.extension.packageJSON.version} starting`);
  const state = new State(context.workspaceState, log);
  state.refresh('startup');
  defaultToChromeOnWindows(context.globalState, log);

  context.subscriptions.push(
    log,
    state,
    ...registerProviders(state),
    new GitopsBranchWarning(state),
    new GitopsTint(state),
    new ExplorerMenu(state),
    vscode.commands.registerCommand('gitopsNav.goTo', () => goTo(state)),
    vscode.commands.registerCommand('gitopsNav.goToApp', () => goTo(state, 'app')),
    vscode.commands.registerCommand('gitopsNav.goToPipeline', () => goTo(state, 'pipeline')),
    vscode.commands.registerCommand('gitopsNav.goToDataset', () => goTo(state, 'dataset')),
    vscode.commands.registerCommand('gitopsNav.refresh', () => state.refresh('Refresh Index command')),
    vscode.commands.registerCommand('gitopsNav.showLog', () => log.show()),
    vscode.commands.registerCommand('gitopsNav.revealGitops', () => revealGitops(state)),
    vscode.commands.registerCommand('gitopsNav.chooseBrowser', chooseBrowser),
    vscode.commands.registerCommand('gitopsNav.createWorkspace', createWorkspace),
    vscode.commands.registerCommand('gitopsNav.openUrl', openUrl),
    vscode.commands.registerCommand('gitopsNav.openRepo', (appId: string) => openRepo(state, appId)),
    vscode.commands.registerCommand('gitopsNav.cloneComponent', async (appId: string) => {
      const app = (await state.index())?.apps.find((a) => a.id === appId);
      if (app && (await cloneComponent(state, app))) await openRepo(state, appId);
    }),
  );
}

async function openRepo(state: State, appId: string) {
  const app = (await state.index())?.apps.find((a) => a.id === appId);
  if (app) await openComponent(state, app);
}

async function createWorkspace() {
  const config = readConfig();
  if (!config) {
    vscode.window.showWarningMessage('GitOps Nav: open the folder that holds your repos first.');
    return;
  }
  const file = path.join(config.root, `${path.basename(config.root)}.code-workspace`);
  const exists = await fs.access(file).then(() => true, () => false);
  if (exists) {
    const answer = await vscode.window.showWarningMessage(
      `${path.basename(file)} already exists.`,
      { modal: true },
      'Overwrite',
    );
    if (answer !== 'Overwrite') return;
  }
  await fs.writeFile(file, JSON.stringify(workspaceFileContent(config.gitopsRepo, config.databaseRepo, config.datasetPattern), null, 2) + '\n');
  const open = await vscode.window.showInformationMessage(`Created ${file}`, 'Open Workspace');
  if (open) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file));
}

export function deactivate() {}

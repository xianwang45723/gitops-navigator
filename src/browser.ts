import * as path from 'path';
import * as vscode from 'vscode';
import { findWindowsChrome } from './core/chrome';

const CHROME_DEFAULTED = 'gitopsNav.chromeDefaulted';

/**
 * On Windows, sets VS Code's browser for links (`workbench.externalBrowser`, user settings) to
 * Chrome, once. Skipped if the user has already chosen a browser or Chrome isn't installed; never
 * re-applied, so a later change (e.g. via Choose Browser for Links) sticks.
 */
export async function defaultToChromeOnWindows(globalState: vscode.Memento, log: vscode.LogOutputChannel) {
  if (process.platform !== 'win32' || globalState.get(CHROME_DEFAULTED)) return;
  const chosen = vscode.workspace.getConfiguration('workbench').inspect<string>('externalBrowser')?.globalValue;
  if (chosen) {
    log.info(`Browser for links already set to "${chosen}"; not defaulting to Chrome`);
    await globalState.update(CHROME_DEFAULTED, true);
    return;
  }
  const chrome = findWindowsChrome();
  if (!chrome) {
    log.info('Chrome not found in its usual install locations; links keep using the system default browser');
    return;
  }
  log.info(`Setting workbench.externalBrowser to chrome (found ${chrome})`);

  await vscode.workspace.getConfiguration('workbench').update('externalBrowser', 'chrome', vscode.ConfigurationTarget.Global);
  await globalState.update(CHROME_DEFAULTED, true);
  toast('GitOps Nav: links from VS Code will now open in Chrome. Change this with "GitOps Nav: Choose Browser for Links".');
}

/** A notification that closes itself after a few seconds. */
function toast(message: string, ms = 8000) {
  vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: message }, () => new Promise((resolve) => setTimeout(resolve, ms)));
}

function externalBrowser(): string | undefined {
  return vscode.workspace.getConfiguration('workbench').get<string>('externalBrowser') || undefined;
}

/** Quick pick that sets `workbench.externalBrowser` in the user's settings. */
export async function chooseBrowser() {
  type Choice = vscode.QuickPickItem & { value?: string; browse?: boolean };
  const current = externalBrowser();
  const mark = (value?: string) => (value === current ? '$(check) current' : undefined);
  const choices: Choice[] = [
    { label: 'Chrome', value: 'chrome', description: mark('chrome') },
    { label: 'Edge', value: 'edge', description: mark('edge') },
    { label: 'Firefox', value: 'firefox', description: mark('firefox') },
    {
      label: 'System default',
      value: undefined,
      description: mark(undefined),
    },
    { label: '$(folder-opened) Browse for a program…', browse: true, description: current && !['chrome', 'edge', 'firefox'].includes(current) ? `current: ${current}` : undefined },
  ];

  const choice = await vscode.window.showQuickPick(choices, {
    title: 'Browser for links opened from VS Code',
    placeHolder: 'Sets workbench.externalBrowser in your user settings. Applies to all web links VS Code opens.',
  });
  if (!choice) return;

  let value = choice.value;
  if (choice.browse) {
    const [file] =
      (await vscode.window.showOpenDialog({
        title: 'Choose a browser',
        canSelectMany: false,
        filters: process.platform === 'win32' ? { Programs: ['exe'] } : undefined,
      })) ?? [];
    if (!file) return;
    value = file.fsPath;
  }

  await vscode.workspace.getConfiguration('workbench').update('externalBrowser', value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(value ? `Links will open in ${path.basename(value)}.` : 'Links will open in your system default browser.');
}

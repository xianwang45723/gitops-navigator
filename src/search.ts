import * as path from 'path';
import * as vscode from 'vscode';
import { browseUrl } from './core/bitbucket';
import { readDirSafe } from './core/fsUtil';
import { App, componentTarget, Index, Pipeline } from './core/index';
import { cloneComponent } from './clone';
import { State } from './state';

export type Kind = 'app' | 'pipeline' | 'dataset';

const COMPONENT_ICONS = { box: '$(package)', git: '$(source-control)' };

/** `gitops-*` icons are our own, from media/gitops-nav.woff (see scripts/build-icon.py). */
export const ICONS = {
  get component() {
    const choice = vscode.workspace.getConfiguration('gitopsNav').get<keyof typeof COMPONENT_ICONS>('componentIcon', 'box');
    return COMPONENT_ICONS[choice] ?? COMPONENT_ICONS.box;
  },
  helmConfig: '$(gitops-helm-config)',
  pipeline: '$(gitops-pipeline)',
  dataset: '$(database)',
};

const KINDS: Record<Kind, { prefix: string; title: string }> = {
  app: { prefix: 'a', title: 'Apps' },
  pipeline: { prefix: 'p', title: 'Pipelines' },
  dataset: { prefix: 'd', title: 'Datasets' },
};

/** `id` identifies the item across sessions, for the recently-opened list. */
type Item = vscode.QuickPickItem & { id: string; open: () => unknown; type: Kind };
type Row = Item | (vscode.QuickPickItem & { kind: vscode.QuickPickItemKind.Separator });

/** Two Go to presses closer than this jump to the gitops folder instead. */
const DOUBLE_TAP_MS = 500;
let lastTap = 0;
let tapSeq = 0;
let openPick: vscode.QuickPick<Row> | undefined;

/** One fuzzy picker over apps, pipelines and datasets. Type "a:", "p:" or "d:" (or with a space) to narrow. */
export async function goTo(state: State, only?: Kind) {
  if (!only) {
    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      tapSeq++; // the first press may still be building its picker; stop it showing
      openPick?.hide();
      await revealGitops(state);
      return;
    }
    lastTap = now;
  }
  const seq = ++tapSeq;

  const index = await state.index();
  if (seq !== tapSeq) return;
  if (!index) {
    vscode.window.showWarningMessage('GitOps Nav: open the folder that holds your repos first.');
    return;
  }

  const all = items(index, state);
  const pick = vscode.window.createQuickPick<Row>();
  pick.matchOnDescription = true;
  const clear: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Show everything' };

  const separator = (label: string): Row => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const setKind = (kind?: Kind) => {
    // Recently opened first; once you type, VS Code ranks by best match instead
    const { recent, rest } = state.recent.split(kind ? all.filter((i) => i.type === kind) : all, (i) => i.id);
    pick.items = recent.length ? [separator('recently opened'), ...recent, separator('all'), ...rest] : rest;
    pick.title = kind ? `Go to ${KINDS[kind].title}` : 'Go to App, Pipeline or Dataset';
    pick.placeholder = kind
      ? `Searching ${KINDS[kind].title.toLowerCase()} only · type another prefix to switch, or use the button above to show everything`
      : 'Type to search · a: apps · p: pipelines · d: datasets';
    pick.buttons = kind ? [clear] : [];
  };
  setKind(only);

  pick.onDidChangeValue((value) => {
    const m = /^([apd])[: ]\s*(.*)$/.exec(value);
    const kind = m && (Object.keys(KINDS) as Kind[]).find((k) => KINDS[k].prefix === m[1]);
    if (!kind) return;
    setKind(kind);
    pick.value = m[2];
  });
  pick.onDidTriggerButton(() => setKind());
  pick.onDidAccept(() => {
    const [item] = pick.selectedItems as Item[];
    pick.hide();
    if (!item) return;
    state.recent.touch(item.id);
    item.open();
  });
  pick.onDidHide(() => {
    if (openPick === pick) openPick = undefined;
    pick.dispose();
  });
  openPick = pick;
  pick.show();
}

function items(index: Index, state: State): Item[] {
  const rel = (file: string) => path.relative(index.config.root, file);
  return [
    // Each app appears twice: the component repo itself, and its helm config in gitops
    ...index.apps.flatMap((app) => [
      {
        type: 'app' as const,
        id: `component:${app.id}`,
        label: `${ICONS.component} ${app.chartRepo?.name ?? app.remote?.slug ?? app.name}`,
        description: app.chartRepo ? undefined : app.repoUrl ? 'not cloned' : 'no repo: key',
        open: () => openComponent(state, app),
      },
      {
        type: 'app' as const,
        id: `helm:${app.id}`,
        label: `${ICONS.helmConfig} ${app.id}`,
        description: `helm config · ${index.config.gitopsRepo}`,
        open: () => openHelmConfig(app),
      },
    ]),
    ...index.pipelines.map((p) => ({
      type: 'pipeline' as const,
      id: `pipeline:${p.file}`,
      label: `${ICONS.pipeline} ${p.name}`,
      description: [path.dirname(rel(p.file)), p.flavour].filter(Boolean).join(' · '),
      open: () => openPipeline(p),
    })),
    ...index.datasets.map((d) => ({
      type: 'dataset' as const,
      id: `dataset:${d.name}`,
      label: `${ICONS.dataset} ${d.name}`,
      description: path.dirname(rel(d.file)),
      open: () => openFile(d.file),
    })),
  ];
}

/**
 * The component repo on disk: the first file in `gitopsNav.componentOpenOrder` that exists, or
 * just the repo folder in the explorer if none do (or if `componentOpenMode` is "folder").
 * If it isn't cloned, offers to clone it or open it on Bitbucket.
 */
export async function openComponent(state: State, app: App) {
  if (app.chartRepo) {
    const target = state.componentOpenMode() === 'file' ? await componentTarget(app, state.componentOpenOrder()) : undefined;
    if (target) await openFile(target);
    else await reveal(app.chartRepo.dir);
  } else if (app.remote) {
    const choice = await vscode.window.showInformationMessage(
      `${app.remote.slug} isn't cloned.`,
      { modal: true, detail: app.repoUrl },
      'Clone',
      'Open in Bitbucket',
    );
    if (choice === 'Open in Bitbucket') await openUrl(browseUrl(app.remote, state.bitbucket()));
    if (choice === 'Clone' && (await cloneComponent(state, app))) {
      const cloned = (await state.index())?.apps.find((a) => a.id === app.id);
      if (cloned?.chartRepo) await openComponent(state, cloned);
    }
  }
}

/** The app's folder in the gitops repo, opening its values.yaml. */
export async function openHelmConfig(app: App) {
  await reveal(app.dir);
  const values = app.files.find((f) => path.basename(f) === 'values.yaml') ?? app.files[0];
  if (values) await openFile(values);
}

export async function openFile(file: string, line = 0) {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
  if (line) {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

const reveal = (dir: string) => vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir));

/**
 * Shows the gitops repo folder in the explorer, expanded, with each namespace folder collapsed.
 * VS Code has no API to collapse a given folder, so each one is selected and collapsed in turn;
 * the rest of the explorer is left alone.
 */
export async function revealGitops(state: State) {
  const index = await state.index();
  if (!index) return;
  const gitopsDir = path.join(index.config.root, index.config.gitopsRepo);
  const entries = await readDirSafe(gitopsDir);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    await reveal(path.join(gitopsDir, e.name));
    await vscode.commands.executeCommand('list.collapse');
  }
  await reveal(gitopsDir);
  await vscode.commands.executeCommand('list.expand');
}

export const openPipeline = (p: Pipeline) => openFile(p.file, p.line);
export const openUrl = (url: string) => vscode.env.openExternal(vscode.Uri.parse(url, true));

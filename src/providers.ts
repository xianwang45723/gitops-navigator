import * as path from 'path';
import * as vscode from 'vscode';
import { browseUrl, urlForPath } from './core/bitbucket';
import { repoNameFromUrl } from './core/git';
import { appsForFile, repoForFile } from './core/index';
import { fileRefs, repoValue } from './core/refs';
import { fillUrlTemplate } from './core/urlTemplate';
import { ICONS } from './search';
import { State } from './state';

const FILES: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/{cicd.yaml,ci.yaml,values*.yaml,Chart.yaml,pipeline,*.sql}' },
];

/** Feeds apps, pipelines and datasets into "#" in Quick Open and Go to Symbol in Workspace. */
export class SymbolProvider implements vscode.WorkspaceSymbolProvider {
  constructor(private state: State) {}

  async provideWorkspaceSymbols(query: string) {
    const index = await this.state.index();
    if (!index) return [];
    const q = query.toLowerCase();
    const matches = (name: string) => {
      let i = 0;
      for (const ch of name.toLowerCase()) if (ch === q[i]) i++;
      return i === q.length;
    };
    const at = (file: string, line = 0) => new vscode.Location(vscode.Uri.file(file), new vscode.Position(line, 0));
    const S = vscode.SymbolInformation;
    return [
      ...index.apps
        .filter((a) => matches(a.id) && a.files[0])
        .map((a) => new S(a.id, vscode.SymbolKind.Module, 'helm config', at(a.files[0]))),
      ...index.apps
        .filter((a) => a.chartRepo && a.chartDir && matches(a.chartRepo.name))
        .map((a) => new S(a.chartRepo!.name, vscode.SymbolKind.Package, `component · ${a.id}`, at(path.join(a.chartDir!, 'Chart.yaml')))),
      ...index.pipelines
        .filter((p) => matches(p.name))
        .map((p) => new S(p.name, vscode.SymbolKind.Function, `pipeline · ${p.repo.name}`, at(p.file, p.line))),
      ...index.datasets
        .filter((d) => matches(d.name))
        .map((d) => new S(d.name, vscode.SymbolKind.Struct, 'dataset', at(d.file))),
    ];
  }
}

/** The bar of links at the top of a file: related files and Bitbucket. */
export class TopBarProvider implements vscode.CodeLensProvider {
  constructor(private state: State) {}

  get onDidChangeCodeLenses() {
    return this.state.onDidChange;
  }

  async provideCodeLenses(doc: vscode.TextDocument) {
    if (this.state.decorations() === 'inline') return [];
    const index = await this.state.index();
    if (!index) return [];

    const file = doc.uri.fsPath;
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];
    const open = (title: string, target: string, tooltip?: string) =>
      lenses.push(new vscode.CodeLens(top, { title, tooltip, command: 'vscode.open', arguments: [vscode.Uri.file(target)] }));
    const web = (title: string, url: string | undefined) =>
      url && lenses.push(new vscode.CodeLens(top, { title, tooltip: url, command: 'gitopsNav.openUrl', arguments: [url] }));

    const bb = this.state.bitbucket();
    const gitopsApp = appsForFile(index, file).find((a) => a.side === 'gitops')?.app;

    // Any file in a gitops app folder: the component repo it points at (on disk and on Bitbucket), and Argo CD
    if (gitopsApp) {
      const app = gitopsApp;
      const name = app.chartRepo?.name ?? app.remote?.slug;
      if (app.chartRepo) {
        lenses.push(new vscode.CodeLens(top, { title: `${ICONS.component} ${name}`, command: 'gitopsNav.openRepo', arguments: [app.id] }));
        web('$(globe) Bitbucket', urlForPath(app.chartRepo, app.chartRepo.dir, bb));
      } else if (app.remote) {
        lenses.push(new vscode.CodeLens(top, { title: `$(cloud-download) clone ${name}`, command: 'gitopsNav.cloneComponent', arguments: [app.id] }));
        web(`$(globe) ${name} on Bitbucket`, browseUrl(app.remote, bb));
      }
      const repoName = app.repoUrl && repoNameFromUrl(app.repoUrl);
      const values = { name: app.name, namespace: app.namespace, ...(repoName && { repoName }) };
      const argo = this.state.argoCdLink(path.basename(file));
      web(`$(globe) ${argo.label}`, fillUrlTemplate(argo.template, values));
      return lenses;
    }

    for (const { app } of appsForFile(index, file)) {
      for (const f of app.files) open(`${ICONS.helmConfig} ${app.id}/${path.basename(f)}`, f, f);
    }

    const pipeline = index.pipelines.find((p) => p.file === file);
    if (pipeline) {
      const repoName = pipeline.repo.remote?.slug ?? pipeline.repo.name;
      web('$(globe) pipeline', fillUrlTemplate(this.state.dashboardUrlTemplate(), { name: pipeline.name, repoName }));
    }

    const repo = repoForFile(index, file);
    if (repo) web('$(globe) Bitbucket', urlForPath(repo, file, bb));
    return lenses;
  }
}

/** Clickable values: `repo:` in a gitops cicd.yaml / ci.yaml, and file names inside pipelines. */
export class InlineLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private state: State) {}

  async provideDocumentLinks(doc: vscode.TextDocument) {
    if (this.state.decorations() === 'topBar') return [];
    const index = await this.state.index();
    if (!index) return [];

    const file = doc.uri.fsPath;
    const text = doc.getText();
    const range = (start: number, end: number) => new vscode.Range(doc.positionAt(start), doc.positionAt(end));
    const links: vscode.DocumentLink[] = [];

    const app = appsForFile(index, file).find((a) => a.side === 'gitops')?.app;
    if (app && file === app.configFile) {
      const r = repoValue(text, index.config.repoKey);
      if (r) {
        const link = new vscode.DocumentLink(range(r.start, r.end), commandUri('gitopsNav.openRepo', app.id));
        link.tooltip = app.chartRepo ? `Open ${app.chartRepo.name}` : 'Not cloned: open in Bitbucket';
        links.push(link);
      }
    }

    if (index.pipelines.some((p) => p.file === file)) {
      for (const r of fileRefs(text, path.dirname(file))) {
        links.push(new vscode.DocumentLink(range(r.start, r.end), vscode.Uri.file(r.file)));
      }
    }
    return links;
  }
}

export function registerProviders(state: State): vscode.Disposable[] {
  return [
    vscode.languages.registerWorkspaceSymbolProvider(new SymbolProvider(state)),
    vscode.languages.registerCodeLensProvider(FILES, new TopBarProvider(state)),
    vscode.languages.registerDocumentLinkProvider(FILES, new InlineLinkProvider(state)),
  ];
}

function commandUri(command: string, ...args: unknown[]) {
  return vscode.Uri.parse(`command:${command}?${encodeURIComponent(JSON.stringify(args))}`);
}

# GitOps Nav

Navigate the gitops repo, its component repos, pipeline repos and the database repo from one VS Code window, with all repos checked out side by side in one folder.

## Install

```sh
npm install
npm run package                      # builds gitops-nav-0.1.0.vsix
code --install-extension gitops-nav-0.1.0.vsix
```

Then open the folder that holds your repos (or the workspace file below).

## Features

- **Go to… (`Cmd+Alt+G` on Mac, `Ctrl+Shift+G` on Windows, `Ctrl+Alt+G` on Linux)**: one search over apps, pipelines (by their `name:`) and datasets. Each app appears twice: the **component** repo (opens the first file from `gitopsNav.componentOpenOrder` that exists, or Bitbucket if it isn't cloned) and its **helm config** in gitops (opens `<ns>/<app>/values.yaml`). Start with `a:`, `p:` or `d:` (or the letter and a space) to show only apps, pipelines or datasets. **Double-tap the shortcut** to jump straight to the gitops folder in the explorer, with its namespace folders collapsed.
- **`#` in Quick Open** (or `Cmd+T`): the same apps, pipelines and datasets, as workspace symbols.
- **Link bar** at the top of related files:
  - files in a gitops app folder link to the component repo (on disk and on Bitbucket) and to Argo CD (`values-dev.yaml` and `values-ci.yaml` can link to separate dev and CI apps with `gitopsNav.argoCdDevUrl` / `gitopsNav.argoCdCiUrl`);
  - chart files link back to the gitops app folder;
  - `pipeline` files link to the pipeline dashboard (the "pipeline" link);
  - every file in a known repo gets a Bitbucket link.
- **Clickable values**:
  - `repo:` in a gitops `cicd.yaml` or `ci.yaml` opens the component repo (or Bitbucket, if it isn't cloned);
  - in a `pipeline`, any value naming a file next to it (e.g. `script: extract.py`) opens that file.
- **Explorer right-click menu**:
  - **Jump to repo** on a gitops app folder (`<ns>/<app>`) shows its component repo in the explorer, expanded (or offers a clone if it isn't cloned);
  - **Jump to Gitops** on a component repo folder (its root, or the folder holding `Chart.yaml`) opens the app's `values.yaml` in gitops. If several apps deploy the repo, you pick one.
- **GitOps Nav: Create Workspace File** writes `<folder>.code-workspace` once, with tab-label rules (see below).
- **Recently opened first**: Go to… lists what you opened last (per workspace) at the top.
- **Clone on demand**: picking a component that isn't cloned offers to clone it next to the other repos (or open it on Bitbucket). If git needs a password or passphrase, it offers to clone in a terminal instead. Gitops files for uncloned apps also get a "clone" link.
- **Wrong-branch warning**: an amber status bar item appears when the gitops repo isn't on `gitopsNav.gitopsBranch` (`dev`). Click it to switch.
- **gitops tint**: the gitops folder and the folders under it (not files) get a subtle text tint in the explorer (`gitopsNav.gitopsTint`: `accent`, `muted` or `off`). It uses theme colours, so it suits any theme; override with `workbench.colorCustomizations` (`gitopsNav.gitopsAccent` / `gitopsNav.gitopsMuted`).
- The index updates itself when `pipeline`, `cicd.yaml`, `ci.yaml`, `Chart.yaml` or dataset files change. **GitOps Nav: Refresh Index** forces an update, e.g. after cloning a repo.

To compare the two link styles, switch `gitopsNav.decorations` between `both`, `topBar` and `inline`.

## How apps find their component repo

An app is a `<namespace>/<app>` folder in the gitops repo containing a `cicd.yaml` or `ci.yaml`. The first of those with a `repo:` key (a `.git` clone URL; the key name is set by `gitopsNav.repoKey`) says which repo the app deploys. The app folder doesn't have to be named after the repo.

The component repo on disk is the sibling folder of gitops that:

1. has a git remote matching the `repo:` URL (same Bitbucket project and repo, whatever the URL style), or failing that
2. is named after the end of the URL: `…/project/some-component-app.git` → `some-component-app`.

If neither exists, the component counts as not cloned, and you're offered a clone or the Bitbucket page.


## Keyboard shortcut

On Windows, `Ctrl+Shift+G` replaces VS Code's default shortcut for the Source Control view (still available from its sidebar icon). To change either, open **Keyboard Shortcuts** (`Ctrl+K Ctrl+S`) and search for "GitOps Nav" or "Source Control".

## Settings

Set these to match your real repo names. The defaults match the example repos. In the Settings screen they're under **GitOps Nav**, with the links in their own **External Links** section.

| Setting | Default | |
|---|---|---|
| `gitopsNav.root` | first workspace folder | folder holding all repos |
| `gitopsNav.gitopsRepo` | `gitops` | |
| `gitopsNav.repoKey` | `repo` | key in `cicd.yaml` / `ci.yaml` holding the component's `.git` URL; dotted for nested, e.g. `source.repo` |
| `gitopsNav.pipelineRepos` | `pipelines-a`, `pipelines-b` | `[{ "repo": "...", "path": "jobs", "flavour": "..." }]`; `path` is optional and limits the search to that folder |
| `gitopsNav.databaseRepo` | `database` | |
| `gitopsNav.datasetPattern` | `datasets/${dataset}/structure.sql` | where dataset files are in the database repo; see below |
| `gitopsNav.gitopsBranch` | `dev` | status bar warns when gitops is on another branch; empty = off |
| `gitopsNav.decorations` | `both` | `both` / `topBar` / `inline` |
| `gitopsNav.componentIcon` | `box` | `box` / `git`: icon for component repos |
| `gitopsNav.gitopsTint` | `accent` | `accent` / `muted` / `off`: text tint for the gitops folders |
| `gitopsNav.componentOpenMode` | `file` | `folder` = just show the repo folder in the explorer, ignoring the list below |
| `gitopsNav.componentOpenOrder` | `README.md`, `Dockerfile`, `${chart}/values.yaml` | files to try, in order, when jumping to a component; `${chart}` = the folder holding `Chart.yaml` |

### External links

| Setting | Default | |
|---|---|---|
| `gitopsNav.bitbucketUrl` | `https://<remote host>` | set this if SSH and web hosts differ |
| `gitopsNav.defaultBranches` | `{ "gitops": "dev" }` | used when your branch isn't on the remote |
| `gitopsNav.argoCdUrl` | `https://argocd.invalid/applications/${name}` | `${name}` = app folder in gitops, `${namespace}` = its namespace, `${repoName}` = component repo (end of `repo:` URL); empty = no link |
| `gitopsNav.argoCdDevUrl` | (empty) | Argo CD link from `values-dev.yaml` (the dev chart in `<namespace>-dev`), labelled "Argo CD (dev)"; same placeholders as `argoCdUrl`, e.g. `…/applications/${namespace}-dev/${name}`; empty = use `argoCdUrl` |
| `gitopsNav.argoCdCiUrl` | (empty) | Argo CD link from `values-ci.yaml` (the CI chart with the Tekton pipeline), labelled "Argo CD (CI)"; same placeholders as `argoCdUrl`; empty = use `argoCdUrl` |
| `gitopsNav.pipelineDashboardUrl` | `https://pipelines.invalid/pipelines/${name}` | `${name}` = the pipeline's `name:`, `${repoName}` = the repo holding it; URL-encoded; empty = no link |

Placeholders in the URL settings are URL-encoded; ones a link doesn't support are left as written. Set a URL to empty to hide that link. To choose which browser opens links, see [Choosing a browser for links](#choosing-a-browser-for-links).

## Dataset files

`gitopsNav.datasetPattern` says where dataset files are in the database repo, relative to its root. Each file matching it is a dataset, named from the placeholder:

| Placeholder | Matches | Dataset name |
|---|---|---|
| `${dataset}` | any name | as written |
| `${dataset_upper}` | an all-uppercase name, e.g. `ORDERS` | lowercased: `orders` |
| `${dataset_lower}` | an all-lowercase name | as written |
| `*` | anything within one folder or file name | (ignored) |

Examples:

```jsonc
"gitopsNav.datasetPattern": "datasets/${dataset}/structure.sql"          // datasets/orders/structure.sql
"gitopsNav.datasetPattern": "some/folder/${dataset_upper}_blah.sql"      // some/folder/ORDERS_blah.sql
"gitopsNav.datasetPattern": "sql/*/${dataset_upper}/${dataset_upper}.sql" // sql/v1/ORDERS/ORDERS.sql
```

A pattern needs at least one placeholder. If a placeholder appears more than once, the parts must agree (ignoring case). When the name is in a folder rather than the file name, **Create Workspace File** adds a tab-label rule so tabs read `orders › structure.sql (database)`. Re-run it after changing the pattern.



Bitbucket, Argo CD and pipeline dashboard links are opened by VS Code itself, so they use VS Code's `workbench.externalBrowser` setting, or your system's default browser if it's empty.

**On Windows, GitOps Nav sets this to Chrome for you** the first time it starts, if Chrome is installed and you haven't already chosen a browser. A notification says so and then disappears. It only does this once, so if you change it afterwards your choice sticks.

**Quickest way to choose**: run **GitOps Nav: Choose Browser for Links…** from the command palette and pick Chrome, Edge, Firefox, system default, or browse for a program. It writes `workbench.externalBrowser` to your user settings for you.

To set it by hand instead:

Set it in your **user** settings (`Cmd/Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**), not the shared workspace file. It's a personal choice, and VS Code ignores it at workspace level in untrusted workspaces.

**By name** (easiest): `chrome`, `edge` or `firefox`:

```jsonc
"workbench.externalBrowser": "chrome"
```

**By path**, if the name doesn't find your browser (e.g. it's installed somewhere unusual, or it's a different browser):

```jsonc
// Windows
"workbench.externalBrowser": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
// macOS
"workbench.externalBrowser": "/Applications/Google Chrome.app"
// Linux
"workbench.externalBrowser": "/usr/bin/google-chrome"
```

To get the Windows path, right-click your Chrome shortcut → **Properties** → **Target**, and double each `\` when you paste it into JSON.

**Through the Settings screen**: `Cmd/Ctrl+,` → search `external browser` → type `chrome` (or a path) into **Workbench: External Browser**.

**To go back** to the system default, delete the line, or clear the field in the Settings screen.

This applies to every web link VS Code opens, not just GitOps Nav's.

## Tab labels

The workspace file opens the parent folder as a single root, so each path the label rules see is `<root>/<repo>/…`, with the repo always second. The rules are generic, so new repos need no changes:

| File | Tab |
|---|---|
| `gitops/orders/orders-api/values-dev.yaml` | `orders/orders-api › values-dev.yaml` |
| `orders-api/deploy/helm/values.yaml` | `orders-api › values.yaml` |
| `pipelines-a/ingest/orders/pipeline` | `orders-pipeline` |
| `pipelines-b/jobs/orders-pipeline/pipeline` | `orders-pipeline` |
| `database/datasets/orders/structure.sql` | `orders › structure.sql (database)` (only when the dataset name is in a folder; see below) |

## Logs and troubleshooting

GitOps Nav logs to **Output → GitOps Nav** (or run **GitOps Nav: Show Log**). By default you'll see what each scan found (repos, apps, pipelines, datasets, with totals and timing) and warnings about likely misconfiguration, such as a configured repo that doesn't exist, an app without a repo key, or a dataset pattern that can't match.

For more detail, run **Developer: Set Log Level…**, pick **GitOps Nav** and choose:

- **Debug**: every repo found (branch, origin), every app and how its component repo was matched (`matched by remote` / `matched by name` / `isn't cloned`, and why), and what triggered each rescan.
- **Trace**: also every pipeline and dataset file, and each file change the watcher sees.

If something isn't showing up in Go to…, the Debug log of the last scan usually says why.



```sh
scripts/make-example-repos.sh        # fake repos in ~/dev/example-repos
python scripts/build-icon.py         # rebuild media/gitops-nav.woff (needs: pip install fonttools picosvg)
npm test                             # unit tests (builds its own copy of the example repos)
npm run test:report                  # same tests, plus HTML reports in reports/:
                                     #   test-report.html, coverage/index.html (src/core), junit.xml (for CI)
```

Press F5 in this folder to launch an Extension Development Host, then open `~/dev/example-repos` in it.

## Credits

The helm config icon is [Lucide](https://lucide.dev)'s `ship-wheel` (ISC licence, see `media/lucide/LICENSE`).

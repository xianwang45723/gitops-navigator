import { compileDatasetPattern, datasetPatternGlob } from './datasets';

/**
 * Builds the .code-workspace file. It opens the parent folder as a single root, so every
 * path the tab-label globs see starts with `<root>/<repo>/…`. That makes ${dirname(-2)}
 * the repo name for any file, however deep, and nothing needs regenerating when repos
 * are cloned later.
 *
 * VS Code tries the most specific pattern first (literal segments beat wildcards), so the
 * gitops and "*pipeline" rules win over the generic ones.
 */
export function workspaceFileContent(gitopsRepo: string, databaseRepo: string, datasetPattern: string): object {
  const repoLabel = '${dirname(-2)} › ${filename}.${extname}';
  const appLabel = '${dirname(1)}/${dirname} › ${filename}.${extname}';
  return {
    folders: [{ path: '.' }],
    settings: {
      'workbench.editor.customLabels.enabled': true,
      'workbench.editor.customLabels.patterns': {
        // gitops/<ns>/<app>/… → "<ns>/<app> › values-dev.yaml"
        [`*/${gitopsRepo}/*/*/values*.yaml`]: appLabel,
        [`*/${gitopsRepo}/*/*/cicd.yaml`]: appLabel,
        [`*/${gitopsRepo}/*/*/ci.yaml`]: appLabel,
        // any other repo → "<repo> › values.yaml"
        '*/*/**/values*.yaml': repoLabel,
        '*/*/**/Chart.yaml': repoLabel,
        // pipelines: "<folder>-pipeline", or just the folder if it already ends in "pipeline"
        '*/*/**/*pipeline/pipeline': '${dirname}',
        '*/*/**/pipeline': '${dirname}-pipeline',
        ...datasetLabel(databaseRepo, datasetPattern),
      },
    },
  };
}

/**
 * Tab label for dataset files, when the dataset name is in a folder rather than the file name:
 * `datasets/${dataset}/structure.sql` → "orders › structure.sql (database)". If the file name holds
 * the dataset already (`${dataset_upper}_blah.sql`), tabs are distinct as they are, so no rule.
 */
function datasetLabel(databaseRepo: string, datasetPattern: string): Record<string, string> {
  const segments = compileDatasetPattern(datasetPattern);
  if (!segments) return {};
  const nearest = segments.map((s) => s.cases.length > 0).lastIndexOf(true);
  if (nearest === segments.length - 1) return {};
  const up = segments.length - 2 - nearest; // ${dirname(0)} is the file's own folder
  const file = segments[segments.length - 1].literal;
  const name = file && file.includes('.') ? '${filename}.${extname}' : '${filename}';
  return {
    [`*/${databaseRepo}/${datasetPatternGlob(datasetPattern)}`]: `\${dirname${up ? `(${up})` : ''}} › ${name} (${databaseRepo})`,
  };
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { browseUrl, urlForPath } from '../src/core/bitbucket';
import { findWindowsChrome, windowsChromeCandidates } from '../src/core/chrome';
import { compileDatasetPattern, datasetPatternGlob, findDatasets } from '../src/core/datasets';
import { workspaceFileContent } from '../src/core/workspaceFile';
import { cloneRepo, parseRemote, remoteKey, repoNameFromUrl } from '../src/core/git';
import { Recent } from '../src/core/recent';
import { fillUrlTemplate } from '../src/core/urlTemplate';
import { appsForFile, buildIndex, componentTarget, Index, isSameOrInside, readPipelineName } from '../src/core/index';
import { fileRefs, repoValue } from '../src/core/refs';

describe('parseRemote', () => {
  const cases: [string, string, string][] = [
    ['ssh://git@bb.invalid:7999/plat/orders-api.git', 'bb.invalid', 'plat/orders-api'],
    ['git@bb.invalid:plat/payments-api.git', 'bb.invalid', 'plat/payments-api'],
    ['https://bb.invalid/scm/plat/order-worker.git', 'bb.invalid', 'plat/order-worker'],
    ['https://me@bb.invalid/bitbucket/scm/PLAT/Thing.git', 'bb.invalid', 'plat/thing'],
    ['ssh://git@bb.invalid:7999/~paul/scratch.git', 'bb.invalid', '~paul/scratch'],
  ];
  for (const [url, host, key] of cases) {
    it(url, () => {
      const ref = parseRemote(url)!;
      assert.equal(ref.host, host);
      assert.equal(remoteKey(ref), key);
    });
  }
  it('rejects junk', () => assert.equal(parseRemote('not a url'), undefined));
});

describe('repoNameFromUrl', () => {
  for (const [url, name] of [
    ['http://blah.bitbucket/project/some-component-app.git', 'some-component-app'],
    ['ssh://git@bb.invalid:7999/plat/orders-api.git', 'orders-api'],
    ['git@bb.invalid:plat/payments-api.git', 'payments-api'],
    ['https://bb.invalid/scm/plat/order-worker.git/', 'order-worker'],
    ['https://bb.invalid/only-one.git', 'only-one'],
  ]) {
    it(url, () => assert.equal(repoNameFromUrl(url), name));
  }
});

describe('browseUrl', () => {
  it('builds project URLs with branch', () => {
    const ref = parseRemote('ssh://git@bb.invalid:7999/plat/orders-api.git')!;
    assert.equal(
      browseUrl(ref, {}, { relPath: 'deploy/helm/values.yaml', branch: 'feature/x' }),
      'https://bb.invalid/projects/PLAT/repos/orders-api/browse/deploy/helm/values.yaml?at=refs%2Fheads%2Ffeature%2Fx',
    );
  });
  it('uses configured base URL and personal repos', () => {
    const ref = parseRemote('ssh://git@bb.invalid:7999/~paul/scratch.git')!;
    assert.equal(browseUrl(ref, { baseUrl: 'https://web.invalid/' }), 'https://web.invalid/users/paul/repos/scratch/browse');
  });
});

describe('dataset patterns', () => {
  let repo: string;
  const touch = (rel: string) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), '');
  };
  const names = async (pattern: string) => (await findDatasets(repo, pattern)).map((d) => `${d.name}=${path.relative(repo, d.file)}`);

  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'gitops-nav-db-'));
    for (const f of [
      'datasets/orders/structure.sql',
      'datasets/refunds/structure.sql',
      'datasets/empty/README.md',
      'some/folder/ORDERS_blah.sql',
      'some/folder/REFUNDS_blah.sql',
      'some/folder/lower_blah.sql',
      'some/folder/NOTES.md',
      'nested/v1/sql/CUSTOMERS/CUSTOMERS.sql',
      'nested/v2/sql/INVENTORY/OTHER.sql',
    ]) touch(f);
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  it('takes the name from a folder', async () => {
    assert.deepEqual(await names('datasets/${dataset}/structure.sql'), ['orders=datasets/orders/structure.sql', 'refunds=datasets/refunds/structure.sql']);
  });
  it('takes an upper-case name from a file name, shown lowercased', async () => {
    assert.deepEqual(await names('some/folder/${dataset_upper}_blah.sql'), ['orders=some/folder/ORDERS_blah.sql', 'refunds=some/folder/REFUNDS_blah.sql']);
  });
  it('lower-case placeholder skips upper-case names', async () => {
    assert.deepEqual(await names('some/folder/${dataset_lower}_blah.sql'), ['lower=some/folder/lower_blah.sql']);
  });
  it('supports * and requires a repeated placeholder to agree', async () => {
    assert.deepEqual(await names('nested/*/sql/${dataset_upper}/${dataset_upper}.sql'), ['customers=nested/v1/sql/CUSTOMERS/CUSTOMERS.sql']);
  });
  it('rejects patterns without a placeholder or leaving the repo', () => {
    assert.equal(compileDatasetPattern('datasets/structure.sql'), undefined);
    assert.equal(compileDatasetPattern('../elsewhere/${dataset}.sql'), undefined);
    assert.equal(compileDatasetPattern('/abs/${dataset}.sql'), undefined);
  });
  it('turns patterns into globs', () => {
    assert.equal(datasetPatternGlob('some/folder/${dataset_upper}_blah.sql'), 'some/folder/*_blah.sql');
  });
  it('labels tabs only when the name is in a folder', () => {
    const labels = (pattern: string) => (workspaceFileContent('gitops', 'database', pattern) as any).settings['workbench.editor.customLabels.patterns'];
    assert.equal(labels('datasets/${dataset}/structure.sql')['*/database/datasets/*/structure.sql'], '${dirname} › ${filename}.${extname} (database)');
    assert.equal(labels('x/${dataset}/sql/schema.sql')['*/database/x/*/sql/schema.sql'], '${dirname(1)} › ${filename}.${extname} (database)');
    assert.ok(!Object.keys(labels('some/folder/${dataset_upper}_blah.sql')).some((k) => k.startsWith('*/database/')));
  });
});

describe('Chrome on Windows', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  it('looks in the standard install locations, machine-wide first', () => {
    assert.deepEqual(windowsChromeCandidates(env), [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });
  it('picks the first that exists, or none', () => {
    assert.equal(findWindowsChrome(env, (p) => p.includes('AppData')), 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    assert.equal(findWindowsChrome(env, () => false), undefined);
  });
});

describe('Recent', () => {
  const memory = () => {
    const data = new Map<string, unknown>();
    return { get: <T>(k: string, d: T) => (data.has(k) ? (data.get(k) as T) : d), update: async (k: string, v: unknown) => void data.set(k, v) };
  };
  it('keeps newest first, without duplicates, up to the limit', async () => {
    const recent = new Recent(memory(), 3);
    for (const id of ['a', 'b', 'c', 'a', 'd']) await recent.touch(id);
    assert.deepEqual(recent.list(), ['d', 'a', 'c']);
  });
  it('splits items into recent and the rest', async () => {
    const recent = new Recent(memory());
    await recent.touch('y');
    await recent.touch('z');
    assert.deepEqual(recent.split(['x', 'y', 'z', 'w'], (i) => i), { recent: ['z', 'y'], rest: ['x', 'w'] });
  });
});

describe('isSameOrInside', () => {
  it('matches the folder itself, with or without a trailing slash', () => {
    assert.ok(isSameOrInside('/w/gitops', '/w/gitops'));
    assert.ok(isSameOrInside('/w/gitops/', '/w/gitops'));
    assert.ok(isSameOrInside('/w/gitops', '/w/gitops/'));
  });
  it('matches things inside, not siblings or parents', () => {
    assert.ok(isSameOrInside('/w/gitops/orders/x.yaml', '/w/gitops'));
    assert.ok(!isSameOrInside('/w/gitops-old', '/w/gitops'));
    assert.ok(!isSameOrInside('/w', '/w/gitops'));
  });
  it('ignores case only on case-insensitive platforms', () => {
    assert.ok(isSameOrInside('/w/GitOps', '/w/gitops', 'darwin'));
    assert.ok(!isSameOrInside('/w/GitOps', '/w/gitops', 'linux'));
  });
});

describe('fillUrlTemplate', () => {
  it('fills and URL-encodes placeholders, leaving unknown ones', () => {
    assert.equal(
      fillUrlTemplate('https://x/p/${name}?ns=${namespace}&t=${name}&o=${other}', { name: 'orders daily/v2', namespace: 'orders' }),
      'https://x/p/orders%20daily%2Fv2?ns=orders&t=orders%20daily%2Fv2&o=${other}',
    );
  });
  it('is off when not configured', () => assert.equal(fillUrlTemplate('', { name: 'x' }), undefined));
});

describe('yaml refs', () => {
  it('finds the repo value and where it is', () => {
    const text = 'team: x\nrepo: ssh://h/p/r.git\n';
    const r = repoValue(text)!;
    assert.equal(r.url, 'ssh://h/p/r.git');
    assert.equal(text.slice(r.start, r.end), 'ssh://h/p/r.git');
  });
  it('uses a configured key, including a dotted path to a nested one', () => {
    const text = 'gitRepo: https://h/p/flat.git\nsource:\n  repo: https://h/p/nested.git\n';
    assert.equal(repoValue(text, 'gitRepo')?.url, 'https://h/p/flat.git');
    const nested = repoValue(text, 'source.repo')!;
    assert.equal(nested.url, 'https://h/p/nested.git');
    assert.equal(text.slice(nested.start, nested.end), 'https://h/p/nested.git');
  });
  it('finds nothing for a missing key, an empty value or a non-string', () => {
    assert.equal(repoValue('repo: x\n', 'other'), undefined);
    assert.equal(repoValue('repo: ""\n'), undefined);
    assert.equal(repoValue('repo:\n  nested: x\n'), undefined);
    assert.equal(repoValue('repo: [unclosed\n'), undefined);
  });
  it('reads pipeline name and line', () => {
    assert.deepEqual(readPipelineName('# hi\nname: orders\nsteps: []\n'), { name: 'orders', line: 1 });
    assert.equal(readPipelineName('steps: []'), undefined);
  });
});

describe('index over the example repos', () => {
  let root: string;
  let index: Index;

  before(async () => {
    root = path.join(mkdtempSync(path.join(tmpdir(), 'gitops-nav-')), 'work');
    execFileSync(path.join(__dirname, '../../scripts/make-example-repos.sh'), [root], { stdio: 'ignore' });
    index = await buildIndex({
      root,
      gitopsRepo: 'gitops',
      pipelineRepos: [
        { repo: 'pipelines-a', flavour: 'a' },
        { repo: 'pipelines-b', flavour: 'b' },
      ],
      databaseRepo: 'database',
      repoKey: 'repo',
      datasetPattern: 'datasets/${dataset}/structure.sql',
    });
  });
  after(() => rmSync(path.dirname(root), { recursive: true, force: true }));

  it('finds git repos and ignores other folders', () => {
    assert.deepEqual([...index.repos.keys()].sort(), [
      'database', 'gitops', 'order-worker', 'orders-api', 'payments-api', 'pipelines-a', 'pipelines-b',
    ]);
  });

  it('links apps to component repos by remote, or by the name at the end of repo:', () => {
    const byId = Object.fromEntries(index.apps.map((a) => [a.id, a]));
    assert.deepEqual(Object.keys(byId), ['orders/orders-api', 'orders/worker', 'payments/ledger-service', 'payments/payments-api']);
    // gitops folder "worker" ≠ repo "order-worker": matched by remote
    assert.equal(byId['orders/worker'].chartRepo?.name, 'order-worker');
    // cloned from a fork, so the remote differs: matched by the name in the repo: URL
    assert.equal(byId['orders/orders-api'].chartRepo?.name, 'orders-api');
    assert.equal(byId['payments/payments-api'].chartRepo?.name, 'payments-api');
    assert.equal(byId['payments/ledger-service'].chartRepo, undefined);
    assert.equal(byId['payments/ledger-service'].remote?.slug, 'ledger-service');
    assert.equal(byId['orders/orders-api'].files.length, 4);
  });

  it('logs what it found, how apps matched, and misconfiguration', async () => {
    const lines: string[] = [];
    const at = (level: string) => (m: string) => lines.push(`${level} ${m}`);
    const log = { trace: at('trace'), debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
    await buildIndex({ ...index.config, pipelineRepos: [...index.config.pipelineRepos, { repo: 'nope' }], databaseRepo: 'missing-db' }, log);
    const has = (re: RegExp) => assert.ok(lines.some((l) => re.test(l)), `no log line matching ${re}\n${lines.join('\n')}`);
    has(/^debug Skipped random-notes: not a git repo$/);
    has(/^debug App orders\/orders-api: .* → orders-api\/ \(matched by name\), chart at deploy\/helm$/);
    has(/^debug App orders\/worker: .* → order-worker\/ \(matched by remote\)/);
    has(/^debug App payments\/ledger-service: .* isn't cloned/);
    has(/^warn Pipeline repo "nope" isn't a git repo/);
    has(/^warn Database repo "missing-db" isn't a git repo/);
    has(/^info Apps: 4 \(3 cloned, 1 not cloned, 0 without a repo key\)$/);
    has(/^info Found 7 repos, 4 apps, 6 pipelines, 0 datasets in \d+ ms$/);
  });

  it('finds no component repos when the configured key is absent', async () => {
    const other = await buildIndex({ ...index.config, repoKey: 'gitRepo' });
    assert.equal(other.apps.length, index.apps.length);
    assert.ok(other.apps.every((a) => !a.repoUrl && !a.chartRepo));
  });

  it('reads repo: from cicd.yaml or ci.yaml', () => {
    const byId = Object.fromEntries(index.apps.map((a) => [a.id, a]));
    assert.equal(path.basename(byId['orders/orders-api'].configFile), 'cicd.yaml');
    assert.equal(path.basename(byId['payments/payments-api'].configFile), 'ci.yaml');
    assert.match(byId['payments/payments-api'].repoUrl!, /payments-api\.git$/);
  });

  it('opens the first component file that exists, in priority order', async () => {
    const app = (id: string) => index.apps.find((a) => a.id === id)!;
    const order = ['README.md', 'Dockerfile', '${chart}/values.yaml'];
    const rel = (f?: string) => f && path.relative(root, f);
    assert.equal(rel(await componentTarget(app('orders/orders-api'), order)), 'orders-api/README.md');
    assert.equal(rel(await componentTarget(app('orders/worker'), order)), 'order-worker/Dockerfile');
    // ${chart} finds the chart at any depth
    assert.equal(rel(await componentTarget(app('orders/orders-api'), ['nope.md', '${chart}/values.yaml'])), 'orders-api/deploy/helm/values.yaml');
    assert.equal(rel(await componentTarget(app('payments/payments-api'), ['${chart}/Chart.yaml'])), 'payments-api/Chart.yaml');
    // nothing matches, outside the repo, or not cloned
    assert.equal(await componentTarget(app('orders/orders-api'), ['missing', '../gitops/orders/orders-api/cicd.yaml']), undefined);
    assert.equal(await componentTarget(app('payments/ledger-service'), order), undefined);
  });

  it('finds pipelines by name with flavour', () => {
    assert.deepEqual(
      index.pipelines.map((p) => `${p.name}:${p.flavour}`),
      ['customer-sync:a', 'inventory:b', 'orders:a', 'orders-daily:b', 'refund-recon:b', 'refunds:a'],
    );
  });

  it('limits pipeline search to a folder inside the repo', async () => {
    const limited = await buildIndex({ ...index.config, pipelineRepos: [{ repo: 'pipelines-b', path: 'jobs' }] });
    assert.deepEqual(limited.pipelines.map((p) => p.name), ['orders-daily', 'refund-recon']);
  });

  it('clones a repo, and fails cleanly instead of prompting', async () => {
    const target = path.join(path.dirname(root), 'cloned');
    await cloneRepo(path.join(root, 'orders-api'), target);
    assert.ok(existsSync(path.join(target, 'deploy/helm/Chart.yaml')));
    await assert.rejects(cloneRepo(path.join(root, 'does-not-exist'), path.join(path.dirname(root), 'nope')));
  });

  it('finds datasets', () => {
    assert.deepEqual(index.datasets.map((d) => d.name), ['customers', 'inventory', 'orders', 'refunds']);
  });

  it('maps files back to apps from both sides', () => {
    const gitopsFile = path.join(root, 'gitops/orders/orders-api/values-dev.yaml');
    const chartFile = path.join(root, 'orders-api/deploy/helm/values.yaml');
    assert.deepEqual(appsForFile(index, gitopsFile).map((x) => `${x.app.id}:${x.side}`), ['orders/orders-api:gitops']);
    assert.deepEqual(appsForFile(index, chartFile).map((x) => `${x.app.id}:${x.side}`), ['orders/orders-api:chart']);
  });

  it('links pipeline scripts', () => {
    const p = index.pipelines.find((x) => x.name === 'orders')!;
    const text = readFileSync(p.file, 'utf8');
    assert.deepEqual(fileRefs(text, path.dirname(p.file)).map((r) => path.basename(r.file)), ['extract.py', 'load.sh']);
  });

  it('builds Bitbucket links on the right branch', () => {
    const gitops = index.repos.get('gitops')!;
    assert.equal(
      urlForPath(gitops, path.join(root, 'gitops/orders/orders-api'), { defaultBranches: { gitops: 'dev' } }),
      'https://bitbucket.invalid/projects/PLAT/repos/gitops/browse/orders/orders-api?at=refs%2Fheads%2Fdev',
    );
  });
});

// A node:test reporter that writes one self-contained HTML page of results.
// Usage: node --test --test-reporter=./scripts/html-reporter.mjs --test-reporter-destination=report.html
//
// Tests finish children-first, each event carrying its nesting depth, so finished tests wait in
// `pending[depth]` until their parent finishes and collects them.

export default async function* htmlReporter(source) {
  const pending = [];
  const started = Date.now();

  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name, nesting, file, details = {}, skip, todo } = event.data;
    const depth = nesting ?? 0;
    const node = {
      name,
      file,
      ok: event.type === 'test:pass',
      skipped: Boolean(skip || todo),
      suite: details.type === 'suite',
      ms: details.duration_ms ?? 0,
      error: details.error,
      children: pending[depth + 1] ?? [],
    };
    pending[depth + 1] = [];
    (pending[depth] ??= []).push(node);
  }

  yield page(pending[0] ?? [], Date.now() - started);
}

function page(roots, wallMs) {
  const leaves = roots.flatMap(function walk(n) {
    return n.children.length ? n.children.flatMap(walk) : n.suite ? [] : [n];
  });
  const count = (f) => leaves.filter(f).length;
  const passed = count((t) => t.ok && !t.skipped);
  const failed = count((t) => !t.ok);
  const skipped = count((t) => t.skipped);
  const when = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test report</title>
<style>
  :root { --bg:#fff; --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --pass:#1a7f37; --fail:#cf222e; --skip:#9a6700; --code:#f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8d96a0; --line:#30363d; --pass:#3fb950; --fail:#f85149; --skip:#d29922; --code:#161b22; }
  }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, sans-serif; }
  main { max-width:960px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .meta { color:var(--muted); margin-bottom:16px; }
  .summary { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .stat { border:1px solid var(--line); border-radius:8px; padding:8px 14px; min-width:90px; }
  .stat b { display:block; font-size:22px; }
  .pass { color:var(--pass); } .fail { color:var(--fail); } .skip { color:var(--skip); }
  details { border-left:2px solid var(--line); margin:2px 0 2px 6px; padding-left:10px; }
  summary { cursor:pointer; }
  .test { margin:2px 0 2px 6px; padding-left:12px; }
  .ms { color:var(--muted); font-size:12px; margin-left:6px; }
  pre { background:var(--code); border:1px solid var(--line); border-radius:6px; padding:10px; overflow:auto; white-space:pre-wrap; font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>Test report</h1>
  <div class="meta">${esc(when)} · ${(wallMs / 1000).toFixed(2)}s</div>
  <div class="summary">
    <div class="stat"><b>${leaves.length}</b>tests</div>
    <div class="stat pass"><b>${passed}</b>passed</div>
    <div class="stat fail"><b>${failed}</b>failed</div>
    <div class="stat skip"><b>${skipped}</b>skipped</div>
  </div>
  ${roots.map(render).join('\n')}
</main>
</body>
</html>
`;
}

function render(n) {
  const mark = n.skipped ? '<span class="skip">○</span>' : n.ok ? '<span class="pass">✓</span>' : '<span class="fail">✗</span>';
  const label = `${mark} ${esc(n.name)}<span class="ms">${n.ms.toFixed(1)} ms</span>`;
  if (n.children.length) {
    return `<details${n.ok ? '' : ' open'}><summary>${label}</summary>${n.children.map(render).join('')}</details>`;
  }
  const err = !n.ok && n.error ? `<pre>${esc(errorText(n.error))}</pre>` : '';
  return `<div class="test">${label}${err}</div>`;
}

/** node:test wraps the thrown error; the assertion itself is usually in `cause`. */
function errorText(error) {
  const e = error.cause ?? error;
  return e.stack ?? e.message ?? String(e);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

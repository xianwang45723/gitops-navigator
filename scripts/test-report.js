#!/usr/bin/env node
// Runs the unit tests with coverage and writes HTML reports:
//   reports/test-report.html   test results (scripts/html-reporter.mjs; reports/junit.xml for CI)
//   reports/coverage/index.html coverage of src/core (the VS Code-free code the tests exercise)
// Reports are written even if tests fail; the exit code still reflects the test run.
// Usage: npm run test:report
const { spawnSync } = require('child_process');
const { mkdirSync, rmSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reports = path.join(root, 'reports');
const npx = (args) =>
  spawnSync('npx', ['--no-install', ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;

rmSync(reports, { recursive: true, force: true });
mkdirSync(reports, { recursive: true });

if (npx(['tsc', '-p', '.']) !== 0) process.exit(1);

const testStatus = npx([
  'c8',
  '--reporter=html',
  '--reporter=text-summary',
  `--reports-dir=${path.join(reports, 'coverage')}`,
  '--all',
  '--src=src/core',
  '--include=src/core/**',
  '--include=out/src/core/**',
  'node',
  '--test',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=junit',
  `--test-reporter-destination=${path.join(reports, 'junit.xml')}`,
  '--test-reporter=./scripts/html-reporter.mjs',
  `--test-reporter-destination=${path.join(reports, 'test-report.html')}`,
  'out/test/',
]);

console.log(`\nTest report:     ${path.join(reports, 'test-report.html')}`);
console.log(`Coverage report: ${path.join(reports, 'coverage', 'index.html')}`);
process.exit(testStatus);

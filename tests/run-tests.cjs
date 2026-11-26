#!/usr/bin/env node
/**
 * tests/run-tests.cjs
 *
 * Zero-dependency parallel and change-scoped test runner for Agent Context Memory.
 *
 * Usage:
 *   node tests/run-tests.cjs                     # Run all 8 suites in parallel
 *   node tests/run-tests.cjs --changed           # Run only suites affected by git status changes
 *   node tests/run-tests.cjs --serial            # Run all suites sequentially (concurrency=1)
 *   node tests/run-tests.cjs --concurrency=4     # Override worker concurrency
 *   node tests/run-tests.cjs non-git compact     # Filter suites by substring keyword(s)
 *   node tests/run-tests.cjs --dry-run           # Print selected suites without running
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

const SUITES = [
  {
    file: 'tests/e2e-install.test.cjs',
    matches: [
      'bin/',
      'acm-template/',
      '.agents/',
      'AGENTS.md',
      'package.json',
      'LICENSE',
      'scripts/acm/install-template.cjs',
      'scripts/acm/uninstall-template.cjs',
      'scripts/acm/sync-agent-rules.cjs',
      'scripts/acm/acm-manifest.cjs',
      'scripts/acm/i18n.cjs',
      'scripts/acm/locales/',
      'scripts/acm/check-git.cjs',
      'scripts/acm/group-status.cjs',
      'scripts/acm/smart-pull.cjs',
      'scripts/acm/audit-push.cjs',
    ],
  },
  {
    file: 'tests/non-git-compatibility.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/check-git.cjs',
      'scripts/acm/group-status.cjs',
      'scripts/acm/smart-pull.cjs',
      'scripts/acm/audit-push.cjs',
      'scripts/acm/install-template.cjs',
      'scripts/acm/uninstall-template.cjs',
      'scripts/acm/acm-db-cli.cjs',
      'scripts/acm/locales/',
    ],
  },
  {
    file: 'tests/sqlite-storage.test.cjs',
    matches: [
      'scripts/acm/storage/',
      'scripts/acm/group-status.cjs',
      'scripts/acm/locales/',
    ],
  },
  {
    file: 'tests/cli-db-commands.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/acm-db-cli.cjs',
      'scripts/acm/install-template.cjs',
      'scripts/acm/storage/',
      'scripts/acm/locales/',
    ],
  },
  {
    file: 'tests/git-orphan-sync.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/acm-db-cli.cjs',
      'scripts/acm/audit-push.cjs',
      'scripts/acm/storage/git-orphan-sync.cjs',
      'scripts/acm/storage/secret-scrubber.cjs',
      'scripts/acm/storage/sqlite-provider.cjs',
      'scripts/acm/storage/id-utils.cjs',
      'scripts/acm/storage/config.cjs',
    ],
  },
  {
    file: 'tests/mcp-server.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/mcp-server.cjs',
      'scripts/acm/viewer/',
      'scripts/acm/acm-manifest.cjs',
      'scripts/acm/storage/',
    ],
  },
  {
    file: 'tests/compact-retention.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/acm-db-cli.cjs',
      'scripts/acm/storage/',
    ],
  },
  {
    file: 'tests/non-destructive-lifecycle.test.cjs',
    matches: [
      'bin/',
      'acm-template/',
      '.agents/',
      'scripts/acm/install-template.cjs',
      'scripts/acm/uninstall-template.cjs',
      'scripts/acm/sync-agent-rules.cjs',
      'scripts/acm/acm-manifest.cjs',
      'scripts/acm/backup-archive.cjs',
      'scripts/acm/backup-git.cjs',
      'scripts/acm/locales/',
    ],
  },
  {
    file: 'tests/viewer.test.cjs',
    matches: [
      'bin/',
      'scripts/acm/viewer/',
      'scripts/acm/cli-viewer.cjs',
      'scripts/acm/ui-viewer.cjs',
      'scripts/acm/acm-db-cli.cjs',
      'scripts/acm/acm-manifest.cjs',
      'scripts/acm/storage/',
      'scripts/acm/locales/',
    ],
  },
];

function parseCliArgs(argv = []) {
  let serial = false;
  let changed = false;
  let dryRun = false;
  let help = false;
  let concurrency = null;
  const filters = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;
    if (arg === '--serial') {
      serial = true;
    } else if (arg === '--changed') {
      changed = true;
    } else if (arg === '--dry-run' || arg === '--list') {
      dryRun = true;
    } else if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg.startsWith('--concurrency=')) {
      const parsed = Number(arg.slice('--concurrency='.length));
      if (Number.isInteger(parsed) && parsed >= 1) concurrency = parsed;
    } else if (arg === '--concurrency') {
      const next = Number(argv[i + 1]);
      if (Number.isInteger(next) && next >= 1) {
        concurrency = next;
        i += 1;
      }
    } else if (!arg.startsWith('-')) {
      filters.push(arg.toLowerCase());
    }
  }

  return { serial, changed, dryRun, help, concurrency, filters };
}

function getChangedFiles(cwd = ROOT_DIR) {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', '--no-pager', 'status', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    shell: false,
    env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
  });
  if (res.error || res.status !== 0) {
    return null;
  }

  const changed = new Set();
  for (const rawLine of String(res.stdout || '').split(/\r?\n/)) {
    if (rawLine.trim().length < 3) continue;
    const rawPath = rawLine.slice(3).trim();
    const parts = rawPath.includes(' -> ') ? rawPath.split(' -> ') : [rawPath];
    for (const part of parts) {
      const cleaned = part.replace(/^"|"$/g, '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (cleaned) changed.add(cleaned);
    }
  }
  return Array.from(changed);
}

function suiteMatchesPath(suite, relPath) {
  if (relPath === suite.file) return true;
  return suite.matches.some((rule) =>
    rule.endsWith('/') ? relPath.startsWith(rule) : relPath === rule
  );
}

function selectSuites(opts) {
  let selected = [...SUITES];

  if (opts.changed) {
    const changedFiles = getChangedFiles(ROOT_DIR);
    if (changedFiles === null) {
      console.warn('[Test Runner] Git status unavailable; falling back to all test suites.');
    } else {
      selected = selected.filter((suite) =>
        changedFiles.some((file) => suiteMatchesPath(suite, file))
      );
    }
  }

  if (opts.filters.length > 0) {
    selected = selected.filter((suite) => {
      const lower = suite.file.toLowerCase();
      return opts.filters.some((f) => lower.includes(f));
    });
  }

  return selected;
}

function resolveConcurrency(opts, totalSuites) {
  if (opts.serial) return 1;
  const envVal = Number(process.env.ACM_TEST_CONCURRENCY);
  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const defaultCap = Math.min(4, Math.max(2, cpuCount || 2));
  const desired = opts.concurrency || (Number.isInteger(envVal) && envVal >= 1 ? envVal : defaultCap);
  return Math.max(1, Math.min(desired, Math.max(1, totalSuites)));
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT_DIR, suite.file)], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
      resolve({
        file: suite.file,
        code: 1,
        elapsedSec,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: `${Buffer.concat(stderrChunks).toString('utf-8')}\n${err.message}`,
      });
    });

    child.on('close', (code) => {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
      resolve({
        file: suite.file,
        code: code === null ? 1 : code,
        elapsedSec,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        'Usage: node tests/run-tests.cjs [options] [suite-filters...]',
        '',
        'Options:',
        '  --changed            Run only suites affected by current git working tree changes',
        '  --serial             Run suites sequentially (concurrency=1)',
        '  --concurrency=<N>    Max parallel suites (default: min(4, max(2, CPUs)))',
        '  --dry-run, --list    Print selected suites and concurrency without executing',
        '  -h, --help           Show help',
      ].join('\n')
    );
    process.exit(0);
  }

  const selected = selectSuites(opts);
  if (selected.length === 0) {
    console.log('[Test Runner] No test suites matched current criteria; skipping.');
    process.exit(0);
  }

  const concurrency = resolveConcurrency(opts, selected.length);
  console.log(`[Test Runner] Selected ${selected.length}/${SUITES.length} suite(s) (concurrency=${concurrency}):`);
  for (const suite of selected) {
    console.log(`  - ${suite.file}`);
  }

  if (opts.dryRun) {
    console.log('[Dry-Run] Exited without executing tests.');
    process.exit(0);
  }

  const overallStart = Date.now();
  const results = new Array(selected.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= selected.length) return;
      const suite = selected[idx];
      const res = await runSuite(suite);
      results[idx] = res;
      if (res.code === 0) {
        console.log(`[PASS] ${res.file} (${res.elapsedSec}s)`);
      } else {
        console.error(`[FAIL] ${res.file} (exit=${res.code}, ${res.elapsedSec}s)`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const totalElapsedSec = ((Date.now() - overallStart) / 1000).toFixed(2);
  const failed = results.filter((r) => r.code !== 0);
  const passedCount = results.length - failed.length;
  console.log(`[Test Runner] Summary: Passed ${passedCount}/${results.length} suite(s) in ${totalElapsedSec}s (concurrency=${concurrency}).`);

  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`\n=== FAILURE OUTPUT: ${f.file} (exit=${f.code}) ===`);
      if (f.stdout.trim()) console.error(f.stdout.trimEnd());
      if (f.stderr.trim()) console.error(f.stderr.trimEnd());
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Test Runner Error]', err);
  process.exit(1);
});

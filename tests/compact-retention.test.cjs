/**
 * tests/compact-retention.test.cjs
 *
 * Verification suite for Phase 1 memory lifecycle:
 * - Schema v1 -> v2 zero-downtime migration
 * - Retention config defaults, validation, and `acm config` CLI
 * - Hot/Cold FTS5 separation, Mode B `task-completed.md` projection limits (N, 0, -1)
 * - `sync_log` circular pruning, cold JSONL archive export, FTS optimize + WAL checkpoint + VACUUM
 * - `acm stats` and markdown-mode compatibility
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('../scripts/acm/storage/config.cjs');
const { SqliteProvider, SCHEMA_VERSION } = require('../scripts/acm/storage/sqlite-provider.cjs');
const { createMemoryStore } = require('../scripts/acm/storage/memory-store.cjs');
const { parseTaskCompletedMdFile } = require('../scripts/acm/storage/markdown-bridge.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

function runAcm(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    shell: false,
  });
}

console.log('=== Starting ACM Phase 1 Retention & Compaction Tests ===');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-compact-test-'));

try {
  // -------------------------------------------------------------------------
  // 1. Schema v1 -> v2 automatic migration
  // -------------------------------------------------------------------------
  console.log('[Stage 1] Schema v1 -> v2 zero-downtime migration');
  const migDir = path.join(tempRoot, 'v1-migration');
  const dbPath = path.join(migDir, '.agents', 'acm', 'local', 'memory.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (
      uid TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      purpose TEXT NOT NULL DEFAULT '',
      results_json TEXT NOT NULL DEFAULT '[]',
      targets_json TEXT NOT NULL DEFAULT '[]',
      owner TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      lease_owner TEXT DEFAULT NULL,
      lease_expires_at TEXT DEFAULT NULL,
      commit_sha TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      scope TEXT NOT NULL DEFAULT 'local',
      provenance TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE TABLE patterns (
      uid TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      symptom TEXT NOT NULL DEFAULT '',
      solution TEXT NOT NULL DEFAULT '',
      related_files_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      supersedes_uid TEXT DEFAULT NULL,
      scope TEXT NOT NULL DEFAULT 'shared',
      author TEXT DEFAULT '',
      provenance TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE TABLE adrs (
      uid TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      related_area TEXT NOT NULL DEFAULT '',
      related_task_code TEXT DEFAULT '',
      branch TEXT DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      impact TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'shared',
      author TEXT DEFAULT '',
      provenance TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE TABLE sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      provider TEXT NOT NULL,
      commit_ref TEXT DEFAULT NULL,
      records_pushed INTEGER NOT NULL DEFAULT 0,
      records_pulled INTEGER NOT NULL DEFAULT 0,
      conflicts_resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(uid UNINDEXED, kind UNINDEXED, code, title, body, tags, tokenize='unicode61');
    INSERT INTO meta (key, value) VALUES ('schema_version', '1');
    INSERT INTO tasks (uid, code, title, status, completed_at, created_at, updated_at)
      VALUES ('01LEGACYTSK000000000000001', 'TSK-1', 'Legacy v1 done task', 'done', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z');
    INSERT INTO patterns (uid, code, category, title, summary, created_at, updated_at)
      VALUES ('01LEGACYPAT000000000000001', 'P-01', 'Core', 'Legacy v1 pattern', 'Legacy summary', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z');
    INSERT INTO adrs (uid, code, date, title, summary, created_at, updated_at)
      VALUES ('01LEGACYADR000000000000001', 'LOG-01', '2025-01-10', 'Legacy v1 adr', 'Legacy ADR', '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:00.000Z');
  `);
  legacyDb.close();

  const migratedStore = new SqliteProvider(migDir).open();
  try {
    const stats = migratedStore.getStats();
    assert.strictEqual(SCHEMA_VERSION, '2');
    assert.strictEqual(stats.schemaVersion, '2');
    assert.ok(stats.dbSizeBytes > 0, 'Expected positive dbSizeBytes');

    const t = migratedStore.getTask('TSK-1');
    assert.strictEqual(t.archivedAt, null);
    const p = migratedStore.getPattern('P-01');
    assert.strictEqual(p.archivedAt, null);
    assert.strictEqual(p.lastAccessedAt, null);
    assert.strictEqual(p.accessCount, 0);
    const a = migratedStore.getAdr('LOG-01');
    assert.strictEqual(a.status, 'accepted');
  } finally {
    migratedStore.close();
  }

  // -------------------------------------------------------------------------
  // 2. Retention config defaults & `acm config` CLI
  // -------------------------------------------------------------------------
  console.log('[Stage 2] Retention defaults and acm config CLI');
  const workDir = path.join(tempRoot, 'workspace');
  fs.mkdirSync(workDir, { recursive: true });
  const initRes = runAcm(['init', '.', '--non-interactive', '--storage=sqlite'], workDir);
  assert.strictEqual(initRes.status, 0, `init failed: ${initRes.stderr || initRes.stdout}`);

  const cfg = loadConfig(workDir);
  assert.deepStrictEqual(cfg.retention, {
    doneTaskFtsDays: 90,
    doneTaskProjectionLimit: 50,
    syncLogMaxRows: 100,
    stalePatternDays: 180,
    tombstoneRetentionDays: 90,
  });
  assert.deepStrictEqual(DEFAULT_CONFIG.retention, cfg.retention);

  const cfgShowRes = runAcm(['config', 'show', '--json'], workDir);
  assert.strictEqual(cfgShowRes.status, 0);
  const cfgShowJson = JSON.parse(cfgShowRes.stdout);
  assert.strictEqual(cfgShowJson.config.storage.markdownProjection, false);
  assert.strictEqual(cfgShowJson.config.retention.doneTaskProjectionLimit, 50);

  const cfgGetRes = runAcm(['config', 'get', 'retention.doneTaskFtsDays', '--json'], workDir);
  assert.strictEqual(cfgGetRes.status, 0);
  assert.strictEqual(JSON.parse(cfgGetRes.stdout).value, 90);

  const cfgSetValid = runAcm(['config', 'set', 'retention.doneTaskFtsDays', '30', '--json'], workDir);
  assert.strictEqual(cfgSetValid.status, 0);
  assert.strictEqual(loadConfig(workDir).retention.doneTaskFtsDays, 30);

  const cfgSetUnlimited = runAcm(['config', 'set', 'retention.doneTaskFtsDays', '-1', '--json'], workDir);
  assert.strictEqual(cfgSetUnlimited.status, 0);
  assert.strictEqual(loadConfig(workDir).retention.doneTaskFtsDays, -1);

  for (const badArgs of [
    ['config', 'set', 'retention.doneTaskFtsDays', '-2'],
    ['config', 'set', 'retention.doneTaskFtsDays', '12.5'],
    ['config', 'set', 'retention.doneTaskFtsDays', 'abc'],
    ['config', 'set', 'storage.provider', 'markdown'],
    ['config', 'set', 'retention.unknownKey', '10'],
  ]) {
    const badRes = runAcm(badArgs, workDir);
    assert.strictEqual(badRes.status, 1, `Expected failure for ${badArgs.join(' ')}`);
  }

  // Restore default 90 days for compaction tests
  assert.strictEqual(runAcm(['config', 'set', 'retention.doneTaskFtsDays', '90'], workDir).status, 0);

  // -------------------------------------------------------------------------
  // 3. Hot/Cold FTS5 separation, sync_log pruning, cold archive & VACUUM
  // -------------------------------------------------------------------------
  console.log('[Stage 3] Compact dry-run, live compact, FTS exclusion, sync_log pruning');
  const now = new Date('2026-11-24T00:00:00.000Z');
  const oldDate = '2025-05-01T00:00:00.000Z';
  const recent1 = '2026-11-10T00:00:00.000Z';
  const recent2 = '2026-11-15T00:00:00.000Z';
  const recent3 = '2026-11-20T00:00:00.000Z';

  let store = createMemoryStore(workDir);
  let agedCode;
  let recentCodes = [];
  try {
    const aged = store.upsertTask(
      {
        title: 'Aged legacy cache cleanup task',
        status: 'done',
        purpose: 'Old cache cleanup',
        results: ['Cleaned legacy cache'],
        targets: ['scripts/old-cache.js'],
        commitSha: '111aaaa',
        completedAt: oldDate,
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      { skipValidation: true }
    );
    agedCode = aged.code;

    for (const [idx, dt] of [recent1, recent2, recent3].entries()) {
      const rec = store.upsertTask(
        {
          title: `Recent nebula feature ${idx + 1}`,
          status: 'done',
          purpose: 'Recent nebula delivery',
          results: [`Delivered nebula ${idx + 1}`],
          targets: [`src/nebula-${idx + 1}.js`],
          commitSha: `222bbb${idx}`,
          completedAt: dt,
          createdAt: dt,
          updatedAt: dt,
        },
        { skipValidation: true }
      );
      recentCodes.push(rec.code);
    }

    store.upsertTask({
      title: 'Active working task',
      status: 'in_progress',
      purpose: 'Ongoing work',
      targets: ['src/active.js'],
    });

    // Seed 5 sync_log rows directly to test pruning with --sync-log-max=2
    for (let i = 0; i < 5; i++) {
      store.recordSyncLog({ direction: 'push', recordsPushed: i + 1 });
    }
    assert.strictEqual(store.getStats().syncLogCount, 5);
  } finally {
    store.close();
  }

  // Dry-run via CLI must leave DB and FTS intact
  const dryRes = runAcm(['compact', '--dry-run', '--days=90', '--sync-log-max=2', '--json'], workDir);
  assert.strictEqual(dryRes.status, 0, dryRes.stderr);
  const dryJson = JSON.parse(dryRes.stdout);
  assert.strictEqual(dryJson.dryRun, true);
  assert.strictEqual(dryJson.archivedTasksCount, 1);
  assert.deepStrictEqual(dryJson.archivedTaskCodes, [agedCode]);
  assert.strictEqual(dryJson.prunedSyncLogs, 3);
  assert.strictEqual(dryJson.vacuumed, false);

  // Verify aged task is still searchable before real compact
  const preSearch = runAcm(['search', 'legacy cache', '--json'], workDir);
  assert.strictEqual(preSearch.status, 0);
  assert.strictEqual(JSON.parse(preSearch.stdout).count, 1);

  // Execute real compact with cold archive export
  store = createMemoryStore(workDir);
  let compactRes;
  try {
    compactRes = store.compact({
      dryRun: false,
      doneTaskFtsDays: 90,
      syncLogMaxRows: 2,
      vacuum: true,
      exportArchive: true,
      now,
    });
  } finally {
    store.close();
  }
  assert.strictEqual(compactRes.dryRun, false);
  assert.strictEqual(compactRes.archivedTasksCount, 1);
  assert.strictEqual(compactRes.prunedSyncLogs, 3);
  assert.strictEqual(compactRes.vacuumed, true);
  assert.ok(compactRes.exportedArchiveFiles.includes('.agents/acm/memory/archive/tasks-2025.jsonl'));

  const archiveJsonl = path.join(workDir, '.agents', 'acm', 'memory', 'archive', 'tasks-2025.jsonl');
  assert.ok(fs.existsSync(archiveJsonl), 'Cold archive JSONL missing');
  assert.ok(fs.readFileSync(archiveJsonl, 'utf-8').includes(agedCode));

  // Aged task must be excluded from FTS5 search, recent task must remain searchable
  const postSearchAged = runAcm(['search', 'legacy cache', '--json'], workDir);
  assert.strictEqual(JSON.parse(postSearchAged.stdout).count, 0, 'Archived task still matched in FTS5');
  const postSearchRecent = runAcm(['search', 'nebula', '--json'], workDir);
  assert.strictEqual(JSON.parse(postSearchRecent.stdout).count, 3, 'Recent tasks missing from FTS5');

  // -------------------------------------------------------------------------
  // 4. Mode B Markdown projection (opt-in projection: exclude archived, cap N=2, 0=none, full export)
  // -------------------------------------------------------------------------
  console.log('[Stage 4] Mode B Markdown projection limits and full export parity');
  assert.strictEqual(runAcm(['config', 'set', 'storage.markdownProjection', 'true'], workDir).status, 0);
  assert.strictEqual(runAcm(['config', 'set', 'retention.doneTaskProjectionLimit', '2'], workDir).status, 0);
  const completedMdPath = path.join(workDir, '.agents', 'acm', 'task', 'task-completed.md');
  const completedMdCap2 = fs.readFileSync(completedMdPath, 'utf-8');
  assert.ok(!completedMdCap2.includes(agedCode), 'Archived task should not be projected in Mode B');
  assert.ok(completedMdCap2.includes(recentCodes[2]) && completedMdCap2.includes(recentCodes[1]), 'Newest 2 unarchived tasks should be projected');
  assert.ok(!completedMdCap2.includes(recentCodes[0]), '3rd unarchived task should be omitted when limit=2');
  assert.ok(completedMdCap2.includes('Projection Policy'), 'Projection policy summary missing');

  // limit=0 hides completed tasks in task-completed.md while keeping active task.md intact
  assert.strictEqual(runAcm(['config', 'set', 'retention.doneTaskProjectionLimit', '0'], workDir).status, 0);
  const completedMdCap0 = fs.readFileSync(completedMdPath, 'utf-8');
  assert.strictEqual(parseTaskCompletedMdFile(completedMdPath).length, 0, 'limit=0 should not project completed task entries');
  assert.ok(!completedMdCap0.includes(`- [x] **${recentCodes[2]}`), 'limit=0 should not project completed tasks');
  assert.ok(completedMdCap0.includes('stored in SQLite DB'), 'limit=0 should show SQLite DB query notice');
  const activeTaskMd = fs.readFileSync(path.join(workDir, '.agents', 'acm', 'task', 'task.md'), 'utf-8');
  assert.ok(activeTaskMd.includes('Active working task'), 'Active task.md should still be projected');

  // acm export --format=md must export 100% of completed tasks regardless of limit=0 / archived
  const exportDir = path.join(tempRoot, 'full-md-export');
  const expRes = runAcm(['export', '--format=md', `--out=${exportDir}`], workDir);
  assert.strictEqual(expRes.status, 0, expRes.stderr);
  const exportedDone = parseTaskCompletedMdFile(path.join(exportDir, '.agents', 'acm', 'task', 'task-completed.md'));
  assert.strictEqual(exportedDone.length, 4, 'Full markdown export must include all 4 done tasks');

  // -------------------------------------------------------------------------
  // 5. doneTaskFtsDays=0 (immediate) & -1 (unlimited) + acm stats
  // -------------------------------------------------------------------------
  console.log('[Stage 5] Immediate (0), unlimited (-1), and acm stats CLI');
  assert.strictEqual(runAcm(['config', 'set', 'retention.doneTaskFtsDays', '-1'], workDir).status, 0);
  const unlimitedCompact = runAcm(['compact', '--dry-run', '--json'], workDir);
  assert.strictEqual(JSON.parse(unlimitedCompact.stdout).archivedTasksCount, 0);

  assert.strictEqual(runAcm(['config', 'set', 'retention.doneTaskFtsDays', '0'], workDir).status, 0);
  const immAdd = runAcm(['task', 'add', 'Immediate archive test', '--status=todo', '--json'], workDir);
  const immCode = JSON.parse(immAdd.stdout).task.code;
  const immDone = runAcm(['task', 'complete', immCode, '--sha=333cccc', '--json'], workDir);
  assert.strictEqual(immDone.status, 0);
  assert.ok(JSON.parse(immDone.stdout).task.archivedAt, 'doneTaskFtsDays=0 should immediately archive on complete');

  const statsJsonRes = runAcm(['stats', '--json'], workDir);
  assert.strictEqual(statsJsonRes.status, 0);
  const statsJson = JSON.parse(statsJsonRes.stdout);
  assert.strictEqual(statsJson.stats.tasks.done, 5);
  assert.strictEqual(statsJson.stats.tasks.archived, 2);
  assert.strictEqual(statsJson.stats.syncLogCount, 2);
  assert.strictEqual(statsJson.retention.doneTaskFtsDays, 0);

  const statsTextRes = runAcm(['stats'], workDir);
  assert.strictEqual(statsTextRes.status, 0);
  assert.ok(statsTextRes.stdout.includes('[ACM Stats]'), 'stats text output missing header');

  // -------------------------------------------------------------------------
  // 6. Markdown provider compatibility & migrate --to=markdown full restore
  // -------------------------------------------------------------------------
  console.log('[Stage 6] Markdown provider compatibility and migrate --to=markdown');
  const migToMd = runAcm(['migrate', '--to=markdown', '--json'], workDir);
  assert.strictEqual(migToMd.status, 0, migToMd.stderr);
  const restoredDone = parseTaskCompletedMdFile(completedMdPath);
  assert.strictEqual(restoredDone.length, 5, 'migrate --to=markdown must restore all 5 completed tasks');

  const mdCompactRes = runAcm(['compact', '--json'], workDir);
  assert.strictEqual(mdCompactRes.status, 0);
  const mdCompactJson = JSON.parse(mdCompactRes.stdout);
  assert.strictEqual(mdCompactJson.skipped, true);
  assert.strictEqual(mdCompactJson.provider, 'markdown');

  // Ensure direct saveConfig preserves retention defaults cleanly
  saveConfig(workDir, { ...loadConfig(workDir), retention: { ...DEFAULT_CONFIG.retention } });
  assert.strictEqual(loadConfig(workDir).retention.doneTaskProjectionLimit, 50);

  console.log('=== All ACM Phase 1 Retention & Compaction tests passed (0 errors) ===\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

/**
 * tests/git-orphan-sync.test.cjs
 *
 * Phase 3 (TSK-22): Tests for Secret Scrubber, Git orphan branch ('acm-memory') collaboration sync,
 * deterministic code collision resolution, non-Git fallback, and audit-push local DB leak blocking.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync, execSync } = require('child_process');

const { scrubText, scrubRecord, scrubRecords } = require('../scripts/storage/secret-scrubber.cjs');
const { syncWithGitOrphan } = require('../scripts/storage/git-orphan-sync.cjs');
const { saveConfig } = require('../scripts/storage/config.cjs');
const { createMemoryStore } = require('../scripts/storage/memory-store.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');
const AUDIT_PATH = path.join(ROOT_DIR, 'scripts', 'audit-push.cjs');

console.log('=== Starting Phase 3 Git Orphan Sync & Secret Scrubber Tests ===');

function runCli(args, cwd, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

// ---------------------------------------------------------------------------
// 1. Secret Scrubber unit tests (masking, idempotency, immutable metadata keys)
// ---------------------------------------------------------------------------
{
  const sampleText = [
    'OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    'ANTHROPIC=sk-ant-api03-1234567890abcdef1234567890',
    'GH=ghp_1234567890abcdef1234567890abcdef1234',
    'AWS=AKIAIOSFODNN7EXAMPLE',
    'GOOG=AIzaSyDummyKeyValue123456789012345678901',
    'SLACK=xoxb-123456789012-1234567890123-abcdef',
    'DB=postgres://admin:supersecretpass@db.example.com:5432/prod',
    'AUTH=Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'AGENTMEMORY_SECRET=my_shared_secret_987654321',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtokenbody\n-----END RSA PRIVATE KEY-----',
  ].join('\n');

  const res1 = scrubText(sampleText);
  assert.ok(res1.redactedCount >= 10, `Expected >= 10 redactions, got ${res1.redactedCount}`);
  assert.ok(!res1.text.includes('sk-proj-'), 'OpenAI key leaked');
  assert.ok(!res1.text.includes('sk-ant-'), 'Anthropic key leaked');
  assert.ok(!res1.text.includes('ghp_'), 'GitHub token leaked');
  assert.ok(!res1.text.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS key leaked');
  assert.ok(!res1.text.includes('AIzaSyDummyKeyValue'), 'Google key leaked');
  assert.ok(!res1.text.includes('xoxb-'), 'Slack token leaked');
  assert.ok(!res1.text.includes('supersecretpass'), 'DB URI password leaked');
  assert.ok(!res1.text.includes('eyJhbGciOi'), 'Bearer token leaked');
  assert.ok(!res1.text.includes('my_shared_secret_987654321'), 'Generic assignment secret leaked');
  assert.ok(!res1.text.includes('MIIEowIBAAKCAQEAtokenbody'), 'Private key leaked');

  // Idempotency check
  const res2 = scrubText(res1.text);
  assert.strictEqual(res2.redactedCount, 0, 'Scrubber should be idempotent on already redacted text');
  assert.strictEqual(res2.text, res1.text);

  // Immutable metadata preservation check
  const recInput = {
    uid: '01ABCDEF1234567890GHJKMNPQ',
    code: 'P-01',
    createdAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    solution: 'Use Bearer secret_token_value_123456789 safely',
  };
  const recRes = scrubRecord(recInput);
  assert.strictEqual(recRes.record.uid, recInput.uid);
  assert.strictEqual(recRes.record.code, recInput.code);
  assert.strictEqual(recRes.redactedCount, 1);
  assert.ok(recRes.record.solution.includes('[REDACTED:BEARER_TOKEN]'));
  assert.ok(recInput.solution.includes('secret_token_value_123456789'), 'Original input must not be mutated');
  console.log('[PASS] 1. Secret Scrubber masking, idempotency, and metadata preservation verified.');
}

// ---------------------------------------------------------------------------
// 2. Two-developer bare remote Git orphan branch sync & conflict resolution E2E
// ---------------------------------------------------------------------------
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-orphan-collab-'));
  const bareDir = path.join(sandbox, 'remote.git');
  const devADir = path.join(sandbox, 'dev-a');
  const devBDir = path.join(sandbox, 'dev-b');

  try {
    fs.mkdirSync(bareDir, { recursive: true });
    execSync('git init --bare', { cwd: bareDir, stdio: 'ignore' });

    execSync(`git clone "${bareDir}" "${devADir}"`, { stdio: 'ignore' });
    execSync('git config user.name "Dev A"', { cwd: devADir, stdio: 'ignore' });
    execSync('git config user.email "deva@example.com"', { cwd: devADir, stdio: 'ignore' });
    execSync('git checkout -b main', { cwd: devADir, stdio: 'ignore' });
    fs.writeFileSync(path.join(devADir, 'README.md'), '# Shared Collab Repo\n');
    execSync('git add README.md && git commit -m "chore: initial main"', { cwd: devADir, stdio: 'ignore' });
    execSync('git push -u origin main', { cwd: devADir, stdio: 'ignore' });

    // Dev A initializes ACM and pushes baseline main; Dev B clones afterwards and runs acm init
    assert.strictEqual(runCli(['init', '--non-interactive'], devADir).status, 0);
    execSync('git add .gitignore AGENTS.md package.json && git commit -m "chore: setup acm on main"', {
      cwd: devADir,
      stdio: 'ignore',
    });
    execSync('git push origin main', { cwd: devADir, stdio: 'ignore' });

    execSync(`git clone "${bareDir}" "${devBDir}"`, { stdio: 'ignore' });
    execSync('git config user.name "Dev B"', { cwd: devBDir, stdio: 'ignore' });
    execSync('git config user.email "devb@example.com"', { cwd: devBDir, stdio: 'ignore' });
    assert.strictEqual(runCli(['init', '--non-interactive'], devBDir).status, 0);

    const devAMainBefore = execSync('git rev-parse HEAD', { cwd: devADir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(devADir, 'dirty-work.txt'), 'uncommitted dev A work\n');

    // Dev A registers P-01 (with secret), LOG-01, TSK-1 (done), and TSK-2 (in_progress local only)
    const storeA = createMemoryStore(devADir, { skipProjection: true });
    try {
      storeA.upsertPattern({
        category: 'Auth',
        title: 'API Token Configuration',
        summary: 'Store tokens in env only',
        symptom: 'Hardcoded sk-proj-secretvalue1234567890abcdef in config',
        solution: 'Use process.env.OPENAI_KEY instead of Authorization: Bearer abcdefghijklmnop1234',
        relatedFiles: ['src/auth.js'],
        createdAt: '2026-11-23T01:00:00.000Z',
        updatedAt: '2026-11-23T01:00:00.000Z',
      });
      storeA.upsertAdr({
        date: '2026-11-23',
        title: 'Adopt Orphan Branch Sync',
        summary: 'Sync shared memories via acm-memory branch',
        relatedArea: 'scripts/storage/',
        context: 'Avoid polluting main git log',
        decision: 'Use Git plumbing temporary index',
        impact: 'Zero working tree disruption',
        createdAt: '2026-11-23T01:05:00.000Z',
        updatedAt: '2026-11-23T01:05:00.000Z',
      });
      storeA.upsertTask({
        title: 'Completed shared baseline task',
        status: 'done',
        commitSha: '111aaaa',
        completedAt: '2026-11-23T01:10:00.000Z',
        createdAt: '2026-11-23T01:00:00.000Z',
        updatedAt: '2026-11-23T01:10:00.000Z',
      });
      storeA.upsertTask({
        title: 'Private WIP task that must stay local',
        status: 'in_progress',
        purpose: 'Local secret wip task',
      });
    } finally {
      storeA.close();
    }

    // Dev A runs acm sync
    const syncARes = runCli(['sync', '--json'], devADir);
    assert.strictEqual(syncARes.status, 0, `Dev A sync failed: ${syncARes.stderr || syncARes.stdout}`);
    const syncAOut = JSON.parse(syncARes.stdout);
    assert.strictEqual(syncAOut.ok, true);
    assert.ok(syncAOut.commitSha, 'Expected orphan commit SHA');
    assert.ok(syncAOut.redactedCount >= 2, `Expected >= 2 secrets scrubbed, got ${syncAOut.redactedCount}`);

    // Main branch HEAD and working tree on Dev A must remain completely untouched
    const devAMainAfter = execSync('git rev-parse HEAD', { cwd: devADir, encoding: 'utf-8' }).trim();
    const devABranchNow = execSync('git rev-parse --abbrev-ref HEAD', { cwd: devADir, encoding: 'utf-8' }).trim();
    assert.strictEqual(devAMainAfter, devAMainBefore, 'Main branch HEAD changed during orphan sync!');
    assert.strictEqual(devABranchNow, 'main', 'Current branch switched away from main!');
    assert.strictEqual(
      fs.readFileSync(path.join(devADir, 'dirty-work.txt'), 'utf-8'),
      'uncommitted dev A work\n',
      'Dirty working tree file disturbed by sync!'
    );

    // Inspect remote acm-memory branch directly: secrets scrubbed, private WIP task excluded
    const remotePatternsRaw = execSync(`git --git-dir="${bareDir}" show refs/heads/acm-memory:patterns.jsonl`, {
      encoding: 'utf-8',
    });
    assert.ok(!remotePatternsRaw.includes('sk-proj-'), 'Unscrubbed OpenAI key pushed to remote!');
    assert.ok(!remotePatternsRaw.includes('abcdefghijklmnop1234'), 'Unscrubbed Bearer token pushed to remote!');
    assert.ok(remotePatternsRaw.includes('[REDACTED:OPENAI_KEY]'), 'Redacted marker missing in remote patterns.jsonl');

    const remoteTasksRaw = execSync(`git --git-dir="${bareDir}" show refs/heads/acm-memory:tasks-archived.jsonl`, {
      encoding: 'utf-8',
    });
    assert.ok(remoteTasksRaw.includes('Completed shared baseline task'), 'Completed task missing from remote archive');
    assert.ok(!remoteTasksRaw.includes('Private WIP task that must stay local'), 'Private in_progress L1 task leaked!');

    // Verify true orphan commit (0 parents on first commit)
    const parentCheck = spawnSync(
      'git',
      [`--git-dir=${bareDir}`, 'rev-list', '--parents', '-n', '1', 'refs/heads/acm-memory'],
      { encoding: 'utf-8' }
    );
    const revParts = parentCheck.stdout.trim().split(/\s+/);
    assert.strictEqual(revParts.length, 1, `First acm-memory commit must be true orphan (0 parents), got: ${parentCheck.stdout}`);

    // Dev B independently creates conflicting P-01, LOG-01, and TSK-1 (in_progress) BEFORE pulling Dev A
    const storeB = createMemoryStore(devBDir, { skipProjection: true });
    try {
      storeB.upsertPattern({
        category: 'Database',
        title: 'WAL Checkpoint Tuning',
        summary: 'Prevent WAL bloat on Windows',
        symptom: 'WAL grows on busy writes',
        solution: 'Set busy_timeout=5000 and close handles cleanly',
        relatedFiles: ['scripts/storage/sqlite-provider.cjs'],
        createdAt: '2026-11-23T02:00:00.000Z',
        updatedAt: '2026-11-23T02:00:00.000Z',
      });
      storeB.upsertAdr({
        date: '2026-11-23',
        title: 'CLI JSON Input Mode',
        summary: 'Support --stdin for multiline JSON',
        relatedArea: 'scripts/acm-db-cli.cjs',
        context: 'PowerShell escaping issues',
        decision: 'Add --stdin JSON merge',
        impact: 'Reliable Korean and multiline writes',
        createdAt: '2026-11-23T02:05:00.000Z',
        updatedAt: '2026-11-23T02:05:00.000Z',
      });
      storeB.upsertTask({
        title: 'Dev B local active task colliding on TSK-1',
        status: 'in_progress',
        purpose: 'Verify local TSK-1 collision renumbers safely',
        createdAt: '2026-11-23T02:10:00.000Z',
        updatedAt: '2026-11-23T02:10:00.000Z',
      });
    } finally {
      storeB.close();
    }

    // Dev B syncs: merges Dev A's records + renumbers Dev B's conflicting codes cleanly + pushes
    const syncBRes = runCli(['sync', '--json'], devBDir);
    assert.strictEqual(syncBRes.status, 0, `Dev B sync failed: ${syncBRes.stderr || syncBRes.stdout}`);
    const syncBOut = JSON.parse(syncBRes.stdout);
    assert.ok(syncBOut.pulled >= 3, `Expected Dev B to pull >= 3 records, got ${syncBOut.pulled}`);
    assert.strictEqual(syncBOut.conflictsResolved, 3, `Expected 3 code collisions resolved, got ${syncBOut.conflictsResolved}`);

    const devBPatterns = JSON.parse(runCli(['pattern', 'list', '--json'], devBDir).stdout).patterns;
    assert.strictEqual(devBPatterns.length, 2);
    assert.strictEqual(devBPatterns.find((p) => p.code === 'P-01').title, 'API Token Configuration');
    assert.strictEqual(devBPatterns.find((p) => p.code === 'P-02').title, 'WAL Checkpoint Tuning');

    const devBTasksAll = JSON.parse(runCli(['task', 'list', '--all', '--json'], devBDir).stdout).tasks;
    assert.strictEqual(devBTasksAll.find((t) => t.code === 'TSK-1').status, 'done');
    assert.strictEqual(devBTasksAll.find((t) => t.code === 'TSK-2').status, 'in_progress');

    // Dev A pulls Dev B's updates
    const dryPullRes = runCli(['sync', '--pull', '--dry-run', '--json'], devADir);
    assert.strictEqual(dryPullRes.status, 0);
    assert.ok(JSON.parse(dryPullRes.stdout).pulled >= 2);

    const pullARes = runCli(['sync', '--pull', '--json'], devADir);
    assert.strictEqual(pullARes.status, 0, pullARes.stderr);
    assert.ok(JSON.parse(pullARes.stdout).pulled >= 2);

    const devAPatterns = JSON.parse(runCli(['pattern', 'list', '--json'], devADir).stdout).patterns;
    const devAAdrs = JSON.parse(runCli(['adr', 'list', '--json'], devADir).stdout).adrs;
    assert.strictEqual(devAPatterns.length, 2);
    assert.strictEqual(devAAdrs.length, 2);

    // Status command verification
    const statusRes = runCli(['sync', '--status', '--json'], devADir);
    assert.strictEqual(statusRes.status, 0, statusRes.stderr);
    const statusOut = JSON.parse(statusRes.stdout);
    assert.strictEqual(statusOut.branch, 'acm-memory');
    assert.ok(statusOut.lastSyncCommit);
    assert.ok(Array.isArray(statusOut.history) && statusOut.history.length >= 2);

    console.log('[PASS] 2. Multi-clone Git orphan sync, code collision resolution, and isolation verified.');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. Non-Git directory graceful skip for acm sync
// ---------------------------------------------------------------------------
{
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-sync-nongit-'));
  try {
    saveConfig(nonGitDir, { storage: { provider: 'sqlite' } });
    const res = runCli(['sync', '--json'], nonGitDir);
    assert.strictEqual(res.status, 0, `Non-Git sync should exit 0: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.skipped, true);
    assert.strictEqual(out.reason, 'non-git');
    console.log('[PASS] 3. Non-Git graceful sync skip verified.');
  } finally {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. audit-push.cjs blocks staged local SQLite DB files (.db / .db-wal)
// ---------------------------------------------------------------------------
{
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-audit-db-'));
  try {
    execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', {
      cwd: auditDir,
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(auditDir, 'README.md'), '# Audit DB Test\n');
    execSync('git add README.md && git commit -m "chore: init"', { cwd: auditDir, stdio: 'ignore' });

    fs.mkdirSync(path.join(auditDir, '.agents', 'local'), { recursive: true });
    fs.writeFileSync(path.join(auditDir, '.agents', 'local', 'memory.db'), 'fake sqlite binary\n');
    fs.writeFileSync(path.join(auditDir, '.agents', 'local', 'memory.db-wal'), 'fake wal\n');
    execSync('git add -f .agents/local/memory.db .agents/local/memory.db-wal', {
      cwd: auditDir,
      stdio: 'ignore',
    });

    const auditRes = spawnSync(process.execPath, [AUDIT_PATH], {
      cwd: auditDir,
      env: { ...process.env, ACM_ROOT_DIR: auditDir },
      encoding: 'utf-8',
    });
    assert.strictEqual(auditRes.status, 1, 'audit-push.cjs must block staged .agents/local/memory.db files');
    assert.ok(
      (auditRes.stderr || auditRes.stdout).includes('.agents/local/memory.db'),
      'Blocked DB file path missing from audit output'
    );
    console.log('[PASS] 4. audit-push.cjs local SQLite DB leak blocking verified.');
  } finally {
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
}

console.log('=== All Phase 3 Git Orphan Sync & Secret Scrubber Tests Passed (0 errors) ===\n');

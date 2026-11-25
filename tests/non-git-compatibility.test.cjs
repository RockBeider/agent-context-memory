/**
 * tests/non-git-compatibility.test.cjs
 *
 * Non-Git environment (uninitialized or no-Git directory) E2E compatibility test suite
 * covering both English default and Korean (--lang=ko) installations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

console.log('=== Starting Non-Git Environment Compatibility E2E Tests ===');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nongit-test-'));
console.log(`[Setup] Created temporary Non-Git test directory: ${tempDir}`);

try {
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'dummy-nongit-app', version: '1.0.0', scripts: {} }, null, 2)
  );

  // 1. Default English init in non-Git directory
  console.log('[Step 1] Running init (English default)');
  const initRes = spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(initRes.status, 0, `init failed (status: ${initRes.status}): ${initRes.stderr || initRes.stdout}`);
  const initCfg = JSON.parse(fs.readFileSync(path.join(tempDir, '.agents', 'acm', 'config.json'), 'utf-8'));
  assert.strictEqual(initCfg.storage.provider, 'sqlite', 'Default Non-Git init should use sqlite');
  assert.strictEqual(initCfg.storage.markdownProjection, false, 'Default sqlite Non-Git init should disable markdownProjection');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'local', 'memory.db')), '.agents/acm/local/memory.db missing');
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task.md')), 'Default sqlite init should not create .agents/acm/task/task.md');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'ACM_GOVERNANCE.md')), '.agents/acm/ACM_GOVERNANCE.md missing');
  assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'AGENTS.md missing');
  console.log('[PASS] init completed and pure SQLite non-Git setup verified.');

  // 2. status (Non-Git Memory Viewer mode)
  console.log('[Step 2] Running status (Non-Git Memory Viewer mode)');
  const statusRes = spawnSync(process.execPath, [CLI_PATH, 'status'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(statusRes.status, 0, `status failed: ${statusRes.stderr || statusRes.stdout}`);
  assert.ok(
    statusRes.stdout.includes('Non-Git Mode') || statusRes.stdout.includes('Not a Git repository'),
    'Non-Git viewer notice missing'
  );
  assert.ok(statusRes.stdout.includes('Working Memory'), 'Working Memory section missing');
  console.log('[PASS] status Non-Git Memory Viewer verified.');

  // 3. status --compact
  console.log('[Step 3] Running status --compact');
  const compactRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(compactRes.status, 0, `status --compact failed: ${compactRes.stderr || compactRes.stdout}`);
  assert.ok(compactRes.stdout.includes('[Non-Git]'), 'Compact Non-Git prefix missing');
  console.log('[PASS] status --compact verified.');

  // 4. commit graceful skip in Non-Git
  console.log('[Step 4] Running commit (Non-Git graceful guard)');
  const commitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(commitRes.status, 0, `commit failed: ${commitRes.stderr || commitRes.stdout}`);
  assert.ok(
    commitRes.stdout.includes('skipping Git commit') || commitRes.stdout.includes('Cannot execute Git commit'),
    'commit Non-Git skip message missing'
  );
  console.log('[PASS] commit Non-Git graceful skip verified.');

  // 5. pull graceful skip in Non-Git
  console.log('[Step 5] Running pull (Non-Git graceful guard)');
  const pullRes = spawnSync(process.execPath, [CLI_PATH, 'pull'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(pullRes.status, 0, `pull failed: ${pullRes.stderr || pullRes.stdout}`);
  assert.ok(pullRes.stdout.includes('skipping pull tool'), 'pull Non-Git skip message missing');
  console.log('[PASS] pull Non-Git guard verified.');

  // 6. audit graceful skip in Non-Git
  console.log('[Step 6] Running audit (Non-Git graceful guard)');
  const auditRes = spawnSync(process.execPath, [CLI_PATH, 'audit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(auditRes.status, 0, `audit failed: ${auditRes.stderr || auditRes.stdout}`);
  assert.ok(auditRes.stdout.includes('skipping audit tool'), 'audit Non-Git skip message missing');
  console.log('[PASS] audit Non-Git guard verified.');

  // 7. Korean (--lang=ko) Non-Git viewer verification
  console.log('[Step 7] Running Korean (--lang=ko) Non-Git viewer check');
  const koInitRes = spawnSync(process.execPath, [CLI_PATH, 'init', '--lang=ko', '--force', '--non-interactive'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(koInitRes.status, 0, 'Korean Non-Git init failed');

  const koStatusRes = spawnSync(process.execPath, [CLI_PATH, 'status'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(koStatusRes.status, 0, 'Korean Non-Git status failed');
  assert.ok(koStatusRes.stdout.includes('비-Git 모드'), 'Korean Non-Git viewer header missing');
  assert.ok(koStatusRes.stdout.includes('작업 기억 정본'), 'Korean Working Memory label missing');

  const koCompactRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(koCompactRes.status, 0, 'Korean Non-Git status --compact failed');
  assert.ok(koCompactRes.stdout.includes('[비-Git 환경]'), 'Korean compact header missing');
  console.log('[PASS] Korean Non-Git viewer verified.');

  // 7.5 acm id command in Non-Git directory
  console.log('[Step 7.5] Running acm id in Non-Git directory');
  const idRes = spawnSync(process.execPath, [CLI_PATH, 'id', 'pattern', '--count=2', '--json'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(idRes.status, 0, `acm id failed in Non-Git directory: ${idRes.stderr || idRes.stdout}`);
  const idOut = JSON.parse(idRes.stdout);
  assert.strictEqual(idOut.ok, true);
  assert.strictEqual(idOut.codes.length, 2);
  assert.ok(idOut.codes.every((c) => /^P-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(c)));
  console.log('[PASS] acm id Non-Git verified.');

  // 7.6 --storage=markdown Non-Git fallback verification
  console.log('[Step 7.6] Verifying --storage=markdown Non-Git fallback');
  const mdInitRes = spawnSync(
    process.execPath,
    [CLI_PATH, 'init', '--storage=markdown', '--force', '--non-interactive'],
    { cwd: tempDir, encoding: 'utf-8' }
  );
  assert.strictEqual(mdInitRes.status, 0, 'Markdown Non-Git init failed');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task.md')), 'Markdown Non-Git mode missing task.md');
  const mdStatusRes = spawnSync(process.execPath, [CLI_PATH, 'status'], { cwd: tempDir, encoding: 'utf-8' });
  assert.strictEqual(mdStatusRes.status, 0, 'Markdown Non-Git status failed');
  assert.ok(mdStatusRes.stdout.includes('Non-Git Mode'), 'Markdown Non-Git viewer header missing');
  console.log('[PASS] Markdown Non-Git fallback verified.');

  // 8. uninstall --force rollback
  console.log('[Step 8] Running uninstall (rollback verification)');
  const uninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(uninstallRes.status, 0, `uninstall failed: ${uninstallRes.stderr || uninstallRes.stdout}`);
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), '.agents directory was not deleted');
  console.log('[PASS] uninstall rollback verified.');

  console.log('=== All Non-Git Environment Compatibility Tests Passed ===\n');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`[Cleanup] Removed temporary test directory: ${tempDir}`);
  } catch (_) {}
}

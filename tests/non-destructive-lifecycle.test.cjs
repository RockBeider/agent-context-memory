/**
 * tests/non-destructive-lifecycle.test.cjs
 *
 * Phase 2 regression suite verifying non-destructive install, re-install,
 * .agents/hooks.json 4-scenario handling, selective .gitignore isolation,
 * [KEEP] file protection, and inventory-based uninstall (v2 & legacy v1).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync, execSync } = require('child_process');
const {
  readZipEntries,
  readTarGzEntries,
  writeZipArchive,
} = require('../scripts/acm/backup-archive.cjs');
const {
  pushBackupToGit,
  discoverGitBackups,
  readGitBackupBuffer,
} = require('../scripts/acm/backup-git.cjs');

console.log('=== Starting Non-Destructive Lifecycle & Collision Protection Tests ===');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
  });
}

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test Runner"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
}

// ---------------------------------------------------------------------------
// 1. Coexistence with host .agents/, scripts/, hooks.json, package.json, .gitignore
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-coexist-'));
  try {
    initGitRepo(dir);
    fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'skills', 'host-skill'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });

    fs.writeFileSync(path.join(dir, '.agents', 'rules', 'host-custom.md'), '# Host Custom Rule\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'agents', 'host-agent.md'), '# Host Agent\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'skills', 'host-skill', 'SKILL.md'), '# Host Skill\n', 'utf-8');
    const hostHooks = {
      'host-lint-hook': {
        enabled: true,
        PreInvocation: [{ type: 'command', command: 'echo host lint' }],
      },
    };
    fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), JSON.stringify(hostHooks, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'build.cjs'), 'console.log("host build");\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'i18n.cjs'), '// host i18n\n', 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'host-coexist-app',
          version: '1.0.0',
          scripts: {
            build: 'node scripts/build.cjs',
            'git:status': 'echo custom host git status',
          },
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
    execSync('git add . && git commit -m "chore: host baseline"', { cwd: dir, stdio: 'ignore' });

    const initRes = runCli(['init', '--non-interactive'], dir);
    assert.strictEqual(initRes.status, 0, `Coexist init failed: ${initRes.stderr || initRes.stdout}`);

    const mergedHooks = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf-8'));
    assert.deepStrictEqual(mergedHooks['host-lint-hook'], hostHooks['host-lint-hook'], 'Host hook altered on init');
    assert.ok(mergedHooks['acm-token-monitor'], 'acm-token-monitor not merged into host hooks.json');

    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.schemaVersion, 2);
    assert.strictEqual(meta.hooks.createdFile, false, 'hooks.createdFile should be false when host hooks.json existed');
    assert.ok(meta.hooks.keys.includes('acm-token-monitor'));

    const giAfterInit = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    assert.ok(!/^\/?\.agents\/?$/m.test(giAfterInit), '.gitignore must not wholesale-ignore /.agents/');
    assert.ok(!giAfterInit.includes('/.agents/hooks.json'), '.gitignore must not ignore pre-existing hooks.json');
    assert.ok(giAfterInit.includes('/.agents/acm/'), '.gitignore missing /.agents/acm/');

    // Host .agents/ custom rule file remains tracked/unignored by Git
    fs.writeFileSync(path.join(dir, '.agents', 'rules', 'host-custom.md'), '# Host Custom Rule v2\n', 'utf-8');
    const gitStatusHost = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' });
    assert.ok(gitStatusHost.includes('.agents/rules/host-custom.md'), 'Host .agents/ file was wrongly gitignored');
    fs.writeFileSync(path.join(dir, '.agents', 'rules', 'host-custom.md'), '# Host Custom Rule\n', 'utf-8');

    // Force re-install must also preserve host assets & hooks.createdFile=false
    const forceRes = runCli(['init', '--force', '--non-interactive'], dir);
    assert.strictEqual(forceRes.status, 0, `Coexist force init failed: ${forceRes.stderr || forceRes.stdout}`);
    const metaAfterForce = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(metaAfterForce.hooks.createdFile, false, 'hooks.createdFile changed to true after --force');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'scripts', 'i18n.cjs'), 'utf-8'), '// host i18n\n');

    // Uninstall must preserve 100% of host assets while creating .acm-backup-*
    const unRes = runCli(['uninstall', '--force'], dir);
    assert.strictEqual(unRes.status, 0, `Coexist uninstall failed: ${unRes.stderr || unRes.stdout}`);

    const backupZip = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-') && f.endsWith('.zip'));
    assert.ok(backupZip, 'Root .acm-backup-*.zip archive missing');
    const zipEntries = readZipEntries(fs.readFileSync(path.join(dir, backupZip)));
    assert.ok(zipEntries.some((e) => e.name === '.agents/acm/ACM_GOVERNANCE.md'));

    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'acm')), '.agents/acm should be deleted');
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'rules', 'acm-task-memory-adr.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'acm')), 'scripts/acm should be deleted');

    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'rules', 'host-custom.md'), 'utf-8'), '# Host Custom Rule\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'agents', 'host-agent.md'), 'utf-8'), '# Host Agent\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'skills', 'host-skill', 'SKILL.md'), 'utf-8'), '# Host Skill\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'scripts', 'build.cjs'), 'utf-8'), 'console.log("host build");\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'scripts', 'i18n.cjs'), 'utf-8'), '// host i18n\n');

    const restoredHooks = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf-8'));
    assert.deepStrictEqual(restoredHooks, hostHooks, 'Host hooks.json not restored cleanly');

    const restoredPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.strictEqual(restoredPkg.scripts.build, 'node scripts/build.cjs');
    assert.strictEqual(restoredPkg.scripts['git:status'], 'echo custom host git status');
    assert.strictEqual(restoredPkg.scripts['acm:commit'], undefined);

    const restoredGi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').replace(/\r\n/g, '\n');
    assert.strictEqual(restoredGi, 'node_modules/\n', '.gitignore did not revert cleanly');
    console.log('[PASS] 1. Host .agents/, scripts/, hooks.json, package.json, and .gitignore coexistence verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 2. Pre-existing empty {} .agents/hooks.json preservation
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-emptyhooks-'));
  try {
    initGitRepo(dir);
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), '{}\n', 'utf-8');

    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const merged = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf-8'));
    assert.ok(merged['acm-token-monitor'], 'acm-token-monitor should be merged into {}');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.hooks.createdFile, false, 'Empty {} host hooks.json must record createdFile=false');
    assert.ok(!fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').includes('/.agents/hooks.json'));

    assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], dir).status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.agents', 'hooks.json')), 'Pre-existing empty hooks.json must NOT be deleted');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf-8')), {});
    console.log('[PASS] 2. Pre-existing empty {} .agents/hooks.json preservation verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. Malformed JSON / JSONC .agents/hooks.json protection
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-badhooks-'));
  try {
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    const rawBadHooks = '// JSONC comment\n{\n  "host": true,\n}\n';
    const hooksPath = path.join(dir, '.agents', 'hooks.json');
    fs.writeFileSync(hooksPath, rawBadHooks, 'utf-8');

    const safeRes = runCli(['init', '--non-interactive'], dir);
    assert.strictEqual(safeRes.status, 0, safeRes.stderr);
    assert.strictEqual(fs.readFileSync(hooksPath, 'utf-8'), rawBadHooks, 'Safe init mutated malformed hooks.json');

    const forceRes = runCli(['init', '--force', '--non-interactive'], dir);
    assert.strictEqual(forceRes.status, 0, forceRes.stderr);
    assert.strictEqual(fs.readFileSync(hooksPath, 'utf-8'), rawBadHooks, 'Force init mutated malformed hooks.json');

    const unRes = runCli(['uninstall', '--force', '--no-backup'], dir);
    assert.strictEqual(unRes.status, 0, unRes.stderr);
    assert.strictEqual(fs.readFileSync(hooksPath, 'utf-8'), rawBadHooks, 'Uninstall mutated or deleted malformed hooks.json');
    console.log('[PASS] 3. Malformed JSON / JSONC .agents/hooks.json protection verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. [KEEP] pre-existing file protection & safe re-install idempotency
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-keep-'));
  try {
    fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'acm'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'acm'), { recursive: true });

    const preRule = '# Host Custom Rule Override\n';
    const preGov = '# Host Custom Governance\n';
    const preScript = '// Host Custom check-git.cjs\n';
    fs.writeFileSync(path.join(dir, '.agents', 'rules', 'acm-task-memory-adr.md'), preRule, 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'acm', 'ACM_GOVERNANCE.md'), preGov, 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'acm', 'check-git.cjs'), preScript, 'utf-8');

    // Safe mode run #1
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const meta1 = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.ok(meta1.skippedExistingFiles.includes('.agents/rules/acm-task-memory-adr.md'));
    assert.ok(meta1.skippedExistingFiles.includes('.agents/acm/ACM_GOVERNANCE.md'));
    assert.ok(meta1.skippedExistingFiles.includes('scripts/acm/check-git.cjs'));
    assert.ok(!meta1.installedFiles.includes('scripts/acm/check-git.cjs'));
    assert.ok(meta1.installedFiles.includes('scripts/acm/group-status.cjs'));

    // Safe mode run #2 (must NOT demote ACM-installed files into skippedExistingFiles)
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const meta2 = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.ok(meta2.installedFiles.includes('scripts/acm/group-status.cjs'), 'Safe re-install lost installedFiles tracking');
    assert.ok(meta2.installedFiles.includes('.agents/agents/acm-context-compactor.md'));
    assert.ok(!meta2.skippedExistingFiles.includes('scripts/acm/group-status.cjs'));
    assert.ok(meta2.skippedExistingFiles.includes('scripts/acm/check-git.cjs'));

    // Uninstall must preserve the 3 [KEEP] files and remove ACM-installed ones
    assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], dir).status, 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'rules', 'acm-task-memory-adr.md'), 'utf-8'), preRule);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'acm', 'ACM_GOVERNANCE.md'), 'utf-8'), preGov);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'scripts', 'acm', 'check-git.cjs'), 'utf-8'), preScript);
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'acm', 'group-status.cjs')), 'ACM-installed script was not removed');
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'agents')), 'ACM-installed .agents/agents should be cleaned');
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'acm', 'config.json')), 'ACM config.json should be removed');
    console.log('[PASS] 4. [KEEP] protected file preservation & safe re-install idempotency verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 5. Clean project multi-level empty dir cleanup & conditional hooks.json .gitignore
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-clean-'));
  try {
    initGitRepo(dir);
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(meta.hooks.createdFile, true);
    assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').includes('/.agents/hooks.json'));

    assert.strictEqual(runCli(['uninstall', '--force'], dir).status, 0);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('.acm-backup-') && f.endsWith('.zip')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents')), 'Empty .agents directory remained');
    assert.ok(!fs.existsSync(path.join(dir, 'scripts')), 'Empty scripts directory remained');
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')), 'ACM-created .gitignore remained');
    console.log('[PASS] 5. Clean project multi-level empty dir cleanup & conditional hooks.json verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. Legacy v1 installation non-destructive uninstall
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-legacy-'));
  try {
    fs.mkdirSync(path.join(dir, '.agents', 'task'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'memory', 'patterns'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'local'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.agents', 'skills', 'git-workflow'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'storage'), { recursive: true });

    fs.writeFileSync(path.join(dir, '.agents', '.acm-meta.json'), JSON.stringify({ language: 'en', ruleFiles: ['AGENTS.md'] }), 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'MEMORY_GOVERNANCE.md'), '# Legacy Gov\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'config.json'), JSON.stringify({ version: 1 }), 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'task', 'task.md'), '# Legacy Task\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'memory', 'patterns-index.md'), '# Legacy Patterns\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'local', 'memory.db'), 'dummy-db', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'scripts', 'token-monitor.cjs'), '// legacy monitor\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'rules', '60-task-memory-adr.md'), '# Legacy Rule\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'agents', 'context-compactor.md'), '# Legacy Compactor\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'agents', 'git-release-sentinel.md'), '# Legacy Sentinel\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.agents', 'skills', 'git-workflow', 'SKILL.md'), '# Legacy Skill\n', 'utf-8');

    // Host assets inside .agents/ and scripts/
    fs.writeFileSync(path.join(dir, '.agents', 'rules', 'host-team-rule.md'), '# Host Team Rule\n', 'utf-8');
    fs.writeFileSync(
      path.join(dir, '.agents', 'hooks.json'),
      JSON.stringify({ 'context-monitor': { enabled: true }, 'host-legacy-hook': { enabled: true } }, null, 2),
      'utf-8'
    );
    fs.writeFileSync(path.join(dir, 'scripts', 'acm-manifest.cjs'), '// legacy manifest\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'group-status.cjs'), '// legacy group-status\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'storage', 'config.cjs'), '// legacy config\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'scripts', 'host-deploy.cjs'), 'console.log("host deploy");\n', 'utf-8');

    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'legacy-v1-app',
          version: '1.0.0',
          scripts: {
            test: 'echo host test',
            'git:status': 'node scripts/group-status.cjs --dry-run',
            'git:commit': 'node scripts/group-status.cjs --all',
            'git:custom': 'echo preserve host git custom',
          },
        },
        null,
        2
      ),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(dir, '.gitignore'),
      'node_modules/\n# Agent Context Memory Ignored Entries\n/.agents/\n/.agent/\n',
      'utf-8'
    );

    const unRes = runCli(['uninstall', '--force'], dir);
    assert.strictEqual(unRes.status, 0, `Legacy v1 uninstall failed: ${unRes.stderr || unRes.stdout}`);

    const backupZip = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-') && f.endsWith('.zip'));
    assert.ok(backupZip, 'Legacy uninstall did not create .acm-backup-*.zip');
    const legacyZipEntries = readZipEntries(fs.readFileSync(path.join(dir, backupZip)));
    assert.ok(legacyZipEntries.some((e) => e.name === '.agents/task/task.md'));
    assert.ok(legacyZipEntries.some((e) => e.name === '.agents/MEMORY_GOVERNANCE.md'));

    // Legacy ACM assets removed
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'task')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'memory')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'local')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', '.acm-meta.json')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'MEMORY_GOVERNANCE.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'rules', '60-task-memory-adr.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.agents', 'skills')));
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'acm-manifest.cjs')));
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'storage')));

    // Host assets preserved
    assert.strictEqual(fs.readFileSync(path.join(dir, '.agents', 'rules', 'host-team-rule.md'), 'utf-8'), '# Host Team Rule\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'scripts', 'host-deploy.cjs'), 'utf-8'), 'console.log("host deploy");\n');
    const legacyHooksAfter = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'hooks.json'), 'utf-8'));
    assert.deepStrictEqual(legacyHooksAfter, { 'host-legacy-hook': { enabled: true } });

    const pkgAfter = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.strictEqual(pkgAfter.scripts.test, 'echo host test');
    assert.strictEqual(pkgAfter.scripts['git:custom'], 'echo preserve host git custom');
    assert.strictEqual(pkgAfter.scripts['git:status'], undefined);
    assert.strictEqual(pkgAfter.scripts['git:commit'], undefined);

    const giAfter = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').replace(/\r\n/g, '\n');
    assert.strictEqual(giAfter, 'node_modules/\n');
    console.log('[PASS] 6. Legacy v1 non-destructive uninstall verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. Compressed backups (zip, tar.gz, dir), SQLite WAL/SHM, UTF-8/long paths, Git orphan backups
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-archive-'));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-remote-'));
  try {
    // 7a. Default .zip backup with SQLite WAL/SHM, UTF-8 Korean path, and empty dir
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const localDir = path.join(dir, '.agents', 'acm', 'local');
    const dbBytes = fs.readFileSync(path.join(localDir, 'memory.db'));
    const walBytes = Buffer.from('WAL-SIDECAR-BYTES-\x00\xff-한글', 'utf-8');
    const shmBytes = Buffer.from('SHM-SIDECAR-BYTES-\x01\xfe', 'utf-8');
    fs.writeFileSync(path.join(localDir, 'memory.db-wal'), walBytes);
    fs.writeFileSync(path.join(localDir, 'memory.db-shm'), shmBytes);

    const utf8Rel = '.agents/acm/memory/patterns/P-한글-패턴-테스트.md';
    fs.mkdirSync(path.join(dir, '.agents', 'acm', 'memory', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(dir, utf8Rel), '# 한글 UTF-8 패턴\n', 'utf-8');
    const emptySubDir = '.agents/acm/empty-빈폴더';
    fs.mkdirSync(path.join(dir, emptySubDir), { recursive: true });

    const unZipRes = runCli(['uninstall', '--force'], dir);
    assert.strictEqual(unZipRes.status, 0, unZipRes.stderr || unZipRes.stdout);
    const zipName = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-') && f.endsWith('.zip'));
    assert.ok(zipName, 'Default zip archive missing');

    const zipEntries = readZipEntries(fs.readFileSync(path.join(dir, zipName)));
    const entryMap = new Map(zipEntries.map((e) => [e.name, e]));
    assert.ok(Buffer.compare(entryMap.get('.agents/acm/local/memory.db').data, dbBytes) === 0);
    assert.ok(Buffer.compare(entryMap.get('.agents/acm/local/memory.db-wal').data, walBytes) === 0);
    assert.ok(Buffer.compare(entryMap.get('.agents/acm/local/memory.db-shm').data, shmBytes) === 0);
    assert.strictEqual(entryMap.get(utf8Rel).data.toString('utf-8'), '# 한글 UTF-8 패턴\n');
    assert.ok(entryMap.get(`${emptySubDir}/`) && entryMap.get(`${emptySubDir}/`).isDirectory);

    // 7b. --backup-format=tar.gz with >100 byte PAX long path + UTF-8 + system tar check
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    fs.writeFileSync(path.join(dir, '.agents', 'acm', 'local', 'memory.db-wal'), walBytes);
    fs.writeFileSync(path.join(dir, '.agents', 'acm', 'local', 'memory.db-shm'), shmBytes);
    const longRel = `.agents/acm/memory/patterns/${'segment-'.repeat(12)}한글-장경로.md`;
    assert.ok(Buffer.byteLength(longRel, 'utf-8') > 100);
    fs.mkdirSync(path.dirname(path.join(dir, longRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, longRel), 'long-pax-content\n', 'utf-8');

    const unTarRes = runCli(['uninstall', '--force', '--backup-format=tar.gz'], dir);
    assert.strictEqual(unTarRes.status, 0, unTarRes.stderr || unTarRes.stdout);
    const tarName = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-') && f.endsWith('.tar.gz'));
    assert.ok(tarName, 'tar.gz archive missing');
    const tarEntries = readTarGzEntries(fs.readFileSync(path.join(dir, tarName)));
    const tarMap = new Map(tarEntries.map((e) => [e.name, e]));
    assert.ok(Buffer.compare(tarMap.get('.agents/acm/local/memory.db-wal').data, walBytes) === 0);
    assert.ok(Buffer.compare(tarMap.get('.agents/acm/local/memory.db-shm').data, shmBytes) === 0);
    assert.strictEqual(tarMap.get(longRel).data.toString('utf-8'), 'long-pax-content\n');

    const sysTarCheck = spawnSync('tar', ['-tzf', tarName], { cwd: dir, encoding: 'utf-8' });
    if (sysTarCheck.status === 0) {
      assert.ok(sysTarCheck.stdout.includes('.agents/acm/local/memory.db-wal'), 'System tar missing WAL entry');
    }

    // 7c. --backup-format=dir, --dry-run, --no-backup, invalid args, non-Git git-target rejection
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const dryRes = runCli(['uninstall', '--dry-run', '--backup-format=tar.gz'], dir);
    assert.strictEqual(dryRes.status, 0);
    assert.ok(dryRes.stdout.includes('[DRY-RUN]'), 'Dry-run output missing');

    const badFmt = runCli(['uninstall', '--force', '--backup-format=rar'], dir);
    assert.strictEqual(badFmt.status, 1, 'Invalid backup format must fail');
    const badTgt = runCli(['uninstall', '--force', '--backup-target=ftp'], dir);
    assert.strictEqual(badTgt.status, 1, 'Invalid backup target must fail');
    const nonGitTgt = runCli(['uninstall', '--force', '--backup-target=git'], dir);
    assert.strictEqual(nonGitTgt.status, 1, 'Non-Git dir with --backup-target=git must fail');

    const dirRes = runCli(['uninstall', '--force', '--backup-format=dir'], dir);
    assert.strictEqual(dirRes.status, 0, dirRes.stderr || dirRes.stdout);
    const dirBackup = fs
      .readdirSync(dir)
      .find((f) => f.startsWith('.acm-backup-') && !f.endsWith('.zip') && !f.endsWith('.tar.gz'));
    assert.ok(dirBackup && fs.statSync(path.join(dir, dirBackup)).isDirectory(), 'Directory backup missing');
    assert.ok(fs.existsSync(path.join(dir, dirBackup, '.agents', 'acm', 'ACM_GOVERNANCE.md')));

    // 7d. Git backup target ('git' & 'both'), .gitignore coverage & legacy /.acm-backup-*/ rollback, pruning
    execSync('git init --bare', { cwd: remoteDir, stdio: 'ignore' });
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# Git Backup Test\n', 'utf-8');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n# Agent Context Memory Ignored Entries\n/.acm-backup-*/\n', 'utf-8');
    execSync('git add . && git commit -m "chore: init"', { cwd: dir, stdio: 'ignore' });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: dir, stdio: 'ignore' });

    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    // Verify .gitignore ignores local .zip, .tar.gz, and dir backups
    const giCheck = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' });
    assert.ok(!giCheck.includes('.acm-backup-'), `Backups should be gitignored, got:\n${giCheck}`);

    // Legacy /.acm-backup-*/ rule rollback verification
    const headBefore = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    const gitBothRes = runCli(['uninstall', '--force', '--backup-target=both'], dir);
    assert.strictEqual(gitBothRes.status, 0, gitBothRes.stderr || gitBothRes.stdout);
    assert.strictEqual(execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim(), headBefore, 'Main branch HEAD mutated by Git backup');

    const gitDiscovered = discoverGitBackups(dir, { fetchRemote: false });
    assert.strictEqual(gitDiscovered.length, 1, 'Expected 1 backup on acm-backups orphan branch');
    const remoteLs = execSync(`git ls-remote "${remoteDir}" refs/heads/acm-backups`, { encoding: 'utf-8' }).trim();
    assert.ok(remoteLs, 'acm-backups branch not pushed to bare remote');
    const gitBuf = readGitBackupBuffer(dir, gitDiscovered[0]);
    assert.ok(readZipEntries(gitBuf).some((e) => e.name === '.agents/acm/local/memory.db'));

    // Verify pruning retains only maxRetained newest backups
    for (let k = 1; k <= 3; k += 1) {
      pushBackupToGit(dir, {
        archiveBuffer: Buffer.from(`dummy-${k}`),
        filename: `.acm-backup-20261125_15000${k}.zip`,
        format: 'zip',
        branch: 'acm-prune-test',
        maxRetained: 2,
      });
    }
    const pruned = discoverGitBackups(dir, { branch: 'acm-prune-test' });
    assert.strictEqual(pruned.length, 2, 'Git backup pruning did not cap retained count at maxRetained');
    assert.strictEqual(pruned[0].name, '.acm-backup-20261125_150003.zip');

    // Also verify /.acm-backup-*/ in pre-existing .gitignore was cleaned on uninstall
    const giAfterLegacy = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    assert.ok(!giAfterLegacy.includes('/.acm-backup-*/'), 'Legacy /.acm-backup-*/ remained in .gitignore');

    console.log('[PASS] 7. Compressed backups (.zip/.tar.gz/dir), WAL/UTF-8/PAX, Git orphan push & pruning verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 8. Init backup discovery & restore (Local .zip/.tar.gz/dir, Git local+remote, Markdown, legacy v1, Zip-Slip)
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-restore-'));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-restore-remote-'));
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-restore-clone-'));
  try {
    execSync('git init --bare', { cwd: remoteDir, stdio: 'ignore' });
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'restore-app', version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(dir, 'README.md'), '# Restore Test\n', 'utf-8');
    execSync('git add . && git commit -m "chore: init"', { cwd: dir, stdio: 'ignore' });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: dir, stdio: 'ignore' });
    execSync('git push -u origin HEAD', { cwd: dir, stdio: 'ignore' });

    // 8a. SQLite task + pattern -> uninstall --backup-target=both -> delete local zip -> restore from git
    assert.strictEqual(runCli(['init', '--non-interactive'], dir).status, 0);
    const addTask = runCli(['task', 'add', 'Restore Verification Task', '--purpose=Verify restore'], dir);
    assert.strictEqual(addTask.status, 0, addTask.stderr || addTask.stdout);
    const addedTaskCode = addTask.stdout.match(/TSK-[A-Z0-9]+/)[0];
    const addPat = runCli(['pattern', 'add', 'Backup Pattern', '--summary=Survives uninstall/reinstall'], dir);
    assert.strictEqual(addPat.status, 0, addPat.stderr || addPat.stdout);

    assert.strictEqual(runCli(['uninstall', '--force', '--backup-target=both'], dir).status, 0);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.acm-backup-')) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }

    // Non-interactive without --restore-backup must NOT auto-restore, should print hint
    const hintRes = runCli(['init', '--non-interactive'], dir);
    assert.strictEqual(hintRes.status, 0);
    assert.ok(hintRes.stdout.includes('--restore-backup'), 'Non-interactive hint missing when Git backup exists');
    const emptyList = runCli(['task', 'list', '--json'], dir);
    assert.strictEqual(JSON.parse(emptyList.stdout).count, 0, 'Non-interactive init auto-restored unexpectedly');

    // Suppress hint with --no-restore-backup
    assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], dir).status, 0);
    const noHintRes = runCli(['init', '--non-interactive', '--no-restore-backup'], dir);
    assert.strictEqual(noHintRes.status, 0);
    assert.ok(!noHintRes.stdout.includes('--restore-backup'), '--no-restore-backup did not suppress hint');
    assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], dir).status, 0);

    // Explicit --restore-backup=git restores SQLite records cleanly
    const gitRestoreRes = runCli(['init', '--non-interactive', '--restore-backup=git'], dir);
    assert.strictEqual(gitRestoreRes.status, 0, gitRestoreRes.stderr || gitRestoreRes.stdout);
    const showRestored = runCli(['task', 'show', addedTaskCode, '--json'], dir);
    assert.strictEqual(showRestored.status, 0, 'Restored task missing after --restore-backup=git');
    assert.strictEqual(JSON.parse(showRestored.stdout).title, 'Restore Verification Task');
    const restoreMeta = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(restoreMeta.restoredFromBackup && restoreMeta.restoredFromBackup.source, 'git');

    // 8b. Fresh clone from remote fetches acm-backups and restores automatically via --restore-backup=git
    execSync(`git clone "${remoteDir}" "${cloneDir}"`, { stdio: 'ignore' });
    const cloneRestoreRes = runCli(['init', '--non-interactive', '--restore-backup=git'], cloneDir);
    assert.strictEqual(cloneRestoreRes.status, 0, cloneRestoreRes.stderr || cloneRestoreRes.stdout);
    const cloneShow = runCli(['task', 'show', addedTaskCode, '--json'], cloneDir);
    assert.strictEqual(cloneShow.status, 0, 'Fresh clone did not restore task from remote acm-backups');

    // 8c. Local .tar.gz restore preserves archive & cleans stale WAL
    const utf8Long = `.agents/acm/memory/patterns/${'abc-'.repeat(28)}한글.md`;
    fs.mkdirSync(path.dirname(path.join(dir, utf8Long)), { recursive: true });
    fs.writeFileSync(path.join(dir, utf8Long), '# Restored UTF-8 Long Pattern\n', 'utf-8');
    assert.strictEqual(runCli(['uninstall', '--force', '--backup-format=tar.gz'], dir).status, 0);
    const tarBackup = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-') && f.endsWith('.tar.gz'));
    assert.ok(tarBackup);
    // Inject stale memory.db-wal that should be wiped before restoring clean DB
    fs.mkdirSync(path.join(dir, '.agents', 'acm', 'local'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'acm', 'local', 'memory.db-wal'), 'STALE-CORRUPT-WAL');

    const tarRestoreRes = runCli(['init', '--non-interactive', `--restore-backup=${tarBackup}`], dir);
    assert.strictEqual(tarRestoreRes.status, 0, tarRestoreRes.stderr || tarRestoreRes.stdout);
    assert.strictEqual(fs.readFileSync(path.join(dir, utf8Long), 'utf-8'), '# Restored UTF-8 Long Pattern\n');
    assert.ok(fs.existsSync(path.join(dir, tarBackup)), 'Original tar.gz backup was deleted during restore');
    assert.strictEqual(runCli(['task', 'show', addedTaskCode, '--json'], dir).status, 0);

    // 8d. Missing backup error & Zip-Slip security guard
    const missingRes = runCli(['init', '--non-interactive', '--restore-backup=does-not-exist.zip'], dir);
    assert.strictEqual(missingRes.status, 1, 'Missing backup did not fail');
    assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], dir).status, 0);
    const evilZipPath = path.join(dir, '.acm-backup-20261125_235959.zip');
    writeZipArchive(evilZipPath, [
      { name: '.agents/acm/task/task.md', isDirectory: false, data: Buffer.from('# ok\n') },
      { name: '../../evil.txt', isDirectory: false, data: Buffer.from('pwned') },
    ]);
    const evilRes = runCli(['init', '--non-interactive', `--restore-backup=${path.basename(evilZipPath)}`], dir);
    assert.strictEqual(evilRes.status, 1, 'Zip-Slip archive was not rejected');
    assert.ok(!fs.existsSync(path.resolve(dir, '..', '..', 'evil.txt')), 'Zip-Slip escaped target dir');
    assert.ok(!fs.existsSync(path.resolve(dir, 'evil.txt')), 'Zip-Slip wrote evil.txt');
    fs.unlinkSync(evilZipPath);

    // 8e. Markdown backup + --force --restore-backup preserves user task.md instead of blank sample
    const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-md-restore-'));
    try {
      assert.strictEqual(runCli(['init', '--non-interactive', '--storage=markdown'], mdDir).status, 0);
      const mdTaskPath = path.join(mdDir, '.agents', 'acm', 'task', 'task.md');
      fs.writeFileSync(mdTaskPath, '# Task Master\n- [ ] **TSK-MD9999: Custom User Task**\n', 'utf-8');
      assert.strictEqual(runCli(['uninstall', '--force'], mdDir).status, 0);

      const mdRestoreRes = runCli(['init', '--force', '--non-interactive', '--restore-backup'], mdDir);
      assert.strictEqual(mdRestoreRes.status, 0, mdRestoreRes.stderr || mdRestoreRes.stdout);
      const restoredMdTask = fs.readFileSync(mdTaskPath, 'utf-8');
      assert.ok(restoredMdTask.includes('TSK-MD9999'), '--force --restore-backup overwrote restored user task.md');
      const restoredMdCfg = JSON.parse(fs.readFileSync(path.join(mdDir, '.agents', 'acm', 'config.json'), 'utf-8'));
      assert.strictEqual(restoredMdCfg.storage.provider, 'markdown', 'Inferred storage provider should be markdown');
      assert.strictEqual(runCli(['uninstall', '--force', '--no-backup'], mdDir).status, 0);
      assert.ok(!fs.existsSync(path.join(mdDir, 'scripts', 'acm')), 'Uninstall after restore failed to clean scripts/acm');
    } finally {
      fs.rmSync(mdDir, { recursive: true, force: true });
    }

    // 8f. Legacy v1 backup auto-mapping into v2 .agents/acm/
    const v1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nd-v1-restore-'));
    try {
      const v1Zip = path.join(v1Dir, '.acm-backup-20261125_101010.zip');
      writeZipArchive(v1Zip, [
        {
          name: '.agents/config.json',
          isDirectory: false,
          data: Buffer.from(JSON.stringify({ version: 1, storage: { provider: 'markdown', dbPath: '.agents/local/memory.db' } })),
        },
        { name: '.agents/task/task.md', isDirectory: false, data: Buffer.from('# Legacy Task\n- [ ] **TSK-LEG1: Old Task**\n') },
        { name: '.agents/memory/patterns-index.md', isDirectory: false, data: Buffer.from('# Legacy Patterns\n') },
        { name: '.agents/MEMORY_GOVERNANCE.md', isDirectory: false, data: Buffer.from('# Old Gov Should Not Overwrite\n') },
      ]);
      const v1RestoreRes = runCli(['init', '--non-interactive', '--restore-backup'], v1Dir);
      assert.strictEqual(v1RestoreRes.status, 0, v1RestoreRes.stderr || v1RestoreRes.stdout);
      assert.ok(
        fs.readFileSync(path.join(v1Dir, '.agents', 'acm', 'task', 'task.md'), 'utf-8').includes('TSK-LEG1'),
        'Legacy v1 task.md not mapped into .agents/acm/task/task.md'
      );
      const mappedCfg = JSON.parse(fs.readFileSync(path.join(v1Dir, '.agents', 'acm', 'config.json'), 'utf-8'));
      assert.strictEqual(mappedCfg.storage.dbPath, '.agents/acm/local/memory.db', 'Legacy dbPath not normalized');
      assert.ok(!fs.existsSync(path.join(v1Dir, '.agents', 'MEMORY_GOVERNANCE.md')), 'Legacy system file leaked during v1 restore');
    } finally {
      fs.rmSync(v1Dir, { recursive: true, force: true });
    }

    console.log('[PASS] 8. Init backup discovery & restore (Local/Git/Remote/Markdown/v1/Zip-Slip) verified.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
}

console.log('=== All Non-Destructive Lifecycle & Collision Protection Tests Passed ===\n');

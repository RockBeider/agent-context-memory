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

    const backupDir = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-'));
    assert.ok(backupDir, 'Root .acm-backup-* directory missing');
    assert.ok(fs.existsSync(path.join(dir, backupDir, '.agents', 'acm', 'ACM_GOVERNANCE.md')));

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
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('.acm-backup-')));
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

    const backupDir = fs.readdirSync(dir).find((f) => f.startsWith('.acm-backup-'));
    assert.ok(backupDir, 'Legacy uninstall did not create .acm-backup-*');
    assert.ok(fs.existsSync(path.join(dir, backupDir, '.agents', 'task', 'task.md')));
    assert.ok(fs.existsSync(path.join(dir, backupDir, '.agents', 'MEMORY_GOVERNANCE.md')));

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

console.log('=== All Non-Destructive Lifecycle & Collision Protection Tests Passed ===\n');

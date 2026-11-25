/**
 * tests/e2e-install.test.cjs
 *
 * Agent Context Memory integration, packaging, EN/KO i18n, and Git E2E test suite.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');
const { PassThrough } = require('stream');
const { spawnSync, execSync } = require('child_process');

console.log('=== Starting Agent Context Memory E2E & Distribution Verification Tests ===');

const ROOT_DIR = path.resolve(__dirname, '..');
const { ACM_MANIFEST } = require('../scripts/acm/acm-manifest.cjs');

// 1. Verify required repository & distribution files exist
const requiredFiles = [
  'package.json',
  'README.md',
  'README.ko.md',
  'LICENSE',
  'AGENTS.md',
  'bin/agent-context-memory.js',
  'scripts/acm/i18n.cjs',
  'scripts/acm/locales/en.cjs',
  'scripts/acm/locales/ko.cjs',
  'scripts/acm/install-template.cjs',
  'scripts/acm/uninstall-template.cjs',
  'scripts/acm/acm-manifest.cjs',
  'scripts/acm/backup-archive.cjs',
  'scripts/acm/backup-git.cjs',
  'scripts/acm/acm-db-cli.cjs',
  'scripts/acm/mcp-server.cjs',
  'scripts/acm/group-status.cjs',
  'scripts/acm/smart-pull.cjs',
  'scripts/acm/audit-push.cjs',
  'scripts/acm/check-git.cjs',
  'scripts/acm/sync-agent-rules.cjs',
  'scripts/acm/storage/id-utils.cjs',
  'scripts/acm/storage/config.cjs',
  'scripts/acm/storage/memory-store.cjs',
  'scripts/acm/storage/sqlite-provider.cjs',
  'scripts/acm/storage/markdown-bridge.cjs',
  'scripts/acm/storage/markdown-provider.cjs',
  'scripts/acm/storage/secret-scrubber.cjs',
  'scripts/acm/storage/git-orphan-sync.cjs',
  '.agents/acm/ACM_GOVERNANCE.md',
  '.agents/rules/acm-task-memory-adr.md',
  '.agents/agents/acm-git-release-sentinel.md',
  '.agents/agents/acm-context-compactor.md',
  '.agents/skills/acm-git-workflow/SKILL.md',
  '.agents/acm/scripts/acm-token-monitor.cjs',
  '.agents/hooks.json',
  'acm-template/AGENTS.md',
  'acm-template/.agents/acm/ACM_GOVERNANCE.md',
  'acm-template/.agents/rules/acm-task-memory-adr.md',
  'acm-template/.agents/agents/acm-git-release-sentinel.md',
  'acm-template/.agents/agents/acm-context-compactor.md',
  'acm-template/.agents/skills/acm-git-workflow/SKILL.md',
  'acm-template/.agents/acm/scripts/acm-token-monitor.cjs',
  'acm-template/.agents/hooks.json',
  'acm-template/.agents/acm/task/task.md',
  'acm-template/.agents/acm/task/task-completed.md',
  'acm-template/.agents/acm/memory/patterns-index.md',
  'acm-template/.agents/acm/memory/patterns/P-00-sample-pattern.md',
  'acm-template/.agents/acm/memory/project-changelog.md',
  'acm-template/locales/ko/AGENTS.md',
  'acm-template/locales/ko/.agents/acm/ACM_GOVERNANCE.md',
  'acm-template/locales/ko/.agents/rules/acm-task-memory-adr.md',
  'acm-template/locales/ko/.agents/agents/acm-git-release-sentinel.md',
  'acm-template/locales/ko/.agents/agents/acm-context-compactor.md',
  'acm-template/locales/ko/.agents/skills/acm-git-workflow/SKILL.md',
  'acm-template/locales/ko/.agents/acm/task/task.md',
  'acm-template/locales/ko/.agents/acm/task/task-completed.md',
  'acm-template/locales/ko/.agents/acm/memory/patterns-index.md',
  'acm-template/locales/ko/.agents/acm/memory/patterns/P-00-sample-pattern.md',
  'acm-template/locales/ko/.agents/acm/memory/project-changelog.md',
];

for (const rel of requiredFiles) {
  const fullPath = path.join(ROOT_DIR, rel);
  assert.ok(fs.existsSync(fullPath), `Missing required file: ${rel}`);
}
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'rules')),
  'Legacy top-level rules/ directory still exists'
);
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'acm-template/rules')),
  'Legacy acm-template/rules/ directory still exists'
);
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'acm-template/scripts')),
  'Duplicate acm-template/scripts/ directory still exists'
);
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'acm-template/.agents/acm/memory/patterns/P-01-git-pager-freeze-fix.md')),
  'Real numbered pattern file (P-01) leaked into acm-template'
);

const normalizeEol = (s) => s.replace(/\r\n/g, '\n');
for (const fileMeta of ACM_MANIFEST.files) {
  const rootScriptPath = path.join(ROOT_DIR, fileMeta.path);
  assert.ok(fs.existsSync(rootScriptPath), `Missing manifest script in root scripts/acm/: ${fileMeta.path}`);
}

const sharedAgentFiles = [
  'acm/ACM_GOVERNANCE.md',
  'rules/acm-task-memory-adr.md',
  'agents/acm-git-release-sentinel.md',
  'agents/acm-context-compactor.md',
  'skills/acm-git-workflow/SKILL.md',
  'acm/scripts/acm-token-monitor.cjs',
  'hooks.json',
];
for (const relAgent of sharedAgentFiles) {
  const rootContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, '.agents', relAgent), 'utf-8'));
  const tplContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'acm-template', '.agents', relAgent), 'utf-8'));
  assert.strictEqual(tplContent, rootContent, `.agents mismatch between root and acm-template: ${relAgent}`);
}

// Verify manifest canonical governance bodies match EN & KO template AGENTS.md
const tplAgentsEn = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'acm-template', 'AGENTS.md'), 'utf-8'));
const tplAgentsKo = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'acm-template', 'locales', 'ko', 'AGENTS.md'), 'utf-8'));
assert.ok(
  tplAgentsEn.includes(normalizeEol(ACM_MANIFEST.governanceRules.expectedBodies.en)),
  'acm-template/AGENTS.md does not match expectedBodies.en'
);
assert.ok(
  tplAgentsKo.includes(normalizeEol(ACM_MANIFEST.governanceRules.expectedBodies.ko)),
  'acm-template/locales/ko/AGENTS.md does not match expectedBodies.ko'
);

// Verify locale catalog key parity between en.cjs and ko.cjs
const enCatalog = require('../scripts/acm/locales/en.cjs');
const koCatalog = require('../scripts/acm/locales/ko.cjs');
function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}
assert.deepStrictEqual(collectKeys(koCatalog), collectKeys(enCatalog), 'en.cjs and ko.cjs locale keys are out of sync');
console.log('[PASS] Required files, sample isolation, EN/KO template parity, and 1:1 script sync verified.');

// 2. Verify package.json metadata
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
assert.strictEqual(pkg.name, 'agent-context-memory', 'package.json name mismatch');
assert.strictEqual(pkg.license, 'MIT', 'package.json license mismatch');
assert.ok(pkg.files.includes('LICENSE'), 'LICENSE missing from package.json files whitelist');
assert.ok(pkg.files.includes('README.ko.md'), 'README.ko.md missing from package.json files whitelist');
assert.ok(pkg.repository, 'repository field missing');
assert.ok(pkg.publishConfig, 'publishConfig field missing');
assert.ok(pkg.dependencies && pkg.dependencies['@clack/prompts'], '@clack/prompts dependency missing');
console.log('[PASS] package.json metadata and dependencies verified.');

// 3. Verify LICENSE integrity
const license = fs.readFileSync(path.join(ROOT_DIR, 'LICENSE'), 'utf-8');
assert.ok(license.includes('MIT License'), 'MIT License text missing from LICENSE');
assert.ok(license.includes('Rock Beider'), 'Author missing from LICENSE');
console.log('[PASS] LICENSE integrity verified.');

// 4. Git E2E lifecycle simulation
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-git-e2e-'));
console.log(`\n[Setup] Created temporary Git host project: ${tempDir}`);

async function runTests() {
  try {
    // 4-1. Initialize Git repo and baseline commit
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'dummy-git-app', version: '1.0.0', scripts: {} }, null, 2)
    );
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Dummy Git App\n');
    execSync('git add . && git commit -m "chore: initial commit"', { cwd: tempDir, stdio: 'ignore' });
    console.log('[PASS] Git repository initialized with baseline commit.');

    // 4-2. Implicit init CLI execution (English default)
    console.log('[Stage 1] Implicit init CLI (--force --non-interactive, English default)');
    const initRes = spawnSync(process.execPath, [CLI_PATH, '--force', '--non-interactive'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(initRes.status, 0, `Implicit init failed: ${initRes.stderr || initRes.stdout}`);
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task.md')), 'Default sqlite init should not create .agents/acm/task/task.md');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'memory', 'patterns-index.md')), 'Default sqlite init should not create .agents/acm/memory/patterns-index.md');
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'rules', 'acm-task-memory-adr.md')), 'acm-task-memory-adr.md missing');
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'agents', 'acm-git-release-sentinel.md')), 'acm-git-release-sentinel.md missing');
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'ACM_GOVERNANCE.md')), '.agents/acm/ACM_GOVERNANCE.md missing');
    assert.ok(fs.existsSync(path.join(tempDir, 'scripts', 'acm', 'i18n.cjs')), 'scripts/acm/i18n.cjs missing');
    assert.ok(fs.existsSync(path.join(tempDir, 'scripts', 'acm', 'locales', 'en.cjs')), 'scripts/acm/locales/en.cjs missing');
    for (const fileMeta of ACM_MANIFEST.files) {
      const hostScriptPath = path.join(tempDir, fileMeta.path);
      assert.ok(fs.existsSync(hostScriptPath), `Host missing manifest script: ${fileMeta.path}`);
      const expectedScript = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, fileMeta.path), 'utf-8'));
      const actualScript = normalizeEol(fs.readFileSync(hostScriptPath, 'utf-8'));
      assert.strictEqual(actualScript, expectedScript, `Host copied script mismatch: ${fileMeta.path}`);
    }
    assert.ok(!fs.existsSync(path.join(tempDir, 'rules')), 'Legacy rules/ folder created at host root');
    assert.ok(!fs.existsSync(path.join(tempDir, 'locales')), 'Template locales/ leaked into host root');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'locales')), 'Template locales/ leaked into host .agents');
    assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'AGENTS.md missing');

    const rootAgentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    assert.ok(rootAgentsContent.includes('[Three Canonical Stores]'), 'Default AGENTS.md is not English');

    const metaObj = JSON.parse(fs.readFileSync(path.join(tempDir, '.agents', 'acm', 'meta.json'), 'utf-8'));
    assert.strictEqual(metaObj.schemaVersion, 2, 'meta.json schemaVersion should be 2');
    assert.strictEqual(metaObj.language, 'en', 'meta.json language should default to en');
    assert.strictEqual(metaObj.storageProvider, 'sqlite', 'meta.json storageProvider should default to sqlite');
    assert.ok(Array.isArray(metaObj.installedFiles) && metaObj.installedFiles.length > 0, 'meta.json installedFiles missing');
    assert.ok(Array.isArray(metaObj.skippedExistingFiles), 'meta.json skippedExistingFiles missing');
    assert.strictEqual(metaObj.hooks && metaObj.hooks.file, '.agents/hooks.json', 'meta.json hooks.file mismatch');
    assert.strictEqual(metaObj.hooks && metaObj.hooks.createdFile, true, 'meta.json hooks.createdFile should be true on clean repo');
    assert.ok(Array.isArray(metaObj.hooks && metaObj.hooks.keys) && metaObj.hooks.keys.includes('acm-token-monitor'), 'meta.json hooks.keys missing acm-token-monitor');
    assert.ok(Array.isArray(metaObj.gitignoreEntries) && metaObj.gitignoreEntries.includes('/.agents/hooks.json'), 'meta.json gitignoreEntries missing /.agents/hooks.json');
    assert.ok(Array.isArray(metaObj.packageScripts) && metaObj.packageScripts.includes('acm:commit'), 'meta.json packageScripts missing acm:commit');

    const cfgObj = JSON.parse(fs.readFileSync(path.join(tempDir, '.agents', 'acm', 'config.json'), 'utf-8'));
    assert.strictEqual(cfgObj.storage.provider, 'sqlite', '.agents/acm/config.json storage.provider should default to sqlite');
    assert.strictEqual(cfgObj.storage.markdownProjection, false, '.agents/acm/config.json storage.markdownProjection should default to false');
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'local', 'memory.db')), '.agents/acm/local/memory.db missing');

    const gitignoreContent = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
    assert.ok(!/^\/?\.agents\/?$/m.test(gitignoreContent), '.gitignore must not wholesale-ignore /.agents/');
    assert.ok(gitignoreContent.includes('/.agents/acm/'), '/.agents/acm/ missing in .gitignore');
    assert.ok(gitignoreContent.includes('/.agents/rules/acm-task-memory-adr.md'), 'IDE rule entry missing in .gitignore');
    assert.ok(gitignoreContent.includes('/.agents/hooks.json'), '/.agents/hooks.json missing when ACM created hooks.json');
    assert.ok(gitignoreContent.includes('/.acm-backup-*'), '/.acm-backup-* missing in .gitignore');
    assert.ok(!/^\/\.acm-backup-\*\/$/m.test(gitignoreContent), 'Legacy /.acm-backup-*/ should be replaced by /.acm-backup-*');

    const injectedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
    assert.ok(injectedPkg.scripts['acm:status'], 'acm:status script missing');
    assert.ok(injectedPkg.scripts['acm:commit'], 'acm:commit script missing');
    console.log('[PASS] English default init, locale overlay isolation, .gitignore, and package.json scripts verified.');

    // 4-3. check-git diagnostics
    console.log('[Stage 2] check-git verification');
    const checkGitRes = spawnSync(process.execPath, [CLI_PATH, 'check-git'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(checkGitRes.status, 0, `check-git failed: ${checkGitRes.stderr || checkGitRes.stdout}`);
    assert.ok(
      checkGitRes.stdout.includes('Git repository integration active') || checkGitRes.stdout.includes('detected'),
      'check-git English notice missing'
    );
    console.log('[PASS] check-git diagnostic verified.');

    // 4-4. status --compact & sample exclusion
    console.log('[Stage 3] status --compact verification');
    const statusRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(statusRes.status, 0, `status failed: ${statusRes.stderr || statusRes.stdout}`);
    assert.ok(statusRes.stdout.includes('[Task-Centric Commit Status]'), 'Compact status header missing');
    assert.ok(!statusRes.stdout.includes('TSK-SAMPLE'), 'Sample task (TSK-SAMPLE) leaked into parser results');
    console.log('[PASS] status --compact and sample isolation verified.');

    // 4-5. Commit safety gate when no [Ready] task exists
    console.log('[Stage 4-1] Commit blocked when no [Ready] task is registered');
    const blockedCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(blockedCommitRes.status, 1, 'Commit was not blocked when no [Ready] task exists');
    assert.ok(
      (blockedCommitRes.stderr || blockedCommitRes.stdout).includes('[Ready]'),
      '[Ready] guidance message missing on blocked commit'
    );
    console.log('[PASS] Commit safety gate verified.');

    // 4-6. Register TSK-1 [Ready] in SQLite DB, commit, and verify DB-only completion (no MD files written)
    console.log('[Stage 4-2] Register TSK-1 [Ready] via DB CLI, commit, and verify SQLite completion');
    const addTsk1Res = spawnSync(process.execPath, [CLI_PATH, 'task', 'add', '--stdin', '--json'], {
      cwd: tempDir,
      encoding: 'utf-8',
      input: JSON.stringify({
        code: 'TSK-1',
        groupName: 'ACM Onboarding',
        title: 'Initial ACM onboarding and governance scripts',
        status: 'ready',
        purpose: 'Introduce Agent Context Memory governance and automation scripts.',
        results: [
          '`AGENTS.md`: Injected ACM governance guardrails',
          '`scripts/`: Installed task-centric commit and smart-pull scripts',
        ],
        targets: ['package.json', 'AGENTS.md', '.gitignore', 'scripts/'],
      }),
    });
    assert.strictEqual(addTsk1Res.status, 0, `task add TSK-1 failed: ${addTsk1Res.stderr || addTsk1Res.stdout}`);

    const commitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(commitRes.status, 0, `commit failed: ${commitRes.stderr || commitRes.stdout}`);
    const postStatus = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    assert.strictEqual(postStatus.trim(), '', `Working tree not clean after commit: ${postStatus}`);

    const showTsk1Res = spawnSync(process.execPath, [CLI_PATH, 'task', 'show', 'TSK-1', '--json'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(showTsk1Res.status, 0, showTsk1Res.stderr);
    const doneTsk1 = JSON.parse(showTsk1Res.stdout);
    const tsk1HeadSha = execSync('git rev-parse --short HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(doneTsk1.status, 'done', 'TSK-1 was not marked done in SQLite after commit');
    assert.strictEqual(doneTsk1.commitSha, tsk1HeadSha, 'TSK-1 commitSha mismatch in SQLite');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task.md')), 'task.md must not be created when markdownProjection=false');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task-completed.md')), 'task-completed.md must not be created when markdownProjection=false');
    console.log('[PASS] Legacy sequential atomic commit, clean tree, and SQLite DB archival verified.');

    // 4-6b. Short-ID task commit via --commit=<prefix> and SQLite archival
    console.log('[Stage 4-3] Register TSK-K7M29A [Ready], commit via --commit=K7M2 prefix, and verify SQLite archival');
    fs.writeFileSync(path.join(tempDir, 'shortid-feature.txt'), 'short-id commit test\n', 'utf-8');
    const addShortRes = spawnSync(process.execPath, [CLI_PATH, 'task', 'add', '--stdin', '--json'], {
      cwd: tempDir,
      encoding: 'utf-8',
      input: JSON.stringify({
        code: 'TSK-K7M29A',
        title: 'Short-ID prefix targeted commit verification',
        status: 'ready',
        purpose: 'Verify short-id commit header and prefix selection in group-status.cjs.',
        results: ['`shortid-feature.txt`: Added test artifact for short-id commit'],
        targets: ['shortid-feature.txt'],
      }),
    });
    assert.strictEqual(addShortRes.status, 0, `task add TSK-K7M29A failed: ${addShortRes.stderr || addShortRes.stdout}`);

    const shortCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit', '--commit=K7M2'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(shortCommitRes.status, 0, `short-id prefix commit failed: ${shortCommitRes.stderr || shortCommitRes.stdout}`);
    assert.ok(shortCommitRes.stdout.includes('[TSK-K7M29A]'), 'Commit header missing [TSK-K7M29A]');
    assert.strictEqual(execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' }).trim(), '');

    const showShortRes = spawnSync(process.execPath, [CLI_PATH, 'task', 'show', 'K7M2', '--json'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(showShortRes.status, 0, showShortRes.stderr);
    const doneShort = JSON.parse(showShortRes.stdout);
    assert.strictEqual(doneShort.code, 'TSK-K7M29A');
    assert.strictEqual(doneShort.status, 'done');
    assert.ok(doneShort.commitSha, 'TSK-K7M29A commitSha missing in SQLite');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task-completed.md')), 'task-completed.md must not exist when markdownProjection=false');
    console.log('[PASS] Short-ID atomic commit (--commit=K7M2) and SQLite DB archival verified.');

    // 4-7. Uninstall --force verification
    console.log('[Stage 5] uninstall --force rollback verification');
    const uninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(uninstallRes.status, 0, `uninstall failed: ${uninstallRes.stderr || uninstallRes.stdout}`);
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), '.agents directory was not removed');
    assert.ok(!fs.existsSync(path.join(tempDir, 'scripts')), 'empty scripts directory was not removed');

    const { readZipEntries } = require('../scripts/acm/backup-archive.cjs');
    const files = fs.readdirSync(tempDir);
    const backupZip = files.find((f) => f.startsWith('.acm-backup-') && f.endsWith('.zip'));
    assert.ok(backupZip, 'Uninstall .acm-backup-*.zip archive was not created');
    const backupEntries = readZipEntries(fs.readFileSync(path.join(tempDir, backupZip)));
    assert.ok(
      backupEntries.some((e) => e.name === '.agents/acm/ACM_GOVERNANCE.md'),
      'Backup zip missing .agents/acm/ACM_GOVERNANCE.md'
    );
    console.log(`[PASS] Uninstall rollback and backup archive (${backupZip}) verified.`);

    // 4-8. npm postinstall auto-initialization and 4 safety guards
    console.log('[Stage 6] npm postinstall hook and safety guards verification');
    const { runPostInstall } = require('../scripts/acm/install-template.cjs');

    const selfGuardRes = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
      {
        cwd: ROOT_DIR,
        env: { ...process.env, INIT_CWD: ROOT_DIR },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(selfGuardRes.status, 0, 'Self-repo postinstall guard failed');

    const execGuardRes = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
      {
        cwd: ROOT_DIR,
        env: { ...process.env, CI: '', GITHUB_ACTIONS: '', INIT_CWD: tempDir, npm_command: 'exec' },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(execGuardRes.status, 0, 'npx exec guard failed');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'postinstall ran under npm_command=exec');

    const ciGuardRes = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
      {
        cwd: ROOT_DIR,
        env: { ...process.env, CI: 'true', INIT_CWD: tempDir, npm_command: 'install' },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(ciGuardRes.status, 0, 'CI=true guard failed');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'postinstall ran under CI=true');

    const npmCiGuardRes = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
      {
        cwd: ROOT_DIR,
        env: { ...process.env, CI: '', GITHUB_ACTIONS: '', INIT_CWD: tempDir, npm_command: 'ci' },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(npmCiGuardRes.status, 0, 'npm ci guard failed');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'postinstall ran under npm_command=ci');

    const beforePostinstallPkg = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8');
    const postInstallRes = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          CI: '',
          GITHUB_ACTIONS: '',
          INIT_CWD: tempDir,
          npm_command: 'install',
          npm_config_global: '',
          ACM_SKIP_POSTINSTALL: '',
          ACM_LANG: '',
        },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(postInstallRes.status, 0, `postinstall failed: ${postInstallRes.stderr || postInstallRes.stdout}`);
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'local', 'memory.db')), 'postinstall missing memory.db');
    assert.ok(!fs.existsSync(path.join(tempDir, '.agents', 'acm', 'task', 'task.md')), 'Default postinstall should not create task.md');
    const postCfg = JSON.parse(fs.readFileSync(path.join(tempDir, '.agents', 'acm', 'config.json'), 'utf-8'));
    assert.strictEqual(postCfg.storage.provider, 'sqlite');
    assert.strictEqual(postCfg.storage.markdownProjection, false);
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'acm', 'ACM_GOVERNANCE.md')), 'postinstall missing ACM_GOVERNANCE.md');
    assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'postinstall missing AGENTS.md');
    assert.ok(
      fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf-8').includes('[Three Canonical Stores]'),
      'Default postinstall should initialize English AGENTS.md'
    );
    const afterPostinstallPkg = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8');
    assert.strictEqual(afterPostinstallPkg, beforePostinstallPkg, 'postinstall mutated host package.json');

    const alreadyInstalledRes = await runPostInstall({
      CI: '',
      GITHUB_ACTIONS: '',
      INIT_CWD: tempDir,
      npm_command: 'install',
    });
    assert.strictEqual(alreadyInstalledRes.skipped, true, 'Already-installed guard failed');
    console.log('[PASS] postinstall guards, English default init, and host package.json protection verified.');

    // 4-9. @clack/prompts interactive multiselect & non-interactive fallback
    console.log('[Stage 7] @clack/prompts interactive multiselect, cancel, and fallback verification');
    const { loadClack, promptCustomRuleFile, resolveTargetRuleFiles } = require('../scripts/acm/sync-agent-rules.cjs');

    const clack = await loadClack();
    assert.ok(clack && typeof clack.multiselect === 'function', '@clack/prompts dynamic import failed');
    assert.ok(typeof clack.intro === 'function' && typeof clack.spinner === 'function', '@clack/prompts API missing');

    const createMockTTY = () => {
      const input = new PassThrough();
      const output = new PassThrough();
      input.isTTY = true;
      input.setRawMode = () => input;
      output.isTTY = true;
      return { input, output };
    };

    {
      const { input, output } = createMockTTY();
      const selectPromise = promptCustomRuleFile({ input, output, silent: true, lang: 'en' });
      setTimeout(() => input.write('\x1b[B'), 40);
      setTimeout(() => input.write(' '), 80);
      setTimeout(() => input.write('\r'), 120);
      const selectedRules = await selectPromise;
      assert.deepStrictEqual(
        selectedRules,
        ['AGENTS.md', 'CLAUDE.md'],
        `Clack multiselect mismatch: ${JSON.stringify(selectedRules)}`
      );
    }

    {
      const { input, output } = createMockTTY();
      const cancelPromise = promptCustomRuleFile({ input, output, silent: true, lang: 'en' });
      setTimeout(() => input.write('\x03'), 40);
      const cancelledResult = await cancelPromise;
      assert.strictEqual(cancelledResult, null, 'Clack cancel did not return null');
    }

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-empty-fallback-'));
    try {
      const fallbackFiles = await resolveTargetRuleFiles(emptyDir, { nonInteractive: true, silent: true });
      assert.deepStrictEqual(fallbackFiles, ['AGENTS.md'], 'Non-interactive fallback to AGENTS.md failed');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }

    // Mock TTY tests for backup confirm, target select, and restore select prompts
    const { promptBackupConfirm, promptBackupTarget } = require('../scripts/acm/uninstall-template.cjs');
    const { promptBackupRestore } = require('../scripts/acm/install-template.cjs');

    {
      const { input, output } = createMockTTY();
      const p = promptBackupConfirm({ input, output, lang: 'en' });
      setTimeout(() => input.write('\r'), 40);
      assert.strictEqual(await p, true, 'promptBackupConfirm default Enter did not select true');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupConfirm({ input, output, lang: 'en' });
      setTimeout(() => input.write('n\r'), 40);
      assert.strictEqual(await p, false, 'promptBackupConfirm n did not select false');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupConfirm({ input, output, lang: 'en' });
      setTimeout(() => input.write('\x03'), 40);
      assert.strictEqual(await p, null, 'promptBackupConfirm Ctrl+C did not return null');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupTarget({ input, output, lang: 'en', branch: 'acm-backups' });
      setTimeout(() => input.write('\r'), 40);
      assert.strictEqual(await p, 'local', 'promptBackupTarget default Enter did not select local');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupTarget({ input, output, lang: 'en', branch: 'acm-backups' });
      setTimeout(() => input.write('\x1b[B'), 40);
      setTimeout(() => input.write('\r'), 80);
      assert.strictEqual(await p, 'git', 'promptBackupTarget Down+Enter did not select git');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupTarget({ input, output, lang: 'en', branch: 'acm-backups' });
      setTimeout(() => input.write('\x03'), 40);
      assert.strictEqual(await p, null, 'promptBackupTarget Ctrl+C did not return null');
    }

    const sampleBackups = [
      {
        source: 'local',
        name: '.acm-backup-20261125_120000.zip',
        format: 'zip',
        sizeBytes: 2048,
        createdAt: '2026-11-25T12:00:00.000Z',
      },
    ];
    {
      const { input, output } = createMockTTY();
      const p = promptBackupRestore(sampleBackups, { input, output, lang: 'en' });
      setTimeout(() => input.write('\r'), 40);
      const selected = await p;
      assert.strictEqual(selected && selected.name, sampleBackups[0].name, 'promptBackupRestore default Enter failed');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupRestore(sampleBackups, { input, output, lang: 'en' });
      setTimeout(() => input.write('\x1b[B'), 40);
      setTimeout(() => input.write('\r'), 80);
      assert.strictEqual(await p, false, 'promptBackupRestore fresh option did not return false');
    }
    {
      const { input, output } = createMockTTY();
      const p = promptBackupRestore(sampleBackups, { input, output, lang: 'en' });
      setTimeout(() => input.write('\x03'), 40);
      assert.strictEqual(await p, null, 'promptBackupRestore Ctrl+C did not return null');
    }

    console.log('[PASS] @clack/prompts rule multiselect, backup prompts, cancel, and fallback verified.');

    // 4-10. Custom rule file rollback (.acm-meta.json) and shared/directory matching commits
    console.log('[Stage 8] Custom rule rollback and shared/root-isolated task commit verification');
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-custom-rule-'));
    try {
      execSync('git init', { cwd: customDir, stdio: 'ignore' });
      execSync('git config user.name "Test Runner"', { cwd: customDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: customDir, stdio: 'ignore' });

      fs.mkdirSync(path.join(customDir, '.github'), { recursive: true });
      fs.mkdirSync(path.join(customDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(customDir, 'AGENTS.md'), '# Root Agents\n');
      fs.writeFileSync(path.join(customDir, 'nested', 'AGENTS.md'), '# Nested Agents\n');
      fs.writeFileSync(path.join(customDir, 'package.json'), JSON.stringify({ name: 'custom-app', version: '1.0.0' }, null, 2));
      fs.writeFileSync(path.join(customDir, '.gitignore'), 'node_modules/\n\ndist/\n');
      fs.writeFileSync(path.join(customDir, '.github', 'copilot-instructions.md'), '# Existing Copilot Rule\n');
      execSync('git add . && git commit -m "chore: init"', { cwd: customDir, stdio: 'ignore' });

      const customInitRes = spawnSync(
        process.execPath,
        [CLI_PATH, 'init', '--force', '--non-interactive', '--rule-file=.github/copilot-instructions.md,AGENTS.md'],
        { cwd: customDir, encoding: 'utf-8' }
      );
      assert.strictEqual(customInitRes.status, 0, `Custom rule init failed: ${customInitRes.stderr || customInitRes.stdout}`);
      const metaPath = path.join(customDir, '.agents', 'acm', 'meta.json');
      assert.ok(fs.existsSync(metaPath), '.agents/acm/meta.json missing');

      const injectedCopilot = fs.readFileSync(path.join(customDir, '.github', 'copilot-instructions.md'), 'utf-8');
      assert.ok(injectedCopilot.includes('ACM_GOVERNANCE_START'), 'Governance block missing in custom rule file');

      const customUninstallRes = spawnSync(
        process.execPath,
        [CLI_PATH, 'uninstall', '--force', '--no-backup'],
        { cwd: customDir, encoding: 'utf-8' }
      );
      assert.strictEqual(customUninstallRes.status, 0, `Custom rule uninstall failed: ${customUninstallRes.stderr || customUninstallRes.stdout}`);
      const restoredCopilot = fs.readFileSync(path.join(customDir, '.github', 'copilot-instructions.md'), 'utf-8');
      assert.ok(!restoredCopilot.includes('ACM_GOVERNANCE_START'), 'Governance block remained after custom uninstall');
      assert.ok(restoredCopilot.includes('# Existing Copilot Rule'), 'User content damaged in custom rule file');
      const restoredGitignore = fs.readFileSync(path.join(customDir, '.gitignore'), 'utf-8').replace(/\r\n/g, '\n');
      assert.strictEqual(restoredGitignore, 'node_modules/\n\ndist/\n', 'Existing .gitignore blank line structure damaged');

      spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive', '--markdown-projection'], { cwd: customDir, encoding: 'utf-8' });
      fs.writeFileSync(path.join(customDir, 'AGENTS.md'), '# Root Agents Updated\n');
      fs.writeFileSync(path.join(customDir, 'nested', 'AGENTS.md'), '# Nested Agents Updated\n');
      fs.writeFileSync(path.join(customDir, 'shared.txt'), 'v1\n');
      execSync('git add nested/AGENTS.md', { cwd: customDir, stdio: 'ignore' });

      const taskPath = path.join(customDir, '.agents', 'acm', 'task', 'task.md');
      const baseTaskMd = fs.readFileSync(taskPath, 'utf-8');
      const dualTaskMd = baseTaskMd.replace(
        '(No active tasks)',
        [
          '- [Ready] **TSK-1. Root and shared file updates**',
          '  - **Purpose**: Verify root AGENTS.md isolation and shared.txt tracking with TSK-2',
          '  - **Results**:',
          '    - `AGENTS.md`, `shared.txt`: updated contents',
          '  - **Targets**: `AGENTS.md`, `shared.txt`, `scripts`, `.gitignore`, `package.json`',
          '- [Ready] **TSK-2. Shared trailing task archive verification**',
          '  - **Purpose**: Verify auto-archive of a trailing task sharing shared.txt with TSK-1',
          '  - **Results**:',
          '    - `shared.txt`: verified shared link',
          '  - **Targets**: `shared.txt`',
        ].join('\n')
      );
      fs.writeFileSync(taskPath, dualTaskMd, 'utf-8');

      const dualCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], { cwd: customDir, encoding: 'utf-8' });
      assert.strictEqual(dualCommitRes.status, 0, `Dual/shared task commit failed: ${dualCommitRes.stderr || dualCommitRes.stdout}`);

      const afterDualStatus = execSync('git status --porcelain', { cwd: customDir, encoding: 'utf-8' });
      assert.ok(afterDualStatus.includes('nested/AGENTS.md'), 'nested/AGENTS.md was wrongly matched by root AGENTS.md');

      const afterDualCompleted = fs.readFileSync(path.join(customDir, '.agents', 'acm', 'task', 'task-completed.md'), 'utf-8');
      assert.ok(afterDualCompleted.includes('**TSK-1.'), 'TSK-1 archive missing');
      assert.ok(afterDualCompleted.includes('**TSK-2.'), 'Shared trailing task TSK-2 archive missing');
      console.log('[PASS] Custom rule rollback, .gitignore preservation, root isolation, and shared task archive verified.');
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true });
    }

    // 4-11. Regression suite (C1 temp-index rm --cached, H1 JSX props, H2 functions, L1 .gitignore preservation, C02 branch validation)
    console.log('[Stage 9] Regression verification (C1, H1/H2, L1, C02)');
    const { tryResolveJsxProps, tryResolveFunctionBlocks, isValidBranchName } = require('../scripts/acm/smart-pull.cjs');
    assert.strictEqual(isValidBranchName('feature/ok-1'), true, 'C02 valid branch rejected');
    assert.strictEqual(isValidBranchName('--upload-pack=evil'), false, 'C02 leading dash branch flag not blocked');
    assert.strictEqual(isValidBranchName('main;whoami'), false, 'C02 invalid branch name not blocked');
    assert.strictEqual(isValidBranchName('main && echo pwn'), false, 'C02 shell metachar branch name not blocked');
    assert.strictEqual(
      tryResolveJsxProps('<Button className="btn primary" onClick={a}>', '<Button className="btn primary" disabled>'),
      '<Button className="btn primary" disabled onClick={a}>',
      'H1 JSX props merge failed'
    );
    assert.strictEqual(
      tryResolveJsxProps('<Button variant="primary">', '<Button variant="secondary">'),
      null,
      'H1 conflicting JSX props should return null'
    );
    assert.strictEqual(
      tryResolveJsxProps('<Button className="btn primary">', '<Button className="btn secondary">'),
      null,
      'H1 conflicting spaced JSX props should return null'
    );
    assert.strictEqual(
      tryResolveFunctionBlocks('if (a) { return 1; }', 'if (b) { return 2; }'),
      null,
      'H2 control flow statement mistaken for method'
    );
    assert.strictEqual(
      tryResolveFunctionBlocks('function foo() { return 1; }', 'function foo() { return 2; }'),
      null,
      'H2 duplicate function name should return null'
    );
    assert.strictEqual(
      tryResolveFunctionBlocks('function foo() {}', 'function bar() {}'),
      'function bar() {}\n\nfunction foo() {}',
      'H2 distinct functions merge failed'
    );

    const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-reg-c1-'));
    try {
      execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', { cwd: regDir, stdio: 'ignore' });
      fs.mkdirSync(path.join(regDir, 'rules'), { recursive: true });
      fs.mkdirSync(path.join(regDir, '.agents', 'task'), { recursive: true });
      fs.writeFileSync(path.join(regDir, '.gitignore'), '.agents/\n');
      fs.writeFileSync(path.join(regDir, 'rules', 'MEM.md'), 'v1\n');
      fs.writeFileSync(path.join(regDir, '.agents', 'task', 'task.md'), '# Task\n');
      fs.writeFileSync(path.join(regDir, '.agents', 'task', 'task-completed.md'), '# Comp\n\n---\n(No completed tasks archived yet)\n');
      execSync('git add -f . && git commit -m "chore: init"', { cwd: regDir, stdio: 'ignore' });

      const l1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-reg-l1-'));
      try {
        execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', { cwd: l1Dir, stdio: 'ignore' });
        fs.writeFileSync(path.join(l1Dir, '.gitignore'), '.agents/\n');
        execSync('git add .gitignore && git commit -m "init"', { cwd: l1Dir, stdio: 'ignore' });
        const l1Init = spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive'], { cwd: l1Dir, encoding: 'utf-8' });
        assert.strictEqual(l1Init.status, 0, 'L1 init failed');
        const l1Un = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], { cwd: l1Dir, encoding: 'utf-8' });
        assert.strictEqual(l1Un.status, 0, 'L1 uninstall failed');
        assert.ok(fs.existsSync(path.join(l1Dir, '.gitignore')), 'L1 existing user .gitignore deleted unexpectedly');
      } finally {
        fs.rmSync(l1Dir, { recursive: true, force: true });
      }

      fs.writeFileSync(path.join(regDir, '.gitignore'), '/.agents/task/\n');
      execSync('git rm -r --cached .agents/task', { cwd: regDir, stdio: 'ignore' });
      execSync('git mv rules/MEM.md .agents/MEM.md', { cwd: regDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(regDir, '.agents', 'MEM.md'), 'v2\n');
      fs.mkdirSync(path.join(regDir, '.agents', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(regDir, '.agents', 'rules', '60.md'), 'rule\n');

      fs.writeFileSync(
        path.join(regDir, '.agents', 'task', 'task.md'),
        [
          '# Task Master',
          '- **ID Rule**: (Latest Done: `None`, Active: `TSK-1, TSK-2`, Next: `TSK-3`)',
          '## 1. Active Tasks',
          '- [Ready] **TSK-1. Commit RM and untracked files**',
          '  - **Purpose**: Verify RM and new file commit',
          '  - **Results**:',
          '    - `.agents/MEM.md`: moved and modified',
          '  - **Targets**: `.agents/MEM.md`, `.agents/rules/`',
          '- [Ready] **TSK-2. Commit task untracking and gitignore**',
          '  - **Purpose**: Verify git rm --cached isolated commit',
          '  - **Results**:',
          '    - `.gitignore`: root anchoring',
          '  - **Targets**: `.gitignore`, `.agents/task/task.md`, `.agents/task/task-completed.md`',
        ].join('\n'),
        'utf-8'
      );

      const regCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], { cwd: regDir, encoding: 'utf-8' });
      assert.strictEqual(regCommitRes.status, 0, `C1 commit failed: ${regCommitRes.stderr || regCommitRes.stdout}`);

      const regPostStatus = execSync('git status --porcelain=v1 -uall', { cwd: regDir, encoding: 'utf-8' });
      assert.strictEqual(regPostStatus.trim(), '', `C1 working tree not clean:\n${regPostStatus}`);
      const trackedTaskFiles = execSync('git ls-files .agents/task', { cwd: regDir, encoding: 'utf-8' });
      assert.strictEqual(trackedTaskFiles.trim(), '', 'C1 .agents/task/ re-tracked into Git');
      assert.ok(fs.existsSync(path.join(regDir, '.agents', 'task', 'task.md')), 'C1 local task.md deleted');
    } finally {
      fs.rmSync(regDir, { recursive: true, force: true });
    }
    console.log('[PASS] Regression checks (C1, H1/H2, L1) passed.');

    // 4-12. Stage 10: i18n EN/KO install, interactive promptLanguage, Korean E2E & drift-free uninstall
    console.log('[Stage 10] i18n (EN/KO) interactive promptLanguage, --lang=ko lifecycle, and postinstall ACM_LANG=ko');
    const { promptLanguage } = require('../scripts/acm/install-template.cjs');

    // Interactive promptLanguage via mock TTY: default Enter -> 'en'
    {
      const { input, output } = createMockTTY();
      const p = promptLanguage({ input, output });
      setTimeout(() => input.write('\r'), 40);
      assert.strictEqual(await p, 'en', 'promptLanguage default Enter did not select en');
    }

    // Interactive promptLanguage via mock TTY: Down + Enter -> 'ko'
    {
      const { input, output } = createMockTTY();
      const p = promptLanguage({ input, output });
      setTimeout(() => input.write('\x1b[B'), 40);
      setTimeout(() => input.write('\r'), 80);
      assert.strictEqual(await p, 'ko', 'promptLanguage Down+Enter did not select ko');
    }

    // Interactive promptLanguage via mock TTY: Ctrl+C -> null
    {
      const { input, output } = createMockTTY();
      const p = promptLanguage({ input, output });
      setTimeout(() => input.write('\x03'), 40);
      assert.strictEqual(await p, null, 'promptLanguage Ctrl+C did not return null');
    }

    // Invalid --lang rejection
    const invalidLangRes = spawnSync(process.execPath, [CLI_PATH, 'init', '--lang=fr', '--non-interactive'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(invalidLangRes.status, 1, 'Invalid --lang=fr should exit with code 1');

    // Full Korean install -> commit -> auto-detected uninstall
    const koDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-ko-e2e-'));
    try {
      execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', { cwd: koDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(koDir, 'package.json'), JSON.stringify({ name: 'ko-app', version: '1.0.0', scripts: {} }, null, 2));
      fs.writeFileSync(path.join(koDir, 'README.md'), '# Korean E2E\n');
      execSync('git add . && git commit -m "chore: init"', { cwd: koDir, stdio: 'ignore' });

      const koInitRes = spawnSync(
        process.execPath,
        [CLI_PATH, 'init', '--lang=ko', '--force', '--non-interactive'],
        { cwd: koDir, encoding: 'utf-8' }
      );
      assert.strictEqual(koInitRes.status, 0, `Korean init failed: ${koInitRes.stderr || koInitRes.stdout}`);
      assert.ok(!fs.existsSync(path.join(koDir, 'locales')), 'locales/ directory leaked into Korean host project');

      const koMeta = JSON.parse(fs.readFileSync(path.join(koDir, '.agents', 'acm', 'meta.json'), 'utf-8'));
      assert.strictEqual(koMeta.language, 'ko', 'meta.json did not persist language=ko');

      const koCfg = JSON.parse(fs.readFileSync(path.join(koDir, '.agents', 'acm', 'config.json'), 'utf-8'));
      assert.strictEqual(koCfg.storage.provider, 'sqlite');
      assert.strictEqual(koCfg.storage.markdownProjection, false);
      assert.ok(fs.existsSync(path.join(koDir, '.agents', 'acm', 'local', 'memory.db')), 'Korean sqlite DB missing');
      assert.ok(!fs.existsSync(path.join(koDir, '.agents', 'acm', 'task', 'task.md')), 'Korean default sqlite init should not create task.md');

      const koAgents = fs.readFileSync(path.join(koDir, 'AGENTS.md'), 'utf-8');
      assert.ok(koAgents.includes('[3대 정본]'), 'Korean AGENTS.md governance block not injected');

      const koStatusRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
        cwd: koDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(koStatusRes.status, 0, 'Korean status --compact failed');
      assert.ok(koStatusRes.stdout.includes('[작업 단위 커밋 현황]'), 'Korean status --compact output expected');

      const koAddRes = spawnSync(process.execPath, [CLI_PATH, 'task', 'add', '--lang=ko', '--stdin', '--json'], {
        cwd: koDir,
        encoding: 'utf-8',
        input: JSON.stringify({
          code: 'TSK-1',
          title: '한국어 온보딩 및 거버넌스 반영',
          status: 'ready',
          purpose: '한국어 모드 커밋 및 자동 이관 검증',
          results: ['`AGENTS.md`, `scripts/`: 한국어 템플릿 주입 및 커밋 검증'],
          targets: ['package.json', 'AGENTS.md', '.gitignore', 'scripts/'],
        }),
      });
      assert.strictEqual(koAddRes.status, 0, `Korean task add failed: ${koAddRes.stderr || koAddRes.stdout}`);

      const koCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], { cwd: koDir, encoding: 'utf-8' });
      assert.strictEqual(koCommitRes.status, 0, `Korean commit failed: ${koCommitRes.stderr || koCommitRes.stdout}`);
      assert.ok(koCommitRes.stdout.includes('[성공] 커밋 완료!'), 'Korean commit output missing');

      const koShowDone = spawnSync(process.execPath, [CLI_PATH, 'task', 'show', 'TSK-1', '--json'], {
        cwd: koDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(koShowDone.status, 0, koShowDone.stderr);
      const koDoneObj = JSON.parse(koShowDone.stdout);
      assert.strictEqual(koDoneObj.status, 'done');
      assert.ok(koDoneObj.commitSha, 'Korean SQLite commitSha missing');
      assert.ok(!fs.existsSync(path.join(koDir, '.agents', 'acm', 'task', 'task-completed.md')), 'Korean default sqlite commit should not create task-completed.md');

      // Uninstall without --lang flag: must auto-detect ko from .agents/acm/meta.json and cleanly remove Korean AGENTS.md (EXACT_MATCH)
      const koUninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], {
        cwd: koDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(koUninstallRes.status, 0, `Korean uninstall failed: ${koUninstallRes.stderr || koUninstallRes.stdout}`);
      assert.ok(koUninstallRes.stdout.includes('제거 및 롤백이 완료되었습니다'), 'Korean uninstall output missing');
      assert.ok(!fs.existsSync(path.join(koDir, 'AGENTS.md')), 'Korean AGENTS.md should be cleanly removed via EXACT_MATCH drift check');

      // Verify postinstall respects ACM_LANG=ko (pure sqlite default + opt-in --markdown-projection check)
      const koPostRes = spawnSync(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts', 'acm', 'install-template.cjs'), '--postinstall'],
        {
          cwd: ROOT_DIR,
          env: {
            ...process.env,
            CI: '',
            GITHUB_ACTIONS: '',
            INIT_CWD: koDir,
            npm_command: 'install',
            npm_config_global: '',
            ACM_SKIP_POSTINSTALL: '',
            ACM_LANG: 'ko',
          },
          encoding: 'utf-8',
        }
      );
      assert.strictEqual(koPostRes.status, 0, 'Korean postinstall failed');
      assert.ok(
        fs.readFileSync(path.join(koDir, 'AGENTS.md'), 'utf-8').includes('[3대 정본]'),
        'postinstall with ACM_LANG=ko did not install Korean AGENTS.md'
      );
      assert.ok(!fs.existsSync(path.join(koDir, '.agents', 'acm', 'task', 'task.md')), 'Korean postinstall should not create task.md by default');

      // Opt-in --markdown-projection with --lang=ko copies Korean task.md template
      const koOptInRes = spawnSync(
        process.execPath,
        [CLI_PATH, 'init', '--lang=ko', '--force', '--non-interactive', '--markdown-projection'],
        { cwd: koDir, encoding: 'utf-8' }
      );
      assert.strictEqual(koOptInRes.status, 0, 'Korean opt-in markdown-projection init failed');
      assert.ok(
        fs.readFileSync(path.join(koDir, '.agents', 'acm', 'task', 'task.md'), 'utf-8').includes('(현재 진행 중인 활성 작업 없음)'),
        'Korean opt-in --markdown-projection did not copy Korean task.md'
      );
    } finally {
      fs.rmSync(koDir, { recursive: true, force: true });
    }
    console.log('[PASS] i18n EN/KO interactive prompt, --lang=ko lifecycle, drift-free uninstall, and ACM_LANG=ko postinstall verified.');

    // 4-13. Stage 11: Host scripts/ non-collision & preservation on init/uninstall
    console.log('[Stage 11] Host scripts/ namespace non-collision & preservation verification');
    const hostScriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-host-scripts-'));
    try {
      fs.mkdirSync(path.join(hostScriptDir, 'scripts', 'storage'), { recursive: true });
      fs.writeFileSync(path.join(hostScriptDir, 'scripts', 'i18n.cjs'), '// host custom i18n\n', 'utf-8');
      fs.writeFileSync(path.join(hostScriptDir, 'scripts', 'group-status.cjs'), 'throw new Error("Wrong host group-status called");\n', 'utf-8');
      fs.writeFileSync(path.join(hostScriptDir, 'scripts', 'storage', 'config.cjs'), '// host custom storage config\n', 'utf-8');

      const hostInit = spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive'], {
        cwd: hostScriptDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(hostInit.status, 0, `Host scripts non-collision init failed: ${hostInit.stderr || hostInit.stdout}`);
      assert.strictEqual(fs.readFileSync(path.join(hostScriptDir, 'scripts', 'i18n.cjs'), 'utf-8'), '// host custom i18n\n');
      assert.strictEqual(fs.readFileSync(path.join(hostScriptDir, 'scripts', 'storage', 'config.cjs'), 'utf-8'), '// host custom storage config\n');

      // CLI must run scripts/acm/group-status.cjs, NOT host scripts/group-status.cjs
      const hostStatus = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
        cwd: hostScriptDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(hostStatus.status, 0, `CLI picked wrong host script instead of scripts/acm/: ${hostStatus.stderr || hostStatus.stdout}`);

      const hostUn = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], {
        cwd: hostScriptDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(hostUn.status, 0, `Host scripts uninstall failed: ${hostUn.stderr || hostUn.stdout}`);
      assert.ok(!fs.existsSync(path.join(hostScriptDir, 'scripts', 'acm')), 'scripts/acm should be removed');
      assert.strictEqual(fs.readFileSync(path.join(hostScriptDir, 'scripts', 'i18n.cjs'), 'utf-8'), '// host custom i18n\n', 'Host scripts/i18n.cjs lost');
      assert.strictEqual(fs.readFileSync(path.join(hostScriptDir, 'scripts', 'storage', 'config.cjs'), 'utf-8'), '// host custom storage config\n', 'Host scripts/storage/config.cjs lost');
      console.log('[PASS] Host scripts/ non-collision and preservation verified.');
    } finally {
      fs.rmSync(hostScriptDir, { recursive: true, force: true });
    }

    console.log('=== All integrity and Git E2E tests passed (0 errors) ===\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[Cleanup] Removed temporary Git test directory: ${tempDir}`);
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

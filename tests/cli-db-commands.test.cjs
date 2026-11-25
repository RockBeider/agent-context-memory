/**
 * tests/cli-db-commands.test.cjs
 *
 * Phase 2 (TSK-21): E2E verification for ACM DB CLI commands (task, pattern, adr, search, migrate, export, import)
 * and interactive/non-interactive installer storage provider selection.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { PassThrough } = require('stream');
const { spawnSync, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');
const { promptStorageProvider } = require('../scripts/acm/install-template.cjs');

console.log('=== Starting Phase 2 DB CLI & Installer Storage UI E2E Tests ===');

function runCli(args, cwd, options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
}

async function runTests() {
  // -------------------------------------------------------------------------
  // 1. promptStorageProvider interactive TTY (Clack select) + Ctrl+C cancel
  // -------------------------------------------------------------------------
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
    const p = promptStorageProvider({ input, output, lang: 'en' });
    setTimeout(() => input.write('\x1b[B'), 50);
    setTimeout(() => input.write('\r'), 100);
    const chosen = await p;
    assert.strictEqual(chosen, 'markdown', `Expected second option markdown, got: ${chosen}`);
  }
  {
    const { input, output } = createMockTTY();
    const p = promptStorageProvider({ input, output, lang: 'ko' });
    setTimeout(() => input.write('\r'), 50);
    const chosen = await p;
    assert.strictEqual(chosen, 'sqlite', `Expected default option sqlite, got: ${chosen}`);
  }
  {
    const { input, output } = createMockTTY();
    const p = promptStorageProvider({ input, output, lang: 'en' });
    setTimeout(() => input.write('\x03'), 50);
    const chosen = await p;
    assert.strictEqual(chosen, null, 'Ctrl+C cancel in promptStorageProvider did not return null');
  }
  console.log('[PASS] 1. Interactive storage provider prompt (sqlite, markdown, Ctrl+C) verified.');

  // -------------------------------------------------------------------------
  // 2. init --storage=markdown vs invalid --storage + pre-existing MD auto-migration
  // -------------------------------------------------------------------------
  const mdInitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cli-mdinit-'));
  try {
    const badRes = runCli(['init', '--storage=invalid-db', '--non-interactive'], mdInitDir);
    assert.strictEqual(badRes.status, 1, 'Invalid --storage should fail with exit code 1');

    const mdRes = runCli(['init', '--storage=markdown', '--non-interactive'], mdInitDir);
    assert.strictEqual(mdRes.status, 0, `init --storage=markdown failed: ${mdRes.stderr || mdRes.stdout}`);
    const mdCfg = JSON.parse(fs.readFileSync(path.join(mdInitDir, '.agents', 'acm', 'config.json'), 'utf-8'));
    assert.strictEqual(mdCfg.storage.provider, 'markdown');
    assert.ok(!fs.existsSync(path.join(mdInitDir, '.agents', 'acm', 'local', 'memory.db')), 'memory.db should not exist in markdown mode');

    // Add a real task in markdown mode, then run init --storage=sqlite (without --force) to verify auto-migration
    const taskMdPath = path.join(mdInitDir, '.agents', 'acm', 'task', 'task.md');
    const origTask = fs.readFileSync(taskMdPath, 'utf-8');
    fs.writeFileSync(
      taskMdPath,
      origTask.replace(
        '(No active tasks)',
        [
          '- [In Progress] **TSK-1. Existing markdown task before sqlite init**',
          '  - **Purpose**: Verify init --storage=sqlite auto-imports existing markdown records.',
          '  - **Results**:',
          '    - `src/app.js`: prepared baseline',
          '  - **Targets**: `src/app.js`',
        ].join('\n')
      ),
      'utf-8'
    );

    const upgradeRes = runCli(['init', '--storage=sqlite', '--non-interactive'], mdInitDir);
    assert.strictEqual(upgradeRes.status, 0, `upgrade init failed: ${upgradeRes.stderr || upgradeRes.stdout}`);

    const listUpgrade = runCli(['task', 'list', '--json'], mdInitDir);
    assert.strictEqual(listUpgrade.status, 0, listUpgrade.stderr);
    const parsedUpgrade = JSON.parse(listUpgrade.stdout);
    assert.strictEqual(parsedUpgrade.provider, 'sqlite');
    assert.strictEqual(parsedUpgrade.count, 1);
    assert.strictEqual(parsedUpgrade.tasks[0].code, 'TSK-1');
  } finally {
    fs.rmSync(mdInitDir, { recursive: true, force: true });
  }
  console.log('[PASS] 2. --storage=markdown, invalid flag rejection, and existing MD auto-migration verified.');

  // -------------------------------------------------------------------------
  // 3~7. Full DB CLI lifecycle: task, pattern, adr, search, migrate, export/import, ko, uninstall
  // -------------------------------------------------------------------------
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cli-db-'));
  try {
    execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', {
      cwd: workDir,
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'cli-db-app', version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(workDir, 'README.md'), '# CLI DB App\n');
    execSync('git add . && git commit -m "chore: init"', { cwd: workDir, stdio: 'ignore' });

    const initRes = runCli(['init', '--non-interactive'], workDir);
    assert.strictEqual(initRes.status, 0, `Default init failed: ${initRes.stderr || initRes.stdout}`);
    const initCfg = JSON.parse(fs.readFileSync(path.join(workDir, '.agents', 'acm', 'config.json'), 'utf-8'));
    assert.strictEqual(initCfg.storage.provider, 'sqlite');
    assert.strictEqual(initCfg.storage.markdownProjection, false, 'Default sqlite init should set markdownProjection=false');
    assert.ok(!fs.existsSync(path.join(workDir, '.agents', 'acm', 'task', 'task.md')), 'Default sqlite init must not create task.md');

    // Subcommand help delegation
    const taskHelpRes = runCli(['task', '--help'], workDir);
    assert.strictEqual(taskHelpRes.status, 0);
    assert.ok(taskHelpRes.stdout.includes('acm task'), 'task --help should print task subcommand help');

    // 2.5 acm id command validation
    const idTskRes = runCli(['id', '--json'], workDir);
    assert.strictEqual(idTskRes.status, 0, idTskRes.stderr);
    const idTskOut = JSON.parse(idTskRes.stdout);
    assert.ok(/^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(idTskOut.code));

    const idPatRes = runCli(['id', 'pattern', '--count=3', '--json'], workDir);
    assert.strictEqual(idPatRes.status, 0, idPatRes.stderr);
    const idPatOut = JSON.parse(idPatRes.stdout);
    assert.strictEqual(idPatOut.codes.length, 3);
    assert.strictEqual(new Set(idPatOut.codes).size, 3);
    assert.ok(idPatOut.codes.every((c) => /^P-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(c)));

    const idAdrRes = runCli(['id', 'adr', '--json'], workDir);
    assert.strictEqual(idAdrRes.status, 0, idAdrRes.stderr);
    assert.ok(/^LOG-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(JSON.parse(idAdrRes.stdout).code));

    assert.strictEqual(runCli(['id', 'unknown'], workDir).status, 1, 'Invalid id kind should fail');
    assert.strictEqual(runCli(['id', 'task', '--count=99'], workDir).status, 1, 'Out-of-range --count should fail');

    // 3. task add / list / show / update (--stdin multiline quotes/backticks/Korean) / lease / complete
    const addTaskRes = runCli(['task', 'add', 'Implement DB CLI', '--purpose', 'Build CLI entrypoints', '--json'], workDir);
    assert.strictEqual(addTaskRes.status, 0, addTaskRes.stderr);
    const addedTask = JSON.parse(addTaskRes.stdout).task;
    const taskCode = addedTask.code;
    assert.ok(/^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(taskCode));
    assert.strictEqual(addedTask.owner, '', 'Default task owner should be empty');

    // Ready without 3 elements must fail
    const badReadyRes = runCli(['task', 'update', taskCode, '--status=ready'], workDir);
    assert.strictEqual(badReadyRes.status, 1, 'task update --status=ready without results/targets should fail');

    // --stdin JSON update with quotes, newlines, backticks, Korean
    const stdinPayload = JSON.stringify({
      status: 'ready',
      purpose: '한글 목적과 "따옴표", `백틱` 포함 테스트',
      results: [
        'scripts/acm-db-cli.cjs: 구현 완료 ("안전 이스케이프")',
        'tests/cli-db-commands.test.cjs: 검증 완료',
      ],
      targets: ['scripts/acm-db-cli.cjs', 'tests/cli-db-commands.test.cjs'],
    });
    const stdinUpdateRes = runCli(['task', 'update', taskCode, '--stdin', '--json'], workDir, {
      input: stdinPayload,
    });
    assert.strictEqual(stdinUpdateRes.status, 0, stdinUpdateRes.stderr);
    const updatedTask = JSON.parse(stdinUpdateRes.stdout).task;
    assert.strictEqual(updatedTask.status, 'ready');
    assert.ok(updatedTask.purpose.includes('`백틱`'), 'Backtick/Korean stdin preservation failed');
    assert.strictEqual(updatedTask.results.length, 2);

    // Exact code and 4-char prefix lookup in task show
    const showTaskRes = runCli(['task', 'show', taskCode.slice(4, 8), '--json'], workDir);
    assert.strictEqual(showTaskRes.status, 0, showTaskRes.stderr);
    assert.strictEqual(JSON.parse(showTaskRes.stdout).code, taskCode);

    // Lease acquire / contention / release
    const leaseOk = runCli(['task', 'lease', taskCode, '--owner=agent-a', '--json'], workDir);
    assert.strictEqual(leaseOk.status, 0, leaseOk.stderr);
    assert.strictEqual(JSON.parse(leaseOk.stdout).acquired, true);

    const leaseBusy = runCli(['task', 'lease', taskCode, '--owner=agent-b', '--json'], workDir);
    assert.strictEqual(leaseBusy.status, 1, 'Contended lease should exit with code 1');
    assert.strictEqual(JSON.parse(leaseBusy.stdout).acquired, false);
    assert.strictEqual(JSON.parse(leaseBusy.stdout).holder, 'agent-a');

    const leaseRel = runCli(['task', 'lease', taskCode, '--owner=agent-a', '--release', '--json'], workDir);
    assert.strictEqual(leaseRel.status, 0);
    assert.strictEqual(JSON.parse(leaseRel.stdout).released, true);

    // Complete task
    const completeRes = runCli(['task', 'complete', taskCode, '--sha=deadbeef', '--json'], workDir);
    assert.strictEqual(completeRes.status, 0, completeRes.stderr);
    const completedTask = JSON.parse(completeRes.stdout).task;
    assert.strictEqual(completedTask.status, 'done');
    assert.strictEqual(completedTask.commitSha, 'deadbeef');

    // Default sqlite mode must NOT generate task.md or task-completed.md automatically
    assert.ok(!fs.existsSync(path.join(workDir, '.agents', 'acm', 'task', 'task.md')), 'task.md should not exist when markdownProjection is false');
    assert.ok(!fs.existsSync(path.join(workDir, '.agents', 'acm', 'task', 'task-completed.md')), 'task-completed.md should not exist when markdownProjection is false');

    // Enabling storage.markdownProjection=true should immediately project existing SQLite DB tasks
    const enableProjRes = runCli(['config', 'set', 'storage.markdownProjection', 'true', '--json'], workDir);
    assert.strictEqual(enableProjRes.status, 0, enableProjRes.stderr);
    const projectedDone = fs.readFileSync(path.join(workDir, '.agents', 'acm', 'task', 'task-completed.md'), 'utf-8');
    assert.ok(projectedDone.includes(taskCode) && projectedDone.includes('deadbeef'), 'Opt-in task-completed.md projection missing');
    assert.strictEqual(runCli(['config', 'set', 'storage.markdownProjection', 'false', '--json'], workDir).status, 0);

    // 4. pattern add / list / show / supersedes
    const pat1Res = runCli(
      [
        'pattern',
        'add',
        'PowerShell Escaping Guard',
        '--category=Windows/CLI',
        '--summary=Use --stdin JSON for complex payloads',
        '--symptom=Quotes break CLI args in PowerShell',
        '--solution=Pass structured JSON via --stdin',
        '--file=scripts/acm-db-cli.cjs',
        '--tag=powershell',
        '--tag=stdin',
        '--json',
      ],
      workDir
    );
    assert.strictEqual(pat1Res.status, 0, pat1Res.stderr);
    const pat1 = JSON.parse(pat1Res.stdout).pattern;
    assert.ok(/^P-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(pat1.code));
    assert.strictEqual(pat1.author, '', 'Default pattern author should be empty');

    const pat2Res = runCli(
      [
        'pattern',
        'add',
        'PowerShell Escaping Guard v2',
        `--supersedes=${pat1.code}`,
        '--summary=Use --stdin JSON or MCP tool calls',
        '--solution=Prefer --stdin or stdio MCP for multiline text',
        '--file=scripts/acm-db-cli.cjs',
        '--json',
      ],
      workDir
    );
    assert.strictEqual(pat2Res.status, 0, pat2Res.stderr);
    const pat2 = JSON.parse(pat2Res.stdout).pattern;
    assert.strictEqual(pat2.version, 2);

    const patListRes = runCli(['pattern', 'list', '--json'], workDir);
    assert.strictEqual(JSON.parse(patListRes.stdout).count, 1, 'Superseded pattern should be hidden by default');

    const patShowRes = runCli(['pattern', 'show', pat2.code.slice(2, 6), '--json'], workDir);
    assert.strictEqual(patShowRes.status, 0, patShowRes.stderr);
    assert.strictEqual(JSON.parse(patShowRes.stdout).version, 2);

    // 5. adr add / list / show
    const adrAddRes = runCli(
      [
        'adr',
        'add',
        'Adopt CLI DB Interface',
        '--date=2026-11-23',
        '--summary=Add acm-db-cli over MemoryStore',
        '--area=scripts/acm-db-cli.cjs',
        `--task=${taskCode}`,
        '--context=Agents need structured DB access',
        '--decision=Expose task/pattern/adr/search/migrate CLI',
        '--impact=Safe cross-platform mutations',
        '--json',
      ],
      workDir
    );
    assert.strictEqual(adrAddRes.status, 0, adrAddRes.stderr);
    const adr1 = JSON.parse(adrAddRes.stdout).adr;
    assert.ok(/^LOG-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(adr1.code));

    const adrListRes = runCli(['adr', 'list', '--json'], workDir);
    assert.strictEqual(JSON.parse(adrListRes.stdout).count, 1);
    const adrShowRes = runCli(['adr', 'show', adr1.code, '--json'], workDir);
    assert.strictEqual(JSON.parse(adrShowRes.stdout).title, 'Adopt CLI DB Interface');

    // 6. search
    const searchRes = runCli(['search', 'scripts/acm-db-cli.cjs', '--limit=5', '--json'], workDir);
    assert.strictEqual(searchRes.status, 0, searchRes.stderr);
    const searchOut = JSON.parse(searchRes.stdout);
    assert.ok(searchOut.count >= 2, 'Expected FTS5 search to match task and pattern');

    const koSearchRes = runCli(['search', '백틱', '--kind=task', '--json'], workDir);
    assert.strictEqual(koSearchRes.status, 0);
    assert.strictEqual(JSON.parse(koSearchRes.stdout).count, 1);

    // 7. export json & md + migrate dry-run & real roundtrip + import strategies
    const snapshotFile = path.join(workDir, 'backup-snapshot.json');
    const expJsonRes = runCli(['export', '--format=json', `--out=${snapshotFile}`, '--json'], workDir);
    assert.strictEqual(expJsonRes.status, 0, expJsonRes.stderr);
    assert.ok(fs.existsSync(snapshotFile), 'Snapshot JSON file not written');

    const expMdDir = path.join(workDir, 'exported-md-view');
    const expMdRes = runCli(['export', '--format=md', `--out=${expMdDir}`, '--json'], workDir);
    assert.strictEqual(expMdRes.status, 0, expMdRes.stderr);
    assert.ok(fs.existsSync(path.join(expMdDir, '.agents', 'acm', 'memory', 'patterns-index.md')));

    // migrate --to=markdown --dry-run (config must remain sqlite)
    const migDryMd = runCli(['migrate', '--to=markdown', '--dry-run', '--json'], workDir);
    assert.strictEqual(migDryMd.status, 0, migDryMd.stderr);
    assert.strictEqual(JSON.parse(migDryMd.stdout).dryRun, true);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(workDir, '.agents', 'acm', 'config.json'), 'utf-8')).storage.provider,
      'sqlite'
    );

    // migrate --to=markdown
    const migRealMd = runCli(['migrate', '--to=markdown', '--json'], workDir);
    assert.strictEqual(migRealMd.status, 0, migRealMd.stderr);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(workDir, '.agents', 'acm', 'config.json'), 'utf-8')).storage.provider,
      'markdown'
    );
    assert.ok(fs.existsSync(path.join(workDir, '.agents', 'acm', 'memory', 'project-changelog.md')));

    // Verify Markdown provider works via CLI (task add + import skip/replace)
    const mdAddRes = runCli(['task', 'add', 'Markdown mode task', '--json'], workDir);
    assert.strictEqual(mdAddRes.status, 0, mdAddRes.stderr);
    const mdTaskCode = JSON.parse(mdAddRes.stdout).task.code;
    assert.ok(/^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(mdTaskCode));

    const mdImportSkip = runCli(['import', snapshotFile, '--strategy=skip', '--json'], workDir);
    assert.strictEqual(mdImportSkip.status, 0, mdImportSkip.stderr);
    assert.ok(JSON.parse(mdImportSkip.stdout).skipped >= 1, 'import --strategy=skip should skip existing records');

    // migrate --to=sqlite --dry-run & real
    const migDrySql = runCli(['migrate', '--to=sqlite', '--dry-run', '--json'], workDir);
    assert.strictEqual(migDrySql.status, 0, migDrySql.stderr);
    assert.strictEqual(JSON.parse(migDrySql.stdout).to, 'sqlite');

    const migRealSql = runCli(['migrate', '--to=sqlite', '--json'], workDir);
    assert.strictEqual(migRealSql.status, 0, migRealSql.stderr);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(workDir, '.agents', 'acm', 'config.json'), 'utf-8')).storage.provider,
      'sqlite'
    );

    const postRoundtripList = runCli(['task', 'list', '--all', '--json'], workDir);
    assert.strictEqual(postRoundtripList.status, 0);
    const postTasks = JSON.parse(postRoundtripList.stdout).tasks;
    assert.ok(postTasks.some((item) => item.code === taskCode && item.status === 'done'));
    assert.ok(postTasks.some((item) => item.code === mdTaskCode));

    // import --strategy=replace in sqlite mode
    const sqlReplace = runCli(['import', snapshotFile, '--strategy=replace', '--json'], workDir);
    assert.strictEqual(sqlReplace.status, 0, sqlReplace.stderr);
    const afterReplace = JSON.parse(runCli(['task', 'list', '--all', '--json'], workDir).stdout).tasks;
    assert.strictEqual(afterReplace.length, 1, 'import --strategy=replace should restore exact snapshot task count');

    // Korean output verification
    const koListRes = runCli(['task', 'list', '--all', '--lang=ko'], workDir);
    assert.strictEqual(koListRes.status, 0);
    assert.ok(koListRes.stdout.includes('[태스크]'), 'Korean CLI header missing');

    // Uninstall removes scripts/acm/* and .agents/ (no EBUSY lock)
    const unRes = runCli(['uninstall', '--force', '--no-backup'], workDir);
    assert.strictEqual(unRes.status, 0, `uninstall failed: ${unRes.stderr || unRes.stdout}`);
    assert.ok(!fs.existsSync(path.join(workDir, '.agents')), '.agents directory remained after uninstall');
    assert.ok(!fs.existsSync(path.join(workDir, 'scripts', 'acm', 'acm-db-cli.cjs')), 'scripts/acm/acm-db-cli.cjs remained after uninstall');
    assert.ok(!fs.existsSync(path.join(workDir, 'scripts', 'acm', 'storage')), 'scripts/acm/storage remained after uninstall');
    assert.ok(!fs.existsSync(path.join(workDir, 'scripts', 'acm')), 'scripts/acm remained after uninstall');
    assert.ok(!fs.existsSync(path.join(workDir, 'scripts')), 'empty scripts directory remained after uninstall');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  console.log('=== All Phase 2 DB CLI & Installer Storage UI Tests Passed (0 errors) ===\n');
}

runTests().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

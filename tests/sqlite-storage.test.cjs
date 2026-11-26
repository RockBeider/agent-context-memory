/**
 * tests/sqlite-storage.test.cjs
 *
 * Storage abstraction core, node:sqlite + FTS5 engine, bilingual Markdown bridge,
 * and group-status.cjs commit integration verification suite.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execSync, spawnSync } = require('child_process');

const {
  generateUlid,
  generateShortToken,
  generateShortCode,
  generateTaskCode,
  generatePatternCode,
  generateAdrCode,
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  isSampleCode,
  isShortIdSuffix,
  parseCode,
  normalizeCodeInput,
  compareRecordsByTimeAndCode,
  normalizeTaskStatus,
  toDisplayStatus,
  toMarkdownCheckbox,
} = require('../scripts/acm/storage/id-utils.cjs');
const { DEFAULT_CONFIG, saveConfig, loadConfig } = require('../scripts/acm/storage/config.cjs');
const { resolveLanguage } = require('../scripts/acm/i18n.cjs');
const { createMemoryStore } = require('../scripts/acm/storage/memory-store.cjs');
const { SqliteProvider } = require('../scripts/acm/storage/sqlite-provider.cjs');
const {
  resolveTaskFiles,
  resolveMemoryFiles,
  importMarkdownToStore,
  exportStoreToMarkdown,
  parseTaskMdFile,
  parseTaskCompletedMdFile,
  parsePatternsFromMd,
  parseAdrsFromMd,
} = require('../scripts/acm/storage/markdown-bridge.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('=== Starting ACM Local SQLite Storage & Commit Engine Integration Tests ===');

// ---------------------------------------------------------------------------
// 1. ULID monotonicity, code formatters, and EN/KO bidirectional status mapping
// ---------------------------------------------------------------------------
{
  const ulids = [];
  for (let i = 0; i < 100; i++) {
    ulids.push(generateUlid(1763860000000));
  }
  for (let i = 1; i < ulids.length; i++) {
    assert.strictEqual(ulids[i].length, 26, 'ULID must be 26 characters');
    assert.ok(ulids[i] > ulids[i - 1], `ULID monotonicity failed: ${ulids[i - 1]} >= ${ulids[i]}`);
  }

  assert.strictEqual(formatTaskCode(1), 'TSK-1');
  assert.strictEqual(formatPatternCode(1), 'P-01');
  assert.strictEqual(formatAdrCode(3), 'LOG-03');
  assert.strictEqual(parseCodeNumber('TSK-18', 'TSK'), 18);
  assert.strictEqual(parseCodeNumber('P-02', 'P'), 2);
  assert.strictEqual(parseCodeNumber('LOG-03', 'LOG'), 3);
  assert.strictEqual(parseCodeNumber('TSK-SAMPLE', 'TSK'), null);
  assert.strictEqual(parseCodeNumber('P-00', 'P'), null);
  assert.strictEqual(parseCodeNumber('LOG-00', 'LOG'), null);
  assert.strictEqual(parseCodeNumber('P-02', 'TSK'), null);

  // Short-ID generation, unbiased alpha-first format, bidirectional parseCode & normalizeCodeInput
  const shortRe = /^[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
  for (let i = 0; i < 40; i++) {
    const tCode = generateTaskCode();
    const pCode = generatePatternCode();
    const aCode = generateAdrCode();
    assert.ok(/^TSK-[A-Z0-9]{6}$/.test(tCode) && shortRe.test(tCode.slice(4)), `Invalid task short-id: ${tCode}`);
    assert.ok(/^P-[A-Z0-9]{6}$/.test(pCode) && shortRe.test(pCode.slice(2)), `Invalid pattern short-id: ${pCode}`);
    assert.ok(/^LOG-[A-Z0-9]{6}$/.test(aCode) && shortRe.test(aCode.slice(4)), `Invalid adr short-id: ${aCode}`);
    assert.ok(!/[ILOU]/.test(generateShortToken()), 'Short token must exclude I, L, O, U');
  }
  assert.strictEqual(isSampleCode('TSK-SAMPLE'), true);
  assert.strictEqual(isSampleCode('P-00'), true);
  assert.strictEqual(isSampleCode('LOG-00'), true);
  assert.strictEqual(isShortIdSuffix('K7M29A'), true);
  assert.strictEqual(isShortIdSuffix('123456'), false);
  assert.strictEqual(parseCode('tsk-k7m29a', 'TSK').code, 'TSK-K7M29A');
  assert.strictEqual(parseCode('k7m29a', 'TSK').code, 'TSK-K7M29A');
  assert.strictEqual(parseCode('TSK-18', 'TSK').code, 'TSK-18');
  assert.strictEqual(parseCode('1', 'P').code, 'P-01');
  assert.strictEqual(parseCode('TSK-SAMPLE', 'TSK'), null);
  assert.strictEqual(parseCode('P-02', 'TSK'), null);
  assert.deepStrictEqual(normalizeCodeInput('K7M2', 'TSK'), {
    exactCode: null,
    prefixQuery: 'TSK-K7M2',
    parsed: null,
  });
  assert.strictEqual(normalizeCodeInput('24', 'TSK').exactCode, 'TSK-24');
  assert.strictEqual(
    compareRecordsByTimeAndCode(
      { code: 'TSK-2', createdAt: '2026-11-23T00:00:00.000Z', uid: '01A' },
      { code: 'TSK-10', createdAt: '2026-11-23T00:00:00.000Z', uid: '01B' },
      'TSK'
    ) < 0,
    true
  );

  // English variants
  assert.strictEqual(normalizeTaskStatus('Todo'), 'todo');
  assert.strictEqual(normalizeTaskStatus('In Progress'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('In Progress (Agent: sub-1)'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('Ready'), 'ready');
  assert.strictEqual(normalizeTaskStatus('Ready to Commit'), 'ready');
  assert.strictEqual(normalizeTaskStatus('Done'), 'done');
  assert.strictEqual(normalizeTaskStatus('Paused'), 'paused');

  // Korean backward-compatible variants
  assert.strictEqual(normalizeTaskStatus('진행 대기'), 'todo');
  assert.strictEqual(normalizeTaskStatus('진행 중'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('진행 중 (Agent: sub-1)'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('커밋 대기'), 'ready');
  assert.strictEqual(normalizeTaskStatus('x'), 'done');
  assert.strictEqual(normalizeTaskStatus('완료'), 'done');
  assert.strictEqual(normalizeTaskStatus('보류'), 'paused');

  // Display / checkbox output by locale (default en + explicit ko)
  assert.strictEqual(toDisplayStatus('ready'), 'Ready');
  assert.strictEqual(toDisplayStatus('in_progress'), 'In Progress');
  assert.strictEqual(toDisplayStatus('ready', 'ko'), '커밋 대기');
  assert.strictEqual(toDisplayStatus('in_progress', 'ko'), '진행 중');
  assert.strictEqual(toMarkdownCheckbox('ready'), 'Ready');
  assert.strictEqual(toMarkdownCheckbox('ready', 'ko'), '커밋 대기');
  assert.strictEqual(toMarkdownCheckbox('done'), 'x');
  assert.strictEqual(toMarkdownCheckbox('todo'), ' ');
  console.log('[PASS] 1. ULID monotonicity, code formatters, and EN/KO status mapping verified.');
}

// ---------------------------------------------------------------------------
// 2~5. SqliteProvider CRUD, 3-element validation, pattern versioning, FTS5 BM25, Lease
// ---------------------------------------------------------------------------
{
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-sqlite-unit-'));
  let store = null;
  try {
    assert.strictEqual(DEFAULT_CONFIG.storage.markdownProjection, false, 'DEFAULT_CONFIG.storage.markdownProjection should default to false');
    saveConfig(tempDbDir, { storage: { provider: 'sqlite' } });
    assert.strictEqual(loadConfig(tempDbDir).storage.markdownProjection, false, 'Default sqlite config should disable markdownProjection');
    store = createMemoryStore(tempDbDir);
    assert.strictEqual(store.providerName, 'sqlite', 'Failed to select sqlite provider');

    // 2-1. Reject [Ready] missing 3 elements
    assert.throws(
      () => store.upsertTask({ title: 'Incomplete task', status: 'ready', purpose: 'Only purpose' }),
      /Missing:.*results.*targets/i,
      'Transitioning to [Ready] without all 3 elements must throw'
    );

    // 2-2. Task creation with short-id allocation & empty default owner (no git user.name leak)
    const tskShortRe = /^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
    const patShortRe = /^P-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
    const adrShortRe = /^LOG-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

    const t1 = store.upsertTask({
      title: 'Build SQLite FTS5 index',
      status: 'in_progress',
      purpose: 'Improve local memory search latency.',
      results: ['scripts/storage/sqlite-provider.cjs: Created FTS5 virtual table'],
      targets: ['scripts/storage/sqlite-provider.cjs'],
      createdAt: '2026-11-23T01:00:00.000Z',
    });
    assert.ok(tskShortRe.test(t1.code), `Expected short-id task code, got: ${t1.code}`);
    assert.strictEqual(t1.status, 'in_progress');
    assert.strictEqual(t1.owner, '', 'tasks.owner must stay empty unless explicitly provided');

    const t2 = store.upsertTask({
      title: 'Integrate group-status.cjs atomic commit',
      status: 'ready',
      purpose: 'Enable SQLite atomic commit and auto-archiving.',
      results: ['scripts/group-status.cjs: Added DB store integration'],
      targets: ['scripts/group-status.cjs'],
      createdAt: '2026-11-23T01:01:00.000Z',
    });
    assert.ok(tskShortRe.test(t2.code), `Expected short-id task code, got: ${t2.code}`);
    assert.notStrictEqual(t2.code, t1.code);
    assert.strictEqual(t2.status, 'ready');

    // Unambiguous prefix lookup & ambiguity rejection
    assert.strictEqual(store.getTask(t1.code.slice(4, 8)).uid, t1.uid, 'Short-id 4-char prefix lookup failed');
    store.upsertTask({ code: 'TSK-K7M111', title: 'Prefix collision A', status: 'todo' });
    store.upsertTask({ code: 'TSK-K7M222', title: 'Prefix collision B', status: 'todo' });
    assert.throws(
      () => store.getTask('K7M'),
      /Ambiguous code prefix/i,
      'Ambiguous 3-char prefix lookup must throw'
    );

    // 2-3. ADR creation (short-id) & empty default author
    const adr1 = store.upsertAdr({
      date: '2026-11-23',
      title: 'Switch to local SQLite-first storage',
      summary: 'Adopt node:sqlite and FTS5 as the default local store',
      relatedArea: 'scripts/storage/, scripts/group-status.cjs',
      relatedTaskCode: t1.code,
      branch: 'main',
      context: 'Resolve Markdown parser coupling and collaboration conflicts',
      decision: 'Introduce SQLite canonical store and StorageProvider abstraction',
      impact: 'Faster search and conflict-free collaboration',
      createdAt: '2026-11-23T01:02:00.000Z',
    });
    assert.ok(adrShortRe.test(adr1.code), `Expected short-id ADR code, got: ${adr1.code}`);
    assert.strictEqual(adr1.author, '', 'adrs.author must stay empty by default');
    assert.strictEqual(store.getAdr(adr1.code.slice(4, 8)).uid, adr1.uid);

    // 3. Pattern v1 and superseded v2 chain + selective ACM_AUTHOR / config.author opt-in
    const p1 = store.upsertPattern({
      category: 'Git/Tooling',
      title: 'Prevent Git Pager Freezes v1',
      summary: 'Disable pager when running Git commands',
      symptom: 'git diff hangs in non-interactive shells',
      solution: 'Inject GIT_PAGER=cat environment variable',
      relatedFiles: ['scripts/group-status.cjs'],
      tags: ['git', 'pager'],
      createdAt: '2026-11-23T01:03:00.000Z',
    });
    assert.ok(patShortRe.test(p1.code), `Expected short-id pattern code, got: ${p1.code}`);
    assert.strictEqual(p1.version, 1);
    assert.strictEqual(p1.author, '', 'patterns.author must stay empty by default');

    const prevEnvAuthor = process.env.ACM_AUTHOR;
    process.env.ACM_AUTHOR = 'opt-in-author';
    let p2;
    try {
      p2 = store.upsertPattern({
        supersedesUid: p1.uid,
        category: 'Git/Tooling',
        title: 'Prevent Git Pager Freezes v2 (Extended)',
        summary: 'Enforce GIT_PAGER=cat and --no-pager together',
        symptom: 'Remaining pager subprocess deadlocks on Windows',
        solution: 'Apply GIT_PAGER=cat, PAGER=cat, and --no-pager on all spawns',
        relatedFiles: ['scripts/group-status.cjs', 'scripts/smart-pull.cjs'],
        tags: ['git', 'pager', 'windows'],
        createdAt: '2026-11-23T01:04:00.000Z',
      });
      const tOptInCheck = store.upsertTask({ title: 'Owner stays empty with ACM_AUTHOR' });
      assert.strictEqual(tOptInCheck.owner, '', 'ACM_AUTHOR must never populate tasks.owner');
    } finally {
      if (prevEnvAuthor === undefined) delete process.env.ACM_AUTHOR;
      else process.env.ACM_AUTHOR = prevEnvAuthor;
    }
    assert.ok(patShortRe.test(p2.code), `Expected short-id pattern code, got: ${p2.code}`);
    assert.notStrictEqual(p2.code, p1.code);
    assert.strictEqual(p2.version, 2);
    assert.strictEqual(p2.supersedesUid, p1.uid);
    assert.strictEqual(p2.author, 'opt-in-author', 'patterns.author should accept ACM_AUTHOR opt-in');
    assert.strictEqual(store.getPattern(p2.code.slice(2, 6)).uid, p2.uid);

    const activePatterns = store.listPatterns();
    assert.strictEqual(activePatterns.length, 1, 'Superseded v1 pattern should be excluded by default');
    assert.strictEqual(activePatterns[0].uid, p2.uid);

    const allPatterns = store.listPatterns({ includeSuperseded: true });
    assert.strictEqual(allPatterns.length, 2, 'includeSuperseded should return both v1 and v2');

    // 4. FTS5 BM25 search (special characters, multilingual, kind filter, tokenBudget, superseded exclusion)
    const pagerHits = store.search('pager', { kind: 'pattern' });
    assert.strictEqual(pagerHits.length, 1, 'FTS5 search must exclude superseded v1 and return v2 only');
    assert.strictEqual(pagerHits[0].uid, p2.uid);

    const specialCharHits1 = store.search(t1.code);
    assert.ok(specialCharHits1.some((h) => h.code === t1.code), 'Hyphenated code search failed');

    const specialCharHits2 = store.search('scripts/group-status.cjs');
    assert.ok(specialCharHits2.length >= 2, 'File path FTS5 search failed');

    const specialCharHits3 = store.search(p2.code);
    assert.ok(specialCharHits3.some((h) => h.code === p2.code), 'Pattern code search failed');

    const commitHits = store.search('atomic commit');
    assert.ok(commitHits.some((h) => h.code === t2.code), 'Keyword phrase search failed');

    const budgetHits = store.search('scripts/group-status.cjs', { tokenBudget: 120 });
    const totalPackedTokens = budgetHits.reduce((acc, h) => acc + h.estimatedTokens, 0);
    assert.ok(totalPackedTokens <= 120, `Token budget exceeded: ${totalPackedTokens} > 120`);

    // 5. Lease acquire / conflict / release (including prefix lookup)
    const lease1 = store.acquireLease(t1.code.slice(4, 8), 'agent-alpha', 300);
    assert.strictEqual(lease1.acquired, true);

    const leaseConflict = store.acquireLease(t1.code, 'agent-beta', 300);
    assert.strictEqual(leaseConflict.acquired, false);
    assert.strictEqual(leaseConflict.holder, 'agent-alpha');

    const badRelease = store.releaseLease(t1.code, 'agent-beta');
    assert.strictEqual(badRelease.released, false);

    const goodRelease = store.releaseLease(t1.code, 'agent-alpha');
    assert.strictEqual(goodRelease.released, true);

    const leaseAfterRelease = store.acquireLease(t1.code, 'agent-beta', 300);
    assert.strictEqual(leaseAfterRelease.acquired, true);

    console.log('[PASS] 2~5. CRUD, 3-element validation, pattern chain, FTS5 search, and Lease verified.');
  } finally {
    if (store) store.close();
    fs.rmSync(tempDbDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. Bilingual Markdown <-> SQLite lossless roundtrip migration & sample exclusion
// ---------------------------------------------------------------------------
{
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-md-roundtrip-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-md-export-'));
  const koFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-ko-roundtrip-'));
  const koExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-ko-export-'));
  let storeA = null;
  let storeB = null;
  let storeKo = null;

  try {
    // 6-1. English live .agents/ workspace roundtrip + sample exclusion (self-contained fixture)
    fs.cpSync(path.join(ROOT_DIR, '.agents'), path.join(fixtureDir, '.agents'), { recursive: true });
    fs.rmSync(path.join(fixtureDir, '.agents', 'acm', 'local'), { recursive: true, force: true });
    const taskDir = path.join(fixtureDir, '.agents', 'acm', 'task');
    fs.mkdirSync(taskDir, { recursive: true });

    const taskMdPath = path.join(taskDir, 'task.md');
    const origTaskMd = fs.readFileSync(
      path.join(ROOT_DIR, 'acm-template', '.agents', 'acm', 'task', 'task.md'),
      'utf-8'
    );
    const augmentedTaskMd = [
      origTaskMd,
      '',
      '> ```markdown',
      '> - [Ready] **TSK-SAMPLE. (Sample Example) Codeblock sample**',
      '>   - **Purpose**: Ignored sample',
      '>   - **Results**:',
      '>     - `sample.js`: ignored',
      '>   - **Targets**: `sample.js`',
      '> ```',
      '- [In Progress] **TSK-99. Roundtrip test active task**',
      '  - **Purpose**: Verify lossless Markdown -> SQLite -> Markdown roundtrip',
      '  - **Results**:',
      '    - `src/roundtrip.cjs`: bidirectional conversion verified',
      '  - **Targets**: `src/roundtrip.cjs`',
      '- [Ready] **TSK-K7M29A. Short-ID mixed roundtrip active task**',
      '  - **Purpose**: Verify legacy sequential and short-id tasks coexist seamlessly',
      '  - **Results**:',
      '    - `src/shortid.cjs`: mixed roundtrip verified',
      '  - **Targets**: `src/shortid.cjs`',
    ].join('\n');
    fs.writeFileSync(taskMdPath, augmentedTaskMd, 'utf-8');

    const completedTaskMd = [
      '# Agent Context Memory Task Completed Master (Cold Archive)',
      '',
      '> ```markdown',
      '> ## 0. YYYY-MM-DD Tasks',
      '> - [x] **TSK-SAMPLE. (Sample Example) Ignored completed sample** (Commit: `0000000`)',
      '>   - **Purpose**: Ignored sample',
      '>   - **Results**:',
      '>     - `sample.js`: ignored',
      '>   - **Targets**: `sample.js`',
      '> ```',
      '',
      '---',
      '',
      '## 2026-11-23',
      '',
      '- [x] **TSK-17. Template tracking, commit/smart-pull fixes, and governance CI sync** (Commit: `6781614`)',
      '  - **Purpose**: Verify completed task roundtrip preservation including commit SHA',
      '  - **Results**:',
      '    - `scripts/acm/group-status.cjs`: verified archive roundtrip',
      '  - **Targets**: `scripts/acm/group-status.cjs`',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(taskDir, 'task-completed.md'), completedTaskMd, 'utf-8');

    fs.copyFileSync(
      path.join(ROOT_DIR, 'acm-template', '.agents', 'acm', 'memory', 'patterns', 'P-00-sample-pattern.md'),
      path.join(fixtureDir, '.agents', 'acm', 'memory', 'patterns', 'P-00-sample-pattern.md')
    );

    saveConfig(fixtureDir, { storage: { provider: 'sqlite', markdownProjection: false } });
    storeA = new SqliteProvider(fixtureDir).open();
    const importRes = importMarkdownToStore(fixtureDir, storeA);
    assert.ok(importRes.tasks >= 1, 'Active task not imported');
    assert.ok(importRes.completedTasks >= 1, 'Completed task not imported');
    assert.ok(importRes.patterns >= 2, 'Patterns (P-01, P-02) not imported');
    assert.ok(importRes.adrs >= 3, 'ADRs (LOG-01..03) not imported');

    const tasksA = storeA.listTasks({ includeDone: true });
    const patternsA = storeA.listPatterns();
    const adrsA = storeA.listAdrs();
    assert.ok(!tasksA.some((t) => t.code.includes('SAMPLE') || t.code === 'TSK-0'), 'Sample task leaked into DB');
    assert.ok(!patternsA.some((p) => p.code === 'P-00'), 'P-00 sample leaked into DB');
    assert.ok(!adrsA.some((a) => a.code === 'LOG-00'), 'LOG-00 sample leaked into DB');

    exportStoreToMarkdown(exportDir, storeA, { lang: 'en' });

    const parsedActive = parseTaskMdFile(path.join(exportDir, '.agents', 'acm', 'task', 'task.md'));
    const parsedDone = parseTaskCompletedMdFile(path.join(exportDir, '.agents', 'acm', 'task', 'task-completed.md'));
    const parsedPatterns = parsePatternsFromMd(exportDir);
    const parsedAdrs = parseAdrsFromMd(exportDir);

    assert.strictEqual(parsedActive.length, tasksA.filter((t) => t.status !== 'done').length);
    assert.strictEqual(parsedDone.length, tasksA.filter((t) => t.status === 'done').length);
    assert.strictEqual(parsedPatterns.length, patternsA.length);
    assert.strictEqual(parsedAdrs.length, adrsA.length);

    storeB = new SqliteProvider(exportDir).open();
    importMarkdownToStore(exportDir, storeB);
    assert.strictEqual(storeB.listTasks({ includeDone: true }).length, tasksA.length);
    assert.strictEqual(storeB.listPatterns().length, patternsA.length);
    assert.strictEqual(storeB.listAdrs().length, adrsA.length);
    assert.strictEqual(storeB.getTask('TSK-17').commitSha, storeA.getTask('TSK-17').commitSha);
    assert.strictEqual(storeB.getTask('K7M2').code, 'TSK-K7M29A');
    assert.strictEqual(storeB.getPattern('P-01').title, storeA.getPattern('P-01').title);
    assert.strictEqual(storeB.getAdr('LOG-02').title, storeA.getAdr('LOG-02').title);

    // 6-2. Korean backward-compatibility Markdown fixture roundtrip
    fs.mkdirSync(path.join(koFixtureDir, '.agents', 'acm', 'task'), { recursive: true });
    fs.mkdirSync(path.join(koFixtureDir, '.agents', 'acm', 'memory', 'patterns'), { recursive: true });
    fs.writeFileSync(
      path.join(koFixtureDir, '.agents', 'acm', 'task', 'task.md'),
      [
        '# Agent Context Memory Task Master (작업 단일 정본)',
        '## 1. 활성 작업 목록 (Active Tasks)',
        '- [커밋 대기] **TSK-5. 한국어 태스크 파싱 호환 검증**',
        '  - **목적**: 기존 한국어 포맷 무손실 적재 검증',
        '  - **수행결과**:',
        '    - `src/ko.cjs`: 한국어 파싱 확인',
        '  - **대상영역**: `src/ko.cjs`',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(koFixtureDir, '.agents', 'acm', 'task', 'task-completed.md'),
      '# Completed\n\n## 2026-11-20\n\n- [x] **TSK-4. 선행 한국어 작업** (Commit: `abc1234`)\n  - **목적**: 선행 작업\n  - **수행결과**:\n    - `a.js`: 완료\n  - **대상영역**: `a.js`\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(koFixtureDir, '.agents', 'acm', 'memory', 'patterns-index.md'),
      '| ID | 카테고리 | 핵심 요약 | 파일 링크 |\n| :--- | :--- | :--- | :--- |\n| P-01 | Git | 한국어 패턴 | [P-01-ko.md](file:///./patterns/P-01-ko.md) |\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(koFixtureDir, '.agents', 'acm', 'memory', 'patterns', 'P-01-ko.md'),
      '# [P-01] 한국어 패턴\n\n- **일자**: 2026-11-20\n- **도메인 분류**: Git\n- **증상 및 원인**: 한국어 증상\n- **해결 패턴**: 한국어 해법\n- **연관 파일**: `scripts/ko.cjs`\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(koFixtureDir, '.agents', 'acm', 'memory', 'project-changelog.md'),
      [
        '# Changelog',
        '## 1. ADR Index Map',
        '| ID | 일자 | 핵심 아키텍처 결정 요약 | 관련 영역 |',
        '| :--- | :--- | :--- | :--- |',
        '| **LOG-01** | 2026-11-20 | 한국어 ADR 결정 | `scripts/` |',
        '',
        '## 2. ADR 상세 기록',
        '### [LOG-01] [2026-11-20] 한국어 ADR 제목',
        '- **관련 커밋/브랜치**: `TSK-4` / `main`',
        '- **결정 배경 및 목적**:',
        '  - 한국어 배경',
        '- **아키텍처 결정 사항**:',
        '  - 한국어 결정',
        '- **예상 효과**:',
        '  - 한국어 효과',
      ].join('\n'),
      'utf-8'
    );

    saveConfig(koFixtureDir, { language: 'ko', storage: { provider: 'sqlite', markdownProjection: false } });
    storeKo = new SqliteProvider(koFixtureDir).open();
    const koImport = importMarkdownToStore(koFixtureDir, storeKo);
    assert.strictEqual(koImport.tasks, 1);
    assert.strictEqual(koImport.completedTasks, 1);
    assert.strictEqual(koImport.patterns, 1);
    assert.strictEqual(koImport.adrs, 1);
    assert.strictEqual(storeKo.getTask('TSK-5').status, 'ready');
    assert.strictEqual(storeKo.getAdr('LOG-01').decision, '한국어 결정');

    exportStoreToMarkdown(koExportDir, storeKo, { lang: 'ko' });
    const exportedKoTask = fs.readFileSync(path.join(koExportDir, '.agents', 'acm', 'task', 'task.md'), 'utf-8');
    assert.ok(exportedKoTask.includes('- [커밋 대기] **TSK-5.'), 'Korean projection missing [커밋 대기]');
    assert.ok(exportedKoTask.includes('**목적**:'), 'Korean projection missing **목적**');

    console.log('[PASS] 6. Bilingual EN/KO Markdown <-> SQLite lossless roundtrip and sample exclusion verified.');
  } finally {
    if (storeA) storeA.close();
    if (storeB) storeB.close();
    if (storeKo) storeKo.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(exportDir, { recursive: true, force: true });
    fs.rmSync(koFixtureDir, { recursive: true, force: true });
    fs.rmSync(koExportDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. Git repo group-status.cjs SQLite integration, atomic commit & MD projection E2E
// ---------------------------------------------------------------------------
{
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-sqlite-git-e2e-'));
  let store = null;
  let verifyStore = null;

  try {
    execSync('git init', { cwd: gitDir, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: gitDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: gitDir, stdio: 'ignore' });

    fs.writeFileSync(path.join(gitDir, '.gitignore'), '/.agents/\n', 'utf-8');
    fs.writeFileSync(path.join(gitDir, 'README.md'), '# SQLite E2E\n', 'utf-8');
    execSync('git add . && git commit -m "chore: baseline"', { cwd: gitDir, stdio: 'ignore' });

    saveConfig(gitDir, {
      storage: { provider: 'sqlite', dbPath: '.agents/acm/local/memory.db', markdownProjection: true },
    });
    const loadedCfg = loadConfig(gitDir);
    assert.strictEqual(loadedCfg.explicit, true);
    assert.strictEqual(loadedCfg.storage.provider, 'sqlite');

    store = createMemoryStore(gitDir);
    const createdGitTask = store.upsertTask({
      title: 'Commit SQLite integrated feature',
      status: 'ready',
      purpose: 'Verify group-status.cjs reads tasks from SQLite DB and records commit SHA.',
      results: ['src/feature.js: Added feature module and verified tests'],
      targets: ['src/feature.js'],
    });
    const gitTaskCode = createdGitTask.code;
    assert.ok(/^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/.test(gitTaskCode));
    store.close();
    store = null;

    fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'src', 'feature.js'), 'module.exports = () => 42;\n', 'utf-8');

    const groupStatusPath = path.join(ROOT_DIR, 'scripts', 'acm', 'group-status.cjs');
    const compactRes = spawnSync(process.execPath, [groupStatusPath, '--compact'], {
      cwd: gitDir,
      env: { ...process.env, ACM_ROOT_DIR: gitDir },
      encoding: 'utf-8',
    });
    assert.strictEqual(compactRes.status, 0, `group-status --compact failed: ${compactRes.stderr || compactRes.stdout}`);
    assert.ok(compactRes.stdout.includes(gitTaskCode), `SQLite ${gitTaskCode} missing from compact output`);

    const commitRes = spawnSync(process.execPath, [groupStatusPath, '--all'], {
      cwd: gitDir,
      env: { ...process.env, ACM_ROOT_DIR: gitDir },
      encoding: 'utf-8',
    });
    assert.strictEqual(commitRes.status, 0, `group-status --all failed: ${commitRes.stderr || commitRes.stdout}`);

    const cleanStatus = execSync('git status --porcelain', { cwd: gitDir, encoding: 'utf-8' });
    assert.strictEqual(cleanStatus.trim(), '', `Working tree not clean after commit: ${cleanStatus}`);
    const headSha = execSync('git rev-parse --short HEAD', { cwd: gitDir, encoding: 'utf-8' }).trim();

    verifyStore = createMemoryStore(gitDir, { skipProjection: true });
    const doneTask = verifyStore.getTask(gitTaskCode);
    assert.strictEqual(doneTask.status, 'done', 'SQLite task status should be done after commit');
    assert.strictEqual(doneTask.commitSha, headSha, 'SQLite commitSha mismatch with HEAD SHA');
    assert.ok(doneTask.completedAt, 'completedAt missing');
    verifyStore.close();
    verifyStore = null;

    const projectedTaskMd = fs.readFileSync(path.join(gitDir, '.agents', 'acm', 'task', 'task.md'), 'utf-8');
    const projectedCompMd = fs.readFileSync(path.join(gitDir, '.agents', 'acm', 'task', 'task-completed.md'), 'utf-8');
    assert.ok(projectedTaskMd.includes('(No active tasks)'), 'Projected task.md did not clear active task');
    assert.ok(projectedTaskMd.includes(`Latest Done: \`${gitTaskCode}\``), 'Projected task.md Latest Done meta not updated');
    assert.ok(
      projectedCompMd.includes(`- [x] **${gitTaskCode}. Commit SQLite integrated feature** (Commit: \`${headSha}\`)`),
      'Projected task-completed.md commit SHA missing'
    );

    console.log('[PASS] 7. Git SQLite group-status.cjs commit and English MD projection E2E verified.');
  } finally {
    if (store) store.close();
    if (verifyStore) verifyStore.close();
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 8. Legacy .agents/ read fallbacks (config.json, .acm-meta.json, local/memory.db, task/, memory/)
// ---------------------------------------------------------------------------
{
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-legacy-fallback-'));
  try {
    fs.mkdirSync(path.join(legacyDir, '.agents', 'local'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, '.agents', 'task'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, '.agents', 'memory', 'patterns'), { recursive: true });

    fs.writeFileSync(
      path.join(legacyDir, '.agents', 'config.json'),
      JSON.stringify({ version: 1, language: 'ko', storage: { provider: 'sqlite' } }, null, 2),
      'utf-8'
    );
    fs.writeFileSync(path.join(legacyDir, '.agents', 'local', 'memory.db'), '', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, '.agents', 'task', 'task.md'), '# Legacy Task\n', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, '.agents', 'memory', 'patterns-index.md'), '# Legacy Patterns\n', 'utf-8');

    const legacyCfg = loadConfig(legacyDir);
    assert.strictEqual(legacyCfg.explicit, true);
    assert.strictEqual(legacyCfg.storage.provider, 'sqlite');
    assert.strictEqual(legacyCfg.storage.dbPath, '.agents/local/memory.db', 'Legacy config without dbPath should resolve to legacy .agents/local/memory.db when present');
    assert.strictEqual(resolveLanguage(legacyDir), 'ko', 'Legacy .agents/config.json language fallback failed');

    const legacyTaskFiles = resolveTaskFiles(legacyDir);
    assert.strictEqual(legacyTaskFiles.taskFile, path.join(legacyDir, '.agents', 'task', 'task.md'));
    const legacyMemFiles = resolveMemoryFiles(legacyDir);
    assert.strictEqual(legacyMemFiles.patternsIndexFile, path.join(legacyDir, '.agents', 'memory', 'patterns-index.md'));

    // Also verify implicit legacy DB fallback when config.json does not exist
    fs.unlinkSync(path.join(legacyDir, '.agents', 'config.json'));
    fs.writeFileSync(path.join(legacyDir, '.agents', '.acm-meta.json'), JSON.stringify({ language: 'ko' }), 'utf-8');
    const implicitLegacyCfg = loadConfig(legacyDir);
    assert.strictEqual(implicitLegacyCfg.explicit, false);
    assert.strictEqual(implicitLegacyCfg.storage.provider, 'sqlite');
    assert.strictEqual(implicitLegacyCfg.storage.dbPath, '.agents/local/memory.db');
    assert.strictEqual(resolveLanguage(legacyDir), 'ko', 'Legacy .agents/.acm-meta.json language fallback failed');

    console.log('[PASS] 8. Legacy .agents/ read fallbacks verified.');
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 9. MarkdownProvider owner roundtrip & file-backed lease verification
// ---------------------------------------------------------------------------
{
  assert.strictEqual(normalizeTaskStatus('[Ready (Agent: agent-worker-1)]'), 'ready');
  assert.strictEqual(normalizeTaskStatus('[커밋 대기 (Agent: agent-worker-1)]'), 'ready');
  assert.strictEqual(normalizeTaskStatus('[In Progress (Agent: w1)]'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('[Paused (Agent: w1)]'), 'paused');

  const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-md-owner-lease-'));
  let mdStore = null;
  try {
    saveConfig(mdDir, { language: 'en', storage: { provider: 'markdown' } });
    mdStore = createMemoryStore(mdDir, { lang: 'en' });
    assert.strictEqual(mdStore.providerName, 'markdown');

    const tTodo = mdStore.upsertTask({
      title: 'Markdown todo with owner',
      status: 'todo',
      owner: 'agent-worker-1',
    });
    const tProg = mdStore.upsertTask({
      title: 'Markdown in-progress with owner',
      status: 'in_progress',
      owner: 'agent-worker-2',
    });
    const tReady = mdStore.upsertTask({
      title: 'Markdown ready with owner',
      status: 'ready',
      owner: 'agent-worker-1',
      purpose: 'Verify owner and lease persistence in markdown mode',
      results: ['Updated bridge and provider'],
      targets: ['scripts/acm/storage/markdown-provider.cjs'],
    });

    const { taskFile } = resolveTaskFiles(mdDir);
    const taskMdText = fs.readFileSync(taskFile, 'utf-8');
    assert.ok(taskMdText.includes('[Todo (Agent: agent-worker-1)]'), 'Todo owner missing in task.md');
    assert.ok(taskMdText.includes('[In Progress (Agent: agent-worker-2)]'), 'In Progress owner missing in task.md');
    assert.ok(taskMdText.includes('[Ready (Agent: agent-worker-1)]'), 'Ready owner missing in task.md');

    mdStore.close();
    mdStore = createMemoryStore(mdDir, { lang: 'en' });
    assert.strictEqual(mdStore.getTask(tTodo.code).owner, 'agent-worker-1');
    assert.strictEqual(mdStore.getTask(tProg.code).owner, 'agent-worker-2');
    assert.strictEqual(mdStore.getTask(tReady.code).owner, 'agent-worker-1');
    assert.strictEqual(mdStore.getTask(tReady.code).status, 'ready');

    // Lease acquisition, contention, mismatch rejection, force release, and completeTask cleanup
    const lease1 = mdStore.acquireLease(tReady.code, 'agent-alpha', 300);
    assert.strictEqual(lease1.acquired, true);
    assert.strictEqual(lease1.owner, 'agent-alpha');
    const leasesFile = path.join(mdDir, '.agents', 'acm', 'local', 'leases.json');
    assert.ok(fs.existsSync(leasesFile), 'leases.json should be created on acquireLease');
    assert.strictEqual(mdStore.getTask(tReady.code).leaseOwner, 'agent-alpha');

    const leaseConflict = mdStore.acquireLease(tReady.code, 'agent-beta', 300);
    assert.strictEqual(leaseConflict.acquired, false);
    assert.strictEqual(leaseConflict.holder, 'agent-alpha');

    const badRelease = mdStore.releaseLease(tReady.code, 'agent-beta');
    assert.strictEqual(badRelease.released, false);
    assert.strictEqual(badRelease.holder, 'agent-alpha');

    const forcedRelease = mdStore.releaseLease(tReady.code, 'agent-beta', { force: true });
    assert.strictEqual(forcedRelease.released, true);
    assert.strictEqual(mdStore.getTask(tReady.code).leaseOwner, null);

    const lease2 = mdStore.acquireLease(tReady.code, 'agent-beta', 300);
    assert.strictEqual(lease2.acquired, true);
    mdStore.completeTask(tReady.code, 'deadbeef');
    assert.strictEqual(mdStore.getTask(tReady.code).leaseOwner, null);
    const leasesAfterComplete = JSON.parse(fs.readFileSync(leasesFile, 'utf-8'));
    assert.strictEqual(leasesAfterComplete[tReady.code], undefined, 'completeTask should clear task lease');

    // Korean owner roundtrip + explicit Owner property line parsing
    mdStore.close();
    saveConfig(mdDir, { language: 'ko', storage: { provider: 'markdown' } });
    mdStore = createMemoryStore(mdDir, { lang: 'ko' });
    const tKo = mdStore.upsertTask({
      title: '한글 소유자 테스트',
      status: 'in_progress',
      owner: '에이전트-1',
    });
    assert.ok(fs.readFileSync(taskFile, 'utf-8').includes('[진행 중 (Agent: 에이전트-1)]'));
    assert.strictEqual(mdStore.getTask(tKo.code).owner, '에이전트-1');

    fs.appendFileSync(
      taskFile,
      '- [ ] **TSK-M2K9Q4. Owner property line**\n  - **Owner**: explicit-prop-agent\n',
      'utf-8'
    );
    const parsedWithProp = parseTaskMdFile(taskFile).find((t) => t.code === 'TSK-M2K9Q4');
    assert.ok(parsedWithProp && parsedWithProp.owner === 'explicit-prop-agent', 'Explicit Owner line parsing failed');

    console.log('[PASS] 9. MarkdownProvider owner roundtrip & file-backed lease verified.');
  } finally {
    if (mdStore) mdStore.close();
    fs.rmSync(mdDir, { recursive: true, force: true });
  }
}

console.log('=== All SQLite storage unit & integration tests passed (0 errors) ===\n');

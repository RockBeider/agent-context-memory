/**
 * tests/sqlite-storage.test.cjs
 *
 * Phase 1 (TSK-18): 스토리지 추상화 코어, node:sqlite + FTS5 엔진, Markdown 브리지 및 group-status.cjs 연동 검증
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execSync, spawnSync } = require('child_process');

const {
  generateUlid,
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  normalizeTaskStatus,
  toDisplayStatus,
  toMarkdownCheckbox,
} = require('../scripts/storage/id-utils.cjs');
const { saveConfig, loadConfig } = require('../scripts/storage/config.cjs');
const { createMemoryStore } = require('../scripts/storage/memory-store.cjs');
const { SqliteProvider } = require('../scripts/storage/sqlite-provider.cjs');
const {
  importMarkdownToStore,
  exportStoreToMarkdown,
  parseTaskMdFile,
  parseTaskCompletedMdFile,
  parsePatternsFromMd,
  parseAdrsFromMd,
} = require('../scripts/storage/markdown-bridge.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('=== ACM 로컬 SQLite 스토리지 및 커밋 엔진 연동 테스트 시작 ===');

// ---------------------------------------------------------------------------
// 1. ULID 단조성, 코드 포맷터 및 상태 양방향 매퍼 검증
// ---------------------------------------------------------------------------
{
  const ulids = [];
  for (let i = 0; i < 100; i++) {
    ulids.push(generateUlid(1763860000000));
  }
  for (let i = 1; i < ulids.length; i++) {
    assert.strictEqual(ulids[i].length, 26, 'ULID 길이는 26자여야 함');
    assert.ok(ulids[i] > ulids[i - 1], `ULID 단조 증가 실패: ${ulids[i - 1]} >= ${ulids[i]}`);
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

  assert.strictEqual(normalizeTaskStatus('진행 대기'), 'todo');
  assert.strictEqual(normalizeTaskStatus('진행 중'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('진행 중 (Agent: sub-1)'), 'in_progress');
  assert.strictEqual(normalizeTaskStatus('커밋 대기'), 'ready');
  assert.strictEqual(normalizeTaskStatus('x'), 'done');
  assert.strictEqual(normalizeTaskStatus('완료'), 'done');
  assert.strictEqual(normalizeTaskStatus('보류'), 'paused');

  assert.strictEqual(toDisplayStatus('ready'), '커밋 대기');
  assert.strictEqual(toMarkdownCheckbox('done'), 'x');
  assert.strictEqual(toMarkdownCheckbox('todo'), ' ');
  console.log('[통과] 1. ULID 단조성, 코드 포맷터 및 상태 양방향 매핑 확인.');
}

// ---------------------------------------------------------------------------
// 2~5. SqliteProvider CRUD, 3요소 검증, 패턴 버전 체인, FTS5 BM25 검색, Lease 검증
// ---------------------------------------------------------------------------
{
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-sqlite-unit-'));
  let store = null;
  try {
    saveConfig(tempDbDir, { storage: { provider: 'sqlite', markdownProjection: false } });
    store = createMemoryStore(tempDbDir);
    assert.strictEqual(store.providerName, 'sqlite', 'sqlite 프로바이더 선택 실패');

    // 2-1. ready 3요소 누락 차단
    assert.throws(
      () => store.upsertTask({ title: '검증 누락 작업', status: 'ready', purpose: '목적만 있음' }),
      /누락 항목.*수행결과.*대상영역/,
      '[커밋 대기] 3요소 누락 시 오류가 발생해야 함'
    );

    // 2-2. Task 생성 및 자동 채번 (TSK-1, TSK-2)
    const t1 = store.upsertTask({
      title: 'SQLite FTS5 인덱스 구축',
      status: 'in_progress',
      purpose: '로컬 메모리 검색 성능을 개선한다.',
      results: ['scripts/storage/sqlite-provider.cjs: FTS5 가상 테이블 구축'],
      targets: ['scripts/storage/sqlite-provider.cjs'],
    });
    assert.strictEqual(t1.code, 'TSK-1');
    assert.strictEqual(t1.status, 'in_progress');

    const t2 = store.upsertTask({
      title: 'group-status.cjs 커밋 연동',
      status: 'ready',
      purpose: 'SQLite 기반 원자적 커밋 및 자동 이관을 연동한다.',
      results: ['scripts/group-status.cjs: DB 연동 분기 추가'],
      targets: ['scripts/group-status.cjs'],
    });
    assert.strictEqual(t2.code, 'TSK-2');
    assert.strictEqual(t2.status, 'ready');

    // 2-3. ADR 생성 (LOG-01)
    const adr1 = store.upsertAdr({
      date: '2026-11-23',
      title: '로컬 SQLite 우선 저장소 전환',
      summary: 'node:sqlite 및 FTS5를 기본 로컬 저장소로 채택',
      relatedArea: 'scripts/storage/, scripts/group-status.cjs',
      relatedTaskCode: 'TSK-18',
      branch: 'main',
      context: '기존 마크다운 파싱 결합도 및 협업 충돌 해소 필요',
      decision: 'SQLite 로컬 정본 및 어댑터 추상화 도입',
      impact: '검색 속도 향상 및 Git 협업 기반 확보',
    });
    assert.strictEqual(adr1.code, 'LOG-01');

    // 3. 패턴 생성(v1) 및 supersedesUid 업그레이드(v2)
    const p1 = store.upsertPattern({
      category: 'Git/도구',
      title: 'Git Pager 프리징 방지 v1',
      summary: 'Git 명령 실행 시 pager 비활성화',
      symptom: '비대화형 쉘에서 git diff 프리징',
      solution: 'GIT_PAGER=cat 환경변수 주입',
      relatedFiles: ['scripts/group-status.cjs'],
      tags: ['git', 'pager'],
    });
    assert.strictEqual(p1.code, 'P-01');
    assert.strictEqual(p1.version, 1);

    const p2 = store.upsertPattern({
      supersedesUid: p1.uid,
      category: 'Git/도구',
      title: 'Git Pager 프리징 방지 v2 (확장)',
      summary: 'GIT_PAGER=cat 및 --no-pager 병행 강제',
      symptom: 'Windows 환경에서 pager 프로세스 잔존 데드락',
      solution: 'GIT_PAGER=cat, PAGER=cat, --no-pager 플래그를 모든 spawn에 적용',
      relatedFiles: ['scripts/group-status.cjs', 'scripts/smart-pull.cjs'],
      tags: ['git', 'pager', 'windows'],
    });
    assert.strictEqual(p2.code, 'P-02');
    assert.strictEqual(p2.version, 2);
    assert.strictEqual(p2.supersedesUid, p1.uid);

    const activePatterns = store.listPatterns();
    assert.strictEqual(activePatterns.length, 1, '대체된 v1 패턴은 기본 목록에서 제외되어야 함');
    assert.strictEqual(activePatterns[0].uid, p2.uid);

    const allPatterns = store.listPatterns({ includeSuperseded: true });
    assert.strictEqual(allPatterns.length, 2, 'includeSuperseded 옵션 시 v1/v2 모두 조회되어야 함');

    // 4. FTS5 BM25 검색 (특수문자, 한글, kind 필터, tokenBudget, 대체 버전 제외)
    const pagerHits = store.search('pager', { kind: 'pattern' });
    assert.strictEqual(pagerHits.length, 1, 'FTS5 검색에서도 대체된 v1은 제외되고 v2만 반환되어야 함');
    assert.strictEqual(pagerHits[0].uid, p2.uid);

    const specialCharHits1 = store.search('TSK-1');
    assert.ok(specialCharHits1.some((h) => h.code === 'TSK-1'), '하이픈 포함 코드 검색 실패');

    const specialCharHits2 = store.search('scripts/group-status.cjs');
    assert.ok(specialCharHits2.length >= 2, '슬래시/점 포함 파일 경로 FTS5 검색 실패');

    const specialCharHits3 = store.search('P-02');
    assert.ok(specialCharHits3.some((h) => h.code === 'P-02'), 'P-02 코드 검색 실패');

    const koreanHits = store.search('원자적 커밋');
    assert.ok(koreanHits.some((h) => h.code === 'TSK-2'), '한글 검색 실패');

    const budgetHits = store.search('scripts/group-status.cjs', { tokenBudget: 120 });
    const totalPackedTokens = budgetHits.reduce((acc, h) => acc + h.estimatedTokens, 0);
    assert.ok(totalPackedTokens <= 120, `토큰 예산 초과: ${totalPackedTokens} > 120`);

    // 5. Lease 점유 / 타 에이전트 차단 / 해제 검증
    const lease1 = store.acquireLease('TSK-1', 'agent-alpha', 300);
    assert.strictEqual(lease1.acquired, true);

    const leaseConflict = store.acquireLease('TSK-1', 'agent-beta', 300);
    assert.strictEqual(leaseConflict.acquired, false);
    assert.strictEqual(leaseConflict.holder, 'agent-alpha');

    const badRelease = store.releaseLease('TSK-1', 'agent-beta');
    assert.strictEqual(badRelease.released, false);

    const goodRelease = store.releaseLease('TSK-1', 'agent-alpha');
    assert.strictEqual(goodRelease.released, true);

    const leaseAfterRelease = store.acquireLease('TSK-1', 'agent-beta', 300);
    assert.strictEqual(leaseAfterRelease.acquired, true);

    console.log('[통과] 2~5. CRUD, 3요소 검증, 패턴 버전 체인, FTS5 특수문자/한글/예산 검색 및 Lease 검증 완료.');
  } finally {
    if (store) store.close();
    fs.rmSync(tempDbDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. Markdown <-> SQLite 왕복 무손실 마이그레이션 및 샘플 비유입 검증
// ---------------------------------------------------------------------------
{
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-md-roundtrip-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-md-export-'));
  let storeA = null;
  let storeB = null;

  try {
    // 6-1. 실제 저장소의 .agents/ 자산을 임시 폴더로 복사하여 실전 파싱 검증
    fs.cpSync(path.join(ROOT_DIR, '.agents'), path.join(fixtureDir, '.agents'), { recursive: true });
    // 비오염 샘플(TSK-SAMPLE, P-00, LOG-00)이 포함된 task.md 일부 보강 시뮬레이션
    const taskMdPath = path.join(fixtureDir, '.agents', 'task', 'task.md');
    const origTaskMd = fs.readFileSync(taskMdPath, 'utf-8');
    const augmentedTaskMd = [
      origTaskMd,
      '',
      '> ```markdown',
      '> - [커밋 대기] **TSK-SAMPLE. (샘플 예시) 코드블록 샘플**',
      '>   - **목적**: 제외 대상 샘플',
      '>   - **수행결과**:',
      '>     - `sample.js`: 무시됨',
      '>   - **대상영역**: `sample.js`',
      '> ```',
      '- [진행 중] **TSK-99. 왕복 테스트용 활성 작업**',
      '  - **목적**: Markdown에서 SQLite로 무손실 적재 후 재내보내기 검증',
      '  - **수행결과**:',
      '    - `src/roundtrip.cjs`: 양방향 변환 검증',
      '  - **대상영역**: `src/roundtrip.cjs`',
    ].join('\n');
    fs.writeFileSync(taskMdPath, augmentedTaskMd, 'utf-8');
    fs.copyFileSync(
      path.join(ROOT_DIR, 'acm-template', '.agents', 'memory', 'patterns', 'P-00-sample-pattern.md'),
      path.join(fixtureDir, '.agents', 'memory', 'patterns', 'P-00-sample-pattern.md')
    );

    saveConfig(fixtureDir, { storage: { provider: 'sqlite', markdownProjection: false } });
    storeA = new SqliteProvider(fixtureDir).open();
    const importRes = importMarkdownToStore(fixtureDir, storeA);
    assert.ok(importRes.tasks >= 1, '활성 태스크가 적재되지 않음');
    assert.ok(importRes.completedTasks >= 1, '완료 태스크가 적재되지 않음');
    assert.ok(importRes.patterns >= 2, '패턴(P-01, P-02)이 적재되지 않음');
    assert.ok(importRes.adrs >= 2, 'ADR(LOG-01, LOG-02)이 적재되지 않음');

    const tasksA = storeA.listTasks({ includeDone: true });
    const patternsA = storeA.listPatterns();
    const adrsA = storeA.listAdrs();
    assert.ok(!tasksA.some((t) => t.code.includes('SAMPLE') || t.code === 'TSK-0'), '샘플 태스크가 유입됨');
    assert.ok(!patternsA.some((p) => p.code === 'P-00'), 'P-00 샘플이 유입됨');
    assert.ok(!adrsA.some((a) => a.code === 'LOG-00'), 'LOG-00 샘플이 유입됨');

    // SQLite -> Markdown 내보내기 -> 신규 SQLite DB로 재적재
    exportStoreToMarkdown(exportDir, storeA);

    const parsedActive = parseTaskMdFile(path.join(exportDir, '.agents', 'task', 'task.md'));
    const parsedDone = parseTaskCompletedMdFile(path.join(exportDir, '.agents', 'task', 'task-completed.md'));
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
    assert.strictEqual(storeB.getPattern('P-01').title, storeA.getPattern('P-01').title);
    assert.strictEqual(storeB.getAdr('LOG-02').title, storeA.getAdr('LOG-02').title);

    console.log('[통과] 6. Markdown <-> SQLite 왕복 무손실 마이그레이션 및 샘플 비유입 검증 완료.');
  } finally {
    if (storeA) storeA.close();
    if (storeB) storeB.close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. Git 임시 저장소에서 group-status.cjs SQLite 연동 및 자동 이관/투영 E2E 검증
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
      storage: { provider: 'sqlite', dbPath: '.agents/local/memory.db', markdownProjection: true },
    });
    const loadedCfg = loadConfig(gitDir);
    assert.strictEqual(loadedCfg.explicit, true);
    assert.strictEqual(loadedCfg.storage.provider, 'sqlite');

    store = createMemoryStore(gitDir);
    store.upsertTask({
      title: 'SQLite 연동 기능 파일 커밋',
      status: 'ready',
      purpose: 'group-status.cjs가 SQLite DB에서 태스크를 읽고 커밋 SHA를 기록하는지 검증한다.',
      results: ['src/feature.js: 신규 모듈 작성 및 검증 완료'],
      targets: ['src/feature.js'],
    });
    store.close();
    store = null;

    fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'src', 'feature.js'), 'module.exports = () => 42;\n', 'utf-8');

    const groupStatusPath = path.join(ROOT_DIR, 'scripts', 'group-status.cjs');
    const compactRes = spawnSync(process.execPath, [groupStatusPath, '--compact'], {
      cwd: gitDir,
      env: { ...process.env, ACM_ROOT_DIR: gitDir },
      encoding: 'utf-8',
    });
    assert.strictEqual(compactRes.status, 0, `group-status --compact 실패: ${compactRes.stderr || compactRes.stdout}`);
    assert.ok(compactRes.stdout.includes('TSK-1'), 'compact 출력에 SQLite TSK-1 누락');

    const commitRes = spawnSync(process.execPath, [groupStatusPath, '--all'], {
      cwd: gitDir,
      env: { ...process.env, ACM_ROOT_DIR: gitDir },
      encoding: 'utf-8',
    });
    assert.strictEqual(commitRes.status, 0, `group-status --all 실패: ${commitRes.stderr || commitRes.stdout}`);

    const cleanStatus = execSync('git status --porcelain', { cwd: gitDir, encoding: 'utf-8' });
    assert.strictEqual(cleanStatus.trim(), '', `커밋 후 워킹 트리가 깨끗하지 않음: ${cleanStatus}`);
    const headSha = execSync('git rev-parse --short HEAD', { cwd: gitDir, encoding: 'utf-8' }).trim();

    verifyStore = createMemoryStore(gitDir, { skipProjection: true });
    const doneTask = verifyStore.getTask('TSK-1');
    assert.strictEqual(doneTask.status, 'done', '커밋 후 SQLite 태스크 상태가 done이 아님');
    assert.strictEqual(doneTask.commitSha, headSha, '커밋 후 SQLite commit_sha가 HEAD SHA와 불일치');
    assert.ok(doneTask.completedAt, 'completedAt 미기록');
    verifyStore.close();
    verifyStore = null;

    const projectedTaskMd = fs.readFileSync(path.join(gitDir, '.agents', 'task', 'task.md'), 'utf-8');
    const projectedCompMd = fs.readFileSync(path.join(gitDir, '.agents', 'task', 'task-completed.md'), 'utf-8');
    assert.ok(projectedTaskMd.includes('(현재 진행 중인 활성 작업 없음)'), '투영된 task.md 비우기 누락');
    assert.ok(projectedTaskMd.includes('최근 완료: `TSK-1`'), '투영된 task.md 메타 헤더 미갱신');
    assert.ok(
      projectedCompMd.includes(`- [x] **TSK-1. SQLite 연동 기능 파일 커밋** (Commit: \`${headSha}\`)`),
      '투영된 task-completed.md 완료 SHA 누락'
    );

    console.log('[통과] 7. Git 저장소 group-status.cjs SQLite 연동, 원자 커밋 및 MD 투영 E2E 검증 완료.');
  } finally {
    if (store) store.close();
    if (verifyStore) verifyStore.close();
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

console.log('=== 모든 SQLite 스토리지 단위 및 통합 테스트 통과 (0 errors) ===\n');

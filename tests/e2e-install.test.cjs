/**
 * tests/e2e-install.test.cjs
 *
 * Agent Context Memory 통합 및 배포 사전 검증 테스트 러너
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== Agent Context Memory 배포 검증 테스트 시작 ===');

const ROOT_DIR = path.resolve(__dirname, '..');

// 1. 필수 배포 파일 실존 여부 검증
const requiredFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'AGENTS.md',
  'bin/agent-context-memory.js',
  'scripts/install-template.cjs',
  'scripts/uninstall-template.cjs',
  'scripts/acm-manifest.cjs',
  'scripts/group-status.cjs',
  'scripts/smart-pull.cjs',
  'scripts/audit-push.cjs',
  'scripts/check-git.cjs',
  'scripts/sync-agent-rules.cjs',
  'scripts/storage/id-utils.cjs',
  'scripts/storage/config.cjs',
  'scripts/storage/memory-store.cjs',
  'scripts/storage/sqlite-provider.cjs',
  'scripts/storage/markdown-bridge.cjs',
  'scripts/storage/markdown-provider.cjs',
  '.agents/MEMORY_GOVERNANCE.md',
  '.agents/rules/60-task-memory-adr.md',
  '.agents/agents/git-release-sentinel.md',
  '.agents/agents/context-compactor.md',
  '.agents/skills/git-workflow/SKILL.md',
  '.agents/scripts/token-monitor.cjs',
  '.agents/hooks.json',
  'acm-template/AGENTS.md',
  'acm-template/.agents/MEMORY_GOVERNANCE.md',
  'acm-template/.agents/rules/60-task-memory-adr.md',
  'acm-template/.agents/agents/git-release-sentinel.md',
  'acm-template/.agents/agents/context-compactor.md',
  'acm-template/.agents/skills/git-workflow/SKILL.md',
  'acm-template/.agents/scripts/token-monitor.cjs',
  'acm-template/.agents/hooks.json',
  'acm-template/.agents/task/task.md',
  'acm-template/.agents/task/task-completed.md',
  'acm-template/.agents/memory/patterns/P-00-sample-pattern.md',
  'acm-template/scripts/acm-manifest.cjs',
  'acm-template/scripts/audit-push.cjs',
  'acm-template/scripts/check-git.cjs',
  'acm-template/scripts/group-status.cjs',
  'acm-template/scripts/smart-pull.cjs',
  'acm-template/scripts/sync-agent-rules.cjs',
  'acm-template/scripts/uninstall-template.cjs',
  'acm-template/scripts/storage/id-utils.cjs',
  'acm-template/scripts/storage/config.cjs',
  'acm-template/scripts/storage/memory-store.cjs',
  'acm-template/scripts/storage/sqlite-provider.cjs',
  'acm-template/scripts/storage/markdown-bridge.cjs',
  'acm-template/scripts/storage/markdown-provider.cjs',
];

for (const rel of requiredFiles) {
  const fullPath = path.join(ROOT_DIR, rel);
  assert.ok(fs.existsSync(fullPath), `필수 파일 누락: ${rel}`);
}
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'rules')),
  '외부 rules/ 디렉터리가 잔존함 (.agents/MEMORY_GOVERNANCE.md로 이전되어야 함)'
);
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'acm-template/rules')),
  '템플릿 외부 rules/ 디렉터리가 잔존함'
);
assert.ok(
  !fs.existsSync(path.join(ROOT_DIR, 'acm-template/.agents/memory/patterns/P-01-git-pager-freeze-fix.md')),
  '템플릿에 실제 번호 패턴 파일(P-01)이 잔존함'
);

const normalizeEol = (s) => s.replace(/\r\n/g, '\n');
const sharedScripts = [
  'acm-manifest.cjs',
  'audit-push.cjs',
  'check-git.cjs',
  'group-status.cjs',
  'smart-pull.cjs',
  'sync-agent-rules.cjs',
  'uninstall-template.cjs',
  'storage/id-utils.cjs',
  'storage/config.cjs',
  'storage/memory-store.cjs',
  'storage/sqlite-provider.cjs',
  'storage/markdown-bridge.cjs',
  'storage/markdown-provider.cjs',
];
for (const scriptName of sharedScripts) {
  const rootContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'scripts', scriptName), 'utf-8'));
  const tplContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'acm-template', 'scripts', scriptName), 'utf-8'));
  assert.strictEqual(tplContent, rootContent, `루트와 acm-template 스크립트 불일치: ${scriptName}`);
}

const sharedAgentFiles = [
  'MEMORY_GOVERNANCE.md',
  'rules/60-task-memory-adr.md',
  'agents/git-release-sentinel.md',
  'agents/context-compactor.md',
  'skills/git-workflow/SKILL.md',
  'scripts/token-monitor.cjs',
  'hooks.json',
];
for (const relAgent of sharedAgentFiles) {
  const rootContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, '.agents', relAgent), 'utf-8'));
  const tplContent = normalizeEol(fs.readFileSync(path.join(ROOT_DIR, 'acm-template', '.agents', relAgent), 'utf-8'));
  assert.strictEqual(tplContent, rootContent, `루트와 acm-template .agents 파일 불일치: ${relAgent}`);
}
console.log('[통과] 필수 배포 파일 실존, 템플릿 비오염 샘플 및 1:1 정본 동기화 확인 완료.');

// 2. package.json 유효성 검증
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
assert.strictEqual(pkg.name, 'agent-context-memory', 'package.json name 불일치');
assert.strictEqual(pkg.license, 'MIT', 'package.json license 불일치');
assert.ok(pkg.files.includes('LICENSE'), 'files 화이트리스트에 LICENSE 누락');
assert.ok(pkg.repository, 'repository 필드 누락');
assert.ok(pkg.publishConfig, 'publishConfig 필드 누락');
assert.ok(pkg.dependencies && pkg.dependencies['@clack/prompts'], '@clack/prompts 의존성 누락');
console.log('[통과] package.json 배포 메타데이터 및 @clack/prompts 의존성 확인 완료.');

// 3. LICENSE 일치 검증
const license = fs.readFileSync(path.join(ROOT_DIR, 'LICENSE'), 'utf-8');
assert.ok(license.includes('MIT License'), 'LICENSE 파일 내 MIT License 명기 누락');
assert.ok(license.includes('Rock Beider'), 'LICENSE 저작권자 명기 누락');
console.log('[통과] LICENSE 무결성 확인 완료.');

// 4. Git 환경 동적 E2E 라이프사이클 시뮬레이션 (init -> check-git -> status -> commit & autoCompleteTask -> uninstall -> postinstall -> clack)
const os = require('os');
const { PassThrough } = require('stream');
const { spawnSync, execSync } = require('child_process');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-git-e2e-'));
console.log(`\n[준비] 가상 Git 호스트 프로젝트 생성: ${tempDir}`);

async function runTests() {
  try {
  // 4-1. Git 저장소 초기화 및 초기 커밋
  execSync('git init', { cwd: tempDir, stdio: 'ignore' });
  execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'dummy-git-app', version: '1.0.0', scripts: {} }, null, 2)
  );
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# Dummy Git App\n');

  execSync('git add . && git commit -m "chore: initial commit"', { cwd: tempDir, stdio: 'ignore' });
  console.log('[통과] 가상 Git 저장소 및 초기 베이스라인 커밋 완료.');

  // 4-2. 무인자(기본 init) CLI 실행 및 자산 주입 검증
  console.log('[단계 1] npx agent-context-memory (--force, init 생략 무인자/플래그 직결) 실행');
  const initRes = spawnSync(process.execPath, [CLI_PATH, '--force', '--non-interactive'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(initRes.status, 0, `무인자 init 실패: ${initRes.stderr || initRes.stdout}`);
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'task', 'task.md')), '.agents/task/task.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'rules', '60-task-memory-adr.md')), '60-task-memory-adr.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'agents', 'git-release-sentinel.md')), 'git-release-sentinel.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'memory', 'patterns', 'P-00-sample-pattern.md')), 'P-00-sample-pattern.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'MEMORY_GOVERNANCE.md')), '.agents/MEMORY_GOVERNANCE.md 미생성');
  assert.ok(!fs.existsSync(path.join(tempDir, 'rules')), '호스트 루트에 외부 rules/ 폴더가 생성됨');
  assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'AGENTS.md 미생성');

  const gitignoreContent = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
  assert.ok(gitignoreContent.includes('.agents/'), '.gitignore에 .agents/ 누락');

  const injectedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
  assert.ok(injectedPkg.scripts['git:status'], 'git:status 스크립트 미주입');
  assert.ok(injectedPkg.scripts['git:commit'], 'git:commit 스크립트 미주입');
  console.log('[통과] 무인자 CLI(init 생략) 자산 생성, .gitignore(.agents/) 주입 및 package.json 스크립트 확인.');

  // 4-3. check-git 실행 및 상태 진단 검증
  console.log('[단계 2] npx agent-context-memory check-git 실행');
  const checkGitRes = spawnSync(process.execPath, [CLI_PATH, 'check-git'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(checkGitRes.status, 0, `check-git 실패: ${checkGitRes.stderr || checkGitRes.stdout}`);
  assert.ok(
    checkGitRes.stdout.includes('Git 저장소 연동 활성화') || checkGitRes.stdout.includes('감지됨'),
    'check-git 정상 연동 문구 누락'
  );
  console.log('[통과] check-git 진단 엔진 정상 확인.');

  // 4-4. status --compact 실행 (신규 주입 파일 감지 및 TSK-SAMPLE 코드블록 비오염 확인)
  console.log('[단계 3] npx agent-context-memory status --compact 실행');
  const statusRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(statusRes.status, 0, `status 실패: ${statusRes.stderr || statusRes.stdout}`);
  assert.ok(statusRes.stdout.includes('작업 단위 커밋 현황'), 'status 작업 단위 현황 헤더 누락');
  assert.ok(!statusRes.stdout.includes('TSK-SAMPLE'), '코드블록 샘플(TSK-SAMPLE)이 실제 작업으로 잘못 파싱됨');
  console.log('[통과] status 작업 단위 감지 및 비오염 샘플 파싱 제외 확인.');

  // 4-5. [커밋 대기] 미등록 상태에서 commit 실행 시 안전 차단 검증
  console.log('[단계 4-1] [커밋 대기] 미등록 상태에서 commit 안전 차단 검증');
  const blockedCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(blockedCommitRes.status, 1, '[커밋 대기] 태스크가 없는데 commit이 차단되지 않음');
  assert.ok(
    (blockedCommitRes.stderr || blockedCommitRes.stdout).includes('[커밋 대기]'),
    '[커밋 대기] 등록 안내 메시지 누락'
  );
  console.log('[통과] [커밋 대기] 미등록 시 오커밋 방지 게이트 정상 작동 확인.');

  // 4-6. task.md에 TSK-1 [커밋 대기] 등록 후 원스톱 commit 및 task-completed.md 자동 이관 검증
  console.log('[단계 4-2] TSK-1 [커밋 대기] 등록 후 commit 및 autoCompleteTask 자동 이관 검증');
  const initialTaskMd = fs.readFileSync(path.join(tempDir, '.agents', 'task', 'task.md'), 'utf-8');
  const updatedTaskMd = initialTaskMd.replace(
    '(현재 진행 중인 활성 작업 없음)',
    [
      '### [ACM 초기 온보딩]',
      '- [커밋 대기] **TSK-1. 초기 ACM 온보딩 설정 및 거버넌스 스크립트 반영**',
      '  - **등록일**: 2026-11-09',
      '  - **목적**: 프로젝트에 Agent Context Memory 거버넌스 및 실행 스크립트를 도입한다.',
      '  - **수행결과**:',
      '    - `AGENTS.md`: ACM 거버넌스 가드레일 마커 블록 주입',
      '    - `scripts/`: 작업 단위 커밋 및 스마트 풀 스크립트 설치',
      '  - **대상영역**: `package.json`, `AGENTS.md`, `.gitignore`, `scripts/`',
    ].join('\n')
  );
  fs.writeFileSync(path.join(tempDir, '.agents', 'task', 'task.md'), updatedTaskMd, 'utf-8');

  const commitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(commitRes.status, 0, `commit 실패: ${commitRes.stderr || commitRes.stdout}`);
  const postStatus = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
  assert.strictEqual(postStatus.trim(), '', `커밋 후 워킹 트리가 깨끗하지 않음: ${postStatus}`);

  const afterTaskMd = fs.readFileSync(path.join(tempDir, '.agents', 'task', 'task.md'), 'utf-8');
  const afterCompletedMd = fs.readFileSync(path.join(tempDir, '.agents', 'task', 'task-completed.md'), 'utf-8');
  assert.ok(afterTaskMd.includes('(현재 진행 중인 활성 작업 없음)'), '커밋 후 task.md에서 TSK-1이 제거되지 않음');
  assert.ok(afterTaskMd.includes('최근 완료: `TSK-1`'), 'task.md 상단 메타 라인(최근 완료: TSK-1) 미갱신');
  assert.ok(afterTaskMd.includes('차기 예정: `TSK-2`'), 'task.md 상단 메타 라인(차기 예정: TSK-2) 미갱신');
  assert.ok(
    afterCompletedMd.includes('- [x] **TSK-1. 초기 ACM 온보딩 설정 및 거버넌스 스크립트 반영** (Commit: `'),
    'task-completed.md에 TSK-1 완료 내역 및 커밋 SHA가 자동 이관되지 않음'
  );
  console.log('[통과] commit 실행, 워킹 트리 완전 정돈 및 task-completed.md 무인 자동 이관 확인.');

  // 4-7. uninstall --force 실행 (안전 롤백 검증)
  console.log('[단계 5] npx agent-context-memory uninstall --force 실행');
  const uninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(uninstallRes.status, 0, `uninstall 실패: ${uninstallRes.stderr || uninstallRes.stdout}`);
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), '.agents 미삭제');

  // 백업 디렉터리 생성 여부 검증
  const files = fs.readdirSync(tempDir);
  const backupDir = files.find((f) => f.startsWith('.agents_backup_') || f.includes('backup'));
  assert.ok(backupDir, 'uninstall 백업 디렉터리 미생성');
  console.log(`[통과] uninstall 안전 롤백 및 백업 디렉터리(${backupDir}) 생성 확인.`);

  // 4-8. npm postinstall 자동 초기화 및 4대 안전 가드 검증
  console.log('[단계 6] npm postinstall 훅(INIT_CWD 자동 주입 및 안전 가드) 검증');
  const { runPostInstall } = require('../scripts/install-template.cjs');

  // 가드 1: 자체 저장소 루트 가드
  const selfGuardRes = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'install-template.cjs'), '--postinstall'],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, INIT_CWD: ROOT_DIR },
      encoding: 'utf-8',
    }
  );
  assert.strictEqual(selfGuardRes.status, 0, '자체 저장소 postinstall 가드 오류');

  // 가드 2: npx exec 중복 실행 가드
  const execGuardRes = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'install-template.cjs'), '--postinstall'],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', INIT_CWD: tempDir, npm_command: 'exec' },
      encoding: 'utf-8',
    }
  );
  assert.strictEqual(execGuardRes.status, 0, 'npx exec 가드 실패');
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'npm_command=exec일 때 postinstall이 실행되면 안 됨');

  // 가드 3: CI 환경 및 npm ci 가드
  const ciGuardRes = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'install-template.cjs'), '--postinstall'],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, CI: 'true', INIT_CWD: tempDir, npm_command: 'install' },
      encoding: 'utf-8',
    }
  );
  assert.strictEqual(ciGuardRes.status, 0, 'CI=true 가드 실패');
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'CI=true일 때 postinstall이 실행되면 안 됨');

  const npmCiGuardRes = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'install-template.cjs'), '--postinstall'],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', INIT_CWD: tempDir, npm_command: 'ci' },
      encoding: 'utf-8',
    }
  );
  assert.strictEqual(npmCiGuardRes.status, 0, 'npm ci 가드 실패');
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), 'npm_command=ci일 때 postinstall이 실행되면 안 됨');

  // 정상 postinstall 실행: 호스트 프로젝트(tempDir)에 자동 주입 (호스트 package.json 무변조 검증 포함)
  const beforePostinstallPkg = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8');
  const postInstallRes = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'install-template.cjs'), '--postinstall'],
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
      },
      encoding: 'utf-8',
    }
  );
  assert.strictEqual(postInstallRes.status, 0, `postinstall 실행 실패: ${postInstallRes.stderr || postInstallRes.stdout}`);
  assert.ok(
    fs.existsSync(path.join(tempDir, '.agents', 'task', 'task.md')),
    'postinstall 실행 후 호스트 프로젝트에 .agents/task/task.md 미생성'
  );
  assert.ok(
    fs.existsSync(path.join(tempDir, 'AGENTS.md')),
    'postinstall 실행 후 호스트 프로젝트에 AGENTS.md 미생성'
  );
  const afterPostinstallPkg = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8');
  assert.strictEqual(afterPostinstallPkg, beforePostinstallPkg, 'postinstall 실행 중 호스트 package.json이 변경됨');

  // 가드 4: 기설치 프로젝트 재실행 방지 가드
  const alreadyInstalledRes = await runPostInstall({
    CI: '',
    GITHUB_ACTIONS: '',
    INIT_CWD: tempDir,
    npm_command: 'install',
  });
  assert.strictEqual(alreadyInstalledRes.skipped, true, '이미 초기화된 프로젝트에서 postinstall이 건너뛰어지지 않음');
  assert.strictEqual(typeof runPostInstall, 'function', 'runPostInstall 함수 export 누락');
  console.log('[통과] npm postinstall 자동 초기화 및 CI/npm-ci/package.json 보호 가드 정상 작동 확인.');

  // 4-9. @clack/prompts 기반 대화형 방향키/체크박스 선택 및 취소/비대화형 폴백 검증
  console.log('[단계 7] @clack/prompts 다중 선택(방향키/Space/Enter), 취소 및 비대화형 폴백 검증');
  const { loadClack, promptCustomRuleFile, resolveTargetRuleFiles } = require('../scripts/sync-agent-rules.cjs');

  const clack = await loadClack();
  assert.ok(clack && typeof clack.multiselect === 'function', '@clack/prompts 동적 임포트 실패');
  assert.ok(typeof clack.intro === 'function' && typeof clack.spinner === 'function', '@clack/prompts UI API 누락');

  // 가상 TTY 스트림으로 방향키(아래) + Space(CLAUDE.md 토글) + Enter 시뮬레이션
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
    const selectPromise = promptCustomRuleFile({ input, output, silent: true });
    setTimeout(() => input.write('\x1b[B'), 40);
    setTimeout(() => input.write(' '), 80);
    setTimeout(() => input.write('\r'), 120);
    const selectedRules = await selectPromise;
    assert.deepStrictEqual(
      selectedRules,
      ['AGENTS.md', 'CLAUDE.md'],
      `Clack multiselect 반환 불일치: ${JSON.stringify(selectedRules)}`
    );
  }

  // 가상 TTY 스트림으로 Ctrl+C(\x03) 취소 처리 검증
  {
    const { input, output } = createMockTTY();
    const cancelPromise = promptCustomRuleFile({ input, output, silent: true });
    setTimeout(() => input.write('\x03'), 40);
    const cancelledResult = await cancelPromise;
    assert.strictEqual(cancelledResult, null, 'Clack 취소 시 null 반환이 아님');
  }

  // 비대화형(nonInteractive: true) 빈 디렉터리 자동 폴백 검증
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-empty-fallback-'));
  try {
    const fallbackFiles = await resolveTargetRuleFiles(emptyDir, { nonInteractive: true, silent: true });
    assert.deepStrictEqual(fallbackFiles, ['AGENTS.md'], '비대화형 환경 AGENTS.md 자동 폴백 실패');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
  console.log('[통과] @clack/prompts 동적 임포트, 방향키/스페이스바 다중 선택, 취소 및 비대화형 폴백 검증 완료.');

  // 4-10. 커스텀 규칙 파일(.acm-meta.json) 자동 롤백 및 group-status 공유/디렉터리 매칭 검증
  console.log('[단계 8] 커스텀 규칙 파일 자동 롤백 및 group-status 디렉터리/공유 태스크/경로 격리 커밋 검증');
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
    assert.strictEqual(customInitRes.status, 0, `커스텀 규칙 init 실패: ${customInitRes.stderr || customInitRes.stdout}`);
    const metaPath = path.join(customDir, '.agents', '.acm-meta.json');
    assert.ok(fs.existsSync(metaPath), '.agents/.acm-meta.json 미생성');

    // 커스텀 규칙 파일에 ACM 블록 주입 확인 후, --rule-file 없이 uninstall 시 자동 절삭 및 기존 내용/.gitignore 공백 보존 확인
    const injectedCopilot = fs.readFileSync(path.join(customDir, '.github', 'copilot-instructions.md'), 'utf-8');
    assert.ok(injectedCopilot.includes('ACM_GOVERNANCE_START'), '커스텀 규칙 파일 거버넌스 주입 누락');

    const customUninstallRes = spawnSync(
      process.execPath,
      [CLI_PATH, 'uninstall', '--force', '--no-backup'],
      { cwd: customDir, encoding: 'utf-8' }
    );
    assert.strictEqual(customUninstallRes.status, 0, `커스텀 규칙 uninstall 실패: ${customUninstallRes.stderr || customUninstallRes.stdout}`);
    const restoredCopilot = fs.readFileSync(path.join(customDir, '.github', 'copilot-instructions.md'), 'utf-8');
    assert.ok(!restoredCopilot.includes('ACM_GOVERNANCE_START'), '--rule-file 미지정 uninstall 시 커스텀 규칙 파일 거버넌스 블록이 남음');
    assert.ok(restoredCopilot.includes('# Existing Copilot Rule'), '커스텀 규칙 파일 기존 사용자 내용 훼손');
    const restoredGitignore = fs.readFileSync(path.join(customDir, '.gitignore'), 'utf-8').replace(/\r\n/g, '\n');
    assert.strictEqual(restoredGitignore, 'node_modules/\n\ndist/\n', '.gitignore 내 기존 빈 줄 구조 훼손');

    // group-status.cjs 디렉터리 슬래시 생략, 루트 파일명 과잉 매칭 차단, 공유 파일 [커밋 대기] 연쇄 이관 검증
    spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive'], { cwd: customDir, encoding: 'utf-8' });
    fs.writeFileSync(path.join(customDir, 'AGENTS.md'), '# Root Agents Updated\n');
    fs.writeFileSync(path.join(customDir, 'nested', 'AGENTS.md'), '# Nested Agents Updated\n');
    fs.writeFileSync(path.join(customDir, 'shared.txt'), 'v1\n');
    execSync('git add nested/AGENTS.md', { cwd: customDir, stdio: 'ignore' });

    const taskPath = path.join(customDir, '.agents', 'task', 'task.md');
    const baseTaskMd = fs.readFileSync(taskPath, 'utf-8');
    const dualTaskMd = baseTaskMd.replace(
      '(현재 진행 중인 활성 작업 없음)',
      [
        '- [커밋 대기] **TSK-1. 루트 파일 및 공유 파일 변경**',
        '  - **목적**: 루트 AGENTS.md 과잉 매칭 방지 및 TSK-2와 shared.txt 공유 검증',
        '  - **수행결과**:',
        '    - `AGENTS.md`, `shared.txt`: 내용 갱신',
        '  - **대상영역**: `AGENTS.md`, `shared.txt`, `scripts`, `.gitignore`, `package.json`',
        '- [커밋 대기] **TSK-2. 공유 파일 후행 태스크 이관 검증**',
        '  - **목적**: TSK-1과 shared.txt를 공유하는 후행 태스크의 자동 이관 검증',
        '  - **수행결과**:',
        '    - `shared.txt`: 연계 검증',
        '  - **대상영역**: `shared.txt`',
      ].join('\n')
    );
    fs.writeFileSync(taskPath, dualTaskMd, 'utf-8');

    const dualCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], { cwd: customDir, encoding: 'utf-8' });
    assert.strictEqual(dualCommitRes.status, 0, `공유/디렉터리 태스크 commit 실패: ${dualCommitRes.stderr || dualCommitRes.stdout}`);

    // 미리 staged 상태였던 nested/AGENTS.md가 TSK-1(AGENTS.md) 커밋에 섞이지 않고 워킹트리에 보존되어야 함
    const afterDualStatus = execSync('git status --porcelain', { cwd: customDir, encoding: 'utf-8' });
    assert.ok(afterDualStatus.includes('nested/AGENTS.md'), '루트 AGENTS.md 매칭 시 nested/AGENTS.md가 오매칭되어 함께 커밋됨');

    const afterDualCompleted = fs.readFileSync(path.join(customDir, '.agents', 'task', 'task-completed.md'), 'utf-8');
    assert.ok(afterDualCompleted.includes('**TSK-1.'), 'TSK-1 완료 이관 누락');
    assert.ok(afterDualCompleted.includes('**TSK-2.'), '공유 파일 후행 태스크 TSK-2 자동 이관 누락');
    console.log('[통과] 커스텀 규칙 자동 롤백, .gitignore 공백 보존, 루트 파일 격리 커밋 및 공유 태스크 이관 검증 완료.');
  } finally {
    fs.rmSync(customDir, { recursive: true, force: true });
  }

  // 4-11. 재검증 회귀 시나리오 (C1: git rm --cached 임시 인덱스 격리 커밋 / H1~H2: smart-pull 안전 병합 / L1: 기존 .gitignore 보존)
  console.log('[단계 9] C1(git rm --cached 격리 커밋), H1/H2(smart-pull JSX·함수 병합), L1(기존 .gitignore 보호) 회귀 검증');
  const { tryResolveJsxProps, tryResolveFunctionBlocks } = require('../scripts/smart-pull.cjs');
  assert.strictEqual(
    tryResolveJsxProps('<Button className="btn primary" onClick={a}>', '<Button className="btn primary" disabled>'),
    '<Button className="btn primary" disabled onClick={a}>',
    'H1 공백 포함 JSX 속성 안전 결합 실패'
  );
  assert.strictEqual(
    tryResolveJsxProps('<Button variant="primary">', '<Button variant="secondary">'),
    null,
    'H1 동명 속성값 충돌 시 null 반환 실패'
  );
  assert.strictEqual(
    tryResolveJsxProps('<Button className="btn primary">', '<Button className="btn secondary">'),
    null,
    'H1 공백 포함 동명 속성 충돌 시 null 반환 실패'
  );
  assert.strictEqual(
    tryResolveFunctionBlocks('if (a) { return 1; }', 'if (b) { return 2; }'),
    null,
    'H2 제어문(if) 메서드 오판 방어 실패'
  );
  assert.strictEqual(
    tryResolveFunctionBlocks('function foo() { return 1; }', 'function foo() { return 2; }'),
    null,
    'H2 동명 함수 중복 선언 방어 실패'
  );
  assert.strictEqual(
    tryResolveFunctionBlocks('function foo() {}', 'function bar() {}'),
    'function bar() {}\n\nfunction foo() {}',
    'H2 서로 다른 함수 블록 결합 실패'
  );

  const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-reg-c1-'));
  try {
    execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', { cwd: regDir, stdio: 'ignore' });
    fs.mkdirSync(path.join(regDir, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(regDir, '.agents', 'task'), { recursive: true });
    fs.writeFileSync(path.join(regDir, '.gitignore'), '.agents/\n');
    fs.writeFileSync(path.join(regDir, 'rules', 'MEM.md'), 'v1\n');
    fs.writeFileSync(path.join(regDir, '.agents', 'task', 'task.md'), '# Task\n');
    fs.writeFileSync(path.join(regDir, '.agents', 'task', 'task-completed.md'), '# Comp\n\n---\n(현재 완료 이관된 작업 없음)\n');
    execSync('git add -f . && git commit -m "chore: init"', { cwd: regDir, stdio: 'ignore' });

    // L1: 기존 .gitignore에 .agents/만 있던 상태에서 init -> uninstall 시 .gitignore 파일 자체는 보존되어야 함
    const l1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-reg-l1-'));
    try {
      execSync('git init && git config user.name "Test Runner" && git config user.email "test@example.com"', { cwd: l1Dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(l1Dir, '.gitignore'), '.agents/\n');
      execSync('git add .gitignore && git commit -m "init"', { cwd: l1Dir, stdio: 'ignore' });
      const l1Init = spawnSync(process.execPath, [CLI_PATH, 'init', '--force', '--non-interactive'], { cwd: l1Dir, encoding: 'utf-8' });
      assert.strictEqual(l1Init.status, 0, 'L1 init 실패');
      const l1Un = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], { cwd: l1Dir, encoding: 'utf-8' });
      assert.strictEqual(l1Un.status, 0, 'L1 uninstall 실패');
      assert.ok(fs.existsSync(path.join(l1Dir, '.gitignore')), 'L1 기존 사용자 .gitignore 파일이 임의 삭제됨');
    } finally {
      fs.rmSync(l1Dir, { recursive: true, force: true });
    }

    // C1: /.agents/task/ 앵커링 + git rm --cached .agents/task + RM + ?? 혼합 커밋 검증
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
        '- **식별자 규칙**: (최근 완료: `없음`, 현재 활성: `TSK-1, TSK-2`, 차기 예정: `TSK-3`)',
        '## 1. 활성 작업 목록',
        '- [커밋 대기] **TSK-1. RM 및 비추적 파일 커밋**',
        '  - **목적**: RM 및 신규 파일 커밋 검증',
        '  - **수행결과**:',
        '    - `.agents/MEM.md`: 이동 및 수정',
        '  - **대상영역**: `.agents/MEM.md`, `.agents/rules/`',
        '- [커밋 대기] **TSK-2. task 언트래킹 및 gitignore 커밋**',
        '  - **목적**: git rm --cached 커밋 검증',
        '  - **수행결과**:',
        '    - `.gitignore`: 루트 앵커링',
        '  - **대상영역**: `.gitignore`, `.agents/task/task.md`, `.agents/task/task-completed.md`',
      ].join('\n'),
      'utf-8'
    );

    const regCommitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], { cwd: regDir, encoding: 'utf-8' });
    assert.strictEqual(regCommitRes.status, 0, `C1 commit 실패: ${regCommitRes.stderr || regCommitRes.stdout}`);

    const regPostStatus = execSync('git status --porcelain=v1 -uall', { cwd: regDir, encoding: 'utf-8' });
    assert.strictEqual(regPostStatus.trim(), '', `C1 커밋 후 워킹 트리가 깨끗하지 않음:\n${regPostStatus}`);
    const trackedTaskFiles = execSync('git ls-files .agents/task', { cwd: regDir, encoding: 'utf-8' });
    assert.strictEqual(trackedTaskFiles.trim(), '', 'C1 .agents/task/ 파일이 Git에 다시 추적됨');
    assert.ok(fs.existsSync(path.join(regDir, '.agents', 'task', 'task.md')), 'C1 로컬 task.md 파일이 삭제됨');
  } finally {
    fs.rmSync(regDir, { recursive: true, force: true });
  }
  console.log('[통과] C1(임시 인덱스 격리 커밋), H1/H2(smart-pull 안전 병합), L1(기존 .gitignore 보호) 회귀 검증 완료.');

  console.log('=== 모든 기본 무결성 및 Git E2E 테스트 통과 (0 errors) ===\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[정리] 임시 Git 테스트 디렉터리 정리 완료: ${tempDir}`);
    } catch (e) {}
  }
}

runTests().catch((err) => {
  console.error('[테스트 실패]', err);
  process.exit(1);
});

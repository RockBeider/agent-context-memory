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
  'rules/MEMORY_GOVERNANCE.md',
];

for (const rel of requiredFiles) {
  const fullPath = path.join(ROOT_DIR, rel);
  assert.ok(fs.existsSync(fullPath), `필수 파일 누락: ${rel}`);
}
console.log('[통과] 필수 배포 파일 실존 확인 완료.');

// 2. package.json 유효성 검증
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
assert.strictEqual(pkg.name, 'agent-context-memory', 'package.json name 불일치');
assert.strictEqual(pkg.license, 'MIT', 'package.json license 불일치');
assert.ok(pkg.files.includes('LICENSE'), 'files 화이트리스트에 LICENSE 누락');
assert.ok(pkg.repository, 'repository 필드 누락');
assert.ok(pkg.publishConfig, 'publishConfig 필드 누락');
console.log('[통과] package.json 배포 메타데이터 규격 확인 완료.');

// 3. LICENSE 일치 검증
const license = fs.readFileSync(path.join(ROOT_DIR, 'LICENSE'), 'utf-8');
assert.ok(license.includes('MIT License'), 'LICENSE 파일 내 MIT License 명기 누락');
assert.ok(license.includes('Rock Beider'), 'LICENSE 저작권자 명기 누락');
console.log('[통과] LICENSE 무결성 확인 완료.');

// 4. Git 환경 동적 E2E 라이프사이클 시뮬레이션 (init -> check-git -> status -> commit -> uninstall)
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-git-e2e-'));
console.log(`\n[준비] 가상 Git 호스트 프로젝트 생성: ${tempDir}`);

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

  // 4-2. init 실행 및 자산 주입 검증
  console.log('[단계 1] npx agent-context-memory init 실행');
  const initRes = spawnSync(process.execPath, [CLI_PATH, 'init', '--force'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(initRes.status, 0, `init 실패: ${initRes.stderr || initRes.stdout}`);
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'task', 'task.md')), '.agents/task/task.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, 'rules', 'MEMORY_GOVERNANCE.md')), 'rules/MEMORY_GOVERNANCE.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'AGENTS.md 미생성');

  const injectedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
  assert.ok(injectedPkg.scripts['git:status'], 'git:status 스크립트 미주입');
  assert.ok(injectedPkg.scripts['git:commit'], 'git:commit 스크립트 미주입');
  console.log('[통과] init 자산 생성 및 package.json 스크립트 주입 확인.');

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

  // 4-4. status --compact 실행 (신규 주입 파일 감지)
  console.log('[단계 3] npx agent-context-memory status --compact 실행');
  const statusRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(statusRes.status, 0, `status 실패: ${statusRes.stderr || statusRes.stdout}`);
  assert.ok(statusRes.stdout.includes('작업 단위 커밋 현황'), 'status 작업 단위 현황 헤더 누락');
  console.log('[통과] status 작업 단위 감지 및 분류 확인.');

  // 4-5. commit 실행 (원자적 커밋 검증)
  console.log('[단계 4] npx agent-context-memory commit 실행');
  const commitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(commitRes.status, 0, `commit 실패: ${commitRes.stderr || commitRes.stdout}`);
  const postStatus = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
  assert.strictEqual(postStatus.trim(), '', `커밋 후 워킹 트리가 깨끗하지 않음: ${postStatus}`);
  console.log('[통과] commit 실행 및 워킹 트리 완전 정돈 확인.');

  // 4-6. uninstall --force 실행 (안전 롤백 검증)
  console.log('[단계 5] npx agent-context-memory uninstall --force 실행');
  const uninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });
  assert.strictEqual(uninstallRes.status, 0, `uninstall 실패: ${uninstallRes.stderr || uninstallRes.stdout}`);
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), '.agents 미삭제');
  assert.ok(!fs.existsSync(path.join(tempDir, 'rules', 'MEMORY_GOVERNANCE.md')), 'rules/MEMORY_GOVERNANCE.md 미삭제');

  // 백업 디렉터리 생성 여부 검증
  const files = fs.readdirSync(tempDir);
  const backupDir = files.find((f) => f.startsWith('.agents_backup_') || f.includes('backup'));
  assert.ok(backupDir, 'uninstall 백업 디렉터리 미생성');
  console.log(`[통과] uninstall 안전 롤백 및 백업 디렉터리(${backupDir}) 생성 확인.`);

  console.log('=== 모든 기본 무결성 및 Git E2E 테스트 통과 (0 errors) ===\n');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`[정리] 임시 Git 테스트 디렉터리 정리 완료: ${tempDir}`);
  } catch (e) {}
}

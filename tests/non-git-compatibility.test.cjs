/**
 * tests/non-git-compatibility.test.cjs
 *
 * 비-Git 환경(Git 미초기화 또는 비저장소 디렉터리)에서의 ACM 전체 라이프사이클 E2E 호환성 검증
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

console.log('=== 비-Git 환경 호환성 E2E 검증 테스트 시작 ===');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

// 1. 임시 비-Git 테스트 작업 디렉터리 생성
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-nongit-test-'));
console.log(`[준비] 임시 테스트 디렉터리 생성: ${tempDir}`);

try {
  // 더미 package.json 생성
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'dummy-nongit-app', version: '1.0.0', scripts: {} }, null, 2)
  );

  // 2. npx agent-context-memory init 실행
  console.log('[단계 1] init 명령 실행');
  const initRes = spawnSync(process.execPath, [CLI_PATH, 'init', '--force'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(initRes.status, 0, `init 실패 (status: ${initRes.status}): ${initRes.stderr || initRes.stdout}`);
  assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'task', 'task.md')), '.agents/task/task.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, 'rules', 'MEMORY_GOVERNANCE.md')), 'rules/MEMORY_GOVERNANCE.md 미생성');
  assert.ok(fs.existsSync(path.join(tempDir, 'AGENTS.md')), 'AGENTS.md 미생성');
  console.log('[통과] init 실행 및 템플릿 파일 생성 확인.');

  // 3. npx agent-context-memory status (상세 메모리 뷰어) 실행
  console.log('[단계 2] status 명령 (메모리 뷰어 모드) 실행');
  const statusRes = spawnSync(process.execPath, [CLI_PATH, 'status'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(statusRes.status, 0, `status 실패: ${statusRes.stderr || statusRes.stdout}`);
  assert.ok(
    statusRes.stdout.includes('비-Git 모드') || statusRes.stdout.includes('Git이 비활성화된 환경'),
    '비-Git 안내 문구 누락'
  );
  assert.ok(statusRes.stdout.includes('작업 기억 정본'), '작업 기억 정본 섹션 누락');
  console.log('[통과] status 비-Git 메모리 뷰어 모드 정상 가동 확인.');

  // 4. npx agent-context-memory status --compact 실행
  console.log('[단계 3] status --compact 명령 실행');
  const compactRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--compact'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(compactRes.status, 0, `status --compact 실패: ${compactRes.stderr || compactRes.stdout}`);
  assert.ok(compactRes.stdout.includes('[비-Git 환경]'), 'compact 모드 비-Git 헤더 누락');
  console.log('[통과] status --compact 모드 정상 가동 확인.');

  // 5. npx agent-context-memory commit 실행
  console.log('[단계 4] commit 명령 실행 (비-Git 방어 검증)');
  const commitRes = spawnSync(process.execPath, [CLI_PATH, 'commit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(commitRes.status, 0, `commit 실패: ${commitRes.stderr || commitRes.stdout}`);
  assert.ok(
    commitRes.stdout.includes('Git 환경이 아니므로 Git 커밋을 건너뜁니다') ||
      commitRes.stdout.includes('Git 환경이 아니므로 Git 커밋을 실행할 수 없습니다'),
    'commit 비-Git 방어 안내 문구 누락'
  );
  console.log('[통과] commit 비-Git 우아한 건너뛰기 및 안내 확인.');

  // 6. npx agent-context-memory pull 실행
  console.log('[단계 5] pull 명령 실행 (비-Git 방어 검증)');
  const pullRes = spawnSync(process.execPath, [CLI_PATH, 'pull'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(pullRes.status, 0, `pull 실패: ${pullRes.stderr || pullRes.stdout}`);
  assert.ok(pullRes.stdout.includes('pull 도구를 건너뜁니다'), 'pull 비-Git 방어 안내 누락');
  console.log('[통과] pull 비-Git 방어 정상 작동 확인.');

  // 7. npx agent-context-memory audit 실행
  console.log('[단계 6] audit 명령 실행 (비-Git 방어 검증)');
  const auditRes = spawnSync(process.execPath, [CLI_PATH, 'audit'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(auditRes.status, 0, `audit 실패: ${auditRes.stderr || auditRes.stdout}`);
  assert.ok(auditRes.stdout.includes('audit 도구를 건너뜁니다'), 'audit 비-Git 방어 안내 누락');
  console.log('[통과] audit 비-Git 방어 정상 작동 확인.');

  // 8. npx agent-context-memory uninstall --force 실행
  console.log('[단계 7] uninstall 명령 실행 (정상 롤백 검증)');
  const uninstallRes = spawnSync(process.execPath, [CLI_PATH, 'uninstall', '--force', '--no-backup'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.strictEqual(uninstallRes.status, 0, `uninstall 실패: ${uninstallRes.stderr || uninstallRes.stdout}`);
  assert.ok(!fs.existsSync(path.join(tempDir, '.agents')), '.agents 디렉터리 미삭제');
  assert.ok(!fs.existsSync(path.join(tempDir, 'rules', 'MEMORY_GOVERNANCE.md')), 'rules/MEMORY_GOVERNANCE.md 미삭제');
  console.log('[통과] uninstall 롤백 및 제거 정상 확인.');

  console.log('=== 비-Git 환경 호환성 E2E 검증 통과 (모든 테스트 성공) ===\n');
} finally {
  // 임시 디렉터리 정리
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`[정리] 임시 테스트 디렉터리 정리 완료: ${tempDir}`);
  } catch (e) {
    // 무시
  }
}

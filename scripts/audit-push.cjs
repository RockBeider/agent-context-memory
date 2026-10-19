/**
 * scripts/audit-push.cjs
 *
 * 원격 브랜치로 push 하기 전,
 * 1. 미해소 충돌 마커(<<<<<<<) 잔존 여부
 * 2. 1회성 테스트 스크립트 및 불필요한 임시/로그 파일 포함 여부
 * 를 전수 검사하여 안전한 배포를 보장하는 품질 게이트 CLI 도구
 */

const { execSync } = require('child_process');

function run(cmd, ignoreError = false) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
    }).trim();
  } catch (err) {
    if (ignoreError) {
      return (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    }
    throw err;
  }
}

// 대상 원격 추적 브랜치 동적 탐색
function getTargetRemoteBranch() {
  try {
    const upstream = run('git rev-parse --abbrev-ref --symbolic-full-name @{u}', true);
    if (upstream && !upstream.includes('fatal')) return upstream;
  } catch {}

  const candidates = ['origin/main', 'origin/master', 'origin/develop'];
  for (const b of candidates) {
    try {
      const res = run(`git rev-parse --verify ${b}`, true);
      if (res && !res.includes('fatal')) return b;
    } catch {}
  }
  return null;
}

// 원격에 올라가면 안 되는 금지/주의 파일 패턴
const FORBIDDEN_PATTERNS = [
  { pattern: /^scripts\/temp-.*\.cjs$/, reason: '1회성 임시 스크립트' },
  { pattern: /^scripts\/scratch_.*$/, reason: '1회성 스크래치 스크립트' },
  { pattern: /^scripts\/test-.*\.cjs$/, reason: '로컬 단발성 테스트 스크립트' },
  { pattern: /^scripts\/.*_report\.txt$/, reason: '1회성 분석 보고서 텍스트' },
  { pattern: /\.tmp$/i, reason: '임시 파일 (*.tmp)' },
  { pattern: /\.bak$/i, reason: '백업 파일 (*.bak)' },
  { pattern: /\.log$/i, reason: '로그 파일 (*.log)' },
];

function main() {
  console.log('=======================================================');
  console.log('  Context Memorial 원격 푸시 사전 위생 감사 품질 게이트');
  console.log('=======================================================\n');

  let hasError = false;
  const targetRemote = getTargetRemoteBranch();

  // 1. 충돌 마커 전수 감사
  console.log('[1/3] 미해소 충돌 마커(<<<<<<<) 잔여 전수 검사...');
  try {
    const diffTarget = targetRemote ? `${targetRemote}..HEAD` : 'HEAD';
    const checkOut = run(`git --no-pager diff --check ${diffTarget}`, true);
    if (checkOut && checkOut.includes('leftover conflict marker')) {
      console.error('  [오류] 미해소 충돌 마커 감지:');
      console.error(checkOut);
      hasError = true;
    } else {
      console.log('  -> 통과: 잔여 충돌 마커 없음.\n');
    }
  } catch (err) {
    console.error('  [오류] 충돌 마커 검사 실패:\n', err.message);
    hasError = true;
  }

  // 2. 워킹 트리 클린 여부 검사
  console.log('[2/3] 로컬 워킹 트리 상태 확인...');
  const statusOut = run('git status --porcelain');
  if (statusOut) {
    console.log('  [주의] 현재 워킹 트리에 커밋되지 않은 수정/추가 파일이 있습니다:');
    statusOut.split('\n').forEach((l) => console.log(`    ${l}`));
    console.log('  -> push 전 "npm run git:status"로 정리하거나 커밋하세요.\n');
  } else {
    console.log('  -> 통과: 워킹 트리가 깨끗합니다.\n');
  }

  // 3. push 대기 파일 전수 검사
  console.log(`[3/3] 원격(${targetRemote || '로컬 최신'}) 대비 푸시 대기 파일 위생 감사...`);
  let diffNameStatus = '';
  if (targetRemote) {
    try {
      diffNameStatus = run(`git diff --name-status ${targetRemote}..HEAD`);
    } catch (err) {
      console.log(`  [안내] ${targetRemote} 비교 실패. HEAD 단독 검사로 대체합니다.`);
    }
  }

  if (!diffNameStatus) {
    console.log('  -> 원격 대비 새로 푸시할 커밋이 없습니다 (이미 최신 동기화 상태).\n');
  } else {
    const lines = diffNameStatus.split('\n').filter(Boolean);
    console.log(`  [안내] 총 ${lines.length}개 파일이 푸시 대상에 포함되어 있습니다.`);

    const forbiddenDetected = [];

    lines.forEach((line) => {
      const parts = line.split(/\s+/);
      const status = parts[0];
      const filePath = parts[1];

      // 삭제된 파일은 금지 패턴이어도 통과
      if (status === 'D') return;

      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.pattern.test(filePath)) {
          forbiddenDetected.push({ filePath, reason: rule.reason });
          break;
        }
      }
    });

    if (forbiddenDetected.length > 0) {
      console.error('\n  [경고] 프로젝트에 불필요한 1회성/임시 파일이 푸시 대상에서 감지되었습니다:');
      forbiddenDetected.forEach(({ filePath, reason }) => {
        console.error(`    - ${filePath} (${reason})`);
      });
      console.error('\n  [조치 방법]: 아래 명령어로 제거 커밋 후 다시 시도하세요:');
      const filesToRm = forbiddenDetected.map((f) => `"${f.filePath}"`).join(' ');
      console.error(`    git rm ${filesToRm}`);
      console.error('    git commit -m "chore: 1회성 스크립트 정리"\n');
      hasError = true;
    } else {
      console.log('  -> 통과: 1회성 스크립트 및 불필요한 임시 파일 없음.\n');
    }
  }

  if (hasError) {
    console.log('=======================================================');
    console.log('  [실패] 푸시 전 위생 감사 기준을 통과하지 못했습니다.');
    console.log('=======================================================\n');
    process.exit(1);
  } else {
    console.log('=======================================================');
    console.log('  [성공] 푸시 전 위생 감사 100% 통과! 안심하고 push 하세요.');
    console.log('=======================================================\n');
    process.exit(0);
  }
}

main();

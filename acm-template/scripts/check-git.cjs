#!/usr/bin/env node
/**
 * scripts/check-git.cjs
 *
 * 시스템의 Git 설치 여부 및 환경을 진단하고,
 * 비-차단(Non-blocking) 방식으로 맞춤형 안내 메시지를 제공하는 모듈.
 */

const { execSync } = require('child_process');

function checkGitEnvironment() {
  try {
    const versionOutput = execSync('git --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return {
      available: true,
      version: versionOutput.trim(),
    };
  } catch (error) {
    return {
      available: false,
      version: null,
    };
  }
}

function printGitNotice(status) {
  if (status.available) {
    console.log(`[환경 점검] ${status.version} 감지됨 (모든 Git 연동 기능 활성화)`);
    return true;
  }

  console.warn('\n================================================================');
  console.warn('[안내] 시스템에 Git이 설치되어 있지 않거나 PATH에 없습니다.');
  console.warn('----------------------------------------------------------------');
  console.warn('1. 기본 문서 관리 및 AI 에이전트 작업 기억 체계는 정상 배포됩니다.');
  console.warn('2. 단, 아래 Git 연계 기능은 제한 모드로 동작합니다:');
  console.warn('   - 작업 단위 자동 분류 커밋 도구 (group-status.cjs)');
  console.warn('   - 커밋 SHA 기반 완료 검증 (TSK 수명주기 통제)');
  console.warn('   - 지능형 3-Way 동기화 및 감사 파이프라인 (smart-pull / audit-push)');
  console.warn('3. 모든 기능을 온전히 사용하시려면 추후 Git을 설치해 주십시오.');
  console.warn('   공식 다운로드: https://git-scm.com/downloads');
  console.warn('================================================================\n');

  return false;
}

if (require.main === module) {
  const status = checkGitEnvironment();
  printGitNotice(status);
}

module.exports = {
  checkGitEnvironment,
  printGitNotice,
};

#!/usr/bin/env node
/**
 * scripts/check-git.cjs
 *
 * 시스템의 Git 설치 여부 및 대상 디렉터리의 Git 저장소 환경을 진단하고,
 * 비-차단(Non-blocking) 방식으로 맞춤형 안내 메시지를 제공하는 모듈.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkGitEnvironment(targetDir = process.cwd()) {
  let available = false;
  let version = null;
  let isRepo = false;

  try {
    const versionOutput = execSync('git --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    available = true;
    version = versionOutput.trim();
  } catch (error) {
    available = false;
  }

  if (available) {
    try {
      const insideWorkTree = execSync('git rev-parse --is-inside-work-tree', {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      isRepo = insideWorkTree.trim() === 'true';
    } catch (e) {
      const gitDir = path.join(targetDir, '.git');
      isRepo = fs.existsSync(gitDir);
    }
  }

  return {
    available,
    isRepo,
    version,
  };
}

function printGitNotice(status) {
  if (status.available && status.isRepo) {
    console.log(`[환경 점검] ${status.version} 감지됨 (Git 저장소 연동 활성화)`);
    return true;
  }

  if (status.available && !status.isRepo) {
    console.log(`[환경 점검] ${status.version} 감지됨 (비-Git 프로젝트)`);
    console.log(`[안내] 현재 대상 디렉터리는 Git 저장소(.git)가 아닙니다.`);
    console.log(`  - 3계층 인지 메모리 거버넌스 및 문서 관리는 정상 작동합니다.`);
    console.log(`  - 작업 단위 자동 커밋 등 Git 연계 기능은 비활성화 모드로 동작합니다.`);
    console.log(`  - 추후 Git 기능을 사용하려면 \`git init\` 명령으로 저장소를 초기화하십시오.\n`);
    return false;
  }

  console.warn('\n================================================================');
  console.warn('[안내] 시스템에 Git이 설치되어 있지 않거나 PATH에 없습니다.');
  console.warn('----------------------------------------------------------------');
  console.warn('1. 3계층 인지 메모리 거버넌스 및 문서 관리 체계는 정상 배포 및 작동합니다.');
  console.warn('2. 단, 아래 Git 연계 기능은 비활성화(제한 모드)됩니다:');
  console.warn('   - 작업 단위 자동 분류 커밋 도구 (group-status.cjs / commit)');
  console.warn('   - 커밋 SHA 기반 완료 검증 (비-Git 환경에서는 사용자 확인 기반 완료 지원)');
  console.warn('   - 지능형 3-Way 동기화 및 감사 파이프라인 (smart-pull / audit-push)');
  console.warn('3. 모든 기능을 온전히 사용하시려면 추후 Git을 설치해 주십시오.');
  console.warn('   공식 다운로드: https://git-scm.com/downloads');
  console.warn('================================================================\n');

  return false;
}

if (require.main === module) {
  const targetArg = process.argv.slice(2).find((a) => !a.startsWith('-')) || process.cwd();
  const status = checkGitEnvironment(targetArg);
  printGitNotice(status);
}

module.exports = {
  checkGitEnvironment,
  printGitNotice,
};

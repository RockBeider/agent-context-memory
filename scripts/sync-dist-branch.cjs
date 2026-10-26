#!/usr/bin/env node
/**
 * scripts/sync-dist-branch.cjs
 *
 * package.json의 files 필드 기반으로 npm 배포 대상 파일만 선별하여
 * dist 브랜치에 격리 커밋을 생성하고 동기화하는 자동화 배포 엔진.
 *
 * 특징:
 * - Git Plumbing 명령어(GIT_INDEX_FILE, write-tree, commit-tree, update-ref) 사용
 * - 현재 작업 브랜치 및 워킹 트리를 checkout 전환 없이 무중단 격리 동기화
 * - dist 브랜치에는 오직 배포 파일(34개 파일)만 존재하며, 선형 배포 이력 유지
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_INDEX_REL = '.git/temp-dist-index';
const TEMP_INDEX_PATH = path.join(REPO_ROOT, TEMP_INDEX_REL);

function runGit(cmd, options = {}) {
  const env = {
    ...process.env,
    PAGER: 'cat',
    ...(options.env || {}),
  };
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getPackageDistributionFiles() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package.json을 찾을 수 없습니다.');
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const declaredFiles = Array.isArray(pkg.files) ? pkg.files : [];

  // npm 배포 기본 필수 파일 및 package.json files 선언 항목
  const requiredDefaults = ['package.json', 'README.md', 'LICENSE', 'AGENTS.md'];
  const targetPatterns = Array.from(new Set([...requiredDefaults, ...declaredFiles]));

  // 실제 존재하는 항목만 필터링
  const validTargets = targetPatterns.filter((item) => {
    const fullPath = path.join(REPO_ROOT, item);
    return fs.existsSync(fullPath);
  });

  return {
    version: pkg.version || '0.0.0',
    validTargets,
  };
}

function syncDistBranch(options = {}) {
  const dryRun = options.dryRun || false;
  const shouldPush = options.push || false;

  console.log('[dist-sync] 배포 브랜치(dist) 동기화 프로세스를 시작합니다.');

  // 1. Git 환경 점검
  try {
    const isInside = runGit('git rev-parse --is-inside-work-tree');
    if (isInside !== 'true') {
      throw new Error('Git 저장소 내부가 아닙니다.');
    }
  } catch (e) {
    console.error('[오류] Git 저장소를 확인할 수 없습니다:', e.message);
    process.exit(1);
  }

  // 2. 현재 소스 브랜치 및 커밋 SHA 확인
  let currentBranch = 'unknown';
  let currentCommit = 'unknown';
  try {
    currentBranch = runGit('git rev-parse --abbrev-ref HEAD');
    currentCommit = runGit('git rev-parse --short HEAD');
  } catch (e) {
    // 무시
  }

  // 3. 배포 대상 파일 목록 수집
  const { version, validTargets } = getPackageDistributionFiles();
  console.log(`[dist-sync] 배포 패키지 버전: v${version}`);
  console.log(`[dist-sync] 소스 브랜치: ${currentBranch} (${currentCommit})`);
  console.log(`[dist-sync] 동기화 대상 항목 (${validTargets.length}개):`, validTargets.join(', '));

  if (dryRun) {
    console.log('[dist-sync] --dry-run 모드이므로 실제 브랜치 커밋을 생성하지 않습니다.');
    return;
  }

  // 4. 임시 인덱스 생성 및 대상 파일 스테이징
  if (fs.existsSync(TEMP_INDEX_PATH)) {
    try {
      fs.unlinkSync(TEMP_INDEX_PATH);
    } catch (_) {}
  }

  const gitEnv = { GIT_INDEX_FILE: TEMP_INDEX_REL };

  try {
    // 대상 항목들을 임시 인덱스에 일괄 추가
    console.log('[dist-sync] 배포 항목 임시 인덱스 스테이징 중...');
    const targetArgs = validTargets.map((t) => `"${t}"`).join(' ');
    runGit(`git add -A -- ${targetArgs}`, { env: gitEnv });
    console.log('[dist-sync] 임시 인덱스 스테이징 완료.');

    // 5. 트리 생성 (git write-tree)
    const treeHash = runGit('git write-tree', { env: gitEnv });
    console.log(`[dist-sync] 배포 트리 해시 생성 완료: ${treeHash}`);

    // 6. 이전 dist 브랜치 HEAD 확인 (부모 커밋 연결)
    let parentCommit = null;
    try {
      parentCommit = runGit('git rev-parse --verify refs/heads/dist');
      console.log(`[dist-sync] 기존 dist 브랜치 HEAD 감지: ${parentCommit}`);
    } catch (_) {
      console.log('[dist-sync] 기존 dist 브랜치가 없어 첫 루트(고아) 커밋으로 생성합니다.');
    }

    // 7. 커밋 생성 (git commit-tree)
    const commitMsg = options.message || `release(dist): v${version} (${currentBranch}@${currentCommit})`;
    const parentArg = parentCommit ? `-p ${parentCommit}` : '';
    const newCommitHash = runGit(`git commit-tree ${treeHash} ${parentArg} -m "${commitMsg}"`, {
      env: gitEnv,
    });
    console.log(`[dist-sync] 신규 dist 커밋 생성 완료: ${newCommitHash}`);

    // 8. dist 브랜치 레퍼런스 업데이트 (git update-ref)
    runGit(`git update-ref refs/heads/dist ${newCommitHash}`);
    console.log(`[dist-sync] refs/heads/dist -> ${newCommitHash} 갱신 완료.`);

    // 9. 원격 푸시 (옵션)
    if (shouldPush) {
      console.log('[dist-sync] 원격 저장소로 dist 브랜치를 푸시합니다: git push origin dist');
      runGit('git push origin dist');
      console.log('[dist-sync] 원격 푸시가 성공적으로 완료되었습니다.');
    }

    console.log('[dist-sync] dist 브랜치 배포 격리 동기화가 성공적으로 완료되었습니다.');
  } finally {
    // 임시 인덱스 파일 정리
    if (fs.existsSync(TEMP_INDEX_PATH)) {
      try {
        fs.unlinkSync(TEMP_INDEX_PATH);
      } catch (_) {}
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const push = args.includes('--push');
  const msgIdx = args.indexOf('--message');
  const message = msgIdx !== -1 && args[msgIdx + 1] ? args[msgIdx + 1] : null;

  syncDistBranch({ dryRun, push, message });
}

module.exports = {
  syncDistBranch,
  getPackageDistributionFiles,
};

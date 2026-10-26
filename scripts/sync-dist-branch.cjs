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

/**
 * dist 배포 산출물 및 npm 패키지에서 제외할 소스/릴리스 전용 파일 목록
 */
const EXCLUDED_DIST_FILES = [
  'scripts/sync-dist-branch.cjs',
];

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

/**
 * 배포 산출물(dist)용으로 불필요/오류 유발 스크립트가 제거된 package.json 문자열을 생성합니다.
 */
function generateDistributionPackageJson(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  if (pkg.scripts) {
    const cleaned = { ...pkg.scripts };

    // 1) 릴리스 파이프라인 전용 스크립트 제거
    delete cleaned['dist:sync'];
    delete cleaned['dist:push'];

    // 2) 런타임에 tests/ 폴더가 제외되어 오류를 유발하는 스크립트 제거
    delete cleaned['test'];
    delete cleaned['prepublishOnly'];

    // 3) CLI(npx acm)로 대체되는 로컬 전용 별칭 스크립트 정제
    delete cleaned['acm:install'];
    delete cleaned['acm:uninstall'];
    delete cleaned['check-git'];

    pkg.scripts = cleaned;
  }

  return JSON.stringify(pkg, null, 2) + '\n';
}

/**
 * Git Plumbing(hash-object, update-index)을 활용해
 * 워킹 트리의 원본 파일 변경 없이 임시 인덱스에만 정제된 package.json을 주입합니다.
 */
function injectSanitizedPackageJson(gitEnv) {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const sanitizedContent = generateDistributionPackageJson(pkgPath);

  const blobHash = execSync('git hash-object -w --stdin', {
    cwd: REPO_ROOT,
    input: sanitizedContent,
    encoding: 'utf-8',
    env: { ...process.env, ...gitEnv },
  }).trim();

  runGit(`git update-index --cacheinfo 100644 ${blobHash} package.json`, { env: gitEnv });
  console.log(`[dist-sync] 배포용 package.json 정제 주입 완료 (blob: ${blobHash.substring(0, 7)})`);
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

    // 4-1. 배포 제외 대상 파일 인덱스에서 제거
    for (const file of EXCLUDED_DIST_FILES) {
      try {
        runGit(`git rm --cached -f -- "${file}"`, {
          env: gitEnv,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        console.log(`[dist-sync] 배포 제외 파일 인덱스 제거: ${file}`);
      } catch (_) {}
    }

    // 4-2. 배포용 package.json 정제 주입 (워킹 트리 원본 보존)
    injectSanitizedPackageJson(gitEnv);

    console.log('[dist-sync] 임시 인덱스 스테이징 및 배포 위생 정제 완료.');

    // 5. 트리 생성 (git write-tree)
    const treeHash = runGit('git write-tree', { env: gitEnv });
    console.log(`[dist-sync] 배포 트리 해시 생성 완료: ${treeHash}`);

    // 6. 이전 dist 브랜치 HEAD 확인 (부모 커밋 연결)
    let parentCommit = null;

    // 원격 dist 브랜치 정보 갱신 시도 (CI 환경 대비)
    try {
      runGit('git fetch origin dist', { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) {}

    const candidateRefs = [
      'refs/heads/dist',
      'refs/remotes/origin/dist',
      'origin/dist',
    ];

    for (const ref of candidateRefs) {
      try {
        const hash = runGit(`git rev-parse --verify ${ref}`);
        if (hash) {
          parentCommit = hash;
          console.log(`[dist-sync] 기존 dist 브랜치 HEAD 감지 (${ref}): ${parentCommit}`);
          break;
        }
      } catch (_) {}
    }

    if (!parentCommit) {
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
      try {
        runGit('git push origin dist');
      } catch (pushErr) {
        console.warn('[dist-sync] 일반 푸시 거부 감지, 배포 브랜치 강제 푸시(--force)를 수행합니다.');
        runGit('git push origin dist --force');
      }
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

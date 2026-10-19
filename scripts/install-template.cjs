#!/usr/bin/env node
/**
 * scripts/install-template.cjs
 *
 * Context Memorial System(CMS) 배포 템플릿을 신규 프로젝트에 설치/초기화하는 CLI 스크립트
 *
 * 사용법:
 *   node scripts/install-template.cjs <target-project-dir> [--force]
 *   예: node scripts/install-template.cjs ../my-new-app
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'cms_template');

function printUsage() {
  console.log('=======================================================');
  console.log('  Context Memorial System 템플릿 인스톨러');
  console.log('=======================================================\n');
  console.log('사용법:');
  console.log('  node scripts/install-template.cjs <target-directory> [--force]\n');
  console.log('옵션:');
  console.log('  --force, -f : 이미 존재하는 파일이 있을 경우 강제 덮어쓰기\n');
  console.log('예시:');
  console.log('  node scripts/install-template.cjs D:/work/new-project');
  console.log('  node scripts/install-template.cjs ./my-app --force\n');
}

function copyRecursive(src, dest, force, stats) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, force, stats);
    } else {
      const exists = fs.existsSync(destPath);
      if (exists && !force) {
        stats.skipped++;
        console.log(`  [보존] ${path.relative(stats.targetRoot, destPath)} (기존 파일 존재)`);
      } else {
        fs.copyFileSync(srcPath, destPath);
        if (exists) {
          stats.overwritten++;
          console.log(`  [덮어씀] ${path.relative(stats.targetRoot, destPath)}`);
        } else {
          stats.created++;
          console.log(`  [생성] ${path.relative(stats.targetRoot, destPath)}`);
        }
      }
    }
  }
}

function updateTargetPackageJson(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  const cmsScripts = {
    'git:status': 'node scripts/group-status.cjs',
    'git:commit': 'node scripts/group-status.cjs --all',
    'git:pull': 'node scripts/smart-pull.cjs',
    'git:resolve': 'node scripts/smart-pull.cjs --resolve',
    'git:audit-push': 'node scripts/audit-push.cjs',
  };

  let pkg = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) {
      console.warn('  [경고] 기존 package.json 파싱 실패. 스크립트 주입을 건너뜁니다.');
      return;
    }
  } else {
    pkg = {
      name: path.basename(targetDir),
      version: '0.1.0',
      private: true,
    };
  }

  pkg.scripts = pkg.scripts || {};
  let addedCount = 0;
  for (const [key, cmd] of Object.entries(cmsScripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = cmd;
      addedCount++;
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`  -> package.json 내 git:* 스크립트 ${addedCount}개 항목 동기화 완료.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const force = args.includes('--force') || args.includes('-f');
  const targetArg = args.find((a) => !a.startsWith('-'));

  if (!targetArg) {
    console.error('[오류] 대상 디렉터리 경로를 지정해야 합니다.');
    printUsage();
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), targetArg);

  console.log('=======================================================');
  console.log('  Context Memorial System 템플릿 설치 시작');
  console.log(`  출처 자산 : ${TEMPLATE_DIR}`);
  console.log(`  대상 경로 : ${targetDir}`);
  console.log(`  옵션      : ${force ? '강제 덮어쓰기 (--force)' : '안전 보존 모드'}`);
  console.log('=======================================================\n');

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`[오류] 템플릿 소스 디렉터리가 존재하지 않습니다: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  const stats = { created: 0, overwritten: 0, skipped: 0, targetRoot: targetDir };

  console.log('[1/2] 템플릿 파일 복제 중...');
  copyRecursive(TEMPLATE_DIR, targetDir, force, stats);
  console.log(`\n  -> 복제 결과: 신규 ${stats.created}건 / 덮어씀 ${stats.overwritten}건 / 보존 ${stats.skipped}건\n`);

  console.log('[2/2] 대상 package.json 스크립트 연동 중...');
  updateTargetPackageJson(targetDir);

  console.log('\n=======================================================');
  console.log('  Context Memorial System 설치가 성공적으로 완료되었습니다.');
  console.log('=======================================================\n');
  console.log('다음 단계 가이드:');
  console.log(`  1. 대상 프로젝트로 이동: cd "${targetDir}"`);
  console.log('  2. 프로젝트 거버넌스 규격 연동:');
  console.log('     rules/MEMORIAL_GOVERNANCE.md 내용을 GEMINI.md 또는 AGENTS.md에 주입');
  console.log('  3. 작업 단위 커밋 엔진 동작 확인:');
  console.log('     npm run git:status');
  console.log('=======================================================\n');
}

main();

#!/usr/bin/env node
/**
 * scripts/install-template.cjs
 *
 * Agent Context Memory(ACM) 배포 템플릿을 신규/기존 프로젝트에 설치/초기화하는 스크립트
 *
 * 사용법:
 *   node scripts/install-template.cjs [target-directory] [--force] [--rule-file=<파일명>]
 *   기본값: target-directory 미지정 시 현재 작업 디렉터리(.)에 설치
 */

const fs = require('fs');
const path = require('path');
const { checkGitEnvironment, printGitNotice } = require('./check-git.cjs');
const { resolveTargetRuleFiles, applyGovernanceRules } = require('./sync-agent-rules.cjs');
const { ACM_MANIFEST } = require('./acm-manifest.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'acm-template');

function printUsage() {
  console.log('=======================================================');
  console.log('  Agent Context Memory 템플릿 인스톨러');
  console.log('=======================================================\n');
  console.log('사용법:');
  console.log('  node scripts/install-template.cjs [target-directory] [옵션]\n');
  console.log('옵션:');
  console.log('  --force, -f             : 이미 존재하는 파일이 있을 경우 강제 덮어쓰기');
  console.log('  --rule-file=<파일명>    : 규칙을 적용할 대상 파일 직접 지정 (쉼표 구분 다중 지정 가능)');
  console.log('  -r <파일명>             : --rule-file 의 축약형\n');
  console.log('예시:');
  console.log('  node scripts/install-template.cjs .');
  console.log('  node scripts/install-template.cjs D:/work/new-project');
  console.log('  node scripts/install-template.cjs ./my-app --rule-file=CLAUDE.md');
  console.log('  node scripts/install-template.cjs ./my-app --force\n');
}

function copyRecursive(src, dest, force, stats) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    // AGENTS.md는 syncAgentRules 파이프라인에서 타깃 파일별로 안전 주입하므로 중복 복사 방지
    if (src === TEMPLATE_DIR && entry.name === 'AGENTS.md') {
      continue;
    }

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
  const acmScripts = ACM_MANIFEST.packageJson.scripts;

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
  for (const [key, cmd] of Object.entries(acmScripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = cmd;
      addedCount++;
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`  -> package.json 내 git:* 스크립트 ${addedCount}개 항목 동기화 완료.`);
}

function updateGitIgnore(targetDir) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const { entries, template } = ACM_MANIFEST.gitignore;
  const primaryEntry = entries[0];

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, template, 'utf-8');
    console.log(`  [생성] .gitignore (${primaryEntry} 등록 완료)`);
    return { created: true, appended: false, exists: false };
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const alreadyExists = lines.some((line) => line === primaryEntry || line === `${primaryEntry}/`);

  if (alreadyExists) {
    console.log(`  [보존] .gitignore (이미 ${primaryEntry} 항목 등록됨)`);
    return { created: false, appended: false, exists: true };
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r');
  const appendContent = (needsNewline ? '\n' : '') + `${primaryEntry}\n`;
  fs.appendFileSync(gitignorePath, appendContent, 'utf-8');
  console.log(`  [동기화] .gitignore (${primaryEntry} 등록 추가)`);
  return { created: false, appended: true, exists: false };
}

async function install(targetPath = '.', options = {}) {
  const force = Boolean(options.force);
  const targetDir = path.resolve(process.cwd(), targetPath);

  console.log('=======================================================');
  console.log('  Agent Context Memory 설치 및 초기화 시작');
  console.log(`  출처 자산 : ${TEMPLATE_DIR}`);
  console.log(`  대상 경로 : ${targetDir}`);
  console.log(`  옵션      : ${force ? '강제 덮어쓰기 (--force)' : '안전 보존 모드'}`);
  if (options.ruleFile) {
    console.log(`  규칙 대상 : ${options.ruleFile} (명시적 지정)`);
  }
  console.log('=======================================================\n');

  // 1단계: Git 환경 비-차단 사전 진단
  const gitStatus = checkGitEnvironment();
  const hasGit = printGitNotice(gitStatus);

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`[오류] 템플릿 소스 디렉터리가 존재하지 않습니다: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  // 2단계: AI 에이전트 규칙 파일 스캔 및 타깃 결정 (Scan First -> Fallback Prompt)
  console.log('[1/3] AI 에이전트 규칙 파일 대상 스캔 및 결정 중...');
  const targetRuleFiles = await resolveTargetRuleFiles(targetDir, options);

  const stats = { created: 0, overwritten: 0, skipped: 0, targetRoot: targetDir };

  // 3단계: 템플릿 기본 자산 복제
  console.log('\n[2/3] 템플릿 시스템 파일 복제 중...');
  copyRecursive(TEMPLATE_DIR, targetDir, force, stats);
  console.log(`  -> 복제 결과: 신규 ${stats.created}건 / 덮어씀 ${stats.overwritten}건 / 보존 ${stats.skipped}건\n`);

  // 4단계: 에이전트 규칙 파일 마커 기반 안전 주입/생성
  console.log('[3/3] AI 에이전트 규칙 파일 동기화 중...');
  applyGovernanceRules(targetDir, targetRuleFiles);

  // 5단계: 대상 package.json 스크립트 연동
  console.log('\n[추가 연동 1/2] 대상 package.json 스크립트 설정 중...');
  updateTargetPackageJson(targetDir);

  // 6단계: Git 환경 감지 시 .gitignore 동기화 (.agent 등록)
  if (hasGit) {
    console.log('\n[추가 연동 2/2] Git 환경 감지: .gitignore 동기화 중...');
    updateGitIgnore(targetDir);
  } else {
    console.log('\n[추가 연동 2/2] Git 미설치 환경: .gitignore 동기화를 건너뜁니다.');
  }

  // 6단계: 최종 안내
  console.log('\n=======================================================');
  console.log('  Agent Context Memory 설치가 완료되었습니다.');
  console.log('=======================================================\n');
  console.log('다음 단계 가이드:');
  if (targetDir !== process.cwd()) {
    console.log(`  1. 대상 프로젝트로 이동: cd "${targetDir}"`);
  }
  console.log('  - 작업 기억 정본 확인: .agents/task/task.md');
  console.log(`  - 거버넌스 규칙 점검: ${targetRuleFiles.join(', ')} 및 rules/MEMORY_GOVERNANCE.md`);
  if (hasGit) {
    console.log('  - 작업 단위 커밋 상태 확인: npm run git:status');
  } else {
    console.log('  - [주의] Git 미설치 환경이므로 Git 커밋 도구는 제한 모드입니다.');
  }
  console.log('=======================================================\n');

  return { success: true, stats, gitAvailable: hasGit, ruleFiles: targetRuleFiles };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const force = args.includes('--force') || args.includes('-f');

  let ruleFile = null;
  const rfArg = args.find((a) => a.startsWith('--rule-file='));
  if (rfArg) {
    ruleFile = rfArg.split('=')[1];
  } else {
    const rfIdx = args.findIndex((a) => a === '--rule-file' || a === '-r');
    if (rfIdx !== -1 && args[rfIdx + 1] && !args[rfIdx + 1].startsWith('-')) {
      ruleFile = args[rfIdx + 1];
    }
  }

  const targetArg = args.find((a) => !a.startsWith('-') && a !== ruleFile) || '.';

  try {
    await install(targetArg, { force, ruleFile });
  } catch (err) {
    console.error('[오류] 설치 중 예외가 발생했습니다:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  install,
  updateGitIgnore,
  printUsage,
};

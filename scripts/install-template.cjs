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
const { loadClack, scanPresetRules, resolveTargetRuleFiles, applyGovernanceRules } = require('./sync-agent-rules.cjs');
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

function copyRecursive(src, dest, force, stats, silent = false) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of entries) {
    // AGENTS.md는 syncAgentRules 파이프라인에서 타깃 파일별로 안전 주입하므로 중복 복사 방지
    if (src === TEMPLATE_DIR && entry.name === 'AGENTS.md') {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, force, stats, silent);
    } else {
      const exists = fs.existsSync(destPath);
      if (exists && !force) {
        stats.skipped++;
        if (!silent) {
          console.log(`  [보존] ${path.relative(stats.targetRoot, destPath)} (기존 파일 존재)`);
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
        if (exists) {
          stats.overwritten++;
          if (!silent) {
            console.log(`  [덮어씀] ${path.relative(stats.targetRoot, destPath)}`);
          }
        } else {
          stats.created++;
          if (!silent) {
            console.log(`  [생성] ${path.relative(stats.targetRoot, destPath)}`);
          }
        }
      }
    }
  }
}

function updateTargetPackageJson(targetDir, silent = false) {
  const pkgPath = path.join(targetDir, 'package.json');
  const acmScripts = ACM_MANIFEST.packageJson.scripts;

  let pkg = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) {
      if (!silent) {
        console.warn('  [경고] 기존 package.json 파싱 실패. 스크립트 주입을 건너뜁니다.');
      }
      return { addedCount: 0, skipped: true };
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
  if (!silent) {
    console.log(`  -> package.json 내 git:* 스크립트 ${addedCount}개 항목 동기화 완료.`);
  }
  return { addedCount, skipped: false };
}

function updateGitIgnore(targetDir, silent = false) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const { entries, template } = ACM_MANIFEST.gitignore;

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, template, 'utf-8');
    if (!silent) {
      console.log(`  [생성] .gitignore (${entries.join(', ')} 등록 완료)`);
    }
    return { created: true, appended: false, exists: false };
  }

  const normIgnore = (s) => s.trim().replace(/^\//, '').replace(/\/$/, '');
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const missingEntries = entries.filter((entry) => {
    const cleanEntry = normIgnore(entry);
    return !lines.some((line) => normIgnore(line) === cleanEntry);
  });

  if (missingEntries.length === 0) {
    if (!silent) {
      console.log(`  [보존] .gitignore (이미 ${entries.join(', ')} 항목 등록됨)`);
    }
    return { created: false, appended: false, exists: true };
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r');
  const appendContent = (needsNewline ? '\n' : '') + missingEntries.join('\n') + '\n';
  fs.appendFileSync(gitignorePath, appendContent, 'utf-8');
  if (!silent) {
    console.log(`  [동기화] .gitignore (${missingEntries.join(', ')} 등록 추가)`);
  }
  return { created: false, appended: true, exists: false };
}

function executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, silent, options = {}) {
  const stats = { created: 0, overwritten: 0, skipped: 0, targetRoot: targetDir };
  const skipPackageJsonUpdate = Boolean(options.skipPackageJsonUpdate);

  if (!silent) console.log('\n[2/3] 템플릿 시스템 파일 복제 중...');
  copyRecursive(TEMPLATE_DIR, targetDir, force, stats, silent);
  if (!silent) {
    console.log(`  -> 복제 결과: 신규 ${stats.created}건 / 덮어씀 ${stats.overwritten}건 / 보존 ${stats.skipped}건\n`);
    console.log('[3/3] AI 에이전트 규칙 파일 동기화 중...');
  }

  const ruleResult = applyGovernanceRules(targetDir, targetRuleFiles, { silent });

  let pkgResult = { addedCount: 0, skipped: true };
  if (skipPackageJsonUpdate) {
    if (!silent) {
      console.log('\n[추가 연동 1/2] postinstall 환경: 호스트 package.json 보호를 위해 스크립트 주입은 npx acm init 실행 시 수행됩니다.');
    }
  } else {
    if (!silent) console.log('\n[추가 연동 1/2] 대상 package.json 스크립트 설정 중...');
    pkgResult = updateTargetPackageJson(targetDir, silent);
  }

  let gitignoreResult = { created: false, appended: false, exists: false, skipped: !hasGit };
  if (hasGit) {
    if (!silent) console.log('\n[추가 연동 2/2] Git 환경 감지: .gitignore 동기화 중...');
    gitignoreResult = updateGitIgnore(targetDir, silent);
  } else if (!silent) {
    console.log('\n[추가 연동 2/2] Git 미설치 환경: .gitignore 동기화를 건너뜁니다.');
  }

  const agentsDir = path.join(targetDir, '.agents');
  if (fs.existsSync(agentsDir)) {
    const metaPath = path.join(agentsDir, '.acm-meta.json');
    let existingRuleFiles = [];
    let existingCreatedGitignore = null;
    if (fs.existsSync(metaPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (Array.isArray(parsed.ruleFiles)) {
          existingRuleFiles = parsed.ruleFiles;
        }
        if (typeof parsed.createdGitignore === 'boolean') {
          existingCreatedGitignore = parsed.createdGitignore;
        }
      } catch (_) {}
    }
    const mergedRuleFiles = Array.from(new Set([...existingRuleFiles, ...targetRuleFiles]));
    const createdGitignore =
      existingCreatedGitignore !== null ? existingCreatedGitignore : Boolean(gitignoreResult.created);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ ruleFiles: mergedRuleFiles, createdGitignore }, null, 2) + '\n',
      'utf-8'
    );
  }

  return { stats, ruleResult, pkgResult, gitignoreResult };
}

function buildNextStepsLines(targetDir, targetRuleFiles, hasGit) {
  const lines = [];
  if (targetDir !== process.cwd()) {
    lines.push(`대상 프로젝트 이동: cd "${targetDir}"`);
  }
  lines.push('작업 기억 정본 확인: .agents/task/task.md');
  lines.push(`거버넌스 규칙 점검: ${targetRuleFiles.join(', ')} 및 .agents/MEMORY_GOVERNANCE.md`);
  if (hasGit) {
    lines.push('작업 단위 커밋 상태 확인: npm run git:status');
  } else {
    lines.push('[주의] Git 미설치 환경이므로 Git 커밋 도구는 제한 모드입니다.');
  }
  return lines;
}

async function install(targetPath = '.', options = {}) {
  const force = Boolean(options.force);
  const targetDir = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`[오류] 템플릿 소스 디렉터리가 존재하지 않습니다: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  const isInteractive =
    Boolean(options.forceInteractive || (process.stdin.isTTY && process.stdout.isTTY)) &&
    !options.nonInteractive;
  const clack = isInteractive ? await loadClack() : null;

  if (clack) {
    const ioOpts = {};
    if (options.input) ioOpts.input = options.input;
    if (options.output) ioOpts.output = options.output;

    clack.intro('Agent Context Memory (ACM) 설치 및 초기화', ioOpts);
    clack.log.info(
      `대상 경로: ${targetDir}\n모드: ${force ? '강제 덮어쓰기 (--force)' : '안전 보존 모드'}`,
      ioOpts
    );

    const gitStatus = checkGitEnvironment(targetDir);
    const hasGit = Boolean(gitStatus.available && gitStatus.isRepo);
    if (hasGit) {
      clack.log.success(`${gitStatus.version} 감지됨 (Git 저장소 연동 활성화)`, ioOpts);
    } else if (gitStatus.available) {
      clack.log.warn(`${gitStatus.version} 감지됨 (비-Git 프로젝트: Git 연계 기능은 제한 모드로 동작)`, ioOpts);
    } else {
      clack.log.warn('Git이 감지되지 않았습니다 (비-Git 메모리 거버넌스 모드로 초기화)', ioOpts);
    }

    const scannedBefore = !options.ruleFile ? scanPresetRules(targetDir) : [];
    const targetRuleFiles = await resolveTargetRuleFiles(targetDir, { ...options, silent: true });
    if (targetRuleFiles === null) {
      clack.cancel('설치가 사용자에 의해 취소되었습니다.', ioOpts);
      return { success: false, cancelled: true };
    }

    if (options.ruleFile) {
      clack.log.info(`지정된 규칙 파일: ${targetRuleFiles.join(', ')}`, ioOpts);
    } else if (scannedBefore.length > 0) {
      clack.log.success(`기존 AI 에이전트 규칙 파일 ${scannedBefore.length}건 자동 감지: ${scannedBefore.join(', ')}`, ioOpts);
    }

    const spin = clack.spinner(ioOpts);
    spin.start('템플릿 파일 복제 및 거버넌스 규칙 동기화 중...');
    const { stats, pkgResult } = executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, true, options);
    spin.stop('템플릿 자산 및 거버넌스 동기화 완료');

    clack.log.step(
      `템플릿 복제: 신규 ${stats.created}건 / 덮어씀 ${stats.overwritten}건 / 보존 ${stats.skipped}건` +
        `\n규칙 주입 대상: ${targetRuleFiles.join(', ')}` +
        `\npackage.json 스크립트 추가: ${pkgResult.addedCount}건`,
      ioOpts
    );

    clack.note(buildNextStepsLines(targetDir, targetRuleFiles, hasGit).join('\n'), '다음 단계 가이드', ioOpts);
    clack.outro('Agent Context Memory 설치가 완료되었습니다.', ioOpts);

    return { success: true, stats, gitAvailable: hasGit, ruleFiles: targetRuleFiles };
  }

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
  const gitStatus = checkGitEnvironment(targetDir);
  const hasGit = printGitNotice(gitStatus);

  // 2단계: AI 에이전트 규칙 파일 스캔 및 타깃 결정 (Scan First -> Fallback Prompt)
  console.log('[1/3] AI 에이전트 규칙 파일 대상 스캔 및 결정 중...');
  const targetRuleFiles = await resolveTargetRuleFiles(targetDir, options);
  if (targetRuleFiles === null) {
    console.log('\n[취소] 설치가 사용자에 의해 취소되었습니다.\n');
    return { success: false, cancelled: true };
  }

  // 3~6단계: 템플릿 복제, 규칙 주입, package.json 및 .gitignore 동기화
  const { stats } = executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, false, options);

  // 최종 안내
  console.log('\n=======================================================');
  console.log('  Agent Context Memory 설치가 완료되었습니다.');
  console.log('=======================================================\n');
  console.log('다음 단계 가이드:');
  buildNextStepsLines(targetDir, targetRuleFiles, hasGit).forEach((line, idx) => {
    console.log(`  ${idx === 0 && targetDir !== process.cwd() ? '1.' : '-'} ${line}`);
  });
  console.log('=======================================================\n');

  return { success: true, stats, gitAvailable: hasGit, ruleFiles: targetRuleFiles };
}

/**
 * npm install 시 postinstall 라이프사이클 훅을 통해 호스트 프로젝트에 자동 주입합니다.
 */
async function runPostInstall(env = process.env) {
  // 1. 사용자 명시적 옵트아웃 가드
  const skipEnv = String(env.ACM_SKIP_POSTINSTALL || '').toLowerCase();
  if (skipEnv === '1' || skipEnv === 'true') {
    return { skipped: true, reason: 'ACM_SKIP_POSTINSTALL 활성화' };
  }

  // 2. CI 환경 가드
  const ciEnv = String(env.CI || '').toLowerCase();
  if (ciEnv === 'true' || ciEnv === '1' || String(env.GITHUB_ACTIONS || '').toLowerCase() === 'true') {
    return { skipped: true, reason: 'CI 환경 감지' };
  }

  // 3. npm ci 클린 설치 가드
  if (env.npm_command === 'ci') {
    return { skipped: true, reason: 'npm ci 클린 설치 감지' };
  }

  // 4. 전역 설치(npm i -g) 가드
  if (env.npm_config_global === 'true') {
    return { skipped: true, reason: '전역(global) 설치 감지' };
  }

  // 5. npx 실행(npm exec) 중복 실행 방지 가드
  if (env.npm_command === 'exec' || env.npm_lifecycle_event === 'npx') {
    return { skipped: true, reason: 'npx/exec 실행 감지 (CLI 본체에서 초기화 수행)' };
  }

  const initCwd = env.INIT_CWD;
  if (!initCwd) {
    return { skipped: true, reason: 'INIT_CWD 미존재' };
  }

  const resolvedInitCwd = path.resolve(initCwd);
  const resolvedRootDir = path.resolve(ROOT_DIR);

  // 6. 패키지 자체 개발 환경(Self-Install) 가드
  if (resolvedInitCwd === resolvedRootDir) {
    return { skipped: true, reason: '패키지 자체 루트 디렉터리 감지' };
  }

  const targetPkgPath = path.join(resolvedInitCwd, 'package.json');
  if (fs.existsSync(targetPkgPath)) {
    try {
      const targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf-8'));
      if (targetPkg && targetPkg.name === 'agent-context-memory') {
        return { skipped: true, reason: '호스트 package.json이 agent-context-memory 자체임' };
      }
    } catch (_) {
      // 파싱 실패 시 무시하고 진행
    }
  }

  // 7. 기설치 프로젝트 가드
  if (fs.existsSync(path.join(resolvedInitCwd, '.agents', 'MEMORY_GOVERNANCE.md'))) {
    return { skipped: true, reason: '이미 ACM이 초기화된 프로젝트' };
  }

  try {
    console.log('\n[ACM postinstall] 호스트 프로젝트 감지에 따른 자동 초기화를 시작합니다...');
    const res = await install(resolvedInitCwd, {
      force: false,
      nonInteractive: true,
      skipPackageJsonUpdate: true,
    });
    return { skipped: false, result: res };
  } catch (err) {
    // postinstall 오류가 호스트의 npm install 전체를 실패시키지 않도록 경고 후 안전 종료
    console.warn(`[ACM postinstall 경고] 자동 초기화 중 예외가 발생하여 건너뜁니다: ${err.message}`);
    return { skipped: true, reason: err.message, error: err };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--postinstall')) {
    await runPostInstall();
    process.exit(0);
  }

  const force = args.includes('--force') || args.includes('-f');
  const nonInteractive = args.includes('--non-interactive');

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
    await install(targetArg, { force, ruleFile, nonInteractive });
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
  runPostInstall,
  updateGitIgnore,
  printUsage,
};

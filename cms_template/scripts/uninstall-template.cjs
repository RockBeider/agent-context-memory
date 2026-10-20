#!/usr/bin/env node
/**
 * scripts/uninstall-template.cjs
 *
 * Context Memory System(CMS) 자산을 대상 프로젝트에서 안전하고 완전하게 제거(Uninstall) 및 원복하는 스크립트
 * scripts/cms-manifest.cjs 단일 정본 매니페스트를 기반으로 동작합니다.
 *
 * 사용법:
 *   node scripts/uninstall-template.cjs [target-directory] [옵션]
 *   기본값: target-directory 미지정 시 현재 작업 디렉터리(.)
 *
 * 옵션:
 *   --dry-run               : 실제 삭제/수정 없이 제거 대상 및 영향 범위 시뮬레이션
 *   --force, -f             : 대화형 확인 프롬프트 생략
 *   --no-backup             : .agents 디렉터리 백업 생략
 *   --rule-file=<파일명>    : 특정 규칙 파일 지정 제거
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CMS_MANIFEST } = require('./cms-manifest.cjs');
const {
  scanPresetRules,
  checkRuleContentDrift,
  removeRuleFromFile,
} = require('./sync-agent-rules.cjs');

function printUsage() {
  console.log('=======================================================');
  console.log('  Context Memory System 템플릿 언인스톨러 (Uninstall)');
  console.log('=======================================================\n');
  console.log('사용법:');
  console.log('  node scripts/uninstall-template.cjs [target-directory] [옵션]\n');
  console.log('옵션:');
  console.log('  --dry-run               : 실제 삭제 없이 제거 대상 시뮬레이션 출력');
  console.log('  --force, -f             : 대화형 확인 프롬프트 건너뛰기');
  console.log('  --no-backup             : .agents 백업 생성 건너뛰기');
  console.log('  --rule-file=<파일명>    : 규칙을 제거할 대상 파일 직접 지정 (쉼표 구분 다중 지정 가능)');
  console.log('  -r <파일명>             : --rule-file 의 축약형\n');
  console.log('예시:');
  console.log('  node scripts/uninstall-template.cjs .');
  console.log('  node scripts/uninstall-template.cjs ./my-app --dry-run');
  console.log('  node scripts/uninstall-template.cjs ./my-app --force\n');
}

function promptConfirm(questionText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(questionText, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/**
 * 디렉터리를 재귀적으로 백업 복사합니다.
 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 1단계: CMS 전용 디렉터리 백업 및 제거
 */
function rollbackDirectories(targetDir, options, stats) {
  console.log('\n[1/5] CMS 소유 디렉터리 검사 및 제거 중...');
  for (const dirMeta of CMS_MANIFEST.directories) {
    const fullDirPath = path.resolve(targetDir, dirMeta.path);
    if (!fs.existsSync(fullDirPath)) {
      console.log(`  [미존재 건너뜀] ${dirMeta.path}`);
      continue;
    }

    // 백업 생성
    if (dirMeta.backupRequired && !options.noBackup) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const backupDirName = `${dirMeta.path}_backup_${timestamp}`;
      const backupFullPath = path.resolve(targetDir, backupDirName);

      if (options.dryRun) {
        console.log(`  [미리보기] 백업 디렉터리 생성 예정: ${backupDirName}`);
      } else {
        copyDirRecursive(fullDirPath, backupFullPath);
        console.log(`  [백업 완료] ${dirMeta.path} -> ${backupDirName}`);
        stats.backups.push(backupDirName);
      }
    }

    // 디렉터리 삭제
    if (options.dryRun) {
      console.log(`  [미리보기] 디렉터리 전체 삭제 예정: ${dirMeta.path}`);
      stats.removedDirs.push(dirMeta.path);
    } else {
      fs.rmSync(fullDirPath, { recursive: true, force: true });
      console.log(`  [디렉터리 삭제] ${dirMeta.path}`);
      stats.removedDirs.push(dirMeta.path);
    }
  }
}

/**
 * 2단계: CMS 배포 개별 파일 선별 삭제 및 빈 부모 디렉터리 정리
 */
function rollbackOwnedFiles(targetDir, options, stats) {
  console.log('\n[2/5] CMS 배포 개별 파일 선별 삭제 중...');
  const cleanedDirs = new Set();

  for (const fileMeta of CMS_MANIFEST.files) {
    const fullFilePath = path.resolve(targetDir, fileMeta.path);
    if (!fs.existsSync(fullFilePath)) {
      continue;
    }

    if (options.dryRun) {
      console.log(`  [미리보기] 파일 삭제 예정: ${fileMeta.path}`);
      stats.removedFiles.push(fileMeta.path);
    } else {
      fs.unlinkSync(fullFilePath);
      console.log(`  [파일 삭제] ${fileMeta.path}`);
      stats.removedFiles.push(fileMeta.path);
    }

    if (fileMeta.parentDirCleanup) {
      const parentDir = path.dirname(fullFilePath);
      cleanedDirs.add(parentDir);
    }
  }

  // 파일 삭제 후 비어있는 부모 폴더 정리 (타 파일이 있으면 건드리지 않음)
  if (!options.dryRun) {
    for (const pDir of cleanedDirs) {
      if (fs.existsSync(pDir)) {
        try {
          const remaining = fs.readdirSync(pDir);
          if (remaining.length === 0) {
            fs.rmdirSync(pDir);
            const relDir = path.relative(targetDir, pDir);
            console.log(`  [빈 디렉터리 정리] ${relDir}`);
          } else {
            const relDir = path.relative(targetDir, pDir);
            console.log(`  [사용자 파일 보존] ${relDir} (잔존 파일 ${remaining.length}개 보존)`);
          }
        } catch (e) {
          // 정리 실패 시 무시
        }
      }
    }
  }
}

/**
 * 3단계: package.json 스크립트 선별 제거
 */
function rollbackPackageJson(targetDir, options, stats) {
  console.log('\n[3/5] package.json 스크립트 원복 중...');
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log('  [건너뜀] package.json 파일 미존재');
    return;
  }

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (e) {
    console.warn('  [경고] package.json 파싱 실패로 스크립트 원복을 건너뜁니다.');
    return;
  }

  if (!pkg.scripts) {
    console.log('  [건너뜀] scripts 필드 없음');
    return;
  }

  const cmsScripts = CMS_MANIFEST.packageJson.scripts;
  let removedCount = 0;

  for (const [key, expectedCmd] of Object.entries(cmsScripts)) {
    if (pkg.scripts[key]) {
      const currentCmd = pkg.scripts[key];
      // 명령어가 CMS 정의와 일치하는지 확인
      if (currentCmd.trim() === expectedCmd.trim()) {
        if (options.dryRun) {
          console.log(`  [미리보기] 스크립트 제거 예정: "${key}"`);
        } else {
          delete pkg.scripts[key];
          console.log(`  [스크립트 제거] "${key}": "${currentCmd}"`);
        }
        removedCount++;
      } else {
        console.log(`  [수정본 보존] "${key}" 명령어가 사용자에 의해 변경되어 있어 보존합니다.`);
      }
    }
  }

  if (!options.dryRun && removedCount > 0) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`  -> package.json 내 CMS 스크립트 ${removedCount}개 항목 원복 완료.`);
  }
  stats.removedScriptsCount = removedCount;
}

/**
 * 4단계: .gitignore 엔트리 정밀 절삭
 */
function rollbackGitIgnore(targetDir, options, stats) {
  console.log('\n[4/5] .gitignore 무시 규칙 원복 중...');
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    console.log('  [건너뜀] .gitignore 파일 미존재');
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const { headerComment, entries } = CMS_MANIFEST.gitignore;

  let modified = false;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === headerComment) {
      modified = true;
      continue;
    }
    if (entries.some((e) => trimmed === e || trimmed === `${e}/`)) {
      modified = true;
      continue;
    }
    newLines.push(lines[i]);
  }

  const remaining = newLines.join('\n').trim();

  if (modified) {
    if (options.dryRun) {
      if (!remaining) {
        console.log('  [미리보기] .gitignore (CMS 외 내용 없어 파일 삭제 예정)');
      } else {
        console.log('  [미리보기] .gitignore 내 .agent 엔트리 제거 예정');
      }
    } else {
      if (!remaining) {
        fs.unlinkSync(gitignorePath);
        console.log('  [파일 삭제] .gitignore (CMS 엔트리 외 내용이 없어 파일 삭제)');
      } else {
        fs.writeFileSync(gitignorePath, remaining + '\n', 'utf-8');
        console.log('  [엔트리 제거] .gitignore 내 .agent 엔트리 절제 완료');
      }
    }
    stats.gitignoreUpdated = true;
  } else {
    console.log('  [보존] .gitignore 내 CMS 관련 엔트리가 발견되지 않음');
  }
}

/**
 * 5단계: AI 에이전트 규칙 파일 마커 절삭 및 내용 변조 감지
 */
async function rollbackAgentRules(targetDir, options, stats) {
  console.log('\n[5/5] AI 에이전트 규칙 파일 거버넌스 룰 절삭 중...');
  let targetFiles = [];

  if (options.ruleFile) {
    targetFiles = Array.isArray(options.ruleFile)
      ? options.ruleFile
      : options.ruleFile.split(',').map((f) => f.trim()).filter(Boolean);
  } else {
    targetFiles = scanPresetRules(targetDir);
  }

  for (const relFile of targetFiles) {
    const fullPath = path.resolve(targetDir, relFile);
    if (!fs.existsSync(fullPath)) continue;

    if (options.dryRun) {
      const drift = checkRuleContentDrift(fullPath);
      if (drift.status === 'EXACT_MATCH') {
        console.log(`  [미리보기] ${relFile} (거버넌스 블록 일치 -> 절삭 예정)`);
      } else if (drift.status === 'MODIFIED') {
        console.log(`  [미리보기 경고] ${relFile} (거버넌스 블록 수정 감지 -> 사용자 확인 대상)`);
      }
      stats.ruleActions.push({ file: relFile, status: drift.status });
    } else {
      const result = await removeRuleFromFile(fullPath, options);
      stats.ruleActions.push(result);
      const relResult = path.relative(targetDir, fullPath);
      if (result.status === 'REMOVED_FILE') {
        console.log(`  [규칙 파일 삭제] ${relResult} (거버넌스 제거 후 빈 파일 정리)`);
      } else if (result.status === 'CLEANED') {
        console.log(`  [규칙 블록 절삭] ${relResult} (거버넌스 제거 및 사용자 프롬프트 보존)`);
      } else if (result.status === 'PRESERVED') {
        console.log(`  [규칙 보존] ${relResult} (${result.detail})`);
      }
    }
  }
}

/**
 * 언인스톨 통합 파이프라인
 */
async function uninstall(targetPath = '.', options = {}) {
  const targetDir = path.resolve(process.cwd(), targetPath);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const isInteractive = typeof options.isInteractive === 'boolean'
    ? options.isInteractive
    : Boolean(process.stdin.isTTY);

  console.log('=======================================================');
  console.log('  Context Memory System 제거(Uninstall) 및 롤백 시작');
  console.log(`  대상 경로 : ${targetDir}`);
  console.log(`  실행 모드 : ${dryRun ? '시뮬레이션 모드 (--dry-run)' : '실제 삭제 모드'}`);
  console.log(`  백업 정책 : ${options.noBackup ? '백업 생략 (--no-backup)' : '안전 백업 활성화'}`);
  console.log('=======================================================');

  if (!dryRun && !force && isInteractive) {
    const confirm = await promptConfirm('\n정말 대상 프로젝트에서 Context Memory System을 제거하시겠습니까? (y/N): ');
    if (!confirm) {
      console.log('\n[취소] 사용자에 의해 제거 작업이 중단되었습니다.\n');
      return { success: false, cancelled: true };
    }
  }

  const stats = {
    removedDirs: [],
    removedFiles: [],
    removedScriptsCount: 0,
    gitignoreUpdated: false,
    ruleActions: [],
    backups: [],
  };

  rollbackDirectories(targetDir, options, stats);
  rollbackOwnedFiles(targetDir, options, stats);
  rollbackPackageJson(targetDir, options, stats);
  rollbackGitIgnore(targetDir, options, stats);
  await rollbackAgentRules(targetDir, options, stats);

  console.log('\n=======================================================');
  if (dryRun) {
    console.log('  [완료] 시뮬레이션(Dry-run) 검사가 완료되었습니다.');
    console.log('  실제 파일은 변경되지 않았습니다.');
  } else {
    console.log('  Context Memory System 제거 및 롤백이 완료되었습니다.');
  }
  console.log('=======================================================\n');

  if (stats.backups.length > 0) {
    console.log('보관된 백업 목록:');
    stats.backups.forEach((b) => console.log(`  - ${b}`));
    console.log('');
  }

  return { success: true, stats };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force') || args.includes('-f');
  const noBackup = args.includes('--no-backup');

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
    await uninstall(targetArg, { dryRun, force, noBackup, ruleFile });
  } catch (err) {
    console.error('[오류] 제거 중 예외가 발생했습니다:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  uninstall,
  printUsage,
};

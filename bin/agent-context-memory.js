#!/usr/bin/env node
/**
 * bin/agent-context-memory.js
 *
 * Agent Context Memory 통합 CLI 진입점 (npx agent-context-memory / npx acm)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { install } = require('../scripts/install-template.cjs');
const { uninstall } = require('../scripts/uninstall-template.cjs');
const { checkGitEnvironment, printGitNotice } = require('../scripts/check-git.cjs');

const pkgPath = path.resolve(__dirname, '../package.json');
let pkgVersion = '0.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkgVersion = pkg.version;
} catch (e) {
  // 무시
}

/**
 * 프로젝트 내 스크립트 또는 패키지 번들 내장 스크립트 경로를 동적으로 해결합니다.
 */
function resolveEngineScript(scriptName) {
  // 1순위: 호스트 프로젝트의 scripts/ 내 스크립트
  const hostScript = path.resolve(process.cwd(), 'scripts', scriptName);
  if (fs.existsSync(hostScript)) {
    return hostScript;
  }
  // 2순위: 패키지 번들 루트의 scripts/ 폴백
  const bundleScript = path.resolve(__dirname, '../scripts', scriptName);
  if (fs.existsSync(bundleScript)) {
    return bundleScript;
  }
  // 3순위: 배포 템플릿의 scripts/ 폴백
  const templateScript = path.resolve(__dirname, '../acm-template/scripts', scriptName);
  if (fs.existsSync(templateScript)) {
    return templateScript;
  }
  return null;
}

/**
 * 엔진 스크립트를 독립 프로세스로 실행하며, I/O 및 종료 코드를 완벽히 인계합니다.
 */
function runEngine(scriptName, scriptArgs = []) {
  const scriptPath = resolveEngineScript(scriptName);
  if (!scriptPath) {
    console.error(`[오류] 실행 대상 스크립트를 찾을 수 없습니다: ${scriptName}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      ACM_ROOT_DIR: process.cwd(),
      GIT_PAGER: 'cat',
      PAGER: 'cat',
    },
  });

  if (result.error) {
    console.error(`[오류] 스크립트 실행 중 에러가 발생했습니다:`, result.error.message);
    process.exit(1);
  }
  process.exit(result.status !== null ? result.status : 0);
}

function printHelp() {
  console.log(`
Agent Context Memory CLI (v${pkgVersion})
Three-Tier Context Memory Governance & Task-Centric Engine

사용법:
  npx agent-context-memory <명령어> [옵션]
  npx acm <명령어> [옵션]
  또는 로컬 실행: node bin/agent-context-memory.js <명령어> [옵션]

명령어:
  init [경로] [옵션]       지정된 경로(기본값: '.')에 Agent Context Memory 템플릿 설치
  uninstall [경로] [옵션]  지정된 경로(기본값: '.')에서 ACM 자산 및 주입 내용 안전 롤백/제거 (별칭: remove)
  check-git               현재 환경의 Git 설치 유무 및 연동 상태 진단
  status [옵션]           작업 단위 Git 상태 점검 (group-status)
  commit [옵션]           작업 단위 개별 원자 커밋 실행 (기본값: --all)
  pull [옵션]             원격 변경사항 지능형 3-Way 병합 (smart-pull)
  resolve [옵션]          3-Way 충돌 정밀 하이브리드 결합 완결
  audit                   원격 브랜치 푸시 전 위생 및 정적 감사 (별칭: audit-push)

옵션:
  -v, --version           현재 CLI 버전 출력
  -h, --help              도움말 출력
  -f, --force             확인 프롬프트 생략 및 강제 실행
  --dry-run               실제 조작 없이 결과 미리보기
  --no-backup             (uninstall 전용) .agents 백업 디렉터리 생성 생략
  --rule-file=<파일명>    규칙 파일 직접 지정 (쉼표 구분 다중 지정 가능)
  -r <파일명>             --rule-file 의 축약형

예시:
  npx agent-context-memory init
  npx agent-context-memory status
  npx agent-context-memory commit
  npx agent-context-memory commit --commit=1
  npx agent-context-memory pull
  npx agent-context-memory audit
  npx agent-context-memory uninstall --dry-run
`);
}

function ensureGit(actionName) {
  const gitEnv = checkGitEnvironment(process.cwd());
  if (!gitEnv.available || !gitEnv.isRepo) {
    if (actionName === 'commit') {
      console.log('[안내] Git 환경이 아니므로 Git 커밋을 건너뜁니다.');
      console.log('       작업 완료 후 사용자 확인을 득하여 task-completed.md로 이관하십시오.');
    } else {
      console.log(`[안내] Git 저장소가 아니거나 Git이 비활성화된 환경이므로 ${actionName} 도구를 건너뜁니다.`);
    }
    process.exit(0);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`agent-context-memory v${pkgVersion}`);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'init': {
      const remaining = args.slice(1);
      const force = remaining.includes('--force') || remaining.includes('-f');

      let ruleFile = null;
      const rfArg = remaining.find((a) => a.startsWith('--rule-file='));
      if (rfArg) {
        ruleFile = rfArg.split('=')[1];
      } else {
        const rfIdx = remaining.findIndex((a) => a === '--rule-file' || a === '-r');
        if (rfIdx !== -1 && remaining[rfIdx + 1] && !remaining[rfIdx + 1].startsWith('-')) {
          ruleFile = remaining[rfIdx + 1];
        }
      }

      const targetDir = remaining.find((a) => !a.startsWith('-') && a !== ruleFile) || '.';

      try {
        await install(targetDir, { force, ruleFile });
      } catch (err) {
        console.error('[오류] 설치 중 예외가 발생했습니다:', err.message);
        process.exit(1);
      }
      break;
    }

    case 'uninstall':
    case 'remove': {
      const remaining = args.slice(1);
      const force = remaining.includes('--force') || remaining.includes('-f');
      const dryRun = remaining.includes('--dry-run');
      const noBackup = remaining.includes('--no-backup');

      let ruleFile = null;
      const rfArg = remaining.find((a) => a.startsWith('--rule-file='));
      if (rfArg) {
        ruleFile = rfArg.split('=')[1];
      } else {
        const rfIdx = remaining.findIndex((a) => a === '--rule-file' || a === '-r');
        if (rfIdx !== -1 && remaining[rfIdx + 1] && !remaining[rfIdx + 1].startsWith('-')) {
          ruleFile = remaining[rfIdx + 1];
        }
      }

      const targetDir = remaining.find((a) => !a.startsWith('-') && a !== ruleFile) || '.';

      try {
        await uninstall(targetDir, { force, dryRun, noBackup, ruleFile });
      } catch (err) {
        console.error('[오류] 제거 중 예외가 발생했습니다:', err.message);
        process.exit(1);
      }
      break;
    }

    case 'check-git': {
      const status = checkGitEnvironment();
      printGitNotice(status);
      break;
    }

    case 'status': {
      runEngine('group-status.cjs', args.slice(1));
      break;
    }

    case 'commit': {
      ensureGit('commit');
      const commitArgs = args.slice(1);
      if (commitArgs.length === 0) {
        commitArgs.push('--all');
      }
      runEngine('group-status.cjs', commitArgs);
      break;
    }

    case 'pull': {
      ensureGit('pull');
      runEngine('smart-pull.cjs', args.slice(1));
      break;
    }

    case 'resolve': {
      ensureGit('resolve');
      const resolveArgs = ['--resolve', ...args.slice(1).filter((a) => a !== '--resolve')];
      runEngine('smart-pull.cjs', resolveArgs);
      break;
    }

    case 'audit':
    case 'audit-push': {
      ensureGit('audit');
      runEngine('audit-push.cjs', args.slice(1));
      break;
    }

    default:
      console.error(`[오류] 알 수 없는 명령어: "${command}"\n`);
      printHelp();
      process.exit(1);
  }
}

main();

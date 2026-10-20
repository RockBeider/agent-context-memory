#!/usr/bin/env node
/**
 * bin/context-memory.js
 *
 * Context Memory System의 통합 CLI 진입점 (npx context-memory)
 */

const path = require('path');
const fs = require('fs');
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

function printHelp() {
  console.log(`
Context Memory System CLI (v${pkgVersion})
Three-Tier Context Memory Governance & Task-Centric Engine

사용법:
  npx context-memory <명령어> [옵션]
  또는 로컬 실행: node bin/context-memory.js <명령어> [옵션]

명령어:
  init [경로] [옵션]       지정된 경로(기본값: '.')에 Context Memory System 템플릿 설치
  uninstall [경로] [옵션]  지정된 경로(기본값: '.')에서 CMS 자산 및 주입 내용 안전 롤백/제거 (별칭: remove)
  check-git               현재 환경의 Git 설치 유무 및 연동 상태 진단
  status                  현재 프로젝트의 작업 단위 Git 상태 점검 (group-status)

옵션:
  -v, --version           현재 CLI 버전 출력
  -h, --help              도움말 출력
  -f, --force             확인 프롬프트 생략 및 강제 실행
  --dry-run               (uninstall 전용) 실제 파일 조작 없이 삭제 대상 미리보기
  --no-backup             (uninstall 전용) .agents 백업 디렉터리 생성 생략
  --rule-file=<파일명>    규칙 파일 직접 지정 (쉼표 구분 다중 지정 가능)
  -r <파일명>             --rule-file 의 축약형

예시:
  npx context-memory init
  npx context-memory init ./my-project --rule-file=CLAUDE.md
  npx context-memory uninstall
  npx context-memory uninstall ./my-project --dry-run
  npx context-memory uninstall ./my-project --force
  npx context-memory check-git
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`context-memory v${pkgVersion}`);
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
      const groupStatusScript = path.resolve(process.cwd(), 'scripts/group-status.cjs');
      if (fs.existsSync(groupStatusScript)) {
        require(groupStatusScript);
      } else {
        console.error('[오류] 현재 디렉터리에서 scripts/group-status.cjs를 찾을 수 없습니다.');
        console.error('먼저 `npx context-memory init`을 실행하여 시스템을 초기화하십시오.');
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`[오류] 알 수 없는 명령어: "${command}"\n`);
      printHelp();
      process.exit(1);
  }
}

main();

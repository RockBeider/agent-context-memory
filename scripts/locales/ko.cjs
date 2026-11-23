/**
 * scripts/locales/ko.cjs
 *
 * Korean ('ko') message catalog for Agent Context Memory (ACM).
 */

module.exports = {
  cli: {
    scriptNotFound: '[오류] 실행 대상 스크립트를 찾을 수 없습니다: {{scriptName}}',
    execError: '[오류] 스크립트 실행 중 에러가 발생했습니다:',
    unsupportedLang: '[오류] 지원하지 않는 언어입니다: "{{lang}}". 지원 언어: en, ko',
    nonGitCommitSkip: '[안내] Git 환경이 아니므로 Git 커밋을 건너뜁니다.',
    nonGitCommitHint: '       작업 완료 후 사용자 확인을 득하여 task-completed.md로 이관하십시오.',
    nonGitToolSkip: '[안내] Git 저장소가 아니거나 Git이 비활성화된 환경이므로 {{action}} 도구를 건너뜁니다.',
    installException: '[오류] 설치 중 예외가 발생했습니다:',
    uninstallException: '[오류] 제거 중 예외가 발생했습니다:',
    unknownCommand: '[오류] 알 수 없는 명령어: "{{command}}"\n',
    unsupportedStorage: '[오류] 지원하지 않는 저장소 방식입니다: "{{storage}}". 지원 방식: sqlite, markdown',
    help: `
Agent Context Memory CLI (v{{version}})
Three-Tier Context Memory Governance & Task-Centric Engine

사용법:
  npx agent-context-memory [명령어] [옵션]
  npx acm [명령어] [옵션]
  또는 로컬 실행: node bin/agent-context-memory.js [명령어] [옵션]

명령어:
  init [경로] [옵션]       (기본값) 지정된 경로(기본값: '.')에 Agent Context Memory 템플릿 설치
                           * 명령어 생략 시('npx agent-context-memory') 자동으로 init이 실행됩니다.
  uninstall [경로] [옵션]  지정된 경로(기본값: '.')에서 ACM 자산 및 주입 내용 안전 롤백/제거 (별칭: remove)
  check-git               현재 환경의 Git 설치 유무 및 연동 상태 진단
  status [옵션]           작업 단위 Git 상태 점검 (group-status)
  commit [옵션]           작업 단위 개별 원자 커밋 실행 (기본값: --all)
  pull [options]          원격 변경사항 지능형 3-Way 병합 (smart-pull)
  resolve [옵션]          3-Way 충돌 정밀 하이브리드 결합 완결
  audit                   원격 브랜치 푸시 전 위생 및 정적 감사 (별칭: audit-push)
  task [하위명령]         로컬 저장소 태스크 관리 (list, add, update, complete, show, lease)
  pattern [하위명령]      지식 패턴 관리 (list, add, show)
  adr [하위명령]          아키텍처 결정 기록(ADR) 관리 (list, add, show)
  search <검색어>         태스크·패턴·ADR 통합 전문 검색
  migrate [옵션]          sqlite <-> markdown 저장소 양방향 마이그레이션
  export [옵션]           전체 메모리 저장소 JSON 또는 Markdown 내보내기
  import <파일> [옵션]    JSON 스냅샷을 메모리 저장소로 가져오기
  sync [옵션]             Git orphan 브랜치(acm-memory)와 공유 메모리 동기화
  mcp [--print-config]    순수 stdio MCP 서버 실행 (또는 클라이언트 JSON 설정 출력)

옵션:
  -v, --version               현재 CLI 버전 출력
  -h, --help                  도움말 출력
  -f, --force                 확인 프롬프트 생략 및 강제 실행
  -l, --lang <en|ko>          설치/실행 언어 지정 (기본값: en)
  --lang=<en|ko>              --lang <en|ko> 와 동일
  --storage=<sqlite|markdown> 초기화 시 저장소 백엔드 지정 (Node >= 22.13 기본값: sqlite)
  --non-interactive           대화형 프롬프트 생략 (미감지 시 en, sqlite, AGENTS.md 자동 폴백)
  --dry-run                   실제 조작 없이 결과 미리보기
  --no-backup                 (uninstall 전용) .agents 백업 디렉터리 생성 생략
  --rule-file=<파일명>        규칙 파일 직접 지정 (쉼표 구분 다중 지정 가능)
  -r <파일명>                 --rule-file 의 축약형

예시:
  npx agent-context-memory
  npx agent-context-memory --lang=ko --storage=sqlite
  npx agent-context-memory --force
  npx agent-context-memory init --storage=markdown
  npx agent-context-memory task list
  npx agent-context-memory search "원자 커밋"
  npx agent-context-memory mcp --print-config
  npx agent-context-memory status
  npx agent-context-memory commit
  npx agent-context-memory commit --commit=1
  npx agent-context-memory pull
  npx agent-context-memory audit
  npx agent-context-memory uninstall --dry-run
`,
  },

  install: {
    usage: `=======================================================
  Agent Context Memory 템플릿 인스톨러
=======================================================

사용법:
  node scripts/install-template.cjs [target-directory] [옵션]

옵션:
  --force, -f                 : 이미 존재하는 파일이 있을 경우 강제 덮어쓰기
  --lang=<en|ko>, -l          : 템플릿 및 CLI 언어 지정 (기본값: en)
  --storage=<sqlite|markdown> : 저장소 백엔드 선택 (Node >= 22.13 기본값: sqlite)
  --non-interactive           : 대화형 프롬프트 생략 (기본값: en, sqlite, AGENTS.md)
  --rule-file=<파일명>        : 규칙을 적용할 대상 파일 직접 지정 (쉼표 구분 다중 지정 가능)
  -r <파일명>                 : --rule-file 의 축약형

예시:
  node scripts/install-template.cjs .
  node scripts/install-template.cjs D:/work/new-project --lang=ko
  node scripts/install-template.cjs ./my-app --storage=markdown
  node scripts/install-template.cjs ./my-app --rule-file=CLAUDE.md
  node scripts/install-template.cjs ./my-app --force
`,
    missingTemplateDir: '[오류] 템플릿 소스 디렉터리가 존재하지 않습니다: {{dir}}',
    intro: 'Agent Context Memory (ACM) 설치 및 초기화',
    langPromptMessage: 'Select language / 언어를 선택하세요:',
    langOptionEnLabel: 'English (Default)',
    langOptionEnHint: 'Recommended default for AI coding agents & lower token usage',
    langOptionKoLabel: '한국어 (Korean)',
    langOptionKoHint: '한국어 거버넌스 문서 및 CLI 출력',
    langPromptFallback: '  Select language / 언어를 선택하세요 [1: English (Default), 2: 한국어 (Korean)] (default: 1): ',
    langSelected: '선택된 언어: {{label}}',
    storagePromptMessage: '기본 메모리 저장소 백엔드를 선택하세요:',
    storageOptionSqliteLabel: '로컬 SQLite DB (권장)',
    storageOptionSqliteHint: '내장 node:sqlite + FTS5 BM25 검색 (.agents/local/memory.db), 추후 온라인 동기화 확장 지원',
    storageOptionMarkdownLabel: '레거시 Markdown 파일',
    storageOptionMarkdownHint: '기존 파일 기반 .agents/ 마크다운 거버넌스 (구버전 Node.js 호환)',
    storagePromptFallback: '  저장소 백엔드를 선택하세요 [1: 로컬 SQLite DB (권장), 2: 레거시 Markdown] (기본값: 1): ',
    storageSelected: '선택된 저장소: {{label}}',
    storageFallbackMarkdownWarn: '  [안내] 내장 node:sqlite는 Node.js >= 22.13.0이 필요합니다(현재: {{version}}). markdown 모드로 폴백합니다.',
    storageMigrated: '  [이관] 기존 Markdown 데이터를 SQLite DB로 자동 적재했습니다 (태스크: {{tasks}}, 완료: {{completedTasks}}, 패턴: {{patterns}}, ADR: {{adrs}}).',
    targetAndMode: '대상 경로: {{targetDir}}\n모드: {{mode}}',
    modeForce: '강제 덮어쓰기 (--force)',
    modeSafe: '안전 보존 모드',
    gitEnabled: '{{version}} 감지됨 (Git 저장소 연동 활성화)',
    gitNonRepo: '{{version}} 감지됨 (비-Git 프로젝트: Git 연계 기능은 제한 모드로 동작)',
    gitMissing: 'Git이 감지되지 않았습니다 (비-Git 메모리 거버넌스 모드로 초기화)',
    cancelled: '설치가 사용자에 의해 취소되었습니다.',
    cancelledCli: '\n[취소] 설치가 사용자에 의해 취소되었습니다.\n',
    specifiedRuleFiles: '지정된 규칙 파일: {{files}}',
    detectedRuleFiles: '기존 AI 에이전트 규칙 파일 {{count}}건 자동 감지: {{files}}',
    spinnerStart: '템플릿 파일 복제 및 거버넌스 규칙 동기화 중...',
    spinnerStop: '템플릿 자산 및 거버넌스 동기화 완료',
    summary:
      '템플릿 복제: 신규 {{created}}건 / 덮어씀 {{overwritten}}건 / 보존 {{skipped}}건' +
      '\n규칙 주입 대상: {{files}}' +
      '\npackage.json 스크립트 추가: {{addedCount}}건',
    summaryStorage: '저장소 백엔드: {{storage}} (.agents/config.json)',
    nextStepsTitle: '다음 단계 가이드',
    outro: 'Agent Context Memory 설치가 완료되었습니다.',
    bannerStart: '  Agent Context Memory 설치 및 초기화 시작',
    bannerSource: '  출처 자산 : {{dir}}',
    bannerTarget: '  대상 경로 : {{dir}}',
    bannerLang: '  적용 언어 : {{lang}}',
    bannerStorage: '  저장소    : {{storage}}',
    bannerMode: '  옵션      : {{mode}}',
    bannerRule: '  규칙 대상 : {{ruleFile}} (명시적 지정)',
    bannerComplete: '  Agent Context Memory 설치가 완료되었습니다.',
    nextStepsHeading: '다음 단계 가이드:',
    step1Scan: '[1/3] AI 에이전트 규칙 파일 대상 스캔 및 결정 중...',
    step2Copy: '\n[2/3] 템플릿 시스템 파일 복제 중...',
    step2Stats: '  -> 복제 결과: 신규 {{created}}건 / 덮어씀 {{overwritten}}건 / 보존 {{skipped}}건\n',
    step3Rules: '[3/3] AI 에이전트 규칙 파일 동기화 중...',
    copyKeep: '  [보존] {{file}} (기존 파일 존재)',
    copyOverwrite: '  [덮어씀] {{file}}',
    copyCreate: '  [생성] {{file}}',
    pkgPostinstallSkip: '\n[추가 연동 1/2] postinstall 환경: 호스트 package.json 보호를 위해 스크립트 주입은 npx acm init 실행 시 수행됩니다.',
    pkgSyncStart: '\n[추가 연동 1/2] 대상 package.json 스크립트 설정 중...',
    pkgParseWarn: '  [경고] 기존 package.json 파싱 실패. 스크립트 주입을 건너뜁니다.',
    pkgSynced: '  -> package.json 내 git:* 스크립트 {{count}}개 항목 동기화 완료.',
    gitignoreGitDetected: '\n[추가 연동 2/2] Git 환경 감지: .gitignore 동기화 중...',
    gitignoreNoGit: '\n[추가 연동 2/2] Git 미설치 환경: .gitignore 동기화를 건너뜁니다.',
    gitignoreCreated: '  [생성] .gitignore ({{entries}} 등록 완료)',
    gitignorePreserved: '  [보존] .gitignore (이미 {{entries}} 항목 등록됨)',
    gitignoreAppended: '  [동기화] .gitignore ({{entries}} 등록 추가)',
    nextCd: '대상 프로젝트 이동: cd "{{dir}}"',
    nextTask: '작업 기억 정본 확인: .agents/task/task.md',
    nextDbTip: '로컬 메모리 DB 관리: npx acm task list / npx acm search "<검색어>"',
    nextRules: '거버넌스 규칙 점검: {{files}} 및 .agents/MEMORY_GOVERNANCE.md',
    nextGitStatus: '작업 단위 커밋 상태 확인: npm run git:status',
    nextNonGitNote: '[주의] Git 미설치 환경이므로 Git 커밋 도구는 제한 모드입니다.',
    postinstallStart: '\n[ACM postinstall] 호스트 프로젝트 감지에 따른 자동 초기화를 시작합니다...',
    postinstallWarn: '[ACM postinstall 경고] 자동 초기화 중 예외가 발생하여 건너뜁니다: {{message}}',
  },

  uninstall: {
    usage: `=======================================================
  Agent Context Memory 템플릿 언인스톨러 (Uninstall)
=======================================================

사용법:
  node scripts/uninstall-template.cjs [target-directory] [옵션]

옵션:
  --dry-run               : 실제 삭제 없이 제거 대상 시뮬레이션 출력
  --force, -f             : 대화형 확인 프롬프트 건너뛰기
  --no-backup             : .agents 백업 생성 건너뛰기
  --lang=<en|ko>, -l      : 출력 언어 지정
  --rule-file=<파일명>    : 규칙을 제거할 대상 파일 직접 지정 (쉼표 구분 다중 지정 가능)
  -r <파일명>             : --rule-file 의 축약형

예시:
  node scripts/uninstall-template.cjs .
  node scripts/uninstall-template.cjs ./my-app --dry-run
  node scripts/uninstall-template.cjs ./my-app --force
`,
    bannerTitle: '  Agent Context Memory 제거(Uninstall) 및 롤백 시작',
    bannerTarget: '  대상 경로 : {{dir}}',
    bannerMode: '  실행 모드 : {{mode}}',
    modeDryRun: '시뮬레이션 모드 (--dry-run)',
    modeExecute: '실제 삭제 모드',
    bannerBackup: '  백업 정책 : {{backup}}',
    backupSkip: '백업 생략 (--no-backup)',
    backupActive: '안전 백업 활성화',
    confirmPrompt: '\n정말 대상 프로젝트에서 Agent Context Memory를 제거하시겠습니까? (y/N): ',
    cancelled: '\n[취소] 사용자에 의해 제거 작업이 중단되었습니다.\n',
    step1: '\n[1/5] ACM 소유 디렉터리 검사 및 제거 중...',
    dirMissing: '  [미존재 건너뜀] {{path}}',
    dryBackup: '  [미리보기] 백업 디렉터리 생성 예정: {{backupDir}}',
    backupDone: '  [백업 완료] {{src}} -> {{dest}}',
    dryDirDelete: '  [미리보기] 디렉터리 전체 삭제 예정: {{path}}',
    dirDeleted: '  [디렉터리 삭제] {{path}}',
    step2: '\n[2/5] ACM 배포 개별 파일 선별 삭제 중...',
    dryFileDelete: '  [미리보기] 파일 삭제 예정: {{path}}',
    fileDeleted: '  [파일 삭제] {{path}}',
    emptyDirCleaned: '  [빈 디렉터리 정리] {{dir}}',
    userFilesPreserved: '  [사용자 파일 보존] {{dir}} (잔존 파일 {{count}}개 보존)',
    step3: '\n[3/5] package.json 스크립트 원복 중...',
    pkgMissing: '  [건너뜀] package.json 파일 미존재',
    pkgParseWarn: '  [경고] package.json 파싱 실패로 스크립트 원복을 건너뜁니다.',
    pkgNoScripts: '  [건너뜀] scripts 필드 없음',
    dryScriptRemove: '  [미리보기] 스크립트 제거 예정: "{{key}}"',
    scriptRemoved: '  [스크립트 제거] "{{key}}": "{{cmd}}"',
    scriptModifiedKeep: '  [수정본 보존] "{{key}}" 명령어가 사용자에 의해 변경되어 있어 보존합니다.',
    pkgReverted: '  -> package.json 내 ACM 스크립트 {{count}}개 항목 원복 완료.',
    step4: '\n[4/5] .gitignore 무시 규칙 원복 중...',
    gitignoreMissing: '  [건너뜀] .gitignore 파일 미존재',
    dryGitignoreKeepEmpty: '  [미리보기] .gitignore (기존 사용자 파일 유지, ACM 엔트리만 제거 예정)',
    dryGitignoreDelete: '  [미리보기] .gitignore (ACM 외 내용 없어 파일 삭제 예정)',
    dryGitignoreRemoveEntries: '  [미리보기] .gitignore 내 .agent 엔트리 제거 예정',
    gitignoreKeptEmpty: '  [보존] .gitignore (기존 사용자 파일 유지, ACM 엔트리만 제거)',
    gitignoreDeleted: '  [파일 삭제] .gitignore (ACM 엔트리 외 내용이 없어 파일 삭제)',
    gitignoreStripped: '  [엔트리 제거] .gitignore 내 .agent 엔트리 절제 완료',
    gitignoreNone: '  [보존] .gitignore 내 ACM 관련 엔트리가 발견되지 않음',
    step5: '\n[5/5] AI 에이전트 규칙 파일 거버넌스 룰 절삭 중...',
    dryRuleMatch: '  [미리보기] {{file}} (거버넌스 블록 일치 -> 절삭 예정)',
    dryRuleModified: '  [미리보기 경고] {{file}} (거버넌스 블록 수정 감지 -> 사용자 확인 대상)',
    ruleRemovedFile: '  [규칙 파일 삭제] {{file}} (거버넌스 제거 후 빈 파일 정리)',
    ruleCleaned: '  [규칙 블록 절삭] {{file}} (거버넌스 제거 및 사용자 프롬프트 보존)',
    rulePreserved: '  [규칙 보존] {{file}} ({{detail}})',
    doneDryRun1: '  [완료] 시뮬레이션(Dry-run) 검사가 완료되었습니다.',
    doneDryRun2: '  실제 파일은 변경되지 않았습니다.',
    doneReal: '  Agent Context Memory 제거 및 롤백이 완료되었습니다.',
    backupListHeader: '보관된 백업 목록:',
  },

  rules: {
    optAgentsHint: '표준 가드레일 정본 (권장)',
    optClaudeHint: 'Claude Code 전용',
    optGeminiHint: 'Gemini CLI 전용',
    optCursorHint: 'Cursor IDE 전용',
    optWindsurfHint: 'Windsurf 전용',
    optCustomLabel: '직접 입력 (기타 규칙 파일명)',
    optCustomHint: '예: .github/copilot-instructions.md',
    detailNotExists: '파일이 존재하지 않음',
    detailNoMarker: 'ACM 거버넌스 마커 미존재',
    driftWarn: '\n  [경고] "{{file}}" 내 ACM 거버넌스 블록 내용이 원본과 다르게 수정되어 있습니다.',
    driftPrompt: '  -> 변경된 거버넌스 블록을 그래도 삭제하시겠습니까? (y/N): ',
    driftPreservedUser: '  [보존] 사용자 확인에 따라 "{{file}}" 내 수정된 거버넌스 블록을 보존합니다.',
    detailUserDeclined: '사용자가 삭제 거부함',
    driftPreservedNonInteractive: '  [보존] 비대화형 세션에서 수정된 거버넌스 블록이 감지되어 안전하게 보존합니다. (강제 삭제: --force)',
    detailNonInteractiveSafe: '비대화형 세션 안전 보존',
    detailRemovedEmpty: '거버넌스 외 내용이 없어 파일 삭제됨',
    detailCleaned: '거버넌스 블록 제거 및 사용자 내용 보존',
    fallbackNoRules: '\n  [안내] 대상 프로젝트에서 기존 AI 에이전트 규칙 파일이 감지되지 않았습니다.',
    fallbackExamples: '  대표 에이전트 예시: Claude(CLAUDE.md), Gemini(GEMINI.md), Cursor(.cursorrules), 표준(AGENTS.md)',
    fallbackPrompt: '  -> 사용할 규칙 파일명을 입력하세요 (기본값: AGENTS.md, 쉼표 구분 다중 지정 가능): ',
    clackNoRules: '대상 프로젝트에서 기존 AI 에이전트 규칙 파일이 감지되지 않았습니다.',
    clackSelectPrompt: '사용할 AI 에이전트 규칙 파일을 선택하세요 (↑/↓ 이동, Space 선택, Enter 확인):',
    clackCustomPrompt: '직접 추가할 규칙 파일명을 입력하세요 (쉼표 구분 다중 지정 가능):',
    clackCustomRequired: '최소 1개 이상의 파일명을 입력해야 합니다.',
    autoScanDetected: '  [자동 스캔] 기존 AI 에이전트 규칙 파일 {{count}}건 감지: {{files}}',
    autoFallbackDefault: '  [자동 폴백] 감지된 규칙 파일이 없어 표준 정본 AGENTS.md로 자동 설정합니다.',
    ruleCreated: '  [규칙 생성] {{file}} (Agent Context Memory 거버넌스 주입)',
    ruleSynced: '  [규칙 동기화] {{file}} (기존 내용 보존 및 거버넌스 갱신)',
  },

  checkGit: {
    repoActive: '[환경 점검] {{version}} 감지됨 (Git 저장소 연동 활성화)',
    nonRepo: '[환경 점검] {{version}} 감지됨 (비-Git 프로젝트)',
    nonRepoDesc1: '[안내] 현재 대상 디렉터리는 Git 저장소(.git)가 아닙니다.',
    nonRepoDesc2: '  - 3계층 인지 메모리 거버넌스 및 문서 관리는 정상 작동합니다.',
    nonRepoDesc3: '  - 작업 단위 자동 커밋 등 Git 연계 기능은 비활성화 모드로 동작합니다.',
    nonRepoDesc4: '  - 추후 Git 기능을 사용하려면 `git init` 명령으로 저장소를 초기화하십시오.\n',
    noGitHeader: '[안내] 시스템에 Git이 설치되어 있지 않거나 PATH에 없습니다.',
    noGitLine1: '1. 3계층 인지 메모리 거버넌스 및 문서 관리 체계는 정상 배포 및 작동합니다.',
    noGitLine2: '2. 단, 아래 Git 연계 기능은 비활성화(제한 모드)됩니다:',
    noGitFeature1: '   - 작업 단위 자동 분류 커밋 도구 (group-status.cjs / commit)',
    noGitFeature2: '   - 커밋 SHA 기반 완료 검증 (비-Git 환경에서는 사용자 확인 기반 완료 지원)',
    noGitFeature3: '   - 지능형 3-Way 동기화 및 감사 파이프라인 (smart-pull / audit-push)',
    noGitInstallTip: '3. 모든 기능을 온전히 사용하시려면 추후 Git을 설치해 주십시오.',
    noGitDownloadUrl: '   공식 다운로드: https://git-scm.com/downloads',
  },

  groupStatus: {
    taskParseWarn: '[경고] task.md 파싱 실패:',
    patternTitle: '[{{id}}] {{category}} 패턴',
    memoryStatus: '메모리 ({{id}})',
    changelogPurposeFallback: '{{key}}: {{val}}',
    commitBodyPurpose: '- 목적: {{purpose}}',
    commitBodyDetails: '- 세부 내용:',
    bucketRulesTitle: '프로젝트 운영 규칙 및 거버넌스 규약 갱신',
    bucketRulesPurpose: 'GEMINI.md, AGENTS.md, README.md 등 거버넌스 및 규칙 문서 최신화',
    bucketMemoryTitle: '메모리 태스크 및 지식 베이스 동기화',
    bucketMemoryPurpose: '작업 정본(task) 및 패턴/체인지로그(memory) 문서 갱신',
    bucketScriptsTitle: '개발 및 자동화 스크립트 도구 갱신',
    bucketScriptsPurpose: '빌드, 형상관리 및 워크플로우 자동화 도구 개선',
    bucketUiTitle: 'UI 컴포넌트 및 스타일 레이아웃 보완',
    bucketUiPurpose: '디자인 토큰, 스타일시트 및 UI 컴포넌트 레이아웃 보완',
    bucketCoreTitle: '공통 설정 및 프로젝트 인프라 갱신',
    bucketCorePurpose: '패키지 매니페스트 및 전역 설정 파일 갱신',
    bucketMiscTitle: 'task.md 미등록 워킹 트리 변경사항',
    bucketMiscPurpose: 'task.md에 [커밋 대기]로 등록되지 않은 변경 파일 (커밋 전 task.md 등록 권장)',
    statusAuxiliary: '보조 작업',
    statusUnregistered: '미등록 (task.md 등록 필요)',
    sourceAuto: '자동 분류',
    autoCompleteSqlite: '[자동 이관] {{tskId}} 완료 내역이 SQLite DB{{projMsg}}에 자동 기록되었습니다.',
    autoCompleteSqliteProj: ' 및 task-completed.md 투영',
    autoCompleteSqliteWarn: '[경고] SQLite 완료 태스크 자동 이관 중 예외 발생: {{message}}',
    autoCompleteMd: '[자동 이관] {{tskId}} 완료 내역이 {{file}}에 자동 기록되었습니다.',
    autoCompleteMdWarn: '[경고] 완료 태스크 자동 이관 중 예외 발생: {{message}}',
    sharedMissingSha: '[오류] 공유 태스크 이관용 HEAD SHA를 확인할 수 없습니다: {{title}}',
    sharedArchiveLog: '\n>>> [공유 커밋 이관] {{title}} (선행 커밋 SHA: {{sha}})',
    commitExecLog: '\n>>> [커밋 실행] {{title}} ({{count}}개 파일)',
    errTempIndexInit: '[오류] 임시 인덱스 초기화 실패: {{detail}}',
    errTempIndexRm: '[오류] 임시 인덱스 git rm 실패: {{title}}',
    errTempIndexAdd: '[오류] 임시 인덱스 git add 실패: {{title}}',
    errConflictMarkers: '[오류] 미해소 충돌 마커(<<<<<<<) 감지:\n{{detail}}',
    errWriteTree: '[오류] git write-tree 실패: {{detail}}',
    errNoActualChanges: '[오류] 커밋할 실제 변경 경로가 없습니다: {{title}}',
    errCommitTree: '[오류] git commit-tree 실패:\n{{detail}}',
    errUpdateRef: '[오류] git update-ref 실패:\n{{detail}}',
    errGitRm: '[오류] git rm 실패: {{title}}',
    errGitAdd: '[오류] git add 실패: {{title}}',
    errGitCommit: '[오류] git commit 실패:\n{{detail}}',
    commitSuccess: '[성공] 커밋 완료! (SHA: {{sha}})',
    commitHeader: '       헤더: {{header}}',
    nonGitCompact: '[비-Git 환경] Git 변경 감지 비활성화 | 활성 태스크: {{activeCount}}건 | 누적 패턴: {{patternCount}}건',
    nonGitHeader: '  Agent Context Memory 메모리 상태 점검 (비-Git 모드)',
    nonGitSub1: '  [안내] Git 저장소가 아니거나 Git이 비활성화된 환경입니다.',
    nonGitSub2: '         (파일 변경 감지 및 자동 커밋 비활성화, 메모리 뷰어 가동)',
    nonGitSec1: '[1] 작업 기억 정본 ({{storageLabel}}) - 활성 작업 {{count}}건:',
    nonGitNoActive: '    (현재 진행 중인 활성 태스크가 없습니다.)\n',
    nonGitPurpose: '       목적: {{purpose}}',
    nonGitTargets: '       대상 영역: {{targets}}',
    nonGitSec2: '[2] 변경 이력 메모리 (project-changelog.md) - 최근 {{count}}건:',
    nonGitNoAdr: '    (기록된 최근 체인지로그가 없습니다.)\n',
    nonGitSec3: '[3] 축적된 설계 패턴 및 해결책 (patterns/) - 총 {{count}}건:',
    nonGitNoPattern: '    (기록된 해결 패턴이 없습니다.)\n',
    nonGitFooterTitle: '  [비-Git 환경 작업 완료 안내]',
    nonGitFooter1: '  - 태스크 완료 시 사용자에게 검증 결과 보고 후 이관 여부를 확인받고,',
    nonGitFooter2: '    task-completed.md 로 이관하십시오.',
    nonGitCommitBlocked: '[안내] Git 환경이 아니므로 Git 커밋을 실행할 수 없습니다.',
    nonGitCommitBlockedHint: '       작업 완료 후 사용자 확인을 득하여 task-completed.md로 이관하십시오.',
    cleanCompact: '[CLEAN] 커밋할 변경사항 없음 (워킹 트리 깨끗함)',
    cleanBanner: '  [안내] 현재 워킹 트리가 깨끗합니다. (커밋할 파일 없음)',
    compactSummary: '[작업 단위 커밋 현황] 총 {{totalFiles}}개 파일 / {{groupCount}}개 작업',
    compactSharedCount: '{{count}}개 공유 파일',
    compactFileCount: '{{count}}개 파일',
    compactRow: '[작업 {{idx}}] {{status}} | {{title}} ({{countLabel}}) -> {{header}}',
    errNoMatchingGroup: '[오류] 일치하는 작업 그룹을 찾을 수 없습니다: {{arg}}',
    errNoReadyAll: '  [중단] 현재 task.md에 "[커밋 대기]" 상태로 매칭된 작업이 없습니다.',
    errNoReadyAllHint1: '         커밋할 작업을 task.md에 "[커밋 대기] TSK-X" 양식',
    errNoReadyAllHint2: '         (목적 / 수행결과 / 대상영역)으로 먼저 기록한 뒤 실행하세요.',
    allStart: '  [커밋 대기 작업 순차 원자 커밋 시작] 총 {{count}}개 작업',
    allStepError: '\n[중단] 작업 {{idx}} 커밋 중 오류가 발생하여 후속 작업을 중단합니다.',
    allDone: '  [완료] 총 {{count}}개 작업의 개별 원자 커밋이 완료되었습니다.',
    allDoneRow: '- [작업 {{idx}}] (SHA: {{sha}}) {{header}}',
    preservedTitle: "[보존 안내] '[커밋 대기]' 태스크에 매핑되지 않은 파일 {{count}}건은",
    preservedSubtitle: '            오커밋 방지를 위해 워킹 트리에 안전하게 보존되었습니다:',
    reportTitle: '  Agent Context Memory 작업 단위(Task-Centric) 커밋 도구',
    reportPrinciple: '  [대원칙] task.md 및 memory 문서를 기반으로 작업별 원자 커밋!',
    reportSummary: '[안내] 총 {{totalFiles}}개 파일이 {{groupCount}}개 작업 단위로 분류되었습니다:\n',
    reportSharedCount: '선행 태스크와 {{count}}개 파일 공유 - 커밋 시 직전 SHA로 자동 이관',
    reportFileCount: '{{count}}개 파일',
    reportGroupHeader: '[작업 {{idx}}] [{{status}}] {{title}} ({{countLabel}})',
    reportSource: '  출처: {{source}}',
    reportPurpose: '  목적: {{purpose}}',
    reportRenameSuffix: ' (이전: {{oldFile}})',
    reportSharedTag: '[공유]',
    reportCommitMsgLabel: '\n  [자동 생성 커밋 메시지]:',
    optionsTitle: '  [실행 옵션 안내]',
    optCommitOne: '  - 특정 작업만 커밋 : node scripts/group-status.cjs --commit=<작업번호>',
    optCommitAll: '  - 전체 순차 커밋   : node scripts/group-status.cjs --all',
    optCompact: '  - 에이전트 요약    : node scripts/group-status.cjs --compact',
    dryRunDone: '[드라이런 완료] 커밋을 실행하지 않고 종료합니다.',
    nonInteractiveSkip1: '[비대화형 세션] 대화형 프롬프트를 건너뛰고 정상 종료합니다.',
    nonInteractiveSkip2: '               커밋 실행 시 --commit=<번호> 또는 --all 옵션을 사용하세요.\n',
    promptSelect: '[선택] 커밋할 작업 번호를 입력하세요 (예: 1 또는 2, 전체는 all, 종료는 q): ',
    promptCancelled: '[종료] 커밋 작업을 취소했습니다.',
    promptNoReady: '\n[중단] task.md에 "[커밋 대기]" 상태로 매칭된 작업이 없습니다.',
    promptAllStart: '\n[커밋 대기 작업 순차 원자 커밋 실행] 총 {{count}}개 작업',
    promptAbortedError: '[오류 발생으로 중단됨]',
    promptInvalidRange: '[오류] 1부터 {{max}} 사이의 숫자를 입력해주세요.',
  },

  smartPull: {
    bannerTitle: '  Agent Context Memory 스마트 원격 동기화 및 정밀 병합 엔진 (smart-pull)',
    virtualMergeLog: '[사전 진단] 인메모리 가상 병합(git merge-tree) 시뮬레이션 중 ({{remote}}/{{branch}})...',
    ruleImportExport: 'Import/Export 합집합 공존 결합',
    ruleJsonKeyValue: 'JSON 키-값 공존 결합',
    ruleFunctionBlock: '독립 함수/메서드 블록 순차 공존 결합',
    ruleJsxProps: 'JSX/HTML 태그 속성 공존 결합',
    ruleUnresolved: '자동 판정 불가 (수동 선택 또는 확인 필요)',
    fileNotFound: '파일 없음',
    gatesTitle: '  Agent Context Memory 병합 후 3대 품질 게이트 검증',
    gate1Start: '[게이트 1/3] 잔여 충돌 마커(<<<<<<<) 전수 검사...',
    gate1Fail: '  [실패] 잔여 충돌 마커가 검출되었습니다:\n',
    gate1Pass: '  -> 통과: 잔여 충돌 마커 0건.\n',
    gate2Start: '[게이트 2/3] 정적 분석 검증 (lint / typecheck)...',
    gate2Skip: '  -> [건너뜀] package.json에 lint/typecheck 스크립트가 정의되어 있지 않습니다.\n',
    gate2Run: '  -> 실행 중: npm run {{scriptName}}',
    gate2Fail: '  [실패] 정적 분석(npm run {{scriptName}}) 실패:\n',
    gate2Pass: '  -> 통과: 정적 분석 검증 완료.\n',
    gate3Start: '[게이트 3/3] 프로젝트 빌드 무결성 검증 (npm run build)...',
    gate3Skip: '  -> [건너뜀] package.json에 build 스크립트가 정의되어 있지 않습니다.\n',
    gate3Pass: '\n  -> 통과: 프로젝트 빌드 무결성 확인 완료.\n',
    gate3Fail: '\n  [실패] 프로젝트 빌드 실패. 소스 구문 또는 임포트를 확인하십시오.',
    manualNeeded: '[수동 선택 필요] 파일: {{filePath}} (청크 #{{chunkIdx}})',
    manualOurs: '<<< [로컬 HEAD (Ours)]:\n{{ours}}\n===',
    manualTheirs: '>>> [원격 변경사항 (Theirs)]:\n{{theirs}}',
    manualPromptTitle: '선택하십시오:',
    manualChoice1: '  1: 로컬 유지 (Keep Ours)',
    manualChoice2: '  2: 원격 수용 (Keep Theirs)',
    manualChoice3: '  3: 양쪽 결합 (Ours 후 Theirs 순차 배치)',
    manualChoice4: '  4: 양쪽 결합 (Theirs 후 Ours 순차 배치)',
    manualChoice5: '  5: 건너뛰기 (충돌 마커 유지, 직접 수동 수정)',
    manualQuestion: '선택 번호 (1-5): ',
    checkFetchStart: '[1/2] 원격 브랜치 정보 갱신 (git fetch {{remote}} {{branch}})...',
    checkFetchDone: '  -> 원격 동기화 완료.\n',
    checkFetchWarn: '  [경고] 원격 fetch 실패 (오프라인/네트워크). 로컬 캐시 기준으로 진단합니다.\n',
    checkSimStart: '[2/2] 가상 병합 사전 진단 시뮬레이션...',
    branchStatus: '\n[브랜치 상태] 로컬 ahead: {{ahead}}개 커밋 / 원격 behind: {{behind}}개 커밋',
    alreadyUpToDate: '\n[성공] 원격의 최신 커밋이 이미 로컬에 모두 반영되어 있습니다.',
    noMergeNeeded: '       별도의 병합(git pull/merge)이 필요하지 않습니다.\n',
    conflictsExpected: '[주의] 총 {{count}}개 파일에서 충돌(CONFLICT)이 예상됩니다:',
    conflictFileLine: '  [충돌 파일] {{file}}',
    autoMergeableTitle: '\n[안내] 아래 파일들은 충돌 없이 자동으로 병합됩니다:',
    autoMergeableLine: '  [자동 병합] {{file}}',
    checkResolutionHint1: '\n[해결 방법]',
    checkResolutionHint2: '  "npm run git:pull" 을 실행하면 정밀 하이브리드 결합 엔진이',
    checkResolutionHint3: '  충돌을 자동으로 해소하고 3대 품질 게이트 검증 후 커밋을 완결합니다.\n',
    checkCleanSuccess: '\n[성공] 충돌 예상 파일이 없습니다! (100% 자동 병합 가능)',
    autoMergeTargetTitle: '\n[자동 병합 대상]:',
    checkCleanHint: '\n"npm run git:pull" 로 안전하게 최신 변경사항을 병합하십시오.\n',
    resolveModeStart: '[충돌 해소 모드] 현재 워킹 트리의 충돌 파일 검사 중...',
    resolveAllStaged: '  -> 모든 충돌이 이미 해소되어 스테이징 완료된 상태입니다.',
    resolveProceedGates: '  -> 3대 품질 게이트 검증 및 머지 커밋 확정으로 진행합니다.\n',
    resolveNothing: '  -> 현재 충돌(Unmerged) 상태이거나 진행 중인 병합이 없습니다.\n',
    resolveDetectedCount: '  -> 총 {{count}}개의 충돌 파일이 감지되었습니다:\n',
    resolvingFile: '[정밀 병합 중] {{file}} ...',
    resolvingFilePull: '  [정밀 분석 및 결합] {{file}} ...',
    resolvedAllChunks: '  -> 성공: 총 {{count}}개 충돌 청크 자동 해소 완료!',
    resolvedAllChunksPull: '    -> 성공: {{count}}개 충돌 청크 자동 해소 완료!',
    chunkApplied: '     청크 #{{index}}: [{{rule}}] 적용',
    chunkAppliedPull: '       청크 #{{index}}: [{{rule}}] 적용',
    partialResolve: '  -> 주의: 일부 청크 자동 해소 불가 ({{resolved}}/{{total}} 해소됨)',
    partialResolvePull: '    -> 주의: 일부 청크 자동 해소 불가 ({{resolved}}/{{total}} 해소됨)',
    manualChoiceApplied: '     청크 #{{index}}: 사용자 수동 선택 반영 완료',
    manualChoiceAppliedPull: '       청크 #{{index}}: 사용자 수동 선택 반영 완료',
    markersRemainWarn: '  [경고] {{file}} 파일에 미해소 충돌 마커가 남아 있습니다.',
    markersRemainWarnPull: '    [경고] {{file}} 파일에 미해소 충돌 마커가 남아 있습니다.',
    resolveUnresolvedErr: '\n[오류] 일부 충돌이 자동으로 해소되지 않았습니다. 해당 파일을 직접 확인하십시오.\n',
    resolveDryRunDone: '\n[Dry-Run 완료] 실제 파일 쓰기 및 커밋은 수행되지 않았습니다.\n',
    gatesFailedHold: '\n[품질 게이트 실패] 3대 품질 게이트를 통과하지 못하여 커밋이 보류되었습니다.\n',
    creatingMergeCommit: '[머지 커밋 생성 중] 원자적 머지 커밋을 확정합니다...',
    mergeCommitMsg: 'merge: 원격({{remote}}/{{branch}}) 최신 변경사항 정밀 하이브리드 병합',
    resolveSuccess: '\n[성공] 정밀 하이브리드 병합 및 머지 커밋 완료! (Commit: {{sha}})\n',
    mergeCommitErr: '  [오류] 머지 커밋 실패:',
    pullStep1: '[1/5] 워킹 트리 상태 확인 중...',
    pullDirtyErr1: '\n[오류] 워킹 트리에 커밋되지 않은 변경사항이 있습니다.',
    pullDirtyErr2: '       먼저 "npm run git:commit" 또는 stash로 작업본을 정리한 후 실행하십시오.\n',
    pullCleanOk: '  -> 워킹 트리 청결 상태 확인 완료.\n',
    pullStep2: '[2/5] 원격 저장소 동기화 (git fetch {{remote}} {{branch}})...',
    pullFetchOk: '  -> 원격 최신화 완료.\n',
    pullFetchErr: '  [오류] 원격 fetch 실패:',
    pullStep3: '[3/5] 사전 가상 병합 진단...',
    pullStatusLine: '  -> 로컬 ahead: {{ahead}}개 커밋 / 원격 behind: {{behind}}개 커밋',
    pullAlreadyLatest: '\n[안내] 이미 원격의 모든 최신 커밋이 반영되어 있습니다. 작업을 종료합니다.\n',
    pullFastForward: '\n[Fast-forward] 로컬 커밋이 없으므로 단순 Fast-forward 병합을 수행합니다...',
    pullFastForwardOk: '\n[성공] 최신 원격 변경사항 반영 완료.\n',
    pullStep4: '\n[4/5] 원격 브랜치 병합 실행 (git merge {{remote}}/{{branch}})...',
    pullCleanMergeOk: '  -> 충돌 없이 100% 자동 병합 완료!\n',
    pullConflictDetected: '  -> 충돌(Conflict) 발생 감지. 정밀 하이브리드 결합 엔진을 가동합니다.\n',
    pullBuildFailWarn: '\n[경고] 빌드 검증에 실패했습니다. 코드를 확인하십시오.\n',
    pullMergeOk: '\n[성공] 원격 병합이 완료되었습니다. (Commit: {{sha}})\n',
    pullStep5: '[5/5] 정밀 하이브리드 결합 엔진 가동...',
    pullConflictCount: '  -> 충돌 발생 파일 수: {{count}}개\n',
    pullUnresolvedWarn: '\n[주의] 자동 해소되지 않은 파일이 있습니다. 충돌 마커를 수동 수정한 후 "npm run git:resolve"를 실행하십시오.\n',
    pullGatesFailed1: '\n[품질 게이트 실패] 3대 품질 게이트를 통과하지 못하여 머지 커밋 생성이 보류되었습니다.',
    pullGatesFailed2: '문제를 수정한 후 "npm run git:resolve"를 실행하십시오.\n',
    pullCommitStart: '\n[머지 커밋 생성 중] 하이브리드 병합 커밋을 생성합니다...',
    pullSuccessBannerTitle: '  [성공] 원격 정밀 병합 및 품질 게이트 통과 완료!',
    pullSuccessSha: '  머지 커밋 SHA: {{sha}}',
    fatalErr: '\n[치명적 오류]:',
  },

  auditPush: {
    bannerTitle: '  Agent Context Memory 원격 푸시 사전 위생 감사 품질 게이트',
    gate1Start: '[1/3] 미해소 충돌 마커(<<<<<<<) 잔여 전수 검사...',
    gate1DetectErr: '  [오류] 미해소 충돌 마커 감지:',
    gate1Pass: '  -> 통과: 잔여 충돌 마커 없음.\n',
    gate1Fail: '  [오류] 충돌 마커 검사 실패:\n',
    gate2Start: '[2/3] 로컬 워킹 트리 상태 확인...',
    gate2Dirty: '  [주의] 현재 워킹 트리에 커밋되지 않은 수정/추가 파일이 있습니다:',
    gate2DirtyHint: '  -> push 전 "npm run git:status"로 정리하거나 커밋하세요.\n',
    gate2Pass: '  -> 통과: 워킹 트리가 깨끗합니다.\n',
    gate3Start: '[3/3] 원격({{target}}) 대비 푸시 대기 파일 위생 감사...',
    localHeadLabel: '로컬 최신',
    gate3Fallback: '  [안내] {{target}} 비교 실패. HEAD 단독 검사로 대체합니다.',
    gate3NoDiff: '  -> 원격 대비 새로 푸시할 커밋이 없습니다 (이미 최신 동기화 상태).\n',
    gate3Count: '  [안내] 총 {{count}}개 파일이 푸시 대상에 포함되어 있습니다.',
    reasonTempScript: '1회성 임시 스크립트',
    reasonScratchScript: '1회성 스크래치 스크립트',
    reasonLocalTestScript: '로컬 단발성 테스트 스크립트',
    reasonReportTxt: '1회성 분석 보고서 텍스트',
    reasonTmpFile: '임시 파일 (*.tmp)',
    reasonBakFile: '백업 파일 (*.bak)',
    reasonLogFile: '로그 파일 (*.log)',
    reasonLocalDbFile: '로컬 SQLite DB 파일 (*.db / *.db-wal / *.db-shm)',
    forbiddenDetected: '\n  [경고] 프로젝트에 불필요한 1회성/임시 파일이 푸시 대상에서 감지되었습니다:',
    remediationHeader: '\n  [조치 방법]: 아래 명령어로 제거 커밋 후 다시 시도하세요:',
    remediationCommit: '    git commit -m "chore: 1회성 스크립트 정리"\n',
    gate3Pass: '  -> 통과: 1회성 스크립트 및 불필요한 임시 파일 없음.\n',
    failBanner: '  [실패] 푸시 전 위생 감사 기준을 통과하지 못했습니다.',
    passBanner: '  [성공] 푸시 전 위생 감사 100% 통과! 안심하고 push 하세요.',
  },

  storage: {
    invalidTaskNumber: '유효하지 않은 태스크 번호입니다: {{num}}',
    invalidPatternNumber: '유효하지 않은 패턴 번호입니다: {{num}}',
    invalidAdrNumber: '유효하지 않은 ADR 번호입니다: {{num}}',
    invalidConfigJson: '.agents/config.json 파싱 실패 ({{path}}): {{message}}',
    invalidProviderReg: '유효한 프로바이더 이름과 팩토리 함수가 필요합니다.',
    unknownProvider: '[설정 오류] 등록되지 않은 스토리지 프로바이더입니다: "{{name}}" (지원 목록: {{supported}})',
    readyMissingPurpose: '목적(purpose)',
    readyMissingResults: '수행결과(results)',
    readyMissingTargets: '대상영역(targets)',
    readyValidationError: '[검증 실패] [커밋 대기](ready) 상태 전환에는 3요소가 필수입니다. 누락 항목: {{missing}}',
    sqliteRequired:
      '[환경 오류] 로컬 SQLite 저장소는 Node.js >= 22.13.0의 내장 node:sqlite 모듈이 필요합니다. ' +
      '현재 버전({{version}})에서는 Node.js를 업그레이드하거나 --storage=markdown 옵션을 사용하십시오.',
    taskInputRequired: '태스크 입력 객체가 필요합니다.',
    taskTitleRequired: '태스크 제목(title)이 필요합니다.',
    taskNotFoundComplete: '완료 처리할 태스크를 찾을 수 없습니다: {{id}}',
    taskNotFound: '태스크를 찾을 수 없습니다: {{id}}',
    leaseOwnerRequired: 'Lease 점유자(owner) 식별자가 필요합니다.',
    leaseTaskNotFoundSet: 'Lease를 설정할 태스크를 찾을 수 없습니다: {{id}}',
    leaseTaskNotFoundRelease: 'Lease를 해제할 태스크를 찾을 수 없습니다: {{id}}',
    patternInputRequired: '패턴 입력 객체가 필요합니다.',
    patternSupersedesNotFound: '대체 대상 패턴을 찾을 수 없습니다: {{ref}}',
    patternTitleRequired: '패턴 제목(title)이 필요합니다.',
    adrInputRequired: 'ADR 입력 객체가 필요합니다.',
    adrTitleRequired: 'ADR 제목(title)이 필요합니다.',
    snapshotInvalid: '유효한 스냅샷 객체가 필요합니다.',
    defaultCategory: '일반',
  },

  dbCli: {
    help: `
ACM 메모리 DB CLI

사용법:
  acm <명령어> [하위명령] [옵션]

명령어:
  task [list|add|update|complete|show|lease]  태스크 관리
  pattern [list|add|show]                     지식 패턴 관리
  adr [list|add|show]                         아키텍처 결정 기록(ADR) 관리
  search <검색어>                             전체 메모리 FTS5 BM25 통합 검색
  migrate --to=<sqlite|markdown>              SQLite DB와 Markdown 파일 간 마이그레이션
  export [--format=json|md] [--out=<경로>]    메모리 저장소 스냅샷 내보내기
  import <파일> [--strategy=merge|skip|replace] 스냅샷을 메모리 저장소로 가져오기
  sync [--pull|--push|--status] [--dry-run]   Git orphan 브랜치를 통한 공유 메모리 동기화

공통 옵션:
  --json                 JSON 형식으로 출력
  --lang=<en|ko>         CLI 출력 언어 지정
  -h, --help             명령어별 도움말 표시
`,
    taskHelp: `
사용법: acm task <하위명령> [옵션]

하위명령:
  list [--status=todo|in_progress|ready|done|paused] [--all|--done] [--json]
  show <idOrCode> [--json]
  add [제목] [--title=...] [--status=...] [--purpose=...] [--result=...] [--target=...] [--group=...] [--owner=...] [--stdin] [--skip-validation] [--json]
  update <idOrCode> [--title=...] [--status=...] [--purpose=...] [--result=...] [--target=...] [--group=...] [--owner=...] [--stdin] [--skip-validation] [--json]
  complete <idOrCode> [--sha=<sha>] [--json]
  lease <idOrCode> --owner=<agentId> [--ttl=600] [--release] [--force] [--json]
`,
    patternHelp: `
사용법: acm pattern <하위명령> [옵션]

하위명령:
  list [--category=...] [--include-superseded] [--json]
  show <idOrCode> [--json]
  add [제목] [--title=...] [--category=...] [--summary=...] [--symptom=...] [--solution=...] [--file=...] [--tag=...] [--supersedes=<uid|code>] [--author=...] [--stdin] [--json]
`,
    adrHelp: `
사용법: acm adr <하위명령> [옵션]

하위명령:
  list [--limit=20] [--json]
  show <idOrCode> [--json]
  add [제목] [--date=YYYY-MM-DD] [--summary=...] [--area=...] [--task=TSK-X] [--branch=...] [--context=...] [--decision=...] [--impact=...] [--author=...] [--stdin] [--json]
`,
    searchHelp: `
사용법: acm search <검색어> [옵션]

옵션:
  --kind=all|task|pattern|adr   엔티티 유형 필터 (기본값: all)
  --limit=10                    최대 결과 수
  --budget=0                    토큰 예산 상한 (0 = 무제한)
  --json                        JSON 형식으로 출력
`,
    migrateHelp: `
사용법: acm migrate --to=<sqlite|markdown> [옵션]

옵션:
  --to=<sqlite|markdown>  대상 저장소 백엔드
  --dry-run               파일이나 설정을 변경하지 않고 이관 건수만 미리보기
  --json                  JSON 형식으로 출력
`,
    exportHelp: `
사용법: acm export [옵션]

옵션:
  --format=json|md    내보내기 형식 (기본값: json)
  --out=<경로>        출력 파일(json) 또는 디렉터리(md) 경로
  --include-deleted   소프트 삭제된 레코드 포함 (json 전용)
  --json              JSON 요약 출력
`,
    importHelp: `
사용법: acm import <파일|-> [옵션]

옵션:
  --strategy=merge|skip|replace  가져오기 충돌 처리 전략 (기본값: merge)
  --stdin                        표준 입력(stdin)에서 JSON 스냅샷 읽기
  --json                         JSON 형식으로 출력
`,
    unknownCommand: '[오류] 알 수 없는 DB 명령어입니다: "{{command}}"',
    unknownSubcommand: '[오류] "{{command}}"의 알 수 없는 하위 명령어입니다: "{{subcommand}}"',
    missingArg: '[오류] 필수 인자가 누락되었습니다: {{arg}}',
    invalidJsonStdin: '[오류] stdin JSON 입력 파싱에 실패했습니다: {{message}}',
    invalidStrategy: '[오류] 잘못된 가져오기 전략입니다: "{{strategy}}". merge, skip, replace 중 하나를 지정하십시오.',
    invalidFormat: '[오류] 잘못된 내보내기 형식입니다: "{{format}}". json 또는 md를 지정하십시오.',
    invalidTargetProvider: '[오류] 잘못된 마이그레이션 대상입니다: "{{to}}". sqlite 또는 markdown을 지정하십시오.',
    fileNotFound: '[오류] 입력 파일을 찾을 수 없습니다: {{file}}',
    notFound: '[오류] 레코드를 찾을 수 없습니다: {{id}}',
    execError: '[오류] {{message}}',
    noResults: '(일치하는 레코드가 없습니다.)',
    taskListHeader: '[태스크] ({{provider}}) - 총 {{count}}건:',
    patternListHeader: '[패턴] ({{provider}}) - 총 {{count}}건:',
    adrListHeader: '[ADR] ({{provider}}) - 총 {{count}}건:',
    searchHeader: '[검색: "{{query}}"] - {{count}}건 일치:',
    taskCreated: '[태스크 등록] {{code}}: {{title}} [{{status}}]',
    taskUpdated: '[태스크 갱신] {{code}}: {{title}} [{{status}}]',
    taskCompleted: '[태스크 완료] {{code}}: {{title}} (커밋/참조: {{sha}})',
    leaseAcquired: '[Lease 점유] {{code}} -> {{owner}} (만료: {{expiresAt}})',
    leaseBusy: '[Lease 충돌] {{code}}는 현재 {{holder}}가 점유 중입니다 (만료: {{expiresAt}})',
    leaseReleased: '[Lease 해제] {{code}}',
    patternSaved: '[패턴 저장] {{code}} (v{{version}}): {{title}}',
    adrSaved: '[ADR 저장] {{code}} [{{date}}]: {{title}}',
    migrateDryRun: '[미리보기] 마이그레이션 예정 ({{from}} -> {{to}}): 태스크={{tasks}}, 완료={{completedTasks}}, 패턴={{patterns}}, ADR={{adrs}}',
    migrateDone: '[이관 완료] 저장소가 "{{to}}"(으)로 전환되었습니다: 태스크={{tasks}}, 완료={{completedTasks}}, 패턴={{patterns}}, ADR={{adrs}}',
    migrateAlready: '[안내] 저장소 설정이 이미 "{{to}}"입니다. 레코드를 동기화했습니다.',
    exportJsonDone: '[JSON 내보내기 완료] 스냅샷 저장됨: {{out}}',
    exportMdDone: '[Markdown 내보내기 완료] 마크다운 파일 생성됨: {{out}}',
    importDone: '[가져오기 완료] 전략={{strategy}}: 태스크={{tasks}}, 패턴={{patterns}}, ADR={{adrs}}, 건너뜀={{skipped}}',
    syncHelp: `
사용법: acm sync [옵션]

옵션:
  --pull                 원격 공유 메모리를 가져와 로컬 SQLite DB와 구조적으로 병합
  --push                 시크릿 스크러빙 후 orphan 브랜치에 스냅샷 커밋 및 원격 푸시
  --status               동기화 브랜치 상태, 공유 건수 및 최근 동기화 이력 조회
  --dry-run              실제 커밋/DB 변경 없이 병합·마스킹 예정 건수만 미리보기
  --branch=<이름>        동기화 대상 브랜치 지정 (기본값: acm-memory)
  --remote=<이름>        원격 저장소 지정 (기본값: origin)
  --no-scrub             아웃바운드 Secret Scrubber 비활성화 (비권장)
  --json                 JSON 형식으로 출력
`,
    syncInvalidRef: '[오류] 유효하지 않은 Git 브랜치 또는 원격 이름입니다: "{{ref}}"',
    syncRequiresSqlite: '[오류] Git orphan 동기화는 SQLite 저장소 모드에서만 동작합니다. 먼저 "acm migrate --to=sqlite"를 실행하십시오.',
    syncNonGitSkip: '[안내] Git 환경이 아니므로 Git orphan 동기화를 건너뜁니다.',
    syncStatusHeader: '[동기화 상태] 브랜치={{branch}} 원격={{remote}} 로컬SHA={{localSha}} 원격SHA={{remoteSha}} 최근동기화={{lastSync}}',
    syncDryRun: '[미리보기] 동기화 예정 ({{direction}} -> {{branch}}): 수신={{pulled}}, 송신={{pushed}}, 충돌해소={{conflictsResolved}}, 마스킹={{redactedCount}}',
    syncDone: '[동기화 완료] {{direction}} -> {{branch}} (커밋={{commitSha}}): 수신={{pulled}}, 송신={{pushed}}, 충돌해소={{conflictsResolved}}, 마스킹={{redactedCount}}',
    syncScrubWarn: '[Secret Scrubber] 동기화 전 민감정보 {{count}}건을 자동 마스킹했습니다 ({{types}}).',
  },

  mcp: {
    help: `
ACM Stdio MCP 서버

사용법:
  npx agent-context-memory mcp [옵션]
  node scripts/mcp-server.cjs [옵션]

옵션:
  --print-config         MCP 클라이언트용 JSON 설정 스니펫 출력
  --json                 --print-config 와 함께 순수 JSON만 출력
  --root=<경로>          대상 워크스페이스 루트 경로 (기본값: 현재 디렉터리)
  -l, --lang <en|ko>     CLI 안내 및 검증 오류 언어 지정
  -h, --help             도움말 표시
`,
    printConfigHeader: '[ACM MCP] 바로 붙여넣을 수 있는 MCP 클라이언트 JSON 설정 스니펫 (대상 경로: {{rootDir}}):',
    printConfigNote: '안내: 위 "mcpServers" 항목 중 하나를 Antigravity, Claude Code, Cursor 등의 MCP 설정 파일에 병합하세요. 로그는 stderr로만 출력되며 stdio로 JSON-RPC 2.0 통신합니다.',
  },
};

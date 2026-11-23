/**
 * scripts/acm-manifest.cjs
 *
 * Agent Context Memory(ACM)의 설치, 소유, 주입 자산에 대한 단일 정본 매니페스트 (Single Source of Truth)
 * 인스톨러(install-template.cjs)와 언인스톨러(uninstall-template.cjs)가 공통 참조합니다.
 */

const ACM_MANIFEST = {
  version: '0.1.2',

  // 1. ACM 전용 소유 디렉터리 (삭제 시 백업 후 디렉터리 전체 제거)
  directories: [
    {
      path: '.agents',
      description: 'Agent Context Memory 거버넌스 및 작업/메모리 저장소',
      backupRequired: true,
    },
  ],

  // 2. ACM 배포 개별 파일 (타 파일 공존 디렉터리에서 선별 삭제 대상)
  files: [
    { path: 'scripts/audit-push.cjs', parentDirCleanup: true },
    { path: 'scripts/check-git.cjs', parentDirCleanup: true },
    { path: 'scripts/group-status.cjs', parentDirCleanup: true },
    { path: 'scripts/smart-pull.cjs', parentDirCleanup: true },
    { path: 'scripts/sync-agent-rules.cjs', parentDirCleanup: true },
    { path: 'scripts/acm-manifest.cjs', parentDirCleanup: true },
    { path: 'scripts/uninstall-template.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/id-utils.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/config.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/memory-store.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/sqlite-provider.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/markdown-bridge.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/markdown-provider.cjs', parentDirCleanup: true },
  ],

  // 3. .gitignore 주입 관리 명세
  gitignore: {
    headerComment: '# Agent Context Memory Ignored Entries',
    entries: ['/.agents/', '/.agent/'],
    template: '# Agent Context Memory Ignored Entries\n/.agents/\n/.agent/\n',
  },

  // 4. 에이전트 규칙 파일(AGENTS.md, CLAUDE.md, GEMINI.md 등) 주입 및 대조 관리 명세
  governanceRules: {
    startMarker: '<!-- ACM_GOVERNANCE_START -->',
    endMarker: '<!-- ACM_GOVERNANCE_END -->',
    snippetTitle: '# Context Memory & Execution Guardrails (STRICT)',
    // 내용 변조 감지(Drift Detection)를 위한 원본 텍스트 본문
    expectedBody: `# Context Memory & Execution Guardrails (STRICT)
1. [3대 정본] 작업 기억 \`.agents/task/task.md\` & 완료 보관소 \`task-completed.md\`(\`TSK-{자연수}\` 불변 채번, 5KB 상한 — 단, 다중 \`[커밋 대기]\` 누적 시 일시 초과 허용), 장기 지식 \`.agents/memory/patterns-index.md\` & \`patterns/\`(\`P-XX\`), 거시 ADR \`.agents/memory/project-changelog.md\`(\`LOG-XX\`). (\`TSK-SAMPLE\`, \`P-00\`, \`LOG-00\`은 양식 샘플이므로 실제 작업 취급 금지, 첫 채번은 \`TSK-1\`, \`P-01\`, \`LOG-01\`부터 시작)
2. [Task 라이프사이클 & 3요소] 상태 전이: \`[ ]\`(대기) -> \`[진행 중]\` -> \`[커밋 대기]\`(검증 완료) -> \`[x]\`(커밋 완료). 경미한 수정을 포함한 모든 커밋 전 반드시 \`task.md\`를 \`[커밋 대기] TSK-X\`로 갱신하고 \`- **목적**:\`, \`- **수행결과**:\`(핵심 파일별 5줄 이내 요약), \`- **대상영역**:\`(변경 파일·폴더 경로) 3요소를 필수 기재한다. (\`/태스크\`, \`/task\` 프리픽스는 \`task.md\` 문서 조회·등록·상태 갱신 시에만 탐색·계획서를 생략하며, 코드 구현이 수반될 때는 표준 실행 게이트 준수)
3. [지식 온디맨드 검색 (0토큰)] \`patterns/\` 전수 통조회 금지. 핵심 키워드로 \`patterns-index.md\` 요약열만 \`grep_search\` 후 매칭된 \`P-XX\` 파일만 핀포인트 열람 (\`/스킵\`, \`/태스크\` 시 생략). 확정된 재사용 솔루션은 \`patterns/P-XX-*.md\` 신설 및 \`patterns-index.md\` 1행 추가.
4. [거시 ADR 열람·기록 (0토큰)] \`project-changelog.md\` 평소 조회 금지. 전역 인프라 수정·회귀 역추적·대규모 머지 직후에만 최상단 \`ADR Index Map\`(1~35라인) 슬라이스 조회 또는 키워드 \`grep_search\`로 대상 \`LOG-XX\` 특정 후 해당 블록만 열람. 거시 아키텍처 변경 시 \`ADR Index Map\` 1행 추가 및 상세 최상단에 \`### [LOG-XX] [YYYY-MM-DD] 제목\` 누적 기록.
5. [실행 & 커밋 승인 게이트] 단일 \`TSK-X\` 내 세부 작업은 계획서 최초 승인 1회로 구현·검증 후 \`walkthrough.md\`로 보고한다(다중 \`TSK\` Phase 작업만 Phase별 승인). 계획서 승인만으로 Git 커밋을 자동 실행하지 않으며, **사용자의 명시적 커밋 지시("커밋해", "반영해") 시에만** \`npm run git:commit\`(\`node scripts/group-status.cjs --all\`)을 단 1회 실행한다(커밋 직후 \`task-completed.md\` 자동 이관). 비-Git 환경은 사용자 승인 확인 후 \`(Completed: YYYY-MM-DD / Non-Git)\` 이관.
6. [격리 & 규칙 분리] 호스트 프로젝트에서 \`.agents/\` 하위 문서는 로컬 전용(\`.gitignore\`)이므로 Git 2차 커밋 시도 금지. 멀티 에이전트 작업 시 \`task.md\` 담당자 명기 및 대상 영역 중첩 금지. 프로젝트 전용 규칙은 \`# Project Execution Rules\` 하위에만 작성.
* [필수 열람 트리거] P-XX 패턴 신설·증류 또는 LOG-XX ADR 기록 시 [.agents/rules/60-task-memory-adr.md](.agents/rules/60-task-memory-adr.md)를, 비-Git 수동 이관·멀티 에이전트 동시성·전체 거버넌스 상세 규격 확인 시 [.agents/MEMORY_GOVERNANCE.md](.agents/MEMORY_GOVERNANCE.md)를 작업 전 반드시 열람할 것.`,
  },

  // 5. package.json 스크립트 주입 관리 명세
  packageJson: {
    scripts: {
      'git:status': 'node scripts/group-status.cjs --dry-run',
      'git:summary': 'node scripts/group-status.cjs --compact',
      'git:commit': 'node scripts/group-status.cjs --all',
      'git:pull': 'node scripts/smart-pull.cjs',
      'git:resolve': 'node scripts/smart-pull.cjs --resolve',
      'git:audit-push': 'node scripts/audit-push.cjs',
    },
  },
};

/**
 * 전체 주입용 거버넌스 스니펫 문자열을 반환합니다.
 */
function getFullGovernanceSnippet() {
  const { startMarker, expectedBody, endMarker } = ACM_MANIFEST.governanceRules;
  return `${startMarker}\n${expectedBody}\n${endMarker}`;
}

module.exports = {
  ACM_MANIFEST,
  CMS_MANIFEST: ACM_MANIFEST,
  getFullGovernanceSnippet,
};

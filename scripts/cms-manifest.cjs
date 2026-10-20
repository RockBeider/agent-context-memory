/**
 * scripts/cms-manifest.cjs
 *
 * Context Memory System(CMS)의 설치, 소유, 주입 자산에 대한 단일 정본 매니페스트 (Single Source of Truth)
 * 인스톨러(install-template.cjs)와 언인스톨러(uninstall-template.cjs)가 공통 참조합니다.
 */

const CMS_MANIFEST = {
  version: '0.1.0',

  // 1. CMS 전용 소유 디렉터리 (삭제 시 백업 후 디렉터리 전체 제거)
  directories: [
    {
      path: '.agents',
      description: 'Context Memory System 거버넌스 및 작업/메모리 저장소',
      backupRequired: true,
    },
  ],

  // 2. CMS 배포 개별 파일 (타 파일 공존 디렉터리에서 선별 삭제 대상)
  files: [
    { path: 'rules/MEMORY_GOVERNANCE.md', parentDirCleanup: true },
    { path: 'rules/MEMORIAL_GOVERNANCE.md', parentDirCleanup: true },
    { path: 'scripts/audit-push.cjs', parentDirCleanup: true },
    { path: 'scripts/check-git.cjs', parentDirCleanup: true },
    { path: 'scripts/group-status.cjs', parentDirCleanup: true },
    { path: 'scripts/smart-pull.cjs', parentDirCleanup: true },
    { path: 'scripts/sync-agent-rules.cjs', parentDirCleanup: true },
    { path: 'scripts/cms-manifest.cjs', parentDirCleanup: true },
    { path: 'scripts/uninstall-template.cjs', parentDirCleanup: true },
  ],

  // 3. .gitignore 주입 관리 명세
  gitignore: {
    headerComment: '# Context Memory System Ignored Entries',
    entries: ['.agent'],
    template: '# Context Memory System Ignored Entries\n.agent\n',
  },

  // 4. 에이전트 규칙 파일(AGENTS.md, CLAUDE.md, GEMINI.md 등) 주입 및 대조 관리 명세
  governanceRules: {
    startMarker: '<!-- CMS_GOVERNANCE_START -->',
    endMarker: '<!-- CMS_GOVERNANCE_END -->',
    snippetTitle: '# Context Memory Guardrails',
    // 내용 변조 감지(Drift Detection)를 위한 원본 텍스트 본문
    expectedBody: `# Context Memory Guardrails
1. [정본] 작업 착수/완료는 반드시 \`.agents/task/task.md\`에만 기록 (\`TSK-X\` 영구 불변 채번, 5KB 상한).
2. [커밋] 일괄 스테이징(\`git add .\`) 절대 금지. 커밋은 반드시 \`node scripts/group-status.cjs\` 실행.
3. [지식] \`patterns/\` 전수 통조회 금지. \`patterns_index.md\` 요약열만 \`grep_search\`로 핀포인트 로딩.
4. [이관] 실제 Git 커밋 SHA 해시 확보 전 \`task_completed.md\` 조기 이관 절대 금지 (\`Commit: abc1234\` 필수).
5. [격리] 멀티 에이전트 동시 작업 시 \`task.md\`에 담당자 명기 및 파일 대상 영역 중첩 금지 (충돌 시 직렬화).
* 상세 규격 필요 시: [rules/MEMORY_GOVERNANCE.md](rules/MEMORY_GOVERNANCE.md) 참조.`,
  },

  // 5. package.json 스크립트 주입 관리 명세
  packageJson: {
    scripts: {
      'git:status': 'node scripts/group-status.cjs',
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
  const { startMarker, expectedBody, endMarker } = CMS_MANIFEST.governanceRules;
  return `${startMarker}\n${expectedBody}\n${endMarker}`;
}

module.exports = {
  CMS_MANIFEST,
  getFullGovernanceSnippet,
};

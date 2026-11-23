/**
 * scripts/acm-manifest.cjs
 *
 * Single Source of Truth manifest for Agent Context Memory (ACM) installed,
 * owned, and injected assets. Shared by install-template.cjs and uninstall-template.cjs.
 */

const fs = require('fs');
const path = require('path');
const { normalizeLanguage, DEFAULT_LANGUAGE } = require('./i18n.cjs');

/**
 * Resolves the ACM package version only when reading ACM's own package.json (never host package.json).
 */
function resolveAcmVersion() {
  const fallback = '0.2.0';
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg && pkg.name === 'agent-context-memory' && typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch (_) {
    // Fallback when running inside a host project where package.json belongs to the host
  }
  return fallback;
}

const EXPECTED_GOVERNANCE_EN = `# Context Memory & Execution Guardrails (STRICT)
1. [Three Canonical Stores] Working memory \`.agents/task/task.md\` & archive \`task-completed.md\` (immutable \`TSK-{N}\` IDs, 5KB cap — temporary overflow allowed while multiple \`[Ready]\` tasks await commit), long-term knowledge \`.agents/memory/patterns-index.md\` & \`patterns/\` (\`P-XX\`), and macro ADRs \`.agents/memory/project-changelog.md\` (\`LOG-XX\`). (\`TSK-SAMPLE\`, \`P-00\`, and \`LOG-00\` are format samples only — never treat them as real records; start real IDs at \`TSK-1\`, \`P-01\`, \`LOG-01\`.)
2. [Task Lifecycle & 3 Elements] Status flow: \`[ ]\` (Todo) -> \`[In Progress]\` -> \`[Ready]\` (verified) -> \`[x]\` (committed). Before any commit (including minor fixes), update \`task.md\` to \`[Ready] TSK-X\` with all 3 elements: \`- **Purpose**:\`, \`- **Results**:\` (<=5 bullets per key file), and \`- **Targets**:\` (changed file/dir paths). (\`/task\` and \`/태스크\` prefixes skip exploration/plans ONLY for viewing, adding, or updating \`task.md\`; code changes follow the standard execution gate.)
3. [Zero-Token On-Demand Knowledge Search] Never read all files in \`patterns/\`. Run \`grep_search\` on the summary column of \`patterns-index.md\` by keyword and read ONLY matched \`P-XX\` files (skip on \`/skip\`). Distill confirmed reusable solutions into \`patterns/P-XX-*.md\` and add 1 row to \`patterns-index.md\`.
4. [Zero-Token Macro ADR Lookup & Logging] Never read \`project-changelog.md\` routinely. Only on global infrastructure changes, regression tracing, or large merges, read the top \`ADR Index Map\` (lines 1-35) or \`grep_search\` to pinpoint \`LOG-XX\`, then read that block only. For macro architectural changes, prepend 1 row to \`ADR Index Map\` and a \`### [LOG-XX] [YYYY-MM-DD] Title\` block at the top of details.
5. [Execution & Commit Approval Gate] Execute all sub-steps within a single \`TSK-X\` under its initial plan approval and report via \`walkthrough.md\` (multi-\`TSK\` plans require per-phase approval). Plan approval does NOT authorize Git commits — execute \`npm run git:commit\` (\`node scripts/group-status.cjs --all\`) ONCE **only on explicit user commit instruction** (e.g. "commit", "apply"), which auto-archives to \`task-completed.md\`. In non-Git environments, archive with \`(Completed: YYYY-MM-DD / Non-Git)\` after user confirmation.
6. [Isolation & Rule Separation] In host projects, \`.agents/\` files are local-only (\`.gitignore\`); never attempt a secondary Git commit for them. For multi-agent work, declare owners in \`task.md\` and never overlap \`Targets\`. Add project-specific rules only under \`# Project Execution Rules\`.
* [Mandatory Read Triggers] Before distilling \`P-XX\` patterns or recording \`LOG-XX\` ADRs, read [.agents/rules/60-task-memory-adr.md](.agents/rules/60-task-memory-adr.md). Before non-Git archiving, multi-agent coordination, or checking full governance specs, read [.agents/MEMORY_GOVERNANCE.md](.agents/MEMORY_GOVERNANCE.md).
* [Storage & MCP Mode] When \`.agents/config.json\` uses \`sqlite\`, prefer \`acm\` CLI (\`task\`, \`pattern\`, \`adr\`, \`search\`, \`sync\`) or MCP tools (\`acm mcp\`) as the structured interface; Markdown projections remain synchronized for human and Git workflows.`;

const EXPECTED_GOVERNANCE_KO = `# Context Memory & Execution Guardrails (STRICT)
1. [3대 정본] 작업 기억 \`.agents/task/task.md\` & 완료 보관소 \`task-completed.md\`(\`TSK-{자연수}\` 불변 채번, 5KB 상한 — 단, 다중 \`[커밋 대기]\` 누적 시 일시 초과 허용), 장기 지식 \`.agents/memory/patterns-index.md\` & \`patterns/\`(\`P-XX\`), 거시 ADR \`.agents/memory/project-changelog.md\`(\`LOG-XX\`). (\`TSK-SAMPLE\`, \`P-00\`, \`LOG-00\`은 양식 샘플이므로 실제 작업 취급 금지, 첫 채번은 \`TSK-1\`, \`P-01\`, \`LOG-01\`부터 시작)
2. [Task 라이프사이클 & 3요소] 상태 전이: \`[ ]\`(대기) -> \`[진행 중]\` -> \`[커밋 대기]\`(검증 완료) -> \`[x]\`(커밋 완료). 경미한 수정을 포함한 모든 커밋 전 반드시 \`task.md\`를 \`[커밋 대기] TSK-X\`로 갱신하고 \`- **목적**:\`, \`- **수행결과**:\`(핵심 파일별 5줄 이내 요약), \`- **대상영역**:\`(변경 파일·폴더 경로) 3요소를 필수 기재한다. (\`/태스크\`, \`/task\` 프리픽스는 \`task.md\` 문서 조회·등록·상태 갱신 시에만 탐색·계획서를 생략하며, 코드 구현이 수반될 때는 표준 실행 게이트 준수)
3. [지식 온디맨드 검색 (0토큰)] \`patterns/\` 전수 통조회 금지. 핵심 키워드로 \`patterns-index.md\` 요약열만 \`grep_search\` 후 매칭된 \`P-XX\` 파일만 핀포인트 열람 (\`/스킵\`, \`/태스크\` 시 생략). 확정된 재사용 솔루션은 \`patterns/P-XX-*.md\` 신설 및 \`patterns-index.md\` 1행 추가.
4. [거시 ADR 열람·기록 (0토큰)] \`project-changelog.md\` 평소 조회 금지. 전역 인프라 수정·회귀 역추적·대규모 머지 직후에만 최상단 \`ADR Index Map\`(1~35라인) 슬라이스 조회 또는 키워드 \`grep_search\`로 대상 \`LOG-XX\` 특정 후 해당 블록만 열람. 거시 아키텍처 변경 시 \`ADR Index Map\` 1행 추가 및 상세 최상단에 \`### [LOG-XX] [YYYY-MM-DD] 제목\` 누적 기록.
5. [실행 & 커밋 승인 게이트] 단일 \`TSK-X\` 내 세부 작업은 계획서 최초 승인 1회로 구현·검증 후 \`walkthrough.md\`로 보고한다(다중 \`TSK\` Phase 작업만 Phase별 승인). 계획서 승인만으로 Git 커밋을 자동 실행하지 않으며, **사용자의 명시적 커밋 지시("커밋해", "반영해") 시에만** \`npm run git:commit\`(\`node scripts/group-status.cjs --all\`)을 단 1회 실행한다(커밋 직후 \`task-completed.md\` 자동 이관). 비-Git 환경은 사용자 승인 확인 후 \`(Completed: YYYY-MM-DD / Non-Git)\` 이관.
6. [격리 & 규칙 분리] 호스트 프로젝트에서 \`.agents/\` 하위 문서는 로컬 전용(\`.gitignore\`)이므로 Git 2차 커밋 시도 금지. 멀티 에이전트 작업 시 \`task.md\` 담당자 명기 및 대상 영역 중첩 금지. 프로젝트 전용 규칙은 \`# Project Execution Rules\` 하위에만 작성.
* [필수 열람 트리거] P-XX 패턴 신설·증류 또는 LOG-XX ADR 기록 시 [.agents/rules/60-task-memory-adr.md](.agents/rules/60-task-memory-adr.md)를, 비-Git 수동 이관·멀티 에이전트 동시성·전체 거버넌스 상세 규격 확인 시 [.agents/MEMORY_GOVERNANCE.md](.agents/MEMORY_GOVERNANCE.md)를 작업 전 반드시 열람할 것.
* [저장소 및 MCP 모드] \`.agents/config.json\`이 \`sqlite\` 모드일 때는 구조화된 \`acm\` DB CLI(\`task\`, \`pattern\`, \`adr\`, \`search\`, \`sync\`) 또는 MCP 도구(\`acm mcp\`) 사용을 우선하며 Markdown 투영은 자동 동기화된다.`;

const ACM_MANIFEST = {
  version: resolveAcmVersion(),

  // 1. ACM-owned directories (backed up and removed on uninstall)
  directories: [
    {
      path: '.agents',
      description: 'Agent Context Memory governance, task, and memory workspace',
      backupRequired: true,
    },
  ],

  // 2. ACM-deployed individual files (selectively removed from shared directories)
  files: [
    { path: 'scripts/i18n.cjs', parentDirCleanup: true },
    { path: 'scripts/locales/en.cjs', parentDirCleanup: true },
    { path: 'scripts/locales/ko.cjs', parentDirCleanup: true },
    { path: 'scripts/audit-push.cjs', parentDirCleanup: true },
    { path: 'scripts/check-git.cjs', parentDirCleanup: true },
    { path: 'scripts/group-status.cjs', parentDirCleanup: true },
    { path: 'scripts/smart-pull.cjs', parentDirCleanup: true },
    { path: 'scripts/sync-agent-rules.cjs', parentDirCleanup: true },
    { path: 'scripts/acm-manifest.cjs', parentDirCleanup: true },
    { path: 'scripts/uninstall-template.cjs', parentDirCleanup: true },
    { path: 'scripts/acm-db-cli.cjs', parentDirCleanup: true },
    { path: 'scripts/mcp-server.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/id-utils.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/config.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/memory-store.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/sqlite-provider.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/markdown-bridge.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/markdown-provider.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/secret-scrubber.cjs', parentDirCleanup: true },
    { path: 'scripts/storage/git-orphan-sync.cjs', parentDirCleanup: true },
  ],

  // 3. .gitignore managed entries
  gitignore: {
    headerComment: '# Agent Context Memory Ignored Entries',
    entries: ['/.agents/', '/.agent/'],
    template: '# Agent Context Memory Ignored Entries\n/.agents/\n/.agent/\n',
  },

  // 4. AI agent rule file injection and drift detection spec
  governanceRules: {
    startMarker: '<!-- ACM_GOVERNANCE_START -->',
    endMarker: '<!-- ACM_GOVERNANCE_END -->',
    snippetTitle: '# Context Memory & Execution Guardrails (STRICT)',
    expectedBody: EXPECTED_GOVERNANCE_EN,
    expectedBodies: {
      en: EXPECTED_GOVERNANCE_EN,
      ko: EXPECTED_GOVERNANCE_KO,
    },
  },

  // 5. package.json injected scripts spec
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
 * Returns the full marker-wrapped governance snippet for the requested language.
 *
 * @param {string} [lang='en']
 * @returns {string}
 */
function getFullGovernanceSnippet(lang = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  const { startMarker, expectedBodies, expectedBody, endMarker } = ACM_MANIFEST.governanceRules;
  const body = (expectedBodies && expectedBodies[norm]) || expectedBody;
  return `${startMarker}\n${body}\n${endMarker}`;
}

/**
 * Returns all official canonical governance rule bodies across supported languages.
 *
 * @returns {string[]}
 */
function getAllGovernanceBodies() {
  const { expectedBodies, expectedBody } = ACM_MANIFEST.governanceRules;
  if (expectedBodies && typeof expectedBodies === 'object') {
    return Object.values(expectedBodies);
  }
  return [expectedBody];
}

module.exports = {
  ACM_MANIFEST,
  CMS_MANIFEST: ACM_MANIFEST,
  getFullGovernanceSnippet,
  getAllGovernanceBodies,
};

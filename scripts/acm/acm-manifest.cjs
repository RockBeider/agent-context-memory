/**
 * scripts/acm/acm-manifest.cjs
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
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
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
1. [Three Canonical Stores] Working memory \`.agents/acm/task/task.md\` & archive \`task-completed.md\` (immutable 6-char short IDs \`TSK-XXXXXX\`, 5KB cap — temporary overflow allowed while multiple \`[Ready]\` tasks await commit; legacy \`TSK-{N}\` supported), long-term knowledge \`.agents/acm/memory/patterns-index.md\` & \`patterns/\` (\`P-XXXXXX\` / legacy \`P-XX\`), and macro ADRs \`.agents/acm/memory/project-changelog.md\` (\`LOG-XXXXXX\` / legacy \`LOG-XX\`). Issue new IDs via \`acm\` / \`npm run acm --\` CLI (\`node scripts/acm/acm-db-cli.cjs\`: \`task add\`, \`pattern add\`, \`adr add\`, \`id\`) or MCP tools; never invent random IDs manually. (\`TSK-SAMPLE\`, \`P-00\`, and \`LOG-00\` are format samples only — never treat them as real records.)
2. [Task Lifecycle & 3 Elements] Status flow: \`[ ]\` (Todo) -> \`[In Progress]\` -> \`[Ready]\` (verified) -> \`[x]\` (committed). Before any commit (including minor fixes), update \`task.md\` to \`[Ready] TSK-XXXXXX\` with all 3 elements: \`- **Purpose**:\`, \`- **Results**:\` (<=5 bullets per key file), and \`- **Targets**:\` (changed file/dir paths). (\`/task\` and \`/태스크\` prefixes skip exploration/plans ONLY for viewing, adding, or updating \`task.md\`; code changes follow the standard execution gate.)
3. [Zero-Token On-Demand Knowledge Search] Never read all files in \`patterns/\`. Run \`grep_search\` on the summary column of \`patterns-index.md\` by keyword and read ONLY matched \`P-*\` files (skip on \`/skip\`). Distill confirmed reusable solutions into \`patterns/P-XXXXXX-*.md\` and add 1 row to \`patterns-index.md\`.
4. [Zero-Token Macro ADR Lookup & Logging] Never read \`project-changelog.md\` routinely. Only on global infrastructure changes, regression tracing, or large merges, read the top \`ADR Index Map\` (lines 1-35) or \`grep_search\` to pinpoint \`LOG-*\`, then read that block only. For macro architectural changes, prepend 1 row to \`ADR Index Map\` and a \`### [LOG-XXXXXX] [YYYY-MM-DD] Title\` block at the top of details.
5. [Execution & Commit Approval Gate] Execute all sub-steps within a single \`TSK-X\` under its initial plan approval and report via \`walkthrough.md\` (multi-\`TSK\` plans require per-phase approval). Plan approval does NOT authorize Git commits — execute \`npm run acm:commit\` (\`node scripts/acm/group-status.cjs --all\`) ONCE **only on explicit user commit instruction** (e.g. "commit", "apply"), which auto-archives to \`task-completed.md\`. In non-Git environments, archive with \`(Completed: YYYY-MM-DD / Non-Git)\` after user confirmation.
6. [Isolation & Rule Separation] In host projects, \`.agents/\` files are local-only (\`.gitignore\`); never attempt a secondary Git commit for them. For multi-agent work, declare owners in \`task.md\` and never overlap \`Targets\`. Add project-specific rules only under \`# Project Execution Rules\`.
* [Mandatory Read Triggers] Before distilling \`P-*\` patterns or recording \`LOG-*\` ADRs, read [.agents/rules/acm-task-memory-adr.md](.agents/rules/acm-task-memory-adr.md). Before non-Git archiving, multi-agent coordination, or checking full governance specs, read [.agents/acm/ACM_GOVERNANCE.md](.agents/acm/ACM_GOVERNANCE.md).
* [Storage & MCP Mode] When \`.agents/acm/config.json\` uses \`sqlite\`, \`.agents/acm/local/memory.db\` is the sole canonical store (\`markdownProjection: false\` by default). Use \`acm\` CLI (\`npm run acm -- <cmd>\` or \`node scripts/acm/acm-db-cli.cjs <cmd>\` when \`acm\` is not in PATH: \`id\`, \`task\`, \`pattern\`, \`adr\`, \`search\`, \`compact\`, \`config\`, \`stats\`, \`sync\`) or MCP tools (\`acm mcp\` / \`npm run acm:mcp\`) as the authoritative interface (never hand-edit Markdown files); generate Markdown on demand via \`export\` or opt in via \`config set storage.markdownProjection true\`.`;

const EXPECTED_GOVERNANCE_KO = `# Context Memory & Execution Guardrails (STRICT)
1. [3대 정본] 작업 기억 \`.agents/acm/task/task.md\` & 완료 보관소 \`task-completed.md\`(불변 6자리 단축 ID \`TSK-XXXXXX\`, 5KB 상한 — 단, 다중 \`[커밋 대기]\` 누적 시 일시 초과 허용; 기존 \`TSK-{N}\` 호환), 장기 지식 \`.agents/acm/memory/patterns-index.md\` & \`patterns/\`(\`P-XXXXXX\` / 기존 \`P-XX\`), 거시 ADR \`.agents/acm/memory/project-changelog.md\`(\`LOG-XXXXXX\` / 기존 \`LOG-XX\`). 신규 ID는 \`acm\` / \`npm run acm --\` CLI(\`node scripts/acm/acm-db-cli.cjs\`: \`task add\`, \`pattern add\`, \`adr add\`, \`id\`) 또는 MCP 도구로 발급하며 임의 수기 채번을 금지한다. (\`TSK-SAMPLE\`, \`P-00\`, \`LOG-00\`은 양식 샘플이므로 실제 작업 취급 금지)
2. [Task 라이프사이클 & 3요소] 상태 전이: \`[ ]\`(대기) -> \`[진행 중]\` -> \`[커밋 대기]\`(검증 완료) -> \`[x]\`(커밋 완료). 경미한 수정을 포함한 모든 커밋 전 반드시 \`task.md\`를 \`[커밋 대기] TSK-XXXXXX\`로 갱신하고 \`- **목적**:\`, \`- **수행결과**:\`(핵심 파일별 5줄 이내 요약), \`- **대상영역**:\`(변경 파일·폴더 경로) 3요소를 필수 기재한다. (\`/태스크\`, \`/task\` 프리픽스는 \`task.md\` 문서 조회·등록·상태 갱신 시에만 탐색·계획서를 생략하며, 코드 구현이 수반될 때는 표준 실행 게이트 준수)
3. [지식 온디맨드 검색 (0토큰)] \`patterns/\` 전수 통조회 금지. 핵심 키워드로 \`patterns-index.md\` 요약열만 \`grep_search\` 후 매칭된 \`P-*\` 파일만 핀포인트 열람 (\`/스킵\`, \`/태스크\` 시 생략). 확정된 재사용 솔루션은 \`patterns/P-XXXXXX-*.md\` 신설 및 \`patterns-index.md\` 1행 추가.
4. [거시 ADR 열람·기록 (0토큰)] \`project-changelog.md\` 평소 조회 금지. 전역 인프라 수정·회귀 역추적·대규모 머지 직후에만 최상단 \`ADR Index Map\`(1~35라인) 슬라이스 조회 또는 키워드 \`grep_search\`로 대상 \`LOG-*\` 특정 후 해당 블록만 열람. 거시 아키텍처 변경 시 \`ADR Index Map\` 1행 추가 및 상세 최상단에 \`### [LOG-XXXXXX] [YYYY-MM-DD] 제목\` 누적 기록.
5. [실행 & 커밋 승인 게이트] 단일 \`TSK-X\` 내 세부 작업은 계획서 최초 승인 1회로 구현·검증 후 \`walkthrough.md\`로 보고한다(다중 \`TSK\` Phase 작업만 Phase별 승인). 계획서 승인만으로 Git 커밋을 자동 실행하지 않으며, **사용자의 명시적 커밋 지시("커밋해", "반영해") 시에만** \`npm run acm:commit\`(\`node scripts/acm/group-status.cjs --all\`)을 단 1회 실행한다(커밋 직후 \`task-completed.md\` 자동 이관). 비-Git 환경은 사용자 승인 확인 후 \`(Completed: YYYY-MM-DD / Non-Git)\` 이관.
6. [격리 & 규칙 분리] 호스트 프로젝트에서 \`.agents/\` 하위 문서는 로컬 전용(\`.gitignore\`)이므로 Git 2차 커밋 시도 금지. 멀티 에이전트 작업 시 \`task.md\` 담당자 명기 및 대상 영역 중첩 금지. 프로젝트 전용 규칙은 \`# Project Execution Rules\` 하위에만 작성.
* [필수 열람 트리거] P-* 패턴 신설·증류 또는 LOG-* ADR 기록 시 [.agents/rules/acm-task-memory-adr.md](.agents/rules/acm-task-memory-adr.md)를, 비-Git 수동 이관·멀티 에이전트 동시성·전체 거버넌스 상세 규격 확인 시 [.agents/acm/ACM_GOVERNANCE.md](.agents/acm/ACM_GOVERNANCE.md)를 작업 전 반드시 열람할 것.
* [저장소 및 MCP 모드] \`.agents/acm/config.json\`이 \`sqlite\` 모드일 때는 \`.agents/acm/local/memory.db\`가 유일한 단일 정본(\`markdownProjection: false\` 기본값)입니다. \`acm\` DB CLI(PATH 미등록 시 \`npm run acm -- <cmd>\` 또는 \`node scripts/acm/acm-db-cli.cjs <cmd>\`: \`id\`, \`task\`, \`pattern\`, \`adr\`, \`search\`, \`compact\`, \`config\`, \`stats\`, \`sync\`) 또는 MCP 도구(\`acm mcp\` / \`npm run acm:mcp\`)를 정본 인터페이스로만 사용하고 Markdown 파일 수기 편집을 금지하며, Markdown 출력이 필요할 때는 \`export\` 또는 \`config set storage.markdownProjection true\` 옵트인을 사용합니다.`;

const ACM_MANIFEST = {
  version: resolveAcmVersion(),

  // 1. ACM-owned directories (backed up and removed on uninstall)
  directories: [
    {
      path: '.agents/acm',
      description: 'Agent Context Memory isolated governance, task, memory, and local DB workspace',
      backupRequired: true,
    },
  ],

  // 2. ACM-deployed individual files (selectively removed from shared directories)
  files: [
    { path: 'scripts/acm/i18n.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/locales/en.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/locales/ko.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/audit-push.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/check-git.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/group-status.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/smart-pull.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/sync-agent-rules.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/acm-manifest.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/backup-archive.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/backup-git.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/uninstall-template.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/acm-db-cli.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/mcp-server.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/id-utils.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/config.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/memory-store.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/sqlite-provider.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/markdown-bridge.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/markdown-provider.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/secret-scrubber.cjs', parentDirCleanup: true },
    { path: 'scripts/acm/storage/git-orphan-sync.cjs', parentDirCleanup: true },
  ],

  // 2b. ACM-owned IDE discovery files inside shared .agents/ subdirectories
  ideFiles: [
    '.agents/rules/acm-task-memory-adr.md',
    '.agents/agents/acm-context-compactor.md',
    '.agents/agents/acm-git-release-sentinel.md',
    '.agents/skills/acm-git-workflow/SKILL.md',
  ],

  // 2c. Shared IDE hooks file and ACM-owned hook key(s)
  hooks: {
    file: '.agents/hooks.json',
    keys: ['acm-token-monitor'],
    legacyKeys: ['context-monitor'],
  },

  // 3. .gitignore managed entries (selective isolation under .agents/)
  gitignore: {
    headerComment: '# Agent Context Memory Ignored Entries',
    entries: [
      '/.agents/acm/',
      '/.agents/rules/acm-task-memory-adr.md',
      '/.agents/agents/acm-context-compactor.md',
      '/.agents/agents/acm-git-release-sentinel.md',
      '/.agents/skills/acm-git-workflow/',
      '/.acm-backup-*',
    ],
    hooksEntry: '/.agents/hooks.json',
    legacyEntries: ['/.agents/', '/.agent/', '/.agents_backup_*/', '/.acm-backup-*/'],
    template:
      '# Agent Context Memory Ignored Entries\n' +
      '/.agents/acm/\n' +
      '/.agents/rules/acm-task-memory-adr.md\n' +
      '/.agents/agents/acm-context-compactor.md\n' +
      '/.agents/agents/acm-git-release-sentinel.md\n' +
      '/.agents/skills/acm-git-workflow/\n' +
      '/.acm-backup-*\n',
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
      acm: 'node scripts/acm/acm-db-cli.cjs',
      'acm:mcp': 'node scripts/acm/mcp-server.cjs',
      'acm:status': 'node scripts/acm/group-status.cjs --dry-run',
      'acm:summary': 'node scripts/acm/group-status.cjs --compact',
      'acm:commit': 'node scripts/acm/group-status.cjs --all',
      'acm:pull': 'node scripts/acm/smart-pull.cjs',
      'acm:resolve': 'node scripts/acm/smart-pull.cjs --resolve',
      'acm:audit-push': 'node scripts/acm/audit-push.cjs',
    },
  },

  // 6. Legacy v1 installation paths for non-destructive rollback
  legacy: {
    directories: ['.agents/task', '.agents/memory', '.agents/local'],
    files: [
      '.agents/MEMORY_GOVERNANCE.md',
      '.agents/config.json',
      '.agents/.acm-meta.json',
      '.agents/scripts/token-monitor.cjs',
      '.agents/rules/60-task-memory-adr.md',
      '.agents/agents/context-compactor.md',
      '.agents/agents/git-release-sentinel.md',
      '.agents/skills/git-workflow/SKILL.md',
    ],
    scriptFiles: [
      'scripts/i18n.cjs',
      'scripts/locales/en.cjs',
      'scripts/locales/ko.cjs',
      'scripts/audit-push.cjs',
      'scripts/check-git.cjs',
      'scripts/group-status.cjs',
      'scripts/smart-pull.cjs',
      'scripts/sync-agent-rules.cjs',
      'scripts/acm-manifest.cjs',
      'scripts/uninstall-template.cjs',
      'scripts/acm-db-cli.cjs',
      'scripts/mcp-server.cjs',
      'scripts/storage/id-utils.cjs',
      'scripts/storage/config.cjs',
      'scripts/storage/memory-store.cjs',
      'scripts/storage/sqlite-provider.cjs',
      'scripts/storage/markdown-bridge.cjs',
      'scripts/storage/markdown-provider.cjs',
      'scripts/storage/secret-scrubber.cjs',
      'scripts/storage/git-orphan-sync.cjs',
    ],
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
 * Returns selective .gitignore entries, conditionally including /.agents/hooks.json
 * only when ACM created .agents/hooks.json itself.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.includeHooks=false]
 * @returns {string[]}
 */
function getGitignoreEntries({ includeHooks = false } = {}) {
  const base = Array.isArray(ACM_MANIFEST.gitignore.entries)
    ? [...ACM_MANIFEST.gitignore.entries]
    : [];
  const hooksEntry = ACM_MANIFEST.gitignore.hooksEntry;
  if (!includeHooks || !hooksEntry) {
    return base;
  }
  const backupIdx = base.indexOf('/.acm-backup-*');
  if (backupIdx === -1) {
    return [...base, hooksEntry];
  }
  return [...base.slice(0, backupIdx), hooksEntry, ...base.slice(backupIdx)];
}

/**
 * Builds the default .gitignore block with optional /.agents/hooks.json entry.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.includeHooks=false]
 * @returns {string}
 */
function buildGitignoreTemplate({ includeHooks = false } = {}) {
  const entries = getGitignoreEntries({ includeHooks });
  return `${ACM_MANIFEST.gitignore.headerComment}\n${entries.join('\n')}\n`;
}

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
  getGitignoreEntries,
  buildGitignoreTemplate,
};

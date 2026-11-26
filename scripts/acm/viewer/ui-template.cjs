/**
 * scripts/acm/viewer/ui-template.cjs
 *
 * 외부 CDN 의존성 없는 오프라인 단일 HTML 뷰어 템플릿.
 * 로컬 HTTP(acm ui), 정적 HTML 스냅샷(export --format=html), MCP Apps 공용.
 */

const { BUNDLE_CSS, BUNDLE_JS } = require('./ui-bundle.cjs');

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const UI_COPY = {
  en: {
    appTitle: 'ACM Local Viewer',
    snapshotBadge: 'Snapshot (Read-Only)',
    readOnlyBadge: 'Read-Only',
    searchPlaceholder: 'Search code, title, keyword...',
    refresh: 'Refresh',
    theme: 'Theme',
    compact: 'Compact',
    exportJson: 'Export JSON',
    exportHtml: 'Export HTML',
    newTask: '+ New Task',
    tabTasks: 'Tasks',
    tabPatterns: 'Patterns',
    tabAdrs: 'ADRs',
    tabArchive: 'Archive',
    filterAll: 'All',
    filterActive: 'Active',
    filterReady: 'Ready',
    filterDone: 'Done',
    itemsShown: '{count} shown',
    noItems: 'No matching records.',
    selectHint: 'Select a record to inspect details.',
    copyId: 'Copy ID',
    copyPath: 'Copy',
    openFile: 'Open',
    copied: 'Copied',
    editTask: 'Edit Task',
    purpose: 'Purpose',
    results: 'Results',
    targets: 'Targets',
    summary: 'Summary',
    symptom: 'Symptom',
    solution: 'Solution',
    relatedFiles: 'Related Files',
    tags: 'Tags',
    context: 'Context',
    decision: 'Decision',
    impact: 'Impact',
    relatedArea: 'Related Area',
    commitSha: 'Commit',
    owner: 'Owner',
    author: 'Author',
    accessCount: 'Views',
    archivedAt: 'Archived',
    updatedAt: 'Updated',
    retentionLabel: 'FTS {days}d / Proj {limit}',
    modalCreateTitle: 'New Task',
    modalEditTitle: 'Edit Task',
    fieldTitle: 'Title',
    fieldStatus: 'Status',
    fieldPurpose: 'Purpose',
    fieldResults: 'Results (one bullet per line)',
    fieldTargets: 'Targets (one file path per line)',
    fieldOwner: 'Owner (optional)',
    doneHint: 'Transitioning to Done requires an explicit Git commit (npm run acm:commit).',
    cancel: 'Cancel',
    save: 'Save',
    compactTitle: 'Compact Preview (Dry-Run)',
    compactLoading: 'Analyzing retention candidates...',
    compactSummary: 'Tasks to archive: {tasks} | sync_log to prune: {logs} | Current DB: {size}',
    compactConfirm: 'Run Compact',
    compactDone: 'Compacted: archived {tasks} task(s), pruned {logs} sync_log(s), reclaimed {reclaimed}.',
    compactSkipped: 'Compact is skipped in Markdown storage mode.',
    statusTodo: 'Todo',
    statusInProgress: 'In Progress',
    statusPaused: 'Paused',
    statusReady: 'Ready',
    backToList: 'List',
    moreActions: 'More actions',
    clearSearch: 'Clear search',
    groupInProgress: 'In Progress',
    groupReady: 'Ready to Commit',
    groupTodo: 'Todo',
    groupPaused: 'Paused',
    groupDone: 'Done',
    storageLabel: 'Storage',
    retentionTitle: 'Retention',
    modeThemeDark: 'Switch to Dark',
    modeThemeLight: 'Switch to Light',
    statusChange: 'Status',
    readyIncompleteHint: 'Ready status requires Purpose, Results, and Targets. Open editor to complete them.',
    openEditor: 'Open Editor',
    keyboardHint: '/ search · j/k move · Esc back',
    category: 'Category',
    relatedTask: 'Related Task',
    branch: 'Branch',
    date: 'Date',
  },
  ko: {
    appTitle: 'ACM 로컬 뷰어',
    snapshotBadge: '스냅샷 (읽기 전용)',
    readOnlyBadge: '읽기 전용',
    searchPlaceholder: '코드, 제목, 키워드 검색...',
    refresh: '새로고침',
    theme: '테마',
    compact: '정리',
    exportJson: 'JSON 저장',
    exportHtml: 'HTML 저장',
    newTask: '+ 새 태스크',
    tabTasks: '태스크',
    tabPatterns: '패턴',
    tabAdrs: 'ADR',
    tabArchive: '아카이브',
    filterAll: '전체',
    filterActive: '활성',
    filterReady: '커밋 대기',
    filterDone: '완료',
    itemsShown: '{count}건 표시',
    noItems: '일치하는 레코드가 없습니다.',
    selectHint: '항목을 선택하면 상세 정보가 표시됩니다.',
    copyId: 'ID 복사',
    copyPath: '복사',
    openFile: '열기',
    copied: '복사됨',
    editTask: '태스크 편집',
    purpose: '목적',
    results: '수행 결과',
    targets: '대상 영역',
    summary: '요약',
    symptom: '문제/증상',
    solution: '해결 패턴',
    relatedFiles: '관련 파일',
    tags: '태그',
    context: '배경 및 맥락',
    decision: '아키텍처 결정',
    impact: '예상 영향',
    relatedArea: '관련 영역',
    commitSha: '커밋',
    owner: '담당자',
    author: '작성자',
    accessCount: '조회수',
    archivedAt: '아카이브 일시',
    updatedAt: '수정 일시',
    retentionLabel: 'FTS {days}일 · 투영 {limit}건',
    modalCreateTitle: '새 태스크 등록',
    modalEditTitle: '태스크 편집',
    fieldTitle: '제목',
    fieldStatus: '상태',
    fieldPurpose: '목적 (Purpose)',
    fieldResults: '수행 결과 (줄바꿈으로 항목 구분)',
    fieldTargets: '대상 경로 (줄바꿈으로 파일 구분)',
    fieldOwner: '담당자 (선택)',
    doneHint: '완료(Done) 전환은 명시적 Git 커밋(npm run acm:commit)으로만 수행할 수 있습니다.',
    cancel: '취소',
    save: '저장',
    compactTitle: 'DB 정리 미리보기 (Dry-Run)',
    compactLoading: '보존 정책 대상 분석 중...',
    compactSummary: '아카이브 대상 태스크: {tasks}건 | sync_log 정리: {logs}건 | 현재 DB: {size}',
    compactConfirm: '정리 실행',
    compactDone: '정리 완료: 태스크 {tasks}건 아카이브, sync_log {logs}건 정리, {reclaimed} 회수.',
    compactSkipped: 'Markdown 저장소 모드에서는 DB 정리가 생략됩니다.',
    statusTodo: '대기 (Todo)',
    statusInProgress: '진행 중 (In Progress)',
    statusPaused: '보류 (Paused)',
    statusReady: '커밋 대기 (Ready)',
    backToList: '목록',
    moreActions: '더보기',
    clearSearch: '검색 초기화',
    groupInProgress: '진행 중',
    groupReady: '커밋 대기',
    groupTodo: '대기',
    groupPaused: '보류',
    groupDone: '완료',
    storageLabel: '저장소',
    retentionTitle: '보존 정책',
    modeThemeDark: '다크 모드로 전환',
    modeThemeLight: '라이트 모드로 전환',
    statusChange: '상태',
    readyIncompleteHint: '커밋 대기(Ready) 전환에는 목적, 수행 결과, 대상 영역 3요소가 필요합니다. 편집 창에서 보완하세요.',
    openEditor: '편집 창 열기',
    keyboardHint: '/ 검색 · j/k 이동 · Esc 뒤로',
    category: '카테고리',
    relatedTask: '연관 태스크',
    branch: '브랜치',
    date: '일자',
  },
};

/**
 * 오프라인 단일 HTML 뷰어 문서를 렌더링한다.
 */
function renderViewerHtml({
  mode = 'http',
  lang = 'en',
  sessionToken = '',
  readOnly = false,
  snapshot = null,
  initialTab = 'tasks',
  hostLabel = '',
} = {}) {
  const effLang = lang === 'ko' ? 'ko' : 'en';
  const copy = UI_COPY[effLang];
  const writable = mode !== 'snapshot' && !readOnly;
  const configObj = {
    mode,
    lang: effLang,
    readOnly: !writable,
    sessionToken: writable ? String(sessionToken || '') : '',
    initialTab: ['tasks', 'patterns', 'adrs', 'archive'].includes(initialTab) ? initialTab : 'tasks',
    hostLabel: String(hostLabel || ''),
    snapshot: mode === 'snapshot' ? snapshot : null,
    copy,
  };

  return `<!DOCTYPE html>
<html lang="${escapeHtml(effLang)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(copy.appTitle)}</title>
  <style>${BUNDLE_CSS}</style>
</head>
<body>
  <div id="app"></div>
  <script>window.__ACM_CONFIG__ = ${serializeInlineJson(configObj)};\n${BUNDLE_JS}</script>
</body>
</html>
`;
}

module.exports = {
  escapeHtml,
  serializeInlineJson,
  renderViewerHtml,
  UI_COPY,
};

/**
 * scripts/acm/viewer/ui-template.cjs
 *
 * 외부 CDN 의존성 없는 오프라인 단일 HTML 뷰어 템플릿.
 * 로컬 HTTP(acm ui), 정적 HTML 스냅샷(export --format=html), MCP Apps(Phase B) 공용.
 */

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
  },
};

/**
 * Renders a self-contained offline HTML viewer document.
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

  const badgeText =
    mode === 'snapshot'
      ? copy.snapshotBadge
      : hostLabel || (mode === 'mcp-app' ? 'MCP App' : '127.0.0.1');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(effLang)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(copy.appTitle)}</title>
  <style>
    :root {
      --bg: var(--color-background-primary, #f8fafc);
      --surface: var(--color-background-secondary, #ffffff);
      --surface-alt: var(--color-background-tertiary, #f1f5f9);
      --fg: var(--color-text-primary, #0f172a);
      --muted: var(--color-text-secondary, #475569);
      --border: var(--color-border-primary, #e2e8f0);
      --primary: #2563eb;
      --primary-fg: #ffffff;
      --success: #15803d;
      --warning: #b45309;
      --danger: #b91c1c;
      --code-bg: #eef2ff;
      --code-fg: #3730a3;
      --font: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: var(--color-background-primary, #0b1120);
        --surface: var(--color-background-secondary, #111827);
        --surface-alt: var(--color-background-tertiary, #1e293b);
        --fg: var(--color-text-primary, #f1f5f9);
        --muted: var(--color-text-secondary, #94a3b8);
        --border: var(--color-border-primary, #334155);
        --primary: #3b82f6;
        --primary-fg: #ffffff;
        --success: #4ade80;
        --warning: #fbbf24;
        --danger: #f87171;
        --code-bg: #1e293b;
        --code-fg: #93c5fd;
      }
    }
    :root[data-theme="dark"] {
      --bg: #0b1120;
      --surface: #111827;
      --surface-alt: #1e293b;
      --fg: #f1f5f9;
      --muted: #94a3b8;
      --border: #334155;
      --primary: #3b82f6;
      --primary-fg: #ffffff;
      --success: #4ade80;
      --warning: #fbbf24;
      --danger: #f87171;
      --code-bg: #1e293b;
      --code-fg: #93c5fd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.5;
    }
    .app {
      max-width: 1320px;
      margin: 0 auto;
      padding: 12px 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .brand-title { font-size: 15px; font-weight: 700; }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      font-family: var(--mono);
    }
    .pill-warn { color: var(--warning); }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    input[type="search"], input[type="text"], select, textarea {
      font-family: var(--font);
      font-size: 12px;
      color: var(--fg);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 8px;
    }
    input[type="search"] { width: 220px; }
    button {
      font-family: var(--font);
      font-size: 12px;
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--fg);
      cursor: pointer;
    }
    button:hover { background: var(--surface-alt); }
    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-fg);
      font-weight: 600;
    }
    button.primary:hover { opacity: 0.92; }
    .subbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tabs, .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .tab-btn.active, .filter-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-fg);
      font-weight: 600;
    }
    .filter-btn { padding: 3px 8px; font-size: 11px; }
    .meta-right { color: var(--muted); font-family: var(--mono); font-size: 12px; }
    .main-grid {
      display: grid;
      grid-template-columns: minmax(300px, 1fr) minmax(320px, 1.15fr);
      gap: 12px;
      align-items: start;
    }
    @media (max-width: 840px) {
      .main-grid { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .list-wrap { max-height: 70vh; overflow-y: auto; }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--surface-alt); }
    .row.selected { background: var(--surface-alt); box-shadow: inset 3px 0 0 var(--primary); }
    .row-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .code {
      font-family: var(--mono);
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--code-fg);
      flex-shrink: 0;
    }
    .row-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }
    .row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 11px; }
    .st-ready { color: var(--warning); font-weight: 600; }
    .st-done, .st-active, .st-accepted { color: var(--success); }
    .st-in_progress { color: var(--primary); font-weight: 600; }
    .st-archived, .st-paused, .st-todo { color: var(--muted); }
    .detail { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .detail-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; }
    .detail-title { font-size: 15px; font-weight: 700; margin: 0; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; }
    .section-body { white-space: pre-wrap; word-break: break-word; }
    .bullet-list { margin: 0; padding-left: 18px; }
    .target-row {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 2px 4px 2px 0;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 11px;
    }
    .mini-btn { padding: 1px 5px; font-size: 10px; }
    .empty { padding: 20px; text-align: center; color: var(--muted); }
    .banner {
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      font-size: 12px;
    }
    .banner.err { border-color: var(--danger); color: var(--danger); }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      width: 100%;
      max-width: 560px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal h3 { margin: 0; font-size: 15px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { font-size: 12px; font-weight: 600; color: var(--muted); }
    .field textarea { min-height: 68px; resize: vertical; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <span class="pill" id="hostBadge">${escapeHtml(badgeText)}</span>
        <span class="brand-title">${escapeHtml(copy.appTitle)}</span>
        <span class="pill" id="storageBadge">-</span>
        <span class="pill" id="retentionBadge">-</span>
        <span class="pill pill-warn ${writable ? 'hidden' : ''}" id="roBadge">${escapeHtml(copy.readOnlyBadge)}</span>
      </div>
      <div class="controls">
        <input id="searchInput" type="search" placeholder="${escapeHtml(copy.searchPlaceholder)}" />
        <button id="refreshBtn" class="${mode === 'snapshot' ? 'hidden' : ''}">${escapeHtml(copy.refresh)}</button>
        <button id="newTaskBtn" class="primary ${writable ? '' : 'hidden'}">${escapeHtml(copy.newTask)}</button>
        <button id="compactBtn" class="${writable ? '' : 'hidden'}">${escapeHtml(copy.compact)}</button>
        <button id="exportJsonBtn">${escapeHtml(copy.exportJson)}</button>
        <button id="exportHtmlBtn" class="${mode === 'http' ? '' : 'hidden'}">${escapeHtml(copy.exportHtml)}</button>
        <button id="themeBtn">${escapeHtml(copy.theme)}</button>
      </div>
    </div>

    <div id="statusBanner" class="banner hidden"></div>

    <div class="subbar">
      <div class="tabs" id="tabBar"></div>
      <div class="filters" id="filterBar"></div>
      <span class="meta-right" id="countBadge">0</span>
    </div>

    <div class="main-grid">
      <div class="card list-wrap" id="listBody"></div>
      <div class="card detail" id="detailPanel"></div>
    </div>
  </div>

  <div class="modal-backdrop" id="taskModal">
    <div class="modal">
      <h3 id="taskModalTitle">${escapeHtml(copy.modalCreateTitle)}</h3>
      <div id="taskModalError" class="banner err hidden"></div>
      <div class="field">
        <label for="fTitle">${escapeHtml(copy.fieldTitle)}</label>
        <input id="fTitle" type="text" />
      </div>
      <div class="field">
        <label for="fStatus">${escapeHtml(copy.fieldStatus)}</label>
        <select id="fStatus">
          <option value="todo">${escapeHtml(copy.statusTodo)}</option>
          <option value="in_progress">${escapeHtml(copy.statusInProgress)}</option>
          <option value="paused">${escapeHtml(copy.statusPaused)}</option>
          <option value="ready">${escapeHtml(copy.statusReady)}</option>
        </select>
      </div>
      <div class="field">
        <label for="fPurpose">${escapeHtml(copy.fieldPurpose)}</label>
        <textarea id="fPurpose"></textarea>
      </div>
      <div class="field">
        <label for="fResults">${escapeHtml(copy.fieldResults)}</label>
        <textarea id="fResults"></textarea>
      </div>
      <div class="field">
        <label for="fTargets">${escapeHtml(copy.fieldTargets)}</label>
        <textarea id="fTargets"></textarea>
      </div>
      <div class="field">
        <label for="fOwner">${escapeHtml(copy.fieldOwner)}</label>
        <input id="fOwner" type="text" />
      </div>
      <div style="font-size:11px;color:var(--muted);">${escapeHtml(copy.doneHint)}</div>
      <div class="modal-actions">
        <button id="taskCancelBtn">${escapeHtml(copy.cancel)}</button>
        <button id="taskSaveBtn" class="primary">${escapeHtml(copy.save)}</button>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="compactModal">
    <div class="modal">
      <h3>${escapeHtml(copy.compactTitle)}</h3>
      <div id="compactBody" class="banner">${escapeHtml(copy.compactLoading)}</div>
      <div class="modal-actions">
        <button id="compactCancelBtn">${escapeHtml(copy.cancel)}</button>
        <button id="compactConfirmBtn" class="primary">${escapeHtml(copy.compactConfirm)}</button>
      </div>
    </div>
  </div>

  <script>
    window.__ACM_CONFIG__ = ${serializeInlineJson(configObj)};
    (function () {
      const CFG = window.__ACM_CONFIG__;
      const T = CFG.copy;
      const state = {
        rootDir: '',
        overview: CFG.snapshot ? CFG.snapshot.overview : null,
        tab: CFG.initialTab || 'tasks',
        statusFilter: 'all',
        query: '',
        items: [],
        selectedUid: null,
        editingTask: null,
        searchTimer: null,
      };

      function esc(val) {
        return String(val === null || val === undefined ? '' : val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function fmtBytes(n) {
        const num = Number(n) || 0;
        if (num < 1024) return num + ' B';
        if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
        return (num / (1024 * 1024)).toFixed(2) + ' MB';
      }

      function fmt(tpl, vars) {
        return String(tpl || '').replace(/\\{(\\w+)\\}/g, (_, k) =>
          vars && vars[k] !== undefined ? String(vars[k]) : ''
        );
      }

      function showBanner(msg, isErr) {
        const el = document.getElementById('statusBanner');
        if (!msg) {
          el.classList.add('hidden');
          el.textContent = '';
          return;
        }
        el.textContent = msg;
        el.classList.toggle('err', Boolean(isErr));
        el.classList.remove('hidden');
      }

      async function apiGet(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      async function apiPost(url, body) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ACM-Token': CFG.sessionToken,
          },
          body: JSON.stringify(body || {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function applyReadOnlyUi() {
        const roBadge = document.getElementById('roBadge');
        const newBtn = document.getElementById('newTaskBtn');
        const cmpBtn = document.getElementById('compactBtn');
        if (roBadge) roBadge.classList.toggle('hidden', !CFG.readOnly);
        if (newBtn) newBtn.classList.toggle('hidden', CFG.readOnly);
        if (cmpBtn) cmpBtn.classList.toggle('hidden', CFG.readOnly);
      }

      const mcpBridge = (function createMcpBridge() {
        if (CFG.mode !== 'mcp-app') return null;
        let nextId = 1;
        let initialResultReceived = false;
        const pending = new Map();

        function applyHostContext(hostCtx) {
          if (!hostCtx || typeof hostCtx !== 'object') return;
          if (hostCtx.theme === 'dark' || hostCtx.theme === 'light') {
            document.documentElement.setAttribute('data-theme', hostCtx.theme);
          }
          if (hostCtx.styles && hostCtx.styles.variables && typeof hostCtx.styles.variables === 'object') {
            for (const [k, v] of Object.entries(hostCtx.styles.variables)) {
              if (k && v !== undefined && v !== null) {
                document.documentElement.style.setProperty(String(k), String(v));
              }
            }
          }
        }

        function applyToolResult(sc) {
          if (!sc || typeof sc !== 'object') return;
          initialResultReceived = true;
          if (sc.rootDir) state.rootDir = String(sc.rootDir);
          if (sc.readOnly !== undefined) {
            CFG.readOnly = Boolean(sc.readOnly);
            applyReadOnlyUi();
          }
          if (sc.overview) state.overview = sc.overview;
          if (sc.tab) state.tab = sc.tab;
          if (sc.status) state.statusFilter = sc.status;
          if (sc.query !== undefined) {
            state.query = String(sc.query || '');
            const si = document.getElementById('searchInput');
            if (si && si.value !== state.query) si.value = state.query;
          }
          if (Array.isArray(sc.items)) state.items = sc.items;
          renderHeader();
          renderTabs();
          renderList();
        }

        window.addEventListener('message', (event) => {
          const msg = event && event.data;
          if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
          if (msg.id !== undefined && msg.method === undefined && pending.has(msg.id)) {
            const entry = pending.get(msg.id);
            pending.delete(msg.id);
            clearTimeout(entry.timer);
            if (msg.error) entry.reject(new Error(msg.error.message || 'MCP App RPC error'));
            else entry.resolve(msg.result);
            return;
          }
          if (msg.method === 'ping' && msg.id !== undefined) {
            window.parent.postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, '*');
            return;
          }
          if (msg.method === 'ui/notifications/host-context-changed') {
            applyHostContext(msg.params);
            return;
          }
          if (msg.method === 'ui/notifications/tool-result') {
            if (msg.params && msg.params.structuredContent) {
              applyToolResult(msg.params.structuredContent);
            }
          }
        });

        function request(method, params) {
          return new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new Error('MCP App bridge timeout: ' + method));
            }, 15000);
            pending.set(id, { resolve, reject, timer });
            window.parent.postMessage({ jsonrpc: '2.0', id, method, params: params || {} }, '*');
          });
        }

        function notify(method, params) {
          window.parent.postMessage({ jsonrpc: '2.0', method, params: params || {} }, '*');
        }

        function toFileUri(rootDir, relPath) {
          const base = String(rootDir || '').replace(/\\\\/g, '/').replace(/\\/+$/, '');
          const rel = String(relPath || '').replace(/\\\\/g, '/').replace(/^\\.?\\/+/, '');
          const joined = base ? base + '/' + rel : rel;
          const encoded = joined
            .split('/')
            .map((seg, idx) => (idx === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
            .join('/');
          return /^[A-Za-z]:\\//.test(joined) ? 'file:///' + encoded : 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded;
        }

        return {
          hasInitialToolResult: () => initialResultReceived,
          async connect() {
            const initRes = await request('ui/initialize', {
              protocolVersion: '2026-01-26',
              appInfo: { name: 'agent-context-memory', version: '0.2.0' },
              appCapabilities: {},
            });
            applyHostContext(initRes && initRes.hostContext);
            notify('ui/notifications/initialized', {});
            if (typeof ResizeObserver === 'function' && document.body) {
              let lastH = 0;
              const ro = new ResizeObserver(() => {
                const h = Math.ceil(document.body.scrollHeight);
                if (h && h !== lastH) {
                  lastH = h;
                  notify('ui/notifications/size-changed', { height: h });
                }
              });
              ro.observe(document.body);
            }
            return initRes;
          },
          async callServerTool(name, args) {
            const res = await request('tools/call', { name, arguments: args || {} });
            if (res && res.isError) {
              const txt = res.content && res.content[0] && res.content[0].text;
              let errMsg = txt || 'Tool call failed';
              try {
                const parsed = JSON.parse(txt);
                if (parsed && parsed.error) errMsg = parsed.error;
              } catch (_) {}
              throw new Error(errMsg);
            }
            if (res && res.structuredContent) return res.structuredContent;
            const text = res && res.content && res.content[0] && res.content[0].text;
            return text ? JSON.parse(text) : {};
          },
          openWorkspaceFile(relPath) {
            if (!state.rootDir || !relPath) return;
            const uri = toFileUri(state.rootDir, relPath);
            request('com.google.antigravity/toggle-aux-pane', {
              tabType: 'fileView',
              uri,
            }).catch(() => {});
          },
        };
      })();

      const transport = {
        async loadOverview() {
          if (CFG.mode === 'snapshot') return CFG.snapshot.overview;
          if (CFG.mode === 'http') return apiGet('/api/overview');
          if (CFG.mode === 'mcp-app' && mcpBridge) {
            return mcpBridge.callServerTool('acm_viewer_data', {
              action: 'overview',
              rootDir: state.rootDir || undefined,
            });
          }
          return state.overview;
        },
        async loadItems(tab, statusFilter, query) {
          if (CFG.mode === 'snapshot') {
            const q = String(query || '').trim().toLowerCase();
            if (q) {
              const pool = tab === 'archive'
                ? (CFG.snapshot.tabs.archive || [])
                : [
                    ...(CFG.snapshot.tabs.tasks || []),
                    ...(CFG.snapshot.tabs.patterns || []),
                    ...(CFG.snapshot.tabs.adrs || []),
                  ];
              const tokens = q.split(/\\s+/).filter(Boolean);
              const matched = pool.filter((it) => {
                const hay = [
                  it.code, it.title, it.purpose, it.summary, it.symptom, it.solution,
                  it.context, it.decision, it.impact,
                  ...(it.results || []), ...(it.targets || []),
                ].filter(Boolean).join(' ').toLowerCase();
                return tokens.every((tok) => hay.includes(tok));
              });
              return { items: matched, total: matched.length };
            }
            let list = (CFG.snapshot.tabs && CFG.snapshot.tabs[tab]) || [];
            if (tab === 'tasks' && statusFilter !== 'all') {
              list = statusFilter === 'active'
                ? list.filter((x) => x.status !== 'done')
                : list.filter((x) => x.status === statusFilter);
            }
            return { items: list, total: list.length };
          }
          if (CFG.mode === 'http') {
            const q = String(query || '').trim();
            if (q) {
              const kindParam = tab === 'archive' ? 'archive' : 'all';
              return apiGet('/api/search?q=' + encodeURIComponent(q) + '&kind=' + encodeURIComponent(kindParam));
            }
            return apiGet('/api/items?tab=' + encodeURIComponent(tab) + '&status=' + encodeURIComponent(statusFilter));
          }
          if (CFG.mode === 'mcp-app' && mcpBridge) {
            const q = String(query || '').trim();
            if (q) {
              return mcpBridge.callServerTool('acm_viewer_data', {
                action: 'search',
                query: q,
                kind: tab === 'archive' ? 'archive' : 'all',
                rootDir: state.rootDir || undefined,
              });
            }
            return mcpBridge.callServerTool('acm_viewer_data', {
              action: 'items',
              tab,
              status: statusFilter,
              rootDir: state.rootDir || undefined,
            });
          }
          return { items: [], total: 0 };
        },
        async saveTask(payload) {
          if (CFG.mode === 'http') return apiPost('/api/tasks', payload);
          if (CFG.mode === 'mcp-app' && mcpBridge && !CFG.readOnly) {
            return mcpBridge.callServerTool('acm_viewer_data', {
              action: 'task_upsert',
              payload,
              rootDir: state.rootDir || undefined,
            });
          }
          throw new Error('Read-only mode');
        },
        async runCompact(opts) {
          if (CFG.mode === 'http') return apiPost('/api/compact', opts);
          if (CFG.mode === 'mcp-app' && mcpBridge && !CFG.readOnly) {
            return mcpBridge.callServerTool('acm_viewer_data', {
              action: 'compact',
              payload: opts,
              rootDir: state.rootDir || undefined,
            });
          }
          throw new Error('Read-only mode');
        },
      };

      function renderHeader() {
        const ov = state.overview;
        if (!ov) return;
        const sb = document.getElementById('storageBadge');
        const rb = document.getElementById('retentionBadge');
        sb.textContent = ov.provider === 'sqlite'
          ? 'sqlite (' + fmtBytes(ov.dbSizeBytes) + ')'
          : ov.provider;
        const ret = ov.retention || {};
        rb.textContent = fmt(T.retentionLabel, {
          days: ret.doneTaskFtsDays !== undefined ? ret.doneTaskFtsDays : 90,
          limit: ret.doneTaskProjectionLimit !== undefined ? ret.doneTaskProjectionLimit : 50,
        });
      }

      function renderTabs() {
        const ov = state.overview;
        const c = (ov && ov.counts) || { tasks: {}, patterns: {}, adrs: {}, archive: 0 };
        const defs = [
          { id: 'tasks', label: T.tabTasks, count: c.tasks.visible !== undefined ? c.tasks.visible : (c.tasks.total || 0) },
          { id: 'patterns', label: T.tabPatterns, count: c.patterns.total || 0 },
          { id: 'adrs', label: T.tabAdrs, count: c.adrs.total || 0 },
          { id: 'archive', label: T.tabArchive, count: c.archive || 0 },
        ];
        const tabBar = document.getElementById('tabBar');
        tabBar.innerHTML = defs.map((d) =>
          '<button class="tab-btn ' + (d.id === state.tab ? 'active' : '') + '" data-tab="' + d.id + '">' +
            esc(d.label) + ' (' + esc(d.count) + ')</button>'
        ).join('');
        tabBar.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.tab = btn.dataset.tab;
            state.selectedUid = null;
            refreshList();
          });
        });

        const filterBar = document.getElementById('filterBar');
        if (state.tab === 'tasks' && !state.query.trim()) {
          const filters = [
            { id: 'all', label: T.filterAll },
            { id: 'active', label: T.filterActive },
            { id: 'ready', label: T.filterReady },
            { id: 'done', label: T.filterDone },
          ];
          filterBar.innerHTML = filters.map((f) =>
            '<button class="filter-btn ' + (f.id === state.statusFilter ? 'active' : '') + '" data-filter="' + f.id + '">' +
              esc(f.label) + '</button>'
          ).join('');
          filterBar.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', () => {
              state.statusFilter = btn.dataset.filter;
              state.selectedUid = null;
              refreshList();
            });
          });
        } else {
          filterBar.innerHTML = '';
        }
      }

      function renderList() {
        const listBody = document.getElementById('listBody');
        const countBadge = document.getElementById('countBadge');
        countBadge.textContent = fmt(T.itemsShown, { count: state.items.length });

        if (state.items.length === 0) {
          listBody.innerHTML = '<div class="empty">' + esc(T.noItems) + '</div>';
          renderDetail(null);
          return;
        }

        if (!state.items.some((x) => x.uid === state.selectedUid)) {
          state.selectedUid = state.items[0].uid;
        }

        listBody.innerHTML = state.items.map((item) => {
          const sel = item.uid === state.selectedUid ? 'selected' : '';
          const stClass = 'st-' + String(item.status || 'todo').replace(/[^a-z_]/gi, '');
          return '<div class="row ' + sel + '" data-uid="' + esc(item.uid) + '">' +
            '<div class="row-left">' +
              '<span class="code">' + esc(item.code) + '</span>' +
              '<span class="row-title">' + esc(item.title) + '</span>' +
            '</div>' +
            '<div class="row-right">' +
              '<span class="' + stClass + '">' + esc(item.statusLabel || item.status || '') + '</span>' +
              '<span style="color:var(--muted);font-family:var(--mono);">' + esc(item.meta || '') + '</span>' +
            '</div>' +
          '</div>';
        }).join('');

        listBody.querySelectorAll('.row').forEach((row) => {
          row.addEventListener('click', () => {
            state.selectedUid = row.dataset.uid;
            renderList();
          });
        });

        const current = state.items.find((x) => x.uid === state.selectedUid) || state.items[0];
        renderDetail(current);
      }

      function copyText(text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            if (btn) {
              const prev = btn.textContent;
              btn.textContent = T.copied;
              setTimeout(() => { btn.textContent = prev; }, 1000);
            }
          }).catch(() => {});
        }
      }

      function renderDetail(item) {
        const panel = document.getElementById('detailPanel');
        if (!item) {
          panel.innerHTML = '<div class="empty">' + esc(T.selectHint) + '</div>';
          return;
        }

        const canEdit = !CFG.readOnly && item.kind === 'task' && item.status !== 'done' && !item.archivedAt;
        const metaPills = [];
        if (item.statusLabel || item.status) metaPills.push(item.statusLabel || item.status);
        if (item.commitSha) metaPills.push(T.commitSha + ': ' + item.commitSha.slice(0, 7));
        if (item.owner) metaPills.push(T.owner + ': ' + item.owner);
        if (item.author) metaPills.push(T.author + ': ' + item.author);
        if (item.kind === 'pattern') metaPills.push(T.accessCount + ': ' + (item.accessCount || 0));
        if (item.archivedAt) metaPills.push(T.archivedAt + ': ' + String(item.archivedAt).slice(0, 10));
        if (item.updatedAt) metaPills.push(T.updatedAt + ': ' + String(item.updatedAt).slice(0, 10));

        let sections = '';
        if (item.kind === 'task') {
          if (item.purpose) {
            sections += '<div><div class="section-title">' + esc(T.purpose) + '</div><div class="section-body">' + esc(item.purpose) + '</div></div>';
          }
          if (item.results && item.results.length) {
            sections += '<div><div class="section-title">' + esc(T.results) + '</div><ul class="bullet-list">' +
              item.results.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul></div>';
          }
          if (item.targets && item.targets.length) {
            const canOpenFile = CFG.mode === 'mcp-app' && Boolean(state.rootDir);
            sections += '<div><div class="section-title">' + esc(T.targets) + '</div><div>' +
              item.targets.map((tg) =>
                '<span class="target-row"><span>' + esc(tg) + '</span>' +
                '<button class="mini-btn copy-target-btn" data-path="' + esc(tg) + '">' + esc(T.copyPath) + '</button>' +
                (canOpenFile
                  ? '<button class="mini-btn open-target-btn" data-path="' + esc(tg) + '">' + esc(T.openFile) + '</button>'
                  : '') +
                '</span>'
              ).join('') + '</div></div>';
          }
        } else if (item.kind === 'pattern') {
          if (item.summary) sections += '<div><div class="section-title">' + esc(T.summary) + '</div><div class="section-body">' + esc(item.summary) + '</div></div>';
          if (item.symptom) sections += '<div><div class="section-title">' + esc(T.symptom) + '</div><div class="section-body">' + esc(item.symptom) + '</div></div>';
          if (item.solution) sections += '<div><div class="section-title">' + esc(T.solution) + '</div><div class="section-body">' + esc(item.solution) + '</div></div>';
          if (item.relatedFiles && item.relatedFiles.length) {
            sections += '<div><div class="section-title">' + esc(T.relatedFiles) + '</div><div>' +
              item.relatedFiles.map((f) => '<span class="target-row">' + esc(f) + '</span>').join('') + '</div></div>';
          }
          if (item.tags && item.tags.length) {
            sections += '<div><div class="section-title">' + esc(T.tags) + '</div><div>' +
              item.tags.map((tg) => '<span class="pill">' + esc(tg) + '</span> ').join('') + '</div></div>';
          }
        } else if (item.kind === 'adr') {
          if (item.summary) sections += '<div><div class="section-title">' + esc(T.summary) + '</div><div class="section-body">' + esc(item.summary) + '</div></div>';
          if (item.relatedArea) sections += '<div><div class="section-title">' + esc(T.relatedArea) + '</div><div class="section-body">' + esc(item.relatedArea) + '</div></div>';
          if (item.context) sections += '<div><div class="section-title">' + esc(T.context) + '</div><div class="section-body">' + esc(item.context) + '</div></div>';
          if (item.decision) sections += '<div><div class="section-title">' + esc(T.decision) + '</div><div class="section-body">' + esc(item.decision) + '</div></div>';
          if (item.impact) sections += '<div><div class="section-title">' + esc(T.impact) + '</div><div class="section-body">' + esc(item.impact) + '</div></div>';
        }

        panel.innerHTML =
          '<div class="detail-head">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span class="code">' + esc(item.code) + '</span>' +
              '<button class="mini-btn" id="copyIdBtn">' + esc(T.copyId) + '</button>' +
            '</div>' +
            (canEdit ? '<button id="editTaskBtn">' + esc(T.editTask) + '</button>' : '') +
          '</div>' +
          '<h2 class="detail-title">' + esc(item.title) + '</h2>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;">' +
            metaPills.map((p) => '<span class="pill">' + esc(p) + '</span>').join('') +
          '</div>' +
          sections;

        const copyBtn = document.getElementById('copyIdBtn');
        if (copyBtn) copyBtn.addEventListener('click', () => copyText(item.code, copyBtn));
        panel.querySelectorAll('.copy-target-btn').forEach((btn) => {
          btn.addEventListener('click', () => copyText(btn.dataset.path, btn));
        });
        panel.querySelectorAll('.open-target-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (mcpBridge) mcpBridge.openWorkspaceFile(btn.dataset.path);
          });
        });
        const editBtn = document.getElementById('editTaskBtn');
        if (editBtn) editBtn.addEventListener('click', () => openTaskModal(item));
      }

      async function refreshAll() {
        try {
          showBanner('');
          state.overview = await transport.loadOverview();
          renderHeader();
          await refreshList();
        } catch (err) {
          showBanner(err.message, true);
        }
      }

      async function refreshList() {
        try {
          renderTabs();
          const res = await transport.loadItems(state.tab, state.statusFilter, state.query);
          state.items = res.items || [];
          renderList();
        } catch (err) {
          showBanner(err.message, true);
        }
      }

      function openTaskModal(task) {
        state.editingTask = task || null;
        document.getElementById('taskModalTitle').textContent = task ? T.modalEditTitle : T.modalCreateTitle;
        document.getElementById('taskModalError').classList.add('hidden');
        document.getElementById('fTitle').value = task ? (task.title || '') : '';
        document.getElementById('fStatus').value = task ? (task.status || 'todo') : 'todo';
        document.getElementById('fPurpose').value = task ? (task.purpose || '') : '';
        document.getElementById('fResults').value = task && task.results ? task.results.join('\\n') : '';
        document.getElementById('fTargets').value = task && task.targets ? task.targets.join('\\n') : '';
        document.getElementById('fOwner').value = task ? (task.owner || '') : '';
        document.getElementById('taskModal').classList.add('open');
      }

      function closeTaskModal() {
        document.getElementById('taskModal').classList.remove('open');
      }

      document.getElementById('taskCancelBtn').addEventListener('click', closeTaskModal);
      document.getElementById('taskSaveBtn').addEventListener('click', async () => {
        const errBox = document.getElementById('taskModalError');
        errBox.classList.add('hidden');
        const payload = {
          idOrCode: state.editingTask ? state.editingTask.code : undefined,
          title: document.getElementById('fTitle').value.trim(),
          status: document.getElementById('fStatus').value,
          purpose: document.getElementById('fPurpose').value.trim(),
          results: document.getElementById('fResults').value.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean),
          targets: document.getElementById('fTargets').value.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean),
          owner: document.getElementById('fOwner').value.trim(),
        };
        try {
          const res = await transport.saveTask(payload);
          closeTaskModal();
          state.overview = res.overview || state.overview;
          state.tab = 'tasks';
          state.selectedUid = res.task ? res.task.uid : null;
          renderHeader();
          await refreshList();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      });

      document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal(null));

      document.getElementById('compactBtn').addEventListener('click', async () => {
        const modal = document.getElementById('compactModal');
        const body = document.getElementById('compactBody');
        const confirmBtn = document.getElementById('compactConfirmBtn');
        body.textContent = T.compactLoading;
        confirmBtn.disabled = true;
        modal.classList.add('open');
        try {
          const res = await transport.runCompact({ dryRun: true });
          const r = res.result || {};
          if (r.skipped) {
            body.textContent = T.compactSkipped;
            confirmBtn.disabled = true;
          } else {
            body.textContent = fmt(T.compactSummary, {
              tasks: r.archivedTasksCount || 0,
              logs: r.prunedSyncLogs || 0,
              size: fmtBytes(r.sizeBeforeBytes || 0),
            });
            confirmBtn.disabled = false;
          }
        } catch (err) {
          body.textContent = err.message;
        }
      });

      document.getElementById('compactCancelBtn').addEventListener('click', () => {
        document.getElementById('compactModal').classList.remove('open');
      });

      document.getElementById('compactConfirmBtn').addEventListener('click', async () => {
        try {
          const res = await transport.runCompact({ dryRun: false });
          const r = res.result || {};
          document.getElementById('compactModal').classList.remove('open');
          showBanner(fmt(T.compactDone, {
            tasks: r.archivedTasksCount || 0,
            logs: r.prunedSyncLogs || 0,
            reclaimed: fmtBytes(r.bytesReclaimed || 0),
          }));
          await refreshAll();
        } catch (err) {
          showBanner(err.message, true);
        }
      });

      document.getElementById('exportJsonBtn').addEventListener('click', () => {
        if (CFG.mode === 'http') {
          window.location.href = '/api/export?format=json';
          return;
        }
        const payload = CFG.mode === 'snapshot'
          ? (CFG.snapshot || {})
          : { overview: state.overview, tab: state.tab, items: state.items };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'acm-snapshot.json';
        a.click();
      });

      document.getElementById('exportHtmlBtn').addEventListener('click', () => {
        if (CFG.mode === 'http') {
          window.location.href = '/api/export?format=html';
        }
      });

      document.getElementById('refreshBtn').addEventListener('click', refreshAll);

      document.getElementById('themeBtn').addEventListener('click', () => {
        const root = document.documentElement;
        const cur = root.getAttribute('data-theme');
        if (cur === 'dark') root.setAttribute('data-theme', 'light');
        else if (cur === 'light') root.setAttribute('data-theme', 'dark');
        else {
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          root.setAttribute('data-theme', prefersDark ? 'light' : 'dark');
        }
      });

      document.getElementById('searchInput').addEventListener('input', (e) => {
        state.query = e.target.value;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          state.selectedUid = null;
          refreshList();
        }, 160);
      });

      if (CFG.mode === 'mcp-app' && mcpBridge) {
        mcpBridge.connect()
          .then(() => {
            if (!mcpBridge.hasInitialToolResult()) {
              return refreshAll();
            }
          })
          .catch((err) => showBanner(err.message, true));
      } else {
        refreshAll();
      }
    })();
  </script>
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

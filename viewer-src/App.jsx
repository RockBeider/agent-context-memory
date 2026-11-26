/**
 * viewer-src/App.jsx
 *
 * ACM 로컬 뷰어 루트 애플리케이션 (Compact-First 1-Pane 드릴다운 / Wide 2-Pane Split).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopHeader } from './components/TopHeader.jsx';
import { RecordList } from './components/RecordList.jsx';
import { DetailPane } from './components/DetailPane.jsx';
import { TaskModal } from './components/TaskModal.jsx';
import { CompactModal } from './components/CompactModal.jsx';
import { createMcpBridge, createTransport } from './transport.js';
import { fmt, fmtBytes } from './utils.js';

const THEME_STORAGE_KEY = 'acm-viewer-theme';

function getInitialTheme(mode) {
  if (mode !== 'mcp-app') {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
        return saved;
      }
    } catch (_) {}
  }
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function App({ initialConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const copy = config.copy || {};

  const [rootDir, setRootDir] = useState('');
  const [overview, setOverview] = useState(
    config.snapshot ? config.snapshot.overview : null
  );
  const [tab, setTab] = useState(config.initialTab || 'tasks');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [banner, setBanner] = useState({ msg: '', isErr: false, actionItem: null });
  const [theme, setTheme] = useState(() => getInitialTheme(initialConfig.mode));
  const [moreOpen, setMoreOpen] = useState(false);

  const [taskModal, setTaskModal] = useState({ open: false, editingTask: null });
  const [compactModal, setCompactModal] = useState({
    open: false,
    loading: false,
    preview: null,
    errorMsg: '',
  });
  const [statusUpdating, setStatusUpdating] = useState(false);

  const searchInputRef = useRef(null);
  const listScrollRef = useRef(null);
  const savedScrollTopRef = useRef(0);
  const rootDirRef = useRef(rootDir);
  rootDirRef.current = rootDir;
  const configRef = useRef(config);
  configRef.current = config;

  const mcpBridge = useMemo(() => {
    return createMcpBridge({
      config: initialConfig,
      onHostContext(hostCtx) {
        if (!hostCtx || typeof hostCtx !== 'object') return;
        if (hostCtx.theme === 'dark' || hostCtx.theme === 'light') {
          document.documentElement.setAttribute('data-theme', hostCtx.theme);
          setTheme(hostCtx.theme);
        }
        if (
          hostCtx.styles &&
          hostCtx.styles.variables &&
          typeof hostCtx.styles.variables === 'object'
        ) {
          for (const [k, v] of Object.entries(hostCtx.styles.variables)) {
            if (k && v !== undefined && v !== null) {
              document.documentElement.style.setProperty(String(k), String(v));
            }
          }
        }
      },
      onToolResult(sc) {
        if (!sc || typeof sc !== 'object') return;
        if (sc.rootDir) setRootDir(String(sc.rootDir));
        if (sc.readOnly !== undefined) {
          setConfig((prev) => ({ ...prev, readOnly: Boolean(sc.readOnly) }));
        }
        if (sc.overview) setOverview(sc.overview);
        if (sc.tab) setTab(sc.tab);
        if (sc.status) setStatusFilter(sc.status);
        if (sc.query !== undefined) setQuery(String(sc.query || ''));
        if (Array.isArray(sc.items)) {
          setItems(sc.items);
          setSelectedUid((prev) =>
            sc.items.some((x) => x.uid === prev)
              ? prev
              : sc.items[0]
                ? sc.items[0].uid
                : null
          );
        }
      },
    });
  }, [initialConfig]);

  const transport = useMemo(() => {
    return createTransport({
      config: initialConfig,
      mcpBridge,
      getRootDir: () => rootDirRef.current,
      getSessionToken: () => configRef.current.sessionToken,
    });
  }, [initialConfig, mcpBridge]);

  const loadList = useCallback(
    async (targetTab, targetFilter, targetQuery, preserveSelectionUid) => {
      try {
        const res = await transport.loadItems(targetTab, targetFilter, targetQuery);
        const list = res.items || [];
        setItems(list);
        setSelectedUid((prev) => {
          const preferred = preserveSelectionUid || prev;
          if (preferred && list.some((x) => x.uid === preferred)) return preferred;
          return list[0] ? list[0].uid : null;
        });
      } catch (err) {
        setBanner({ msg: err.message, isErr: true, actionItem: null });
      }
    },
    [transport]
  );

  const refreshAll = useCallback(async () => {
    try {
      setBanner({ msg: '', isErr: false, actionItem: null });
      const ov = await transport.loadOverview();
      if (ov) setOverview(ov);
      await loadList(tab, statusFilter, query);
    } catch (err) {
      setBanner({ msg: err.message, isErr: true, actionItem: null });
    }
  }, [transport, loadList, tab, statusFilter, query]);

  // 초기 마운트 연결 및 로드
  useEffect(() => {
    if (initialConfig.mode === 'mcp-app' && mcpBridge) {
      mcpBridge
        .connect()
        .then(() => {
          if (!mcpBridge.hasInitialToolResult()) {
            return refreshAll();
          }
          return undefined;
        })
        .catch((err) => setBanner({ msg: err.message, isErr: true, actionItem: null }));
      return () => mcpBridge.destroy();
    }
    refreshAll();
    return undefined;
  }, [initialConfig.mode, mcpBridge]);

  // 탭/필터/검색어 변경 시 디바운스 로드 (초기 마운트 이후)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return undefined;
    }
    const timer = setTimeout(
      () => {
        loadList(tab, statusFilter, query);
      },
      query ? 160 : 0
    );
    return () => clearTimeout(timer);
  }, [tab, statusFilter, query, loadList]);

  const selectedItem = useMemo(
    () => items.find((x) => x.uid === selectedUid) || items[0] || null,
    [items, selectedUid]
  );

  const handleSelectRecord = useCallback((uid) => {
    if (listScrollRef.current) {
      savedScrollTopRef.current = listScrollRef.current.scrollTop;
    }
    setSelectedUid(uid);
    setMobileDetailOpen(true);
  }, []);

  const handleBackToList = useCallback(() => {
    setMobileDetailOpen(false);
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = savedScrollTopRef.current;
      }
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      if (initialConfig.mode !== 'mcp-app') {
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch (_) {}
      }
      return next;
    });
  }, [initialConfig.mode]);

  // 키보드 단축키 (/, Ctrl/Cmd+K, j/k, ArrowUp/Down, Enter, n, Esc)
  useEffect(() => {
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (e.target && e.target.isContentEditable);

      if (e.key === 'Escape') {
        if (taskModal.open) {
          setTaskModal({ open: false, editingTask: null });
          return;
        }
        if (compactModal.open) {
          setCompactModal((prev) => ({ ...prev, open: false }));
          return;
        }
        if (moreOpen) {
          setMoreOpen(false);
          return;
        }
        if (isEditable) {
          e.target.blur();
          return;
        }
        if (mobileDetailOpen) {
          handleBackToList();
          return;
        }
        if (query) {
          setQuery('');
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }

      if (isEditable || taskModal.open || compactModal.open) return;

      if (e.key === '/') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      } else if (e.key === 'n' && !config.readOnly) {
        e.preventDefault();
        setTaskModal({ open: true, editingTask: null });
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        if (items.length === 0) return;
        e.preventDefault();
        const idx = items.findIndex((x) => x.uid === selectedUid);
        const nextIdx = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
        setSelectedUid(items[nextIdx].uid);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (items.length === 0) return;
        e.preventDefault();
        const idx = items.findIndex((x) => x.uid === selectedUid);
        const nextIdx = idx <= 0 ? 0 : idx - 1;
        setSelectedUid(items[nextIdx].uid);
      } else if (e.key === 'Enter' && selectedItem && !mobileDetailOpen) {
        handleSelectRecord(selectedItem.uid);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    taskModal.open,
    compactModal.open,
    moreOpen,
    mobileDetailOpen,
    query,
    config.readOnly,
    items,
    selectedUid,
    selectedItem,
    handleBackToList,
    handleSelectRecord,
  ]);

  async function handleSaveTask(payload) {
    const res = await transport.saveTask(payload);
    setTaskModal({ open: false, editingTask: null });
    setBanner({ msg: '', isErr: false, actionItem: null });
    if (res.overview) setOverview(res.overview);
    setTab('tasks');
    const savedUid = res.task ? res.task.uid : null;
    await loadList('tasks', statusFilter, query, savedUid);
  }

  async function handleQuickStatusChange(item, nextStatus) {
    if (!item || item.status === nextStatus) return;
    setStatusUpdating(true);
    setBanner({ msg: '', isErr: false, actionItem: null });
    try {
      const res = await transport.saveTask({
        idOrCode: item.code,
        status: nextStatus,
      });
      if (res.overview) setOverview(res.overview);
      await loadList(tab, statusFilter, query, res.task ? res.task.uid : item.uid);
    } catch (err) {
      const msg =
        nextStatus === 'ready' && copy.readyIncompleteHint
          ? `${err.message} — ${copy.readyIncompleteHint}`
          : err.message;
      setBanner({
        msg,
        isErr: true,
        actionItem: nextStatus === 'ready' ? item : null,
      });
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleOpenCompact() {
    setCompactModal({ open: true, loading: true, preview: null, errorMsg: '' });
    try {
      const res = await transport.runCompact({ dryRun: true });
      setCompactModal({
        open: true,
        loading: false,
        preview: res.result || {},
        errorMsg: '',
      });
    } catch (err) {
      setCompactModal({
        open: true,
        loading: false,
        preview: null,
        errorMsg: err.message,
      });
    }
  }

  async function handleConfirmCompact() {
    setCompactModal((prev) => ({ ...prev, loading: true }));
    try {
      const res = await transport.runCompact({ dryRun: false });
      const r = res.result || {};
      setCompactModal({ open: false, loading: false, preview: null, errorMsg: '' });
      setBanner({
        msg: fmt(copy.compactDone, {
          tasks: r.archivedTasksCount || 0,
          logs: r.prunedSyncLogs || 0,
          reclaimed: fmtBytes(r.bytesReclaimed || 0),
        }),
        isErr: false,
        actionItem: null,
      });
      await refreshAll();
    } catch (err) {
      setCompactModal((prev) => ({ ...prev, loading: false, errorMsg: err.message }));
    }
  }

  function handleExportJson() {
    if (config.mode === 'http') {
      window.location.href = '/api/export?format=json';
      return;
    }
    const payload =
      config.mode === 'snapshot'
        ? config.snapshot || {}
        : { overview, tab, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'acm-snapshot.json';
    a.click();
  }

  function handleExportHtml() {
    if (config.mode === 'http') {
      window.location.href = '/api/export?format=html';
    }
  }

  return (
    <div class={`viewer-shell mode-${config.mode}`}>
      <TopHeader
        config={config}
        copy={copy}
        overview={overview}
        tab={tab}
        statusFilter={statusFilter}
        query={query}
        theme={theme}
        moreOpen={moreOpen}
        searchInputRef={searchInputRef}
        onSelectTab={(nextTab) => {
          setTab(nextTab);
          setSelectedUid(null);
          setMobileDetailOpen(false);
        }}
        onSelectFilter={(nextFilter) => {
          setStatusFilter(nextFilter);
          setSelectedUid(null);
          setMobileDetailOpen(false);
        }}
        onQueryChange={(val) => {
          setQuery(val);
          setSelectedUid(null);
          setMobileDetailOpen(false);
        }}
        onClearQuery={() => {
          setQuery('');
          setSelectedUid(null);
          setMobileDetailOpen(false);
        }}
        onOpenNewTask={() => setTaskModal({ open: true, editingTask: null })}
        onToggleMore={() => setMoreOpen((v) => !v)}
        onCloseMore={() => setMoreOpen(false)}
        onRefresh={refreshAll}
        onOpenCompact={handleOpenCompact}
        onExportJson={handleExportJson}
        onExportHtml={handleExportHtml}
        onToggleTheme={handleToggleTheme}
      />

      {banner.msg && (
        <div class={`status-banner ${banner.isErr ? 'err' : ''}`} role="status">
          <span>{banner.msg}</span>
          <div class="banner-actions">
            {banner.actionItem && (
              <button
                type="button"
                class="btn btn-sm"
                onClick={() => {
                  const target = banner.actionItem;
                  setBanner({ msg: '', isErr: false, actionItem: null });
                  setTaskModal({ open: true, editingTask: target });
                }}
              >
                {copy.openEditor || copy.editTask}
              </button>
            )}
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => setBanner({ msg: '', isErr: false, actionItem: null })}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <main class={`workspace ${mobileDetailOpen && selectedItem ? 'is-detail-open' : ''}`}>
        <RecordList
          items={items}
          selectedUid={selectedUid}
          tab={tab}
          statusFilter={statusFilter}
          query={query}
          copy={copy}
          listScrollRef={listScrollRef}
          onSelect={handleSelectRecord}
        />

        <DetailPane
          item={selectedItem}
          config={config}
          rootDir={rootDir}
          copy={copy}
          statusUpdating={statusUpdating}
          onBack={handleBackToList}
          onEditTask={(t) => setTaskModal({ open: true, editingTask: t })}
          onQuickStatusChange={handleQuickStatusChange}
          onOpenWorkspaceFile={(filePath) => {
            if (mcpBridge) mcpBridge.openWorkspaceFile(rootDir, filePath);
          }}
        />
      </main>

      <TaskModal
        open={taskModal.open}
        editingTask={taskModal.editingTask}
        copy={copy}
        onClose={() => setTaskModal({ open: false, editingTask: null })}
        onSave={handleSaveTask}
      />

      <CompactModal
        open={compactModal.open}
        loading={compactModal.loading}
        preview={compactModal.preview}
        errorMsg={compactModal.errorMsg}
        copy={copy}
        onClose={() =>
          setCompactModal({ open: false, loading: false, preview: null, errorMsg: '' })
        }
        onConfirm={handleConfirmCompact}
      />
    </div>
  );
}

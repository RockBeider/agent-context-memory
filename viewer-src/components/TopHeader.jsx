/**
 * viewer-src/components/TopHeader.jsx
 *
 * 2단 압축 상단 헤더:
 * - 1줄: 브랜드 + 4개 탭 세그먼트 + 주 액션(+ 새 태스크) + 더보기 팝오버
 * - 2줄: 통합 검색창 + Tasks 탭 전용 상태 필터 칩
 */

import { useEffect, useRef } from 'preact/hooks';
import {
  Search,
  Plus,
  Ellipsis,
  RefreshCw,
  Database,
  Download,
  FileCode,
  Sun,
  Moon,
  X,
} from 'lucide-preact';
import { fmt, fmtBytes } from '../utils.js';

export function TopHeader({
  config,
  copy,
  overview,
  tab,
  statusFilter,
  query,
  theme,
  moreOpen,
  searchInputRef,
  onSelectTab,
  onSelectFilter,
  onQueryChange,
  onClearQuery,
  onOpenNewTask,
  onToggleMore,
  onCloseMore,
  onRefresh,
  onOpenCompact,
  onExportJson,
  onExportHtml,
  onToggleTheme,
}) {
  const moreWrapRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const handleOutside = (e) => {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target)) {
        onCloseMore();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moreOpen, onCloseMore]);

  const counts = (overview && overview.counts) || {
    tasks: {},
    patterns: {},
    adrs: {},
    archive: 0,
  };

  const tabs = [
    {
      id: 'tasks',
      label: copy.tabTasks,
      count: counts.tasks.visible !== undefined ? counts.tasks.visible : counts.tasks.total || 0,
    },
    { id: 'patterns', label: copy.tabPatterns, count: counts.patterns.total || 0 },
    { id: 'adrs', label: copy.tabAdrs, count: counts.adrs.total || 0 },
    { id: 'archive', label: copy.tabArchive, count: counts.archive || 0 },
  ];

  const filters = [
    { id: 'all', label: copy.filterAll },
    { id: 'active', label: copy.filterActive },
    { id: 'ready', label: copy.filterReady },
    { id: 'done', label: copy.filterDone },
  ];

  const ret = (overview && overview.retention) || {};
  const storageText = overview
    ? overview.provider === 'sqlite'
      ? `sqlite (${fmtBytes(overview.dbSizeBytes)})`
      : overview.provider
    : '-';
  const retentionText = fmt(copy.retentionLabel, {
    days: ret.doneTaskFtsDays !== undefined ? ret.doneTaskFtsDays : 90,
    limit: ret.doneTaskProjectionLimit !== undefined ? ret.doneTaskProjectionLimit : 50,
  });

  const badgeText =
    config.mode === 'snapshot'
      ? copy.snapshotBadge
      : config.hostLabel || (config.mode === 'mcp-app' ? 'MCP App' : '127.0.0.1');

  return (
    <header class="top-header">
      <div class="header-row-1">
        <div class="brand-mark" title={badgeText}>
          <span class="brand-dot" />
          <span>ACM</span>
          {config.readOnly && <span class="mode-badge warn">{copy.readOnlyBadge}</span>}
        </div>

        <nav class="tab-list" role="tablist" aria-label={copy.appTitle}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              class={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => onSelectTab(t.id)}
            >
              <span>{t.label}</span>
              <span class="tab-count">{t.count}</span>
            </button>
          ))}
        </nav>

        <div class="header-actions" ref={moreWrapRef}>
          {!config.readOnly && (
            <button
              type="button"
              id="newTaskBtn"
              class="btn btn-primary"
              onClick={onOpenNewTask}
              title={copy.newTask}
            >
              <Plus size={14} class="icon" />
              <span class="new-task-label">{copy.newTask.replace(/^\+\s*/, '')}</span>
            </button>
          )}

          <button
            type="button"
            id="moreMenuBtn"
            class="btn btn-icon"
            aria-expanded={moreOpen}
            aria-label={copy.moreActions || 'More'}
            title={copy.moreActions || 'More'}
            onClick={onToggleMore}
          >
            <Ellipsis size={15} class="icon" />
          </button>

          {moreOpen && (
            <div class="more-popover" role="menu">
              <div class="popover-meta">
                <div class="popover-meta-row">
                  <span>{copy.storageLabel || 'Storage'}</span>
                  <span class="popover-meta-val">{storageText}</span>
                </div>
                <div class="popover-meta-row">
                  <span>{copy.retentionTitle || 'Retention'}</span>
                  <span class="popover-meta-val">{retentionText}</span>
                </div>
                <div class="popover-meta-row">
                  <span>Host</span>
                  <span class="popover-meta-val">{badgeText}</span>
                </div>
              </div>

              {config.mode !== 'snapshot' && (
                <button
                  type="button"
                  class="menu-item"
                  onClick={() => {
                    onCloseMore();
                    onRefresh();
                  }}
                >
                  <RefreshCw size={14} class="icon" />
                  <span>{copy.refresh}</span>
                </button>
              )}

              {!config.readOnly && (
                <button
                  type="button"
                  class="menu-item"
                  onClick={() => {
                    onCloseMore();
                    onOpenCompact();
                  }}
                >
                  <Database size={14} class="icon" />
                  <span>{copy.compact}</span>
                </button>
              )}

              <button
                type="button"
                class="menu-item"
                onClick={() => {
                  onCloseMore();
                  onExportJson();
                }}
              >
                <Download size={14} class="icon" />
                <span>{copy.exportJson}</span>
              </button>

              {config.mode === 'http' && (
                <button
                  type="button"
                  class="menu-item"
                  onClick={() => {
                    onCloseMore();
                    onExportHtml();
                  }}
                >
                  <FileCode size={14} class="icon" />
                  <span>{copy.exportHtml}</span>
                </button>
              )}

              <div class="menu-divider" />

              <button
                type="button"
                class="menu-item"
                onClick={() => {
                  onCloseMore();
                  onToggleTheme();
                }}
              >
                {theme === 'dark' ? (
                  <Sun size={14} class="icon" />
                ) : (
                  <Moon size={14} class="icon" />
                )}
                <span>
                  {theme === 'dark'
                    ? copy.modeThemeLight || copy.theme
                    : copy.modeThemeDark || copy.theme}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div class="header-row-2">
        <div class="search-box">
          <Search size={14} class="search-icon icon" />
          <input
            ref={searchInputRef}
            id="searchInput"
            class="search-input"
            type="search"
            value={query}
            placeholder={copy.searchPlaceholder}
            onInput={(e) => onQueryChange(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              class="search-clear"
              aria-label={copy.clearSearch || 'Clear'}
              onClick={onClearQuery}
            >
              <X size={13} class="icon" />
            </button>
          ) : (
            <span class="search-kbd">/</span>
          )}
        </div>

        {tab === 'tasks' && !String(query || '').trim() && (
          <div class="filter-row" role="group" aria-label="Status Filter">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                class={`filter-chip ${statusFilter === f.id ? 'active' : ''}`}
                onClick={() => onSelectFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

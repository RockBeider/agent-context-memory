/**
 * scripts/acm/viewer/read-model.cjs
 *
 * SQLite / Markdown 저장소 공용 로컬 뷰어 Read-Model 및 안전 가드 기반 경량 쓰기 계층.
 */

const path = require('path');
const { createMemoryStore } = require('../storage/memory-store.cjs');
const { loadConfig, normalizeRetentionConfig, validateRetentionValue } = require('../storage/config.cjs');
const { normalizeTaskStatus, toDisplayStatus } = require('../storage/id-utils.cjs');
const { checkGitEnvironment } = require('../check-git.cjs');
const { scrubRecords } = require('../storage/secret-scrubber.cjs');
const { resolveLanguage, createTranslator } = require('../i18n.cjs');

const ALLOWED_VIEWER_TABS = ['tasks', 'patterns', 'adrs', 'archive'];
const ALLOWED_TASK_FILTERS = ['all', 'active', 'todo', 'in_progress', 'ready', 'paused', 'done'];
const WRITABLE_TASK_STATUSES = ['todo', 'in_progress', 'paused', 'ready'];

const RAW_STATUS_ALIASES = {
  todo: 'todo',
  ' ': 'todo',
  pending: 'todo',
  대기: 'todo',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  inprogress: 'in_progress',
  '진행 중': 'in_progress',
  진행중: 'in_progress',
  ready: 'ready',
  '커밋 대기': 'ready',
  커밋대기: 'ready',
  paused: 'paused',
  보류: 'paused',
  done: 'done',
  x: 'done',
  completed: 'done',
  완료: 'done',
};

function parseExplicitStatus(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) return null;
  if (Object.prototype.hasOwnProperty.call(RAW_STATUS_ALIASES, cleaned)) {
    return RAW_STATUS_ALIASES[cleaned];
  }
  return null;
}

/**
 * Normalizes a task, pattern, or ADR record into a unified viewer DTO.
 */
function normalizeRecordForViewer(kind, record, lang = 'en') {
  if (!record || typeof record !== 'object') return null;

  if (kind === 'task') {
    const status = normalizeTaskStatus(record.status);
    const meta = record.commitSha
      ? String(record.commitSha).slice(0, 7)
      : String(record.archivedAt || record.completedAt || record.updatedAt || record.createdAt || '').slice(0, 10);
    return {
      uid: record.uid || record.code,
      kind: 'task',
      code: record.code || '',
      title: record.title || '',
      status,
      statusLabel: toDisplayStatus(status, lang),
      purpose: record.purpose || '',
      results: Array.isArray(record.results) ? record.results : [],
      targets: Array.isArray(record.targets) ? record.targets : [],
      owner: record.owner || '',
      groupName: record.groupName || '',
      leaseOwner: record.leaseOwner || null,
      leaseExpiresAt: record.leaseExpiresAt || null,
      commitSha: record.commitSha || null,
      completedAt: record.completedAt || null,
      archivedAt: record.archivedAt || null,
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      meta,
    };
  }

  if (kind === 'pattern') {
    const status = record.archivedAt ? 'archived' : 'active';
    return {
      uid: record.uid || record.code,
      kind: 'pattern',
      code: record.code || '',
      title: record.title || '',
      category: record.category || '',
      summary: record.summary || '',
      symptom: record.symptom || '',
      solution: record.solution || '',
      relatedFiles: Array.isArray(record.relatedFiles) ? record.relatedFiles : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
      version: Number(record.version) || 1,
      supersedesUid: record.supersedesUid || null,
      accessCount: Number(record.accessCount) || 0,
      lastAccessedAt: record.lastAccessedAt || null,
      archivedAt: record.archivedAt || null,
      author: record.author || '',
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      status,
      statusLabel: status === 'archived' ? (lang === 'ko' ? '아카이브' : 'Archived') : lang === 'ko' ? '활성' : 'Active',
      meta: record.category || 'General',
    };
  }

  if (kind === 'adr') {
    const status = record.status || 'accepted';
    return {
      uid: record.uid || record.code,
      kind: 'adr',
      code: record.code || '',
      title: record.title || '',
      date: record.date || '',
      summary: record.summary || '',
      relatedArea: record.relatedArea || '',
      relatedTaskCode: record.relatedTaskCode || '',
      branch: record.branch || '',
      context: record.context || '',
      decision: record.decision || '',
      impact: record.impact || '',
      status,
      statusLabel: status,
      author: record.author || '',
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      meta: record.date || String(record.createdAt || '').slice(0, 10),
    };
  }

  return null;
}

/**
 * Returns storage stats, retention policy, record counts, and Git metadata for the workspace.
 */
function getViewerOverview(rootDir = process.cwd(), { lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const config = loadConfig(resolvedRoot);
  const retention = normalizeRetentionConfig(config.retention);
  const git = checkGitEnvironment(resolvedRoot);

  const store = createMemoryStore(resolvedRoot, { config, lang: effLang, skipProjection: true });
  try {
    const stats = store.getStats();
    const taskTotal = Number(stats.tasks && stats.tasks.total) || 0;
    const taskArchived = Number(stats.tasks && stats.tasks.archived) || 0;
    const patArchived = Number(stats.patterns && stats.patterns.archived) || 0;
    return {
      rootDir: resolvedRoot,
      provider: stats.provider || (config.storage && config.storage.provider) || 'markdown',
      schemaVersion: String(stats.schemaVersion || ''),
      dbSizeBytes: Number(stats.dbSizeBytes) || 0,
      markdownProjection: Boolean(config.storage && config.storage.markdownProjection),
      language: effLang,
      retention,
      counts: {
        tasks: {
          total: taskTotal,
          active: Number(stats.tasks && stats.tasks.active) || 0,
          ready: Number(stats.tasks && stats.tasks.ready) || 0,
          done: Number(stats.tasks && stats.tasks.done) || 0,
          archived: taskArchived,
          visible: Math.max(0, taskTotal - taskArchived),
        },
        patterns: {
          total: Number(stats.patterns && stats.patterns.total) || 0,
          active: Number(stats.patterns && stats.patterns.active) || 0,
          superseded: Number(stats.patterns && stats.patterns.superseded) || 0,
          archived: patArchived,
        },
        adrs: {
          total: Number(stats.adrs && stats.adrs.total) || 0,
        },
        archive: taskArchived + patArchived,
        syncLogCount: Number(stats.syncLogCount) || 0,
      },
      git: {
        available: Boolean(git.available),
        isRepo: Boolean(git.isRepo),
        version: git.version || null,
      },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    store.close();
  }
}

/**
 * Lists normalized records for a specific viewer tab (`tasks`, `patterns`, `adrs`, `archive`).
 */
function listViewerItems(rootDir = process.cwd(), { tab = 'tasks', status = 'all', limit = 200, lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const tr = createTranslator(effLang);
  const normTab = String(tab || 'tasks').trim().toLowerCase();

  if (!ALLOWED_VIEWER_TABS.includes(normTab)) {
    throw new Error(tr('viewer.invalidTab', { tab }));
  }

  const normStatus = String(status || 'all').trim().toLowerCase();
  if (normTab === 'tasks' && !ALLOWED_TASK_FILTERS.includes(normStatus)) {
    throw new Error(tr('viewer.invalidStatus', { status }));
  }

  const maxLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const store = createMemoryStore(resolvedRoot, { lang: effLang, skipProjection: true });
  try {
    let items = [];

    if (normTab === 'tasks') {
      let raw = store.listTasks({ includeDone: true, includeArchived: false });
      raw = raw.filter((item) => item && !item.archivedAt && !item.deletedAt);
      if (normStatus === 'active') {
        raw = raw.filter((item) => normalizeTaskStatus(item.status) !== 'done');
      } else if (normStatus !== 'all') {
        raw = raw.filter((item) => normalizeTaskStatus(item.status) === normStatus);
      }
      items = raw.map((item) => normalizeRecordForViewer('task', item, effLang));
    } else if (normTab === 'patterns') {
      const raw = store
        .listPatterns({ includeSuperseded: true, includeArchived: false })
        .filter((item) => item && !item.archivedAt && !item.deletedAt);
      items = raw.map((item) => normalizeRecordForViewer('pattern', item, effLang));
    } else if (normTab === 'adrs') {
      const raw = store.listAdrs({}).filter((item) => item && !item.deletedAt);
      items = raw.map((item) => normalizeRecordForViewer('adr', item, effLang));
    } else if (normTab === 'archive') {
      const archivedTasks = store
        .listTasks({ includeDone: true, includeArchived: true })
        .filter((item) => item && Boolean(item.archivedAt) && !item.deletedAt)
        .map((item) => normalizeRecordForViewer('task', item, effLang));
      const archivedPatterns = store
        .listPatterns({ includeSuperseded: true, includeArchived: true })
        .filter((item) => item && Boolean(item.archivedAt) && !item.deletedAt)
        .map((item) => normalizeRecordForViewer('pattern', item, effLang));
      items = [...archivedTasks, ...archivedPatterns].sort((a, b) =>
        String(b.archivedAt || b.updatedAt || '').localeCompare(String(a.archivedAt || a.updatedAt || ''))
      );
    }

    const total = items.length;
    return {
      tab: normTab,
      status: normTab === 'tasks' ? normStatus : 'all',
      total,
      items: items.slice(0, maxLimit),
    };
  } finally {
    store.close();
  }
}

/**
 * Searches records across the store (FTS5 / Markdown fallback) or archived items.
 */
function searchViewerItems(rootDir = process.cwd(), { query = '', kind = 'all', limit = 50, lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const cleaned = String(query || '').trim();
  const normKind = String(kind || 'all').trim().toLowerCase();
  const maxLimit = Math.max(1, Math.min(200, Number(limit) || 50));

  if (!cleaned) {
    return { query: '', kind: normKind, total: 0, items: [] };
  }

  if (normKind === 'archive') {
    const archiveList = listViewerItems(resolvedRoot, { tab: 'archive', limit: 1000, lang: effLang });
    const tokens = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = archiveList.items.filter((item) => {
      const hay = [
        item.code,
        item.title,
        item.purpose,
        item.summary,
        item.symptom,
        item.solution,
        ...(item.results || []),
        ...(item.targets || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
    return {
      query: cleaned,
      kind: 'archive',
      total: matched.length,
      items: matched.slice(0, maxLimit),
    };
  }

  const storeKind =
    normKind === 'tasks' || normKind === 'task'
      ? 'task'
      : normKind === 'patterns' || normKind === 'pattern'
        ? 'pattern'
        : normKind === 'adrs' || normKind === 'adr'
          ? 'adr'
          : 'all';

  const store = createMemoryStore(resolvedRoot, { lang: effLang, skipProjection: true });
  try {
    const hits = store.search(cleaned, { kind: storeKind, limit: maxLimit });
    const items = hits
      .map((hit) => {
        const normalized = normalizeRecordForViewer(hit.kind, hit.record, effLang);
        if (!normalized) return null;
        return {
          ...normalized,
          score: Number(hit.score) || 0,
        };
      })
      .filter(Boolean);
    return {
      query: cleaned,
      kind: storeKind,
      total: items.length,
      items,
    };
  } finally {
    store.close();
  }
}

function detectKindFromCode(idOrCode) {
  const raw = String(idOrCode || '').trim().toUpperCase();
  if (raw.startsWith('TSK-')) return 'task';
  if (raw.startsWith('P-')) return 'pattern';
  if (raw.startsWith('LOG-')) return 'adr';
  return '';
}

/**
 * Fetches a single normalized record detail by kind and UID/code/prefix.
 */
function getViewerItemDetail(rootDir = process.cwd(), { kind = '', idOrCode = '', lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const targetId = String(idOrCode || '').trim();
  if (!targetId) return null;

  const normKind = String(kind || '').trim().toLowerCase() || detectKindFromCode(targetId);
  const store = createMemoryStore(resolvedRoot, { lang: effLang, skipProjection: true });
  try {
    if (normKind === 'task' || normKind === 'tasks') {
      return normalizeRecordForViewer('task', store.getTask(targetId), effLang);
    }
    if (normKind === 'pattern' || normKind === 'patterns') {
      return normalizeRecordForViewer('pattern', store.getPattern(targetId), effLang);
    }
    if (normKind === 'adr' || normKind === 'adrs') {
      return normalizeRecordForViewer('adr', store.getAdr(targetId), effLang);
    }

    const task = store.getTask(targetId);
    if (task) return normalizeRecordForViewer('task', task, effLang);
    const pattern = store.getPattern(targetId);
    if (pattern) return normalizeRecordForViewer('pattern', pattern, effLang);
    const adr = store.getAdr(targetId);
    if (adr) return normalizeRecordForViewer('adr', adr, effLang);
    return null;
  } finally {
    store.close();
  }
}

/**
 * Builds an offline snapshot (optionally scrubbed for secrets) containing overview and all tabs.
 */
function buildViewerSnapshot(rootDir = process.cwd(), { scrubSecrets = true, lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const overview = getViewerOverview(resolvedRoot, { lang: effLang });
  const rawTabs = {
    tasks: listViewerItems(resolvedRoot, { tab: 'tasks', status: 'all', limit: 1000, lang: effLang }).items,
    patterns: listViewerItems(resolvedRoot, { tab: 'patterns', limit: 1000, lang: effLang }).items,
    adrs: listViewerItems(resolvedRoot, { tab: 'adrs', limit: 1000, lang: effLang }).items,
    archive: listViewerItems(resolvedRoot, { tab: 'archive', limit: 1000, lang: effLang }).items,
  };

  if (scrubSecrets === false) {
    return {
      overview,
      tabs: rawTabs,
      scrubbed: false,
      redactedCount: 0,
      redactedTypes: [],
    };
  }

  let redactedCount = 0;
  const typesSet = new Set();
  const scrubbedTabs = {};
  for (const tabKey of ALLOWED_VIEWER_TABS) {
    const res = scrubRecords(rawTabs[tabKey]);
    scrubbedTabs[tabKey] = res.records;
    redactedCount += res.redactedCount;
    res.types.forEach((tp) => typesSet.add(tp));
  }

  return {
    overview,
    tabs: scrubbedTabs,
    scrubbed: true,
    redactedCount,
    redactedTypes: Array.from(typesSet),
  };
}

/**
 * Safely creates or updates a task from the viewer while blocking direct 'done' transitions and enforcing Ready validation.
 */
function upsertViewerTask(rootDir = process.cwd(), payload = {}, { lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const tr = createTranslator(effLang);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(tr('storage.taskInputRequired'));
  }

  let nextStatus;
  if (payload.status !== undefined && payload.status !== null && String(payload.status).trim() !== '') {
    const parsed = parseExplicitStatus(payload.status);
    if (parsed === 'done') {
      throw new Error(tr('viewer.doneTransitionBlocked'));
    }
    if (!parsed || !WRITABLE_TASK_STATUSES.includes(parsed)) {
      throw new Error(tr('viewer.invalidStatus', { status: payload.status }));
    }
    nextStatus = parsed;
  }

  const store = createMemoryStore(resolvedRoot, { lang: effLang });
  let saved = null;
  try {
    const lookupId = payload.idOrCode || payload.uid || payload.code || null;
    let existing = null;
    if (lookupId) {
      existing = store.getTask(String(lookupId));
      if (!existing && payload.idOrCode) {
        throw new Error(tr('dbCli.notFound', { id: payload.idOrCode }));
      }
    }

    if (existing && normalizeTaskStatus(existing.status) === 'done') {
      throw new Error(tr('viewer.doneTaskImmutable', { code: existing.code }));
    }

    const input = {
      uid: existing ? existing.uid : undefined,
      code: existing ? existing.code : payload.code || undefined,
      title: payload.title !== undefined ? String(payload.title).trim() : existing ? existing.title : '',
      status: nextStatus !== undefined ? nextStatus : existing ? existing.status : 'todo',
      purpose: payload.purpose !== undefined ? String(payload.purpose) : existing ? existing.purpose : '',
      results: payload.results !== undefined ? payload.results : existing ? existing.results : [],
      targets: payload.targets !== undefined ? payload.targets : existing ? existing.targets : [],
      owner: payload.owner !== undefined ? String(payload.owner) : existing ? existing.owner : '',
    };

    saved = store.upsertTask(input, { lang: effLang });
  } finally {
    store.close();
  }

  return {
    ok: true,
    task: normalizeRecordForViewer('task', saved, effLang),
    overview: getViewerOverview(resolvedRoot, { lang: effLang }),
  };
}

/**
 * Runs store.compact() (dry-run preview or actual execution) and returns refreshed overview.
 */
function runViewerCompact(rootDir = process.cwd(), options = {}, { lang = null } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, lang);
  const tr = createTranslator(effLang);

  const compactOpts = {
    dryRun: Boolean(options.dryRun),
    vacuum: !options.noVacuum,
    exportArchive: Boolean(options.exportArchive),
  };

  const rawDays = options.doneTaskFtsDays !== undefined ? options.doneTaskFtsDays : options.days;
  if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
    const v = validateRetentionValue('doneTaskFtsDays', rawDays);
    if (!v.valid) {
      throw new Error(tr('dbCli.invalidIntFlag', { flag: '--days', value: rawDays }));
    }
    compactOpts.doneTaskFtsDays = v.value;
  }

  const rawSyncMax = options.syncLogMaxRows !== undefined ? options.syncLogMaxRows : options.syncLogMax;
  if (rawSyncMax !== undefined && rawSyncMax !== null && rawSyncMax !== '') {
    const v = validateRetentionValue('syncLogMaxRows', rawSyncMax);
    if (!v.valid) {
      throw new Error(tr('dbCli.invalidIntFlag', { flag: '--sync-log-max', value: rawSyncMax }));
    }
    compactOpts.syncLogMaxRows = v.value;
  }

  const store = createMemoryStore(resolvedRoot, { lang: effLang });
  let result = null;
  try {
    result = store.compact(compactOpts);
  } finally {
    store.close();
  }

  return {
    ok: true,
    result,
    overview: getViewerOverview(resolvedRoot, { lang: effLang }),
  };
}

module.exports = {
  ALLOWED_VIEWER_TABS,
  ALLOWED_TASK_FILTERS,
  WRITABLE_TASK_STATUSES,
  normalizeRecordForViewer,
  getViewerOverview,
  listViewerItems,
  searchViewerItems,
  getViewerItemDetail,
  buildViewerSnapshot,
  upsertViewerTask,
  runViewerCompact,
};

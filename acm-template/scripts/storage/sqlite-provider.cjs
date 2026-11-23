/**
 * scripts/storage/sqlite-provider.cjs
 *
 * Local-first storage provider backed by Node.js built-in node:sqlite (DatabaseSync) + FTS5 (bm25).
 */

const fs = require('fs');
const path = require('path');
const {
  generateUlid,
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  normalizeTaskStatus,
} = require('./id-utils.cjs');
const { isNodeSqliteAvailable, loadConfig, resolveDbPath } = require('./config.cjs');
const { t, DEFAULT_LANGUAGE } = require('../i18n.cjs');

const SCHEMA_VERSION = '1';

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch (_) {}
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTargetArray(value) {
  return Array.from(
    new Set(
      normalizeStringArray(value).map((p) =>
        p.replace(/^`|`$/g, '').trim().replace(/\\/g, '/')
      )
    )
  ).filter(Boolean);
}

function parseJsonArraySafe(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Escapes tokens for FTS5 MATCH queries to prevent syntax errors from -, ., /, :, or quotes.
 */
function buildFtsQueries(rawQuery) {
  const cleaned = String(rawQuery || '').trim();
  if (!cleaned) return { andQuery: null, orQuery: null };

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const validTokens = rawTokens.filter((tok) => /[\p{L}\p{N}]/u.test(tok));
  if (validTokens.length === 0) return { andQuery: null, orQuery: null };

  const quoted = validTokens.map((tok) => `"${tok.replace(/"/g, '""')}"`);
  return {
    andQuery: quoted.join(' AND '),
    orQuery: quoted.length > 1 ? quoted.join(' OR ') : null,
  };
}

function normalizeSearchKind(kind) {
  if (!kind) return 'all';
  const k = String(kind).trim().toLowerCase();
  if (k === 'tasks' || k === 'task') return 'task';
  if (k === 'patterns' || k === 'pattern') return 'pattern';
  if (k === 'adrs' || k === 'adr' || k === 'changelog') return 'adr';
  return 'all';
}

function canonicalTaskCodeInput(rawCode) {
  if (!rawCode) return null;
  const num = parseCodeNumber(rawCode, 'TSK');
  if (num !== null) return formatTaskCode(num);
  return String(rawCode).trim().toUpperCase();
}

function canonicalPatternCodeInput(rawCode) {
  if (!rawCode) return null;
  const num = parseCodeNumber(rawCode, 'P');
  if (num !== null) return formatPatternCode(num);
  return String(rawCode).trim().toUpperCase();
}

function canonicalAdrCodeInput(rawCode) {
  if (!rawCode) return null;
  const num = parseCodeNumber(rawCode, 'LOG');
  if (num !== null) return formatAdrCode(num);
  return String(rawCode).trim().toUpperCase();
}

/**
 * Validates that transitioning to [Ready] includes all 3 required elements (purpose/results/targets).
 */
function validateReadyTask(task, lang = DEFAULT_LANGUAGE) {
  if (normalizeTaskStatus(task.status) !== 'ready') return;

  const missing = [];
  if (!task.purpose || typeof task.purpose !== 'string' || !task.purpose.trim()) {
    missing.push(t('storage.readyMissingPurpose', {}, lang));
  }
  const results = normalizeStringArray(task.results);
  if (results.length === 0) {
    missing.push(t('storage.readyMissingResults', {}, lang));
  }
  const targets = normalizeTargetArray(task.targets);
  if (targets.length === 0) {
    missing.push(t('storage.readyMissingTargets', {}, lang));
  }

  if (missing.length > 0) {
    throw new Error(t('storage.readyValidationError', { missing: missing.join(', ') }, lang));
  }
}

function hydrateTask(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    code: row.code,
    title: row.title,
    status: row.status,
    purpose: row.purpose || '',
    results: parseJsonArraySafe(row.results_json),
    targets: parseJsonArraySafe(row.targets_json),
    owner: row.owner || '',
    groupName: row.group_name || '',
    leaseOwner: row.lease_owner || null,
    leaseExpiresAt: row.lease_expires_at || null,
    commitSha: row.commit_sha || null,
    completedAt: row.completed_at || null,
    scope: row.scope || 'local',
    provenance: row.provenance || 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function hydratePattern(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    code: row.code,
    category: row.category || '',
    title: row.title,
    summary: row.summary || '',
    symptom: row.symptom || '',
    solution: row.solution || '',
    relatedFiles: parseJsonArraySafe(row.related_files_json),
    tags: parseJsonArraySafe(row.tags_json),
    version: Number(row.version) || 1,
    supersedesUid: row.supersedes_uid || null,
    scope: row.scope || 'shared',
    author: row.author || '',
    provenance: row.provenance || 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

function hydrateAdr(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    code: row.code,
    date: row.date,
    title: row.title,
    summary: row.summary || '',
    relatedArea: row.related_area || '',
    relatedTaskCode: row.related_task_code || '',
    branch: row.branch || '',
    context: row.context || '',
    decision: row.decision || '',
    impact: row.impact || '',
    scope: row.scope || 'shared',
    author: row.author || '',
    provenance: row.provenance || 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

class SqliteProvider {
  constructor(rootDir, options = {}) {
    if (!isNodeSqliteAvailable()) {
      throw new Error(t('storage.sqliteRequired', { version: process.version }));
    }

    this.rootDir = path.resolve(rootDir || process.cwd());
    this.config = options.config || loadConfig(this.rootDir);
    this.dbPath = options.dbPath
      ? path.resolve(this.rootDir, options.dbPath)
      : resolveDbPath(this.rootDir, this.config);
    this.providerName = 'sqlite';
    this.db = null;
    this._inTx = false;
  }

  open() {
    if (this.db) return this;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);

    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    this._initSchema();
    return this;
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        uid TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        purpose TEXT NOT NULL DEFAULT '',
        results_json TEXT NOT NULL DEFAULT '[]',
        targets_json TEXT NOT NULL DEFAULT '[]',
        owner TEXT DEFAULT '',
        group_name TEXT DEFAULT '',
        lease_owner TEXT DEFAULT NULL,
        lease_expires_at TEXT DEFAULT NULL,
        commit_sha TEXT DEFAULT NULL,
        completed_at TEXT DEFAULT NULL,
        scope TEXT NOT NULL DEFAULT 'local',
        provenance TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS patterns (
        uid TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        symptom TEXT NOT NULL DEFAULT '',
        solution TEXT NOT NULL DEFAULT '',
        related_files_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        supersedes_uid TEXT DEFAULT NULL,
        scope TEXT NOT NULL DEFAULT 'shared',
        author TEXT DEFAULT '',
        provenance TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS adrs (
        uid TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        related_area TEXT NOT NULL DEFAULT '',
        related_task_code TEXT DEFAULT '',
        branch TEXT DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT '',
        impact TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'shared',
        author TEXT DEFAULT '',
        provenance TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        provider TEXT NOT NULL,
        commit_ref TEXT DEFAULT NULL,
        records_pushed INTEGER NOT NULL DEFAULT 0,
        records_pulled INTEGER NOT NULL DEFAULT 0,
        conflicts_resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        uid UNINDEXED,
        kind UNINDEXED,
        code,
        title,
        body,
        tags,
        tokenize='unicode61'
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);
      CREATE INDEX IF NOT EXISTS idx_patterns_supersedes ON patterns(supersedes_uid);
      CREATE INDEX IF NOT EXISTS idx_adrs_date ON adrs(date);
    `);

    const upsertDefaultMeta = this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');
    const defaults = [
      ['schema_version', SCHEMA_VERSION],
      ['workspace_id', generateUlid()],
      ['next_seq_tsk', '1'],
      ['next_seq_pat', '1'],
      ['next_seq_log', '1'],
      ['last_sync_commit', ''],
    ];
    for (const [k, v] of defaults) {
      upsertDefaultMeta.run(k, v);
    }
  }

  _runInTx(fn) {
    this.open();
    if (this._inTx) {
      return fn();
    }
    this._inTx = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      this._inTx = false;
    }
  }

  _getMeta(key, fallback = '') {
    this.open();
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  _setMeta(key, value) {
    this.open();
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  _getAllMeta() {
    this.open();
    const rows = this.db.prepare('SELECT key, value FROM meta').all();
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  _syncFts(uid, kind, code, title, body, tags, isDeleted) {
    this.db.prepare('DELETE FROM memory_fts WHERE uid = ?').run(uid);
    if (!isDeleted) {
      this.db
        .prepare('INSERT INTO memory_fts (uid, kind, code, title, body, tags) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid, kind, code || '', title || '', body || '', tags || '');
    }
  }

  _allocateCode(metaKey, tableName, prefix, formatter) {
    let seq = parseInt(this._getMeta(metaKey, '1'), 10);
    if (!Number.isFinite(seq) || seq <= 0) seq = 1;

    const checkStmt = this.db.prepare(`SELECT 1 FROM ${tableName} WHERE code = ?`);
    while (checkStmt.get(formatter(seq))) {
      seq += 1;
    }
    this._setMeta(metaKey, String(seq + 1));
    return formatter(seq);
  }

  _bumpSeqIfNeeded(metaKey, code, prefix) {
    const num = parseCodeNumber(code, prefix);
    if (num === null) return;
    const curr = parseInt(this._getMeta(metaKey, '1'), 10) || 1;
    if (num >= curr) {
      this._setMeta(metaKey, String(num + 1));
    }
  }

  // =========================================================================
  // Task CRUD & Lease
  // =========================================================================

  listTasks({ status, includeDone = false, includeDeleted = false } = {}) {
    this.open();
    const clauses = [];
    const params = [];

    if (!includeDeleted) {
      clauses.push('deleted_at IS NULL');
    }
    if (status) {
      clauses.push('status = ?');
      params.push(normalizeTaskStatus(status));
    } else if (!includeDone) {
      clauses.push("status != 'done'");
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM tasks ${whereSql}`).all(...params);
    return rows.map(hydrateTask).sort((a, b) => {
      const na = parseCodeNumber(a.code, 'TSK') || 0;
      const nb = parseCodeNumber(b.code, 'TSK') || 0;
      if (na !== nb) return na - nb;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  getTask(idOrCode) {
    if (!idOrCode) return null;
    this.open();
    const raw = String(idOrCode).trim();
    const byUid = this.db.prepare('SELECT * FROM tasks WHERE uid = ?').get(raw);
    if (byUid) return hydrateTask(byUid);

    const code = canonicalTaskCodeInput(raw);
    if (!code) return null;
    const byCode = this.db.prepare('SELECT * FROM tasks WHERE UPPER(code) = ?').get(code.toUpperCase());
    return hydrateTask(byCode);
  }

  upsertTask(input, options = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error(t('storage.taskInputRequired'));
    }

    return this._runInTx(() => {
      let existingRow = null;
      if (input.uid) {
        existingRow = this.db.prepare('SELECT * FROM tasks WHERE uid = ?').get(String(input.uid).trim());
      }
      if (!existingRow && input.code) {
        const lookupCode = canonicalTaskCodeInput(input.code);
        existingRow = this.db
          .prepare('SELECT * FROM tasks WHERE UPPER(code) = ?')
          .get(lookupCode.toUpperCase());
      }
      const existing = hydrateTask(existingRow);

      const now = new Date().toISOString();
      const title =
        input.title !== undefined ? String(input.title).trim() : existing ? existing.title : '';
      if (!title) {
        throw new Error(t('storage.taskTitleRequired'));
      }

      const status =
        input.status !== undefined
          ? normalizeTaskStatus(input.status)
          : existing
            ? existing.status
            : 'todo';
      const purpose =
        input.purpose !== undefined
          ? String(input.purpose).trim()
          : existing
            ? existing.purpose
            : '';
      const results =
        input.results !== undefined
          ? normalizeStringArray(input.results)
          : existing
            ? existing.results
            : [];
      const targets =
        input.targets !== undefined
          ? normalizeTargetArray(input.targets)
          : existing
            ? existing.targets
            : [];

      if (!options.skipValidation) {
        validateReadyTask({ status, purpose, results, targets });
      }

      const uid = existing ? existing.uid : input.uid ? String(input.uid).trim() : generateUlid();
      let code;
      if (existing) {
        code = input.code ? canonicalTaskCodeInput(input.code) : existing.code;
      } else if (input.code) {
        code = canonicalTaskCodeInput(input.code);
      } else {
        code = this._allocateCode('next_seq_tsk', 'tasks', 'TSK', formatTaskCode);
      }
      this._bumpSeqIfNeeded('next_seq_tsk', code, 'TSK');

      const owner =
        input.owner !== undefined ? String(input.owner).trim() : existing ? existing.owner : '';
      const groupName =
        input.groupName !== undefined
          ? String(input.groupName).trim()
          : existing
            ? existing.groupName
            : '';
      const leaseOwner =
        input.leaseOwner !== undefined ? input.leaseOwner : existing ? existing.leaseOwner : null;
      const leaseExpiresAt =
        input.leaseExpiresAt !== undefined
          ? input.leaseExpiresAt
          : existing
            ? existing.leaseExpiresAt
            : null;
      const commitSha =
        input.commitSha !== undefined
          ? input.commitSha
            ? String(input.commitSha).trim()
            : null
          : existing
            ? existing.commitSha
            : null;
      const completedAt =
        input.completedAt !== undefined
          ? input.completedAt
          : status === 'done'
            ? (existing && existing.completedAt) || now
            : existing
              ? existing.completedAt
              : null;
      const scope = input.scope || (existing ? existing.scope : 'local');
      const provenance = input.provenance || (existing ? existing.provenance : 'user');
      const createdAt = input.createdAt || (existing ? existing.createdAt : now);
      const updatedAt = input.updatedAt || now;
      const deletedAt =
        input.deletedAt !== undefined ? input.deletedAt : existing ? existing.deletedAt : null;

      this.db
        .prepare(
          `INSERT INTO tasks (
            uid, code, title, status, purpose, results_json, targets_json,
            owner, group_name, lease_owner, lease_expires_at, commit_sha, completed_at,
            scope, provenance, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            code = excluded.code,
            title = excluded.title,
            status = excluded.status,
            purpose = excluded.purpose,
            results_json = excluded.results_json,
            targets_json = excluded.targets_json,
            owner = excluded.owner,
            group_name = excluded.group_name,
            lease_owner = excluded.lease_owner,
            lease_expires_at = excluded.lease_expires_at,
            commit_sha = excluded.commit_sha,
            completed_at = excluded.completed_at,
            scope = excluded.scope,
            provenance = excluded.provenance,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at`
        )
        .run(
          uid,
          code,
          title,
          status,
          purpose,
          JSON.stringify(results),
          JSON.stringify(targets),
          owner,
          groupName,
          leaseOwner,
          leaseExpiresAt,
          commitSha,
          completedAt,
          scope,
          provenance,
          createdAt,
          updatedAt,
          deletedAt
        );

      const ftsBody = [purpose, ...results, ...targets, commitSha || ''].filter(Boolean).join('\n');
      const ftsTags = [status, owner, groupName, ...targets].filter(Boolean).join(' ');
      this._syncFts(uid, 'task', code, title, ftsBody, ftsTags, Boolean(deletedAt));

      return this.getTask(uid);
    });
  }

  completeTask(idOrCode, commitSha, options = {}) {
    return this._runInTx(() => {
      const task = this.getTask(idOrCode);
      if (!task) {
        throw new Error(t('storage.taskNotFoundComplete', { id: idOrCode }));
      }
      const now = options.completedAt || new Date().toISOString();
      const sha = commitSha ? String(commitSha).trim() : task.commitSha || null;
      return this.upsertTask(
        {
          uid: task.uid,
          status: 'done',
          commitSha: sha,
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          scope: options.scope || task.scope,
          updatedAt: options.updatedAt || now,
        },
        { skipValidation: true }
      );
    });
  }

  acquireLease(idOrCode, owner, ttlSeconds = 600) {
    if (!owner || !String(owner).trim()) {
      throw new Error(t('storage.leaseOwnerRequired'));
    }
    const normOwner = String(owner).trim();
    const ttl = Math.max(1, Math.min(3600, Number(ttlSeconds) || 600));

    return this._runInTx(() => {
      const task = this.getTask(idOrCode);
      if (!task || task.deletedAt) {
        throw new Error(t('storage.leaseTaskNotFoundSet', { id: idOrCode }));
      }

      const nowMs = Date.now();
      const existingExpMs = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : NaN;
      if (
        task.leaseOwner &&
        task.leaseOwner !== normOwner &&
        Number.isFinite(existingExpMs) &&
        existingExpMs > nowMs
      ) {
        return {
          acquired: false,
          uid: task.uid,
          code: task.code,
          holder: task.leaseOwner,
          expiresAt: task.leaseExpiresAt,
        };
      }

      const nowIso = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + ttl * 1000).toISOString();
      this.db
        .prepare('UPDATE tasks SET lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE uid = ?')
        .run(normOwner, expiresAt, nowIso, task.uid);

      return {
        acquired: true,
        uid: task.uid,
        code: task.code,
        owner: normOwner,
        expiresAt,
      };
    });
  }

  releaseLease(idOrCode, owner, options = {}) {
    return this._runInTx(() => {
      const task = this.getTask(idOrCode);
      if (!task || task.deletedAt) {
        throw new Error(t('storage.leaseTaskNotFoundRelease', { id: idOrCode }));
      }
      const normOwner = owner ? String(owner).trim() : '';
      if (normOwner && task.leaseOwner && task.leaseOwner !== normOwner && !options.force) {
        return {
          released: false,
          uid: task.uid,
          code: task.code,
          holder: task.leaseOwner,
        };
      }

      const nowIso = new Date().toISOString();
      this.db
        .prepare('UPDATE tasks SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE uid = ?')
        .run(nowIso, task.uid);

      return {
        released: true,
        uid: task.uid,
        code: task.code,
      };
    });
  }

  // =========================================================================
  // Pattern CRUD & Versioning
  // =========================================================================

  listPatterns({ category, includeSuperseded = false, includeDeleted = false } = {}) {
    this.open();
    const clauses = [];
    const params = [];

    if (!includeDeleted) {
      clauses.push('deleted_at IS NULL');
    }
    if (!includeSuperseded) {
      clauses.push(
        'uid NOT IN (SELECT supersedes_uid FROM patterns WHERE supersedes_uid IS NOT NULL AND deleted_at IS NULL)'
      );
    }
    if (category) {
      clauses.push('LOWER(category) LIKE ?');
      params.push(`%${String(category).trim().toLowerCase()}%`);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM patterns ${whereSql}`).all(...params);
    return rows.map(hydratePattern).sort((a, b) => {
      const na = parseCodeNumber(a.code, 'P') || 0;
      const nb = parseCodeNumber(b.code, 'P') || 0;
      if (na !== nb) return na - nb;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  getPattern(idOrCode) {
    if (!idOrCode) return null;
    this.open();
    const raw = String(idOrCode).trim();
    const byUid = this.db.prepare('SELECT * FROM patterns WHERE uid = ?').get(raw);
    if (byUid) return hydratePattern(byUid);

    const code = canonicalPatternCodeInput(raw);
    if (!code) return null;
    const byCode = this.db
      .prepare('SELECT * FROM patterns WHERE UPPER(code) = ?')
      .get(code.toUpperCase());
    return hydratePattern(byCode);
  }

  upsertPattern(input) {
    if (!input || typeof input !== 'object') {
      throw new Error(t('storage.patternInputRequired'));
    }

    return this._runInTx(() => {
      let existingRow = null;
      if (input.uid) {
        existingRow = this.db
          .prepare('SELECT * FROM patterns WHERE uid = ?')
          .get(String(input.uid).trim());
      }
      const supersedesRef = input.supersedesUid || input.supersedesCode || null;
      let prevPattern = supersedesRef ? this.getPattern(supersedesRef) : null;
      if (supersedesRef && !prevPattern) {
        throw new Error(t('storage.patternSupersedesNotFound', { ref: supersedesRef }));
      }

      if (!existingRow && !prevPattern && input.code) {
        const lookupCode = canonicalPatternCodeInput(input.code);
        existingRow = this.db
          .prepare('SELECT * FROM patterns WHERE UPPER(code) = ?')
          .get(lookupCode.toUpperCase());
      }
      const existing = hydratePattern(existingRow);

      const now = new Date().toISOString();
      const title =
        input.title !== undefined
          ? String(input.title).trim()
          : existing
            ? existing.title
            : prevPattern
              ? prevPattern.title
              : '';
      if (!title) {
        throw new Error(t('storage.patternTitleRequired'));
      }

      const category =
        input.category !== undefined
          ? String(input.category).trim()
          : existing
            ? existing.category
            : prevPattern
              ? prevPattern.category
              : '';
      const summary =
        input.summary !== undefined
          ? String(input.summary).trim()
          : existing
            ? existing.summary
            : title;
      const symptom =
        input.symptom !== undefined
          ? String(input.symptom).trim()
          : existing
            ? existing.symptom
            : '';
      const solution =
        input.solution !== undefined
          ? String(input.solution).trim()
          : existing
            ? existing.solution
            : '';
      const relatedFiles =
        input.relatedFiles !== undefined
          ? normalizeTargetArray(input.relatedFiles)
          : existing
            ? existing.relatedFiles
            : [];
      const tags =
        input.tags !== undefined
          ? normalizeStringArray(input.tags)
          : existing
            ? existing.tags
            : [];

      let version = existing ? existing.version : 1;
      let supersedesUid = existing ? existing.supersedesUid : null;

      if (prevPattern && (!existing || existing.uid !== prevPattern.uid)) {
        version = (prevPattern.version || 1) + 1;
        supersedesUid = prevPattern.uid;
        // Exclude superseded version from FTS index while retaining the version-chain record
        this.db.prepare('DELETE FROM memory_fts WHERE uid = ?').run(prevPattern.uid);
      } else if (input.version !== undefined) {
        version = Number(input.version) || 1;
      }

      const uid = existing ? existing.uid : input.uid ? String(input.uid).trim() : generateUlid();
      let code;
      if (existing) {
        code = input.code ? canonicalPatternCodeInput(input.code) : existing.code;
      } else if (input.code) {
        code = canonicalPatternCodeInput(input.code);
        if (prevPattern && prevPattern.code.toUpperCase() === code.toUpperCase()) {
          const archivedCode = `${prevPattern.code}@v${prevPattern.version}`;
          this.db.prepare('UPDATE patterns SET code = ? WHERE uid = ?').run(archivedCode, prevPattern.uid);
        }
      } else {
        code = this._allocateCode('next_seq_pat', 'patterns', 'P', formatPatternCode);
      }
      this._bumpSeqIfNeeded('next_seq_pat', code, 'P');

      const scope = input.scope || (existing ? existing.scope : 'shared');
      const author =
        input.author !== undefined ? String(input.author).trim() : existing ? existing.author : '';
      const provenance = input.provenance || (existing ? existing.provenance : 'user');
      const createdAt = input.createdAt || (existing ? existing.createdAt : now);
      const updatedAt = input.updatedAt || now;
      const deletedAt =
        input.deletedAt !== undefined ? input.deletedAt : existing ? existing.deletedAt : null;

      this.db
        .prepare(
          `INSERT INTO patterns (
            uid, code, category, title, summary, symptom, solution,
            related_files_json, tags_json, version, supersedes_uid,
            scope, author, provenance, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            code = excluded.code,
            category = excluded.category,
            title = excluded.title,
            summary = excluded.summary,
            symptom = excluded.symptom,
            solution = excluded.solution,
            related_files_json = excluded.related_files_json,
            tags_json = excluded.tags_json,
            version = excluded.version,
            supersedes_uid = excluded.supersedes_uid,
            scope = excluded.scope,
            author = excluded.author,
            provenance = excluded.provenance,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at`
        )
        .run(
          uid,
          code,
          category,
          title,
          summary,
          symptom,
          solution,
          JSON.stringify(relatedFiles),
          JSON.stringify(tags),
          version,
          supersedesUid,
          scope,
          author,
          provenance,
          createdAt,
          updatedAt,
          deletedAt
        );

      const isSuperseded = Boolean(
        this.db
          .prepare('SELECT 1 FROM patterns WHERE supersedes_uid = ? AND deleted_at IS NULL')
          .get(uid)
      );
      const ftsBody = [category, summary, symptom, solution, ...relatedFiles].filter(Boolean).join('\n');
      const ftsTags = [category, ...tags, ...relatedFiles].filter(Boolean).join(' ');
      this._syncFts(uid, 'pattern', code, title, ftsBody, ftsTags, Boolean(deletedAt) || isSuperseded);

      return this.getPattern(uid);
    });
  }

  // =========================================================================
  // ADR (Changelog) CRUD
  // =========================================================================

  listAdrs({ limit = 0, includeDeleted = false } = {}) {
    this.open();
    const whereSql = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    const rows = this.db.prepare(`SELECT * FROM adrs ${whereSql}`).all();
    const sorted = rows.map(hydrateAdr).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const na = parseCodeNumber(a.code, 'LOG') || 0;
      const nb = parseCodeNumber(b.code, 'LOG') || 0;
      return nb - na;
    });
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  getAdr(idOrCode) {
    if (!idOrCode) return null;
    this.open();
    const raw = String(idOrCode).trim();
    const byUid = this.db.prepare('SELECT * FROM adrs WHERE uid = ?').get(raw);
    if (byUid) return hydrateAdr(byUid);

    const code = canonicalAdrCodeInput(raw);
    if (!code) return null;
    const byCode = this.db.prepare('SELECT * FROM adrs WHERE UPPER(code) = ?').get(code.toUpperCase());
    return hydrateAdr(byCode);
  }

  upsertAdr(input) {
    if (!input || typeof input !== 'object') {
      throw new Error(t('storage.adrInputRequired'));
    }

    return this._runInTx(() => {
      let existingRow = null;
      if (input.uid) {
        existingRow = this.db.prepare('SELECT * FROM adrs WHERE uid = ?').get(String(input.uid).trim());
      }
      if (!existingRow && input.code) {
        const lookupCode = canonicalAdrCodeInput(input.code);
        existingRow = this.db
          .prepare('SELECT * FROM adrs WHERE UPPER(code) = ?')
          .get(lookupCode.toUpperCase());
      }
      const existing = hydrateAdr(existingRow);

      const now = new Date().toISOString();
      const title =
        input.title !== undefined ? String(input.title).trim() : existing ? existing.title : '';
      if (!title) {
        throw new Error(t('storage.adrTitleRequired'));
      }

      const date =
        input.date !== undefined
          ? String(input.date).trim()
          : existing
            ? existing.date
            : now.slice(0, 10);
      const summary =
        input.summary !== undefined
          ? String(input.summary).trim()
          : existing
            ? existing.summary
            : title;
      const relatedArea =
        input.relatedArea !== undefined
          ? String(input.relatedArea).trim()
          : existing
            ? existing.relatedArea
            : '';
      const relatedTaskCode =
        input.relatedTaskCode !== undefined
          ? String(input.relatedTaskCode).trim()
          : existing
            ? existing.relatedTaskCode
            : '';
      const branch =
        input.branch !== undefined ? String(input.branch).trim() : existing ? existing.branch : '';
      const context =
        input.context !== undefined ? String(input.context).trim() : existing ? existing.context : '';
      const decision =
        input.decision !== undefined
          ? String(input.decision).trim()
          : existing
            ? existing.decision
            : '';
      const impact =
        input.impact !== undefined ? String(input.impact).trim() : existing ? existing.impact : '';

      const uid = existing ? existing.uid : input.uid ? String(input.uid).trim() : generateUlid();
      let code;
      if (existing) {
        code = input.code ? canonicalAdrCodeInput(input.code) : existing.code;
      } else if (input.code) {
        code = canonicalAdrCodeInput(input.code);
      } else {
        code = this._allocateCode('next_seq_log', 'adrs', 'LOG', formatAdrCode);
      }
      this._bumpSeqIfNeeded('next_seq_log', code, 'LOG');

      const scope = input.scope || (existing ? existing.scope : 'shared');
      const author =
        input.author !== undefined ? String(input.author).trim() : existing ? existing.author : '';
      const provenance = input.provenance || (existing ? existing.provenance : 'user');
      const createdAt = input.createdAt || (existing ? existing.createdAt : now);
      const updatedAt = input.updatedAt || now;
      const deletedAt =
        input.deletedAt !== undefined ? input.deletedAt : existing ? existing.deletedAt : null;

      this.db
        .prepare(
          `INSERT INTO adrs (
            uid, code, date, title, summary, related_area, related_task_code,
            branch, context, decision, impact, scope, author, provenance,
            created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            code = excluded.code,
            date = excluded.date,
            title = excluded.title,
            summary = excluded.summary,
            related_area = excluded.related_area,
            related_task_code = excluded.related_task_code,
            branch = excluded.branch,
            context = excluded.context,
            decision = excluded.decision,
            impact = excluded.impact,
            scope = excluded.scope,
            author = excluded.author,
            provenance = excluded.provenance,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at`
        )
        .run(
          uid,
          code,
          date,
          title,
          summary,
          relatedArea,
          relatedTaskCode,
          branch,
          context,
          decision,
          impact,
          scope,
          author,
          provenance,
          createdAt,
          updatedAt,
          deletedAt
        );

      const ftsBody = [summary, relatedArea, context, decision, impact].filter(Boolean).join('\n');
      const ftsTags = [date, relatedTaskCode, branch, relatedArea].filter(Boolean).join(' ');
      this._syncFts(uid, 'adr', code, title, ftsBody, ftsTags, Boolean(deletedAt));

      return this.getAdr(uid);
    });
  }

  // =========================================================================
  // FTS5 Search & Token Budget Packing
  // =========================================================================

  search(query, { kind = 'all', limit = 10, tokenBudget = 0 } = {}) {
    this.open();
    const raw = String(query || '').trim();
    if (!raw) return [];

    const normKind = normalizeSearchKind(kind);
    const maxLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const budget = Math.max(0, Number(tokenBudget) || 0);
    const { andQuery, orQuery } = buildFtsQueries(raw);

    const runFts = (matchExpr) => {
      if (!matchExpr) return [];
      try {
        if (normKind === 'all') {
          return this.db
            .prepare(
              'SELECT uid, kind, code, title, bm25(memory_fts) AS score FROM memory_fts WHERE memory_fts MATCH ? ORDER BY score ASC LIMIT ?'
            )
            .all(matchExpr, maxLimit);
        }
        return this.db
          .prepare(
            'SELECT uid, kind, code, title, bm25(memory_fts) AS score FROM memory_fts WHERE memory_fts MATCH ? AND kind = ? ORDER BY score ASC LIMIT ?'
          )
          .all(matchExpr, normKind, maxLimit);
      } catch (_) {
        return [];
      }
    };

    let rows = runFts(andQuery);
    if (rows.length === 0 && orQuery) {
      rows = runFts(orQuery);
    }
    if (rows.length === 0) {
      const likeTerm = `%${raw}%`;
      if (normKind === 'all') {
        rows = this.db
          .prepare(
            'SELECT uid, kind, code, title, 0.0 AS score FROM memory_fts WHERE code LIKE ? OR title LIKE ? OR body LIKE ? OR tags LIKE ? LIMIT ?'
          )
          .all(likeTerm, likeTerm, likeTerm, likeTerm, maxLimit);
      } else {
        rows = this.db
          .prepare(
            'SELECT uid, kind, code, title, 0.0 AS score FROM memory_fts WHERE kind = ? AND (code LIKE ? OR title LIKE ? OR body LIKE ? OR tags LIKE ?) LIMIT ?'
          )
          .all(normKind, likeTerm, likeTerm, likeTerm, likeTerm, maxLimit);
      }
    }

    const packed = [];
    let usedTokens = 0;

    for (const row of rows) {
      let record = null;
      if (row.kind === 'task') record = this.getTask(row.uid);
      else if (row.kind === 'pattern') record = this.getPattern(row.uid);
      else if (row.kind === 'adr') record = this.getAdr(row.uid);

      if (!record || record.deletedAt) continue;

      const summaryObj = {
        kind: row.kind,
        code: record.code,
        title: record.title,
        body:
          row.kind === 'task'
            ? `${record.purpose} ${(record.results || []).join(' ')} ${(record.targets || []).join(' ')}`
            : row.kind === 'pattern'
              ? `${record.summary} ${record.symptom} ${record.solution}`
              : `${record.summary} ${record.decision} ${record.impact}`,
      };
      const estimatedTokens = Math.max(1, Math.ceil(JSON.stringify(summaryObj).length / 2.5));

      if (budget > 0 && usedTokens + estimatedTokens > budget) {
        continue;
      }

      usedTokens += estimatedTokens;
      packed.push({
        uid: row.uid,
        kind: row.kind,
        code: record.code,
        title: record.title,
        score: Number(row.score),
        estimatedTokens,
        record,
      });
    }

    return packed;
  }

  // =========================================================================
  // Stats, Snapshot Export / Import
  // =========================================================================

  getStats() {
    this.open();
    const meta = this._getAllMeta();
    const tTotal = this.db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL').get().c;
    const tActive = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND status != 'done'")
      .get().c;
    const tReady = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND status = 'ready'")
      .get().c;
    const tDone = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND status = 'done'")
      .get().c;

    const pTotal = this.db.prepare('SELECT COUNT(*) AS c FROM patterns WHERE deleted_at IS NULL').get().c;
    const pSuperseded = this.db
      .prepare(
        'SELECT COUNT(*) AS c FROM patterns WHERE deleted_at IS NULL AND uid IN (SELECT supersedes_uid FROM patterns WHERE supersedes_uid IS NOT NULL AND deleted_at IS NULL)'
      )
      .get().c;
    const aTotal = this.db.prepare('SELECT COUNT(*) AS c FROM adrs WHERE deleted_at IS NULL').get().c;

    return {
      provider: 'sqlite',
      dbPath: this.dbPath,
      schemaVersion: meta.schema_version || SCHEMA_VERSION,
      workspaceId: meta.workspace_id || '',
      tasks: { total: tTotal, active: tActive, ready: tReady, done: tDone },
      patterns: { total: pTotal, active: pTotal - pSuperseded, superseded: pSuperseded },
      adrs: { total: aTotal },
      sequences: {
        tsk: parseInt(meta.next_seq_tsk || '1', 10),
        pat: parseInt(meta.next_seq_pat || '1', 10),
        log: parseInt(meta.next_seq_log || '1', 10),
      },
    };
  }

  exportSnapshot({ includeDeleted = false } = {}) {
    this.open();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspaceId: this._getMeta('workspace_id', ''),
      meta: this._getAllMeta(),
      tasks: this.listTasks({ includeDone: true, includeDeleted }),
      patterns: this.listPatterns({ includeSuperseded: true, includeDeleted }),
      adrs: this.listAdrs({ includeDeleted }),
    };
  }

  importSnapshot(snapshot, strategy = 'merge') {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error(t('storage.snapshotInvalid'));
    }

    return this._runInTx(() => {
      if (strategy === 'replace') {
        this.db.exec('DELETE FROM memory_fts; DELETE FROM tasks; DELETE FROM patterns; DELETE FROM adrs;');
        this._setMeta('next_seq_tsk', '1');
        this._setMeta('next_seq_pat', '1');
        this._setMeta('next_seq_log', '1');
      }

      const counts = { tasks: 0, patterns: 0, adrs: 0, skipped: 0 };

      for (const task of snapshot.tasks || []) {
        if (strategy === 'skip' && (this.getTask(task.uid) || this.getTask(task.code))) {
          counts.skipped += 1;
          continue;
        }
        this.upsertTask(task, { skipValidation: true });
        counts.tasks += 1;
      }

      // Insert in ascending version order to preserve version-chain referential integrity
      const sortedPatterns = [...(snapshot.patterns || [])].sort(
        (a, b) => (Number(a.version) || 1) - (Number(b.version) || 1)
      );
      for (const pattern of sortedPatterns) {
        if (strategy === 'skip' && (this.getPattern(pattern.uid) || this.getPattern(pattern.code))) {
          counts.skipped += 1;
          continue;
        }
        this.upsertPattern(pattern);
        counts.patterns += 1;
      }

      for (const adr of snapshot.adrs || []) {
        if (strategy === 'skip' && (this.getAdr(adr.uid) || this.getAdr(adr.code))) {
          counts.skipped += 1;
          continue;
        }
        this.upsertAdr(adr);
        counts.adrs += 1;
      }

      return counts;
    });
  }
}

module.exports = {
  SqliteProvider,
  validateReadyTask,
  buildFtsQueries,
  SCHEMA_VERSION,
};

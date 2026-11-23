/**
 * scripts/storage/markdown-provider.cjs
 *
 * 기존 .agents/ Markdown 정본 파일 위에서 동작하는 하위 호환 StorageProvider 구현
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
const { validateReadyTask } = require('./sqlite-provider.cjs');
const {
  resolveTaskFiles,
  resolveMemoryFiles,
  parseTaskMdFile,
  parseTaskCompletedMdFile,
  parsePatternsFromMd,
  parseAdrsFromMd,
  projectTasksToMarkdown,
  exportStoreToMarkdown,
} = require('./markdown-bridge.cjs');

function normalizeArray(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

class MarkdownProvider {
  constructor(rootDir, options = {}) {
    this.rootDir = path.resolve(rootDir || process.cwd());
    this.options = options;
    this.providerName = 'markdown';
  }

  open() {
    return this;
  }

  close() {
    // 파일 핸들을 상시 점유하지 않으므로 별도 정리 없음
  }

  _loadAllTasks() {
    const { taskFile, completedFile } = resolveTaskFiles(this.rootDir);
    const active = parseTaskMdFile(taskFile).map((t) => ({
      uid: t.code,
      ...t,
      owner: '',
      leaseOwner: null,
      leaseExpiresAt: null,
      commitSha: null,
      completedAt: null,
      scope: 'local',
      provenance: 'user',
      createdAt: t.registeredDate ? `${t.registeredDate}T00:00:00.000Z` : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }));
    const done = parseTaskCompletedMdFile(completedFile).map((t) => ({
      uid: t.code,
      ...t,
      owner: '',
      leaseOwner: null,
      leaseExpiresAt: null,
      scope: 'local',
      provenance: 'user',
      createdAt: t.completedAt || new Date().toISOString(),
      updatedAt: t.completedAt || new Date().toISOString(),
      deletedAt: null,
    }));

    const byCode = new Map();
    for (const item of [...done, ...active]) {
      byCode.set(item.code, item);
    }
    return Array.from(byCode.values()).sort(
      (a, b) => (parseCodeNumber(a.code, 'TSK') || 0) - (parseCodeNumber(b.code, 'TSK') || 0)
    );
  }

  listTasks({ status, includeDone = false } = {}) {
    let tasks = this._loadAllTasks();
    if (status) {
      const target = normalizeTaskStatus(status);
      tasks = tasks.filter((t) => t.status === target);
    } else if (!includeDone) {
      tasks = tasks.filter((t) => t.status !== 'done');
    }
    return tasks;
  }

  getTask(idOrCode) {
    if (!idOrCode) return null;
    const raw = String(idOrCode).trim().toUpperCase();
    const num = parseCodeNumber(raw, 'TSK');
    const lookupCode = num ? formatTaskCode(num) : raw;
    return this._loadAllTasks().find((t) => t.uid === raw || t.code.toUpperCase() === lookupCode) || null;
  }

  upsertTask(input, options = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error('태스크 입력 객체가 필요합니다.');
    }
    const all = this._loadAllTasks();
    const lookupCode = input.code ? formatTaskCode(parseCodeNumber(input.code, 'TSK') || 0) : null;
    const existingIdx = all.findIndex(
      (t) =>
        (input.uid && t.uid === input.uid) ||
        (lookupCode && t.code.toUpperCase() === lookupCode.toUpperCase())
    );
    const existing = existingIdx !== -1 ? all[existingIdx] : null;

    const title =
      input.title !== undefined ? String(input.title).trim() : existing ? existing.title : '';
    if (!title) throw new Error('태스크 제목(title)이 필요합니다.');

    const status =
      input.status !== undefined
        ? normalizeTaskStatus(input.status)
        : existing
          ? existing.status
          : 'todo';
    const purpose =
      input.purpose !== undefined ? String(input.purpose).trim() : existing ? existing.purpose : '';
    const results =
      input.results !== undefined ? normalizeArray(input.results) : existing ? existing.results : [];
    const targets =
      input.targets !== undefined
        ? normalizeArray(input.targets).map((p) => p.replace(/\\/g, '/'))
        : existing
          ? existing.targets
          : [];

    if (!options.skipValidation) {
      validateReadyTask({ status, purpose, results, targets });
    }

    const maxNum = all.reduce((acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0), 0);
    const code = existing
      ? existing.code
      : input.code
        ? formatTaskCode(parseCodeNumber(input.code, 'TSK'))
        : formatTaskCode(maxNum + 1);
    const now = new Date().toISOString();

    const updated = {
      uid: existing ? existing.uid : code,
      code,
      title,
      status,
      purpose,
      results,
      targets,
      owner: input.owner !== undefined ? input.owner : existing ? existing.owner : '',
      groupName:
        input.groupName !== undefined ? input.groupName : existing ? existing.groupName : '',
      leaseOwner: null,
      leaseExpiresAt: null,
      commitSha:
        input.commitSha !== undefined ? input.commitSha : existing ? existing.commitSha : null,
      completedAt:
        input.completedAt !== undefined
          ? input.completedAt
          : status === 'done'
            ? (existing && existing.completedAt) || now
            : null,
      scope: input.scope || (existing ? existing.scope : 'local'),
      provenance: input.provenance || 'user',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      deletedAt: null,
    };

    if (existingIdx !== -1) all[existingIdx] = updated;
    else all.push(updated);

    const viewStore = {
      listTasks: () => all,
      listPatterns: () => this.listPatterns(),
      listAdrs: () => this.listAdrs(),
      getStats: () => ({
        sequences: {
          tsk: all.reduce((acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0), 0) + 1,
        },
      }),
    };
    projectTasksToMarkdown(this.rootDir, viewStore);
    return updated;
  }

  completeTask(idOrCode, commitSha, options = {}) {
    const task = this.getTask(idOrCode);
    if (!task) {
      throw new Error(`완료 처리할 태스크를 찾을 수 없습니다: ${idOrCode}`);
    }
    return this.upsertTask(
      {
        uid: task.uid,
        code: task.code,
        status: 'done',
        commitSha: commitSha || task.commitSha || null,
        completedAt: options.completedAt || new Date().toISOString(),
      },
      { skipValidation: true }
    );
  }

  acquireLease(idOrCode, owner, ttlSeconds = 600) {
    const task = this.getTask(idOrCode);
    if (!task) throw new Error(`태스크를 찾을 수 없습니다: ${idOrCode}`);
    return {
      acquired: true,
      uid: task.uid,
      code: task.code,
      owner,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  releaseLease(idOrCode) {
    const task = this.getTask(idOrCode);
    if (!task) throw new Error(`태스크를 찾을 수 없습니다: ${idOrCode}`);
    return { released: true, uid: task.uid, code: task.code };
  }

  listPatterns({ category } = {}) {
    const raw = parsePatternsFromMd(this.rootDir).map((p) => ({
      uid: p.code,
      ...p,
      version: 1,
      supersedesUid: null,
      scope: 'shared',
      author: '',
      provenance: 'user',
      deletedAt: null,
    }));
    if (!category) return raw;
    const normCat = String(category).trim().toLowerCase();
    return raw.filter((p) => (p.category || '').toLowerCase().includes(normCat));
  }

  getPattern(idOrCode) {
    if (!idOrCode) return null;
    const raw = String(idOrCode).trim().toUpperCase();
    const num = parseCodeNumber(raw, 'P');
    const code = num ? formatPatternCode(num) : raw;
    return this.listPatterns().find((p) => p.uid === raw || p.code.toUpperCase() === code) || null;
  }

  upsertPattern(input) {
    const all = this.listPatterns();
    const maxNum = all.reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0);
    const code = input.code
      ? formatPatternCode(parseCodeNumber(input.code, 'P') || maxNum + 1)
      : formatPatternCode(maxNum + 1);
    const existingIdx = all.findIndex((p) => p.code === code);
    const now = new Date().toISOString();
    const item = {
      uid: code,
      code,
      category: input.category || '일반',
      title: input.title,
      summary: input.summary || input.title,
      symptom: input.symptom || '',
      solution: input.solution || '',
      relatedFiles: normalizeArray(input.relatedFiles).map((p) => p.replace(/\\/g, '/')),
      tags: normalizeArray(input.tags),
      version: 1,
      supersedesUid: null,
      scope: 'shared',
      author: input.author || '',
      provenance: 'user',
      createdAt: (existingIdx !== -1 && all[existingIdx].createdAt) || now,
      updatedAt: now,
      deletedAt: null,
    };
    if (existingIdx !== -1) all[existingIdx] = item;
    else all.push(item);

    exportStoreToMarkdown(this.rootDir, {
      listTasks: () => this._loadAllTasks(),
      listPatterns: () => all,
      listAdrs: () => this.listAdrs(),
      getStats: () => ({
        sequences: {
          tsk:
            this._loadAllTasks().reduce((acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0), 0) +
            1,
          pat: all.reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0) + 1,
        },
      }),
    });
    return item;
  }

  listAdrs({ limit = 0 } = {}) {
    const raw = parseAdrsFromMd(this.rootDir).map((a) => ({
      uid: a.code,
      ...a,
      scope: 'shared',
      author: '',
      provenance: 'user',
      deletedAt: null,
    }));
    return limit > 0 ? raw.slice(0, limit) : raw;
  }

  getAdr(idOrCode) {
    if (!idOrCode) return null;
    const raw = String(idOrCode).trim().toUpperCase();
    const num = parseCodeNumber(raw, 'LOG');
    const code = num ? formatAdrCode(num) : raw;
    return this.listAdrs().find((a) => a.uid === raw || a.code.toUpperCase() === code) || null;
  }

  upsertAdr(input) {
    const all = this.listAdrs();
    const maxNum = all.reduce((acc, a) => Math.max(acc, parseCodeNumber(a.code, 'LOG') || 0), 0);
    const code = input.code
      ? formatAdrCode(parseCodeNumber(input.code, 'LOG') || maxNum + 1)
      : formatAdrCode(maxNum + 1);
    const existingIdx = all.findIndex((a) => a.code === code);
    const now = new Date().toISOString();
    const item = {
      uid: code,
      code,
      date: input.date || now.slice(0, 10),
      title: input.title,
      summary: input.summary || input.title,
      relatedArea: input.relatedArea || '',
      relatedTaskCode: input.relatedTaskCode || '',
      branch: input.branch || 'main',
      context: input.context || '',
      decision: input.decision || '',
      impact: input.impact || '',
      scope: 'shared',
      author: input.author || '',
      provenance: 'user',
      createdAt: (existingIdx !== -1 && all[existingIdx].createdAt) || now,
      updatedAt: now,
      deletedAt: null,
    };
    if (existingIdx !== -1) all[existingIdx] = item;
    else all.unshift(item);

    exportStoreToMarkdown(this.rootDir, {
      listTasks: () => this._loadAllTasks(),
      listPatterns: () => this.listPatterns(),
      listAdrs: () => all,
      getStats: () => ({
        sequences: {
          tsk:
            this._loadAllTasks().reduce((acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0), 0) +
            1,
          pat:
            this.listPatterns().reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0) +
            1,
        },
      }),
    });
    return item;
  }

  search(query, { kind = 'all', limit = 10, tokenBudget = 0 } = {}) {
    const raw = String(query || '').trim().toLowerCase();
    if (!raw) return [];
    const tokens = raw.split(/\s+/).filter(Boolean);
    const normKind = String(kind || 'all').toLowerCase();

    const candidates = [];
    if (normKind === 'all' || normKind === 'task' || normKind === 'tasks') {
      for (const t of this._loadAllTasks()) {
        const hay = `${t.code} ${t.title} ${t.purpose} ${t.results.join(' ')} ${t.targets.join(' ')}`.toLowerCase();
        const hits = tokens.filter((tok) => hay.includes(tok)).length;
        if (hits > 0) candidates.push({ uid: t.uid, kind: 'task', code: t.code, title: t.title, score: -hits, record: t });
      }
    }
    if (normKind === 'all' || normKind === 'pattern' || normKind === 'patterns') {
      for (const p of this.listPatterns()) {
        const hay = `${p.code} ${p.category} ${p.title} ${p.summary} ${p.symptom} ${p.solution} ${p.relatedFiles.join(' ')}`.toLowerCase();
        const hits = tokens.filter((tok) => hay.includes(tok)).length;
        if (hits > 0) candidates.push({ uid: p.uid, kind: 'pattern', code: p.code, title: p.title, score: -hits, record: p });
      }
    }
    if (normKind === 'all' || normKind === 'adr' || normKind === 'adrs') {
      for (const a of this.listAdrs()) {
        const hay = `${a.code} ${a.title} ${a.summary} ${a.relatedArea} ${a.context} ${a.decision} ${a.impact}`.toLowerCase();
        const hits = tokens.filter((tok) => hay.includes(tok)).length;
        if (hits > 0) candidates.push({ uid: a.uid, kind: 'adr', code: a.code, title: a.title, score: -hits, record: a });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const sliced = candidates.slice(0, Math.max(1, Number(limit) || 10));
    if (!tokenBudget || tokenBudget <= 0) return sliced;

    const packed = [];
    let used = 0;
    for (const item of sliced) {
      const est = Math.max(1, Math.ceil(JSON.stringify(item.record).length / 2.5));
      if (used + est <= tokenBudget) {
        used += est;
        packed.push({ ...item, estimatedTokens: est });
      }
    }
    return packed;
  }

  getStats() {
    const tasks = this._loadAllTasks();
    const patterns = this.listPatterns();
    const adrs = this.listAdrs();
    const { taskFile } = resolveTaskFiles(this.rootDir);
    const { changelogFile } = resolveMemoryFiles(this.rootDir);

    return {
      provider: 'markdown',
      taskFile,
      changelogFile,
      schemaVersion: 'markdown',
      workspaceId: generateUlid(),
      tasks: {
        total: tasks.length,
        active: tasks.filter((t) => t.status !== 'done').length,
        ready: tasks.filter((t) => t.status === 'ready').length,
        done: tasks.filter((t) => t.status === 'done').length,
      },
      patterns: { total: patterns.length, active: patterns.length, superseded: 0 },
      adrs: { total: adrs.length },
      sequences: {
        tsk: tasks.reduce((acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0), 0) + 1,
        pat: patterns.reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0) + 1,
        log: adrs.reduce((acc, a) => Math.max(acc, parseCodeNumber(a.code, 'LOG') || 0), 0) + 1,
      },
    };
  }

  exportSnapshot() {
    return {
      schemaVersion: 'markdown',
      exportedAt: new Date().toISOString(),
      tasks: this._loadAllTasks(),
      patterns: this.listPatterns(),
      adrs: this.listAdrs(),
    };
  }
}

module.exports = {
  MarkdownProvider,
};

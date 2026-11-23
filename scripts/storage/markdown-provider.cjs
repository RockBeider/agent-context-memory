/**
 * scripts/storage/markdown-provider.cjs
 *
 * Backward-compatible StorageProvider operating directly on .agents/ Markdown files.
 */

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
const { t, resolveLanguage } = require('../i18n.cjs');

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
    // No persistent file handles held
  }

  _loadAllTasks() {
    const { taskFile, completedFile } = resolveTaskFiles(this.rootDir);
    const active = parseTaskMdFile(taskFile).map((task) => ({
      uid: task.code,
      ...task,
      owner: '',
      leaseOwner: null,
      leaseExpiresAt: null,
      commitSha: null,
      completedAt: null,
      scope: 'local',
      provenance: 'user',
      createdAt: task.registeredDate ? `${task.registeredDate}T00:00:00.000Z` : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }));
    const done = parseTaskCompletedMdFile(completedFile).map((task) => ({
      uid: task.code,
      ...task,
      owner: '',
      leaseOwner: null,
      leaseExpiresAt: null,
      scope: 'local',
      provenance: 'user',
      createdAt: task.completedAt || new Date().toISOString(),
      updatedAt: task.completedAt || new Date().toISOString(),
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
      tasks = tasks.filter((item) => item.status === target);
    } else if (!includeDone) {
      tasks = tasks.filter((item) => item.status !== 'done');
    }
    return tasks;
  }

  getTask(idOrCode) {
    if (!idOrCode) return null;
    const raw = String(idOrCode).trim().toUpperCase();
    const num = parseCodeNumber(raw, 'TSK');
    const lookupCode = num ? formatTaskCode(num) : raw;
    return this._loadAllTasks().find((item) => item.uid === raw || item.code.toUpperCase() === lookupCode) || null;
  }

  upsertTask(input, options = {}) {
    const lang = resolveLanguage(this.rootDir, options.lang || this.options.lang);
    if (!input || typeof input !== 'object') {
      throw new Error(t('storage.taskInputRequired', {}, lang));
    }
    const all = this._loadAllTasks();
    const lookupCode = input.code ? formatTaskCode(parseCodeNumber(input.code, 'TSK') || 0) : null;
    const existingIdx = all.findIndex(
      (item) =>
        (input.uid && item.uid === input.uid) ||
        (lookupCode && item.code.toUpperCase() === lookupCode.toUpperCase())
    );
    const existing = existingIdx !== -1 ? all[existingIdx] : null;

    const title =
      input.title !== undefined ? String(input.title).trim() : existing ? existing.title : '';
    if (!title) throw new Error(t('storage.taskTitleRequired', {}, lang));

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
      validateReadyTask({ status, purpose, results, targets }, lang);
    }

    const maxNum = all.reduce((acc, item) => Math.max(acc, parseCodeNumber(item.code, 'TSK') || 0), 0);
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
          tsk: all.reduce((acc, item) => Math.max(acc, parseCodeNumber(item.code, 'TSK') || 0), 0) + 1,
        },
      }),
    };
    projectTasksToMarkdown(this.rootDir, viewStore, { lang });
    return updated;
  }

  completeTask(idOrCode, commitSha, options = {}) {
    const task = this.getTask(idOrCode);
    if (!task) {
      throw new Error(t('storage.taskNotFoundComplete', { id: idOrCode }));
    }
    return this.upsertTask(
      {
        uid: task.uid,
        code: task.code,
        status: 'done',
        commitSha: commitSha || task.commitSha || null,
        completedAt: options.completedAt || new Date().toISOString(),
      },
      { skipValidation: true, lang: options.lang }
    );
  }

  acquireLease(idOrCode, owner, ttlSeconds = 600) {
    const task = this.getTask(idOrCode);
    if (!task) throw new Error(t('storage.taskNotFound', { id: idOrCode }));
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
    if (!task) throw new Error(t('storage.taskNotFound', { id: idOrCode }));
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

  upsertPattern(input, options = {}) {
    const lang = resolveLanguage(this.rootDir, options.lang || this.options.lang);
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
      category: input.category || t('storage.defaultCategory', {}, lang),
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

    exportStoreToMarkdown(
      this.rootDir,
      {
        listTasks: () => this._loadAllTasks(),
        listPatterns: () => all,
        listAdrs: () => this.listAdrs(),
        getStats: () => ({
          sequences: {
            tsk:
              this._loadAllTasks().reduce((acc, task) => Math.max(acc, parseCodeNumber(task.code, 'TSK') || 0), 0) +
              1,
            pat: all.reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0) + 1,
          },
        }),
      },
      { lang }
    );
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

  upsertAdr(input, options = {}) {
    const lang = resolveLanguage(this.rootDir, options.lang || this.options.lang);
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

    exportStoreToMarkdown(
      this.rootDir,
      {
        listTasks: () => this._loadAllTasks(),
        listPatterns: () => this.listPatterns(),
        listAdrs: () => all,
        getStats: () => ({
          sequences: {
            tsk:
              this._loadAllTasks().reduce((acc, task) => Math.max(acc, parseCodeNumber(task.code, 'TSK') || 0), 0) +
              1,
            pat:
              this.listPatterns().reduce((acc, p) => Math.max(acc, parseCodeNumber(p.code, 'P') || 0), 0) +
              1,
          },
        }),
      },
      { lang }
    );
    return item;
  }

  search(query, { kind = 'all', limit = 10, tokenBudget = 0 } = {}) {
    const raw = String(query || '').trim().toLowerCase();
    if (!raw) return [];
    const tokens = raw.split(/\s+/).filter(Boolean);
    const normKind = String(kind || 'all').toLowerCase();

    const candidates = [];
    if (normKind === 'all' || normKind === 'task' || normKind === 'tasks') {
      for (const task of this._loadAllTasks()) {
        const hay = `${task.code} ${task.title} ${task.purpose} ${task.results.join(' ')} ${task.targets.join(' ')}`.toLowerCase();
        const hits = tokens.filter((tok) => hay.includes(tok)).length;
        if (hits > 0) candidates.push({ uid: task.uid, kind: 'task', code: task.code, title: task.title, score: -hits, record: task });
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
        active: tasks.filter((task) => task.status !== 'done').length,
        ready: tasks.filter((task) => task.status === 'ready').length,
        done: tasks.filter((task) => task.status === 'done').length,
      },
      patterns: { total: patterns.length, active: patterns.length, superseded: 0 },
      adrs: { total: adrs.length },
      sequences: {
        tsk: tasks.reduce((acc, task) => Math.max(acc, parseCodeNumber(task.code, 'TSK') || 0), 0) + 1,
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

  importSnapshot(snapshot, strategy = 'merge', options = {}) {
    const lang = resolveLanguage(this.rootDir, options.lang || this.options.lang);
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error(t('storage.snapshotInvalid', {}, lang));
    }

    const { patternsDir } = resolveMemoryFiles(this.rootDir);
    if (strategy === 'replace' && fs.existsSync(patternsDir)) {
      for (const file of fs.readdirSync(patternsDir)) {
        if (file.endsWith('.md') && !/^P-00\b/i.test(file) && !/sample/i.test(file)) {
          fs.unlinkSync(path.join(patternsDir, file));
        }
      }
    }

    const taskMap = new Map();
    const patMap = new Map();
    const adrMap = new Map();

    if (strategy !== 'replace') {
      for (const item of this._loadAllTasks()) taskMap.set(item.code.toUpperCase(), item);
      for (const item of this.listPatterns()) patMap.set(item.code.toUpperCase(), item);
      for (const item of this.listAdrs()) adrMap.set(item.code.toUpperCase(), item);
    }

    const counts = { tasks: 0, patterns: 0, adrs: 0, skipped: 0 };
    const now = new Date().toISOString();

    for (const rawTask of snapshot.tasks || []) {
      if (!rawTask || rawTask.deletedAt) continue;
      const num = parseCodeNumber(rawTask.code, 'TSK');
      const code = num ? formatTaskCode(num) : String(rawTask.code || '').trim().toUpperCase();
      if (!code) continue;

      if (strategy === 'skip' && taskMap.has(code)) {
        counts.skipped += 1;
        continue;
      }

      const status = normalizeTaskStatus(rawTask.status);
      taskMap.set(code, {
        uid: rawTask.uid || code,
        code,
        title: String(rawTask.title || code).trim(),
        status,
        purpose: rawTask.purpose ? String(rawTask.purpose).trim() : '',
        results: normalizeArray(rawTask.results),
        targets: normalizeArray(rawTask.targets).map((p) => p.replace(/\\/g, '/')),
        owner: rawTask.owner || '',
        groupName: rawTask.groupName || '',
        leaseOwner: null,
        leaseExpiresAt: null,
        commitSha: rawTask.commitSha || null,
        completedAt: status === 'done' ? rawTask.completedAt || rawTask.updatedAt || now : null,
        scope: rawTask.scope || 'local',
        provenance: rawTask.provenance || 'import',
        createdAt: rawTask.createdAt || now,
        updatedAt: rawTask.updatedAt || now,
        deletedAt: null,
      });
      counts.tasks += 1;
    }

    const allSnapshotPatterns = snapshot.patterns || [];
    const supersededUids = new Set(
      allSnapshotPatterns.filter((p) => p && !p.deletedAt && p.supersedesUid).map((p) => p.supersedesUid)
    );
    const sortedPatterns = [...allSnapshotPatterns].sort(
      (a, b) => (Number(a && a.version) || 1) - (Number(b && b.version) || 1)
    );

    for (const rawPat of sortedPatterns) {
      if (!rawPat || rawPat.deletedAt) continue;
      if (rawPat.uid && supersededUids.has(rawPat.uid)) continue;
      const num = parseCodeNumber(rawPat.code, 'P');
      const code = num ? formatPatternCode(num) : String(rawPat.code || '').trim().toUpperCase();
      if (!code) continue;

      if (strategy === 'skip' && patMap.has(code)) {
        counts.skipped += 1;
        continue;
      }

      patMap.set(code, {
        uid: rawPat.uid || code,
        code,
        category: rawPat.category || t('storage.defaultCategory', {}, lang),
        title: String(rawPat.title || code).trim(),
        summary: rawPat.summary || rawPat.title || code,
        symptom: rawPat.symptom || '',
        solution: rawPat.solution || '',
        relatedFiles: normalizeArray(rawPat.relatedFiles).map((p) => p.replace(/\\/g, '/')),
        tags: normalizeArray(rawPat.tags),
        version: Number(rawPat.version) || 1,
        supersedesUid: null,
        scope: rawPat.scope || 'shared',
        author: rawPat.author || '',
        provenance: rawPat.provenance || 'import',
        createdAt: rawPat.createdAt || now,
        updatedAt: rawPat.updatedAt || now,
        deletedAt: null,
      });
      counts.patterns += 1;
    }

    for (const rawAdr of snapshot.adrs || []) {
      if (!rawAdr || rawAdr.deletedAt) continue;
      const num = parseCodeNumber(rawAdr.code, 'LOG');
      const code = num ? formatAdrCode(num) : String(rawAdr.code || '').trim().toUpperCase();
      if (!code) continue;

      if (strategy === 'skip' && adrMap.has(code)) {
        counts.skipped += 1;
        continue;
      }

      adrMap.set(code, {
        uid: rawAdr.uid || code,
        code,
        date: rawAdr.date || now.slice(0, 10),
        title: String(rawAdr.title || code).trim(),
        summary: rawAdr.summary || rawAdr.title || code,
        relatedArea: rawAdr.relatedArea || '',
        relatedTaskCode: rawAdr.relatedTaskCode || '',
        branch: rawAdr.branch || 'main',
        context: rawAdr.context || '',
        decision: rawAdr.decision || '',
        impact: rawAdr.impact || '',
        scope: rawAdr.scope || 'shared',
        author: rawAdr.author || '',
        provenance: rawAdr.provenance || 'import',
        createdAt: rawAdr.createdAt || now,
        updatedAt: rawAdr.updatedAt || now,
        deletedAt: null,
      });
      counts.adrs += 1;
    }

    const finalTasks = Array.from(taskMap.values()).sort(
      (a, b) => (parseCodeNumber(a.code, 'TSK') || 0) - (parseCodeNumber(b.code, 'TSK') || 0)
    );
    const finalPatterns = Array.from(patMap.values()).sort(
      (a, b) => (parseCodeNumber(a.code, 'P') || 0) - (parseCodeNumber(b.code, 'P') || 0)
    );
    const finalAdrs = Array.from(adrMap.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (parseCodeNumber(b.code, 'LOG') || 0) - (parseCodeNumber(a.code, 'LOG') || 0);
    });

    exportStoreToMarkdown(
      this.rootDir,
      {
        listTasks: () => finalTasks,
        listPatterns: () => finalPatterns,
        listAdrs: () => finalAdrs,
        getStats: () => ({
          sequences: {
            tsk: finalTasks.reduce((acc, item) => Math.max(acc, parseCodeNumber(item.code, 'TSK') || 0), 0) + 1,
            pat: finalPatterns.reduce((acc, item) => Math.max(acc, parseCodeNumber(item.code, 'P') || 0), 0) + 1,
            log: finalAdrs.reduce((acc, item) => Math.max(acc, parseCodeNumber(item.code, 'LOG') || 0), 0) + 1,
          },
        }),
      },
      { lang }
    );

    return counts;
  }
}

module.exports = {
  MarkdownProvider,
};

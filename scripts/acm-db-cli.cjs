#!/usr/bin/env node
/**
 * scripts/acm-db-cli.cjs
 *
 * Unified CLI command handler for MemoryStore operations:
 *   task, pattern, adr, search, migrate, export, import
 */

const fs = require('fs');
const path = require('path');
const {
  isNodeSqliteAvailable,
  normalizeStorageProvider,
  loadConfig,
  saveConfig,
} = require('./storage/config.cjs');
const { createMemoryStore } = require('./storage/memory-store.cjs');
const { toDisplayStatus } = require('./storage/id-utils.cjs');
const {
  importMarkdownToStore,
  exportStoreToMarkdown,
  parseTaskMdFile,
  parseTaskCompletedMdFile,
  parsePatternsFromMd,
  parseAdrsFromMd,
  resolveTaskFiles,
} = require('./storage/markdown-bridge.cjs');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');
const { syncWithGitOrphan } = require('./storage/git-orphan-sync.cjs');

const VALUE_FLAGS = new Set([
  'lang',
  'l',
  'status',
  'title',
  'purpose',
  'group',
  'owner',
  'sha',
  'ttl',
  'category',
  'summary',
  'symptom',
  'solution',
  'supersedes',
  'author',
  'date',
  'area',
  'task',
  'branch',
  'context',
  'decision',
  'impact',
  'kind',
  'limit',
  'budget',
  'token-budget',
  'query',
  'to',
  'format',
  'out',
  'strategy',
  'remote',
]);

const ARRAY_PUSH_FLAGS = new Set(['result', 'target', 'file', 'tag']);
const ARRAY_SPLIT_FLAGS = new Set(['results', 'targets', 'files', 'tags']);

const BOOLEAN_FLAGS = new Set([
  'json',
  'all',
  'done',
  'include-superseded',
  'include-deleted',
  'dry-run',
  'stdin',
  'skip-validation',
  'release',
  'pull',
  'push',
  'no-scrub',
  'force',
  'f',
  'help',
  'h',
]);

/**
 * Parses CLI arguments into { positionals, flags }.
 * Supports --key=value, --key value, repeatable array flags, and '-' positional stdin marker.
 */
function parseArgs(argv = [], command = '') {
  const positionals = [];
  const flags = {
    results: [],
    targets: [],
    files: [],
    tags: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '-') {
      positionals.push('-');
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      continue;
    }
    if (arg === '-f' || arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '-l') {
      if (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('-')) {
        flags.lang = String(argv[i + 1]);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('-l=')) {
      flags.lang = arg.slice('-l='.length);
      continue;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eqIdx = body.indexOf('=');
      const rawKey = eqIdx !== -1 ? body.slice(0, eqIdx) : body;
      const key = rawKey.toLowerCase();
      let val = eqIdx !== -1 ? body.slice(eqIdx + 1) : undefined;

      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = val === undefined ? true : val !== 'false' && val !== '0';
        continue;
      }

      if (ARRAY_PUSH_FLAGS.has(key)) {
        if (val === undefined && argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('-')) {
          val = String(argv[i + 1]);
          i += 1;
        }
        if (val !== undefined) {
          const targetProp = `${key}s`;
          flags[targetProp].push(val);
        }
        continue;
      }

      if (ARRAY_SPLIT_FLAGS.has(key)) {
        if (val === undefined && argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('-')) {
          val = String(argv[i + 1]);
          i += 1;
        }
        if (val !== undefined) {
          const parts = val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          flags[key].push(...parts);
        }
        continue;
      }

      if (VALUE_FLAGS.has(key)) {
        if (val === undefined) {
          if (key === 'status' && command === 'sync') {
            val = true;
          } else if (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')) {
            if (key === 'status' && String(argv[i + 1]).startsWith('-')) {
              val = true;
            } else {
              val = String(argv[i + 1]);
              i += 1;
            }
          } else if (key === 'status') {
            val = true;
          }
        }
        flags[key] = val;
        continue;
      }

      flags[key] = val === undefined ? true : val;
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, flags };
}

function readJsonFromStdin(tr) {
  const raw = fs.readFileSync(0, 'utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(tr('dbCli.invalidJsonStdin', { message: err.message }));
  }
}

function normalizeInputArray(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val.trim()];
  return [];
}

function updateMetaStorageProvider(rootDir, providerName) {
  const metaPath = path.join(rootDir, '.agents', '.acm-meta.json');
  if (!fs.existsSync(metaPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    parsed.storageProvider = providerName;
    fs.writeFileSync(metaPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  } catch (_) {
    // Ignore malformed .acm-meta.json
  }
}

function emitOutput(flags, payload, textLines) {
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const lines = Array.isArray(textLines) ? textLines : [textLines];
  for (const line of lines) {
    if (line !== undefined && line !== null) {
      console.log(line);
    }
  }
}

function emitError(flags, message) {
  if (flags.json) {
    console.error(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(message);
  }
}

function handleTaskCommand(rootDir, positionals, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.taskHelp'));
    return 0;
  }

  const sub = positionals[0] ? String(positionals[0]).toLowerCase() : 'list';
  const validSubs = new Set(['list', 'show', 'add', 'update', 'complete', 'lease']);
  if (!validSubs.has(sub)) {
    emitError(flags, tr('dbCli.unknownSubcommand', { command: 'task', subcommand: sub }));
    return 1;
  }

  const store = createMemoryStore(rootDir, { lang });
  try {
    if (sub === 'list') {
      const includeDone = Boolean(
        flags.all || flags.done || flags.status === 'done' || flags.status === '완료'
      );
      const tasks = store.listTasks({
        status: flags.status,
        includeDone,
      });
      if (flags.json) {
        emitOutput(flags, { provider: store.providerName, count: tasks.length, tasks });
        return 0;
      }
      console.log(
        tr('dbCli.taskListHeader', { provider: store.providerName, count: tasks.length })
      );
      if (tasks.length === 0) {
        console.log(`  ${tr('dbCli.noResults')}`);
        return 0;
      }
      for (const task of tasks) {
        const displayStatus = toDisplayStatus(task.status, lang);
        console.log(`- [${displayStatus}] ${task.code}: ${task.title}`);
      }
      return 0;
    }

    if (sub === 'show') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const task = store.getTask(id);
      if (!task) {
        emitError(flags, tr('dbCli.notFound', { id }));
        return 1;
      }
      emitOutput(flags, task, [
        `${task.code}: ${task.title} [${toDisplayStatus(task.status, lang)}]`,
        `  UID       : ${task.uid}`,
        `  Purpose   : ${task.purpose || '-'}`,
        `  Results   : ${task.results.length ? task.results.join(' | ') : '-'}`,
        `  Targets   : ${task.targets.length ? task.targets.join(', ') : '-'}`,
        `  Lease     : ${task.leaseOwner ? `${task.leaseOwner} (${task.leaseExpiresAt})` : '-'}`,
        `  CommitSHA : ${task.commitSha || '-'}`,
      ]);
      return 0;
    }

    if (sub === 'add') {
      const stdinData = flags.stdin ? readJsonFromStdin(tr) : {};
      const title =
        flags.title !== undefined
          ? String(flags.title)
          : stdinData.title !== undefined
            ? String(stdinData.title)
            : positionals.slice(1).join(' ').trim();

      const results =
        flags.results.length > 0 ? flags.results : normalizeInputArray(stdinData.results);
      const targets =
        flags.targets.length > 0 ? flags.targets : normalizeInputArray(stdinData.targets);

      const payload = {
        ...stdinData,
        ...(title ? { title } : {}),
        ...(flags.status !== undefined ? { status: flags.status } : {}),
        ...(flags.purpose !== undefined ? { purpose: flags.purpose } : {}),
        ...(results.length > 0 || stdinData.results !== undefined ? { results } : {}),
        ...(targets.length > 0 || stdinData.targets !== undefined ? { targets } : {}),
        ...(flags.group !== undefined ? { groupName: flags.group } : {}),
        ...(flags.owner !== undefined ? { owner: flags.owner } : {}),
      };

      const created = store.upsertTask(payload, {
        skipValidation: Boolean(flags['skip-validation']),
        lang,
      });
      emitOutput(
        flags,
        { ok: true, task: created },
        tr('dbCli.taskCreated', {
          code: created.code,
          title: created.title,
          status: toDisplayStatus(created.status, lang),
        })
      );
      return 0;
    }

    if (sub === 'update') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const existing = store.getTask(id);
      if (!existing) {
        emitError(flags, tr('dbCli.notFound', { id }));
        return 1;
      }

      const stdinData = flags.stdin ? readJsonFromStdin(tr) : {};
      const payload = {
        uid: existing.uid,
        code: existing.code,
        ...stdinData,
        ...(flags.title !== undefined ? { title: flags.title } : {}),
        ...(flags.status !== undefined ? { status: flags.status } : {}),
        ...(flags.purpose !== undefined ? { purpose: flags.purpose } : {}),
        ...(flags.results.length > 0 ? { results: flags.results } : {}),
        ...(flags.targets.length > 0 ? { targets: flags.targets } : {}),
        ...(flags.group !== undefined ? { groupName: flags.group } : {}),
        ...(flags.owner !== undefined ? { owner: flags.owner } : {}),
      };

      const updated = store.upsertTask(payload, {
        skipValidation: Boolean(flags['skip-validation']),
        lang,
      });
      emitOutput(
        flags,
        { ok: true, task: updated },
        tr('dbCli.taskUpdated', {
          code: updated.code,
          title: updated.title,
          status: toDisplayStatus(updated.status, lang),
        })
      );
      return 0;
    }

    if (sub === 'complete') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const sha = flags.sha !== undefined ? String(flags.sha) : null;
      const completed = store.completeTask(id, sha, { lang });
      emitOutput(
        flags,
        { ok: true, task: completed },
        tr('dbCli.taskCompleted', {
          code: completed.code,
          title: completed.title,
          sha: completed.commitSha || 'Non-Git',
        })
      );
      return 0;
    }

    if (sub === 'lease') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const stdinData = flags.stdin ? readJsonFromStdin(tr) : {};
      const owner = flags.owner || stdinData.owner || '';

      if (flags.release) {
        const res = store.releaseLease(id, owner, { force: Boolean(flags.force), lang });
        if (flags.json) {
          emitOutput(flags, { ok: res.released, ...res });
        } else if (res.released) {
          console.log(tr('dbCli.leaseReleased', { code: res.code }));
        } else {
          console.log(
            tr('dbCli.leaseBusy', {
              code: res.code,
              holder: res.holder,
              expiresAt: '-',
            })
          );
        }
        return res.released ? 0 : 1;
      }

      if (!owner) {
        emitError(flags, tr('dbCli.missingArg', { arg: '--owner' }));
        return 1;
      }
      const ttl = flags.ttl ? Number(flags.ttl) : 600;
      const res = store.acquireLease(id, owner, ttl, { lang });
      if (flags.json) {
        emitOutput(flags, { ok: res.acquired, ...res });
      } else if (res.acquired) {
        console.log(
          tr('dbCli.leaseAcquired', {
            code: res.code,
            owner: res.owner,
            expiresAt: res.expiresAt,
          })
        );
      } else {
        console.log(
          tr('dbCli.leaseBusy', {
            code: res.code,
            holder: res.holder,
            expiresAt: res.expiresAt,
          })
        );
      }
      return res.acquired ? 0 : 1;
    }
  } finally {
    store.close();
  }
  return 0;
}

function handlePatternCommand(rootDir, positionals, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.patternHelp'));
    return 0;
  }

  const sub = positionals[0] ? String(positionals[0]).toLowerCase() : 'list';
  const validSubs = new Set(['list', 'show', 'add']);
  if (!validSubs.has(sub)) {
    emitError(flags, tr('dbCli.unknownSubcommand', { command: 'pattern', subcommand: sub }));
    return 1;
  }

  const store = createMemoryStore(rootDir, { lang });
  try {
    if (sub === 'list') {
      const patterns = store.listPatterns({
        category: flags.category,
        includeSuperseded: Boolean(flags['include-superseded']),
      });
      if (flags.json) {
        emitOutput(flags, { provider: store.providerName, count: patterns.length, patterns });
        return 0;
      }
      console.log(
        tr('dbCli.patternListHeader', { provider: store.providerName, count: patterns.length })
      );
      if (patterns.length === 0) {
        console.log(`  ${tr('dbCli.noResults')}`);
        return 0;
      }
      for (const p of patterns) {
        console.log(`- ${p.code} [${p.category}] (v${p.version}): ${p.title}`);
      }
      return 0;
    }

    if (sub === 'show') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const pattern = store.getPattern(id);
      if (!pattern) {
        emitError(flags, tr('dbCli.notFound', { id }));
        return 1;
      }
      emitOutput(flags, pattern, [
        `${pattern.code} (v${pattern.version}): ${pattern.title}`,
        `  UID       : ${pattern.uid}`,
        `  Category  : ${pattern.category || '-'}`,
        `  Summary   : ${pattern.summary || '-'}`,
        `  Symptom   : ${pattern.symptom || '-'}`,
        `  Solution  : ${pattern.solution || '-'}`,
        `  Files     : ${pattern.relatedFiles.length ? pattern.relatedFiles.join(', ') : '-'}`,
        `  Tags      : ${pattern.tags.length ? pattern.tags.join(', ') : '-'}`,
      ]);
      return 0;
    }

    if (sub === 'add') {
      const stdinData = flags.stdin ? readJsonFromStdin(tr) : {};
      const title =
        flags.title !== undefined
          ? String(flags.title)
          : stdinData.title !== undefined
            ? String(stdinData.title)
            : positionals.slice(1).join(' ').trim();

      const relatedFiles =
        flags.files.length > 0 ? flags.files : normalizeInputArray(stdinData.relatedFiles);
      const tags = flags.tags.length > 0 ? flags.tags : normalizeInputArray(stdinData.tags);

      const payload = {
        ...stdinData,
        ...(title ? { title } : {}),
        ...(flags.category !== undefined ? { category: flags.category } : {}),
        ...(flags.summary !== undefined ? { summary: flags.summary } : {}),
        ...(flags.symptom !== undefined ? { symptom: flags.symptom } : {}),
        ...(flags.solution !== undefined ? { solution: flags.solution } : {}),
        ...(relatedFiles.length > 0 || stdinData.relatedFiles !== undefined ? { relatedFiles } : {}),
        ...(tags.length > 0 || stdinData.tags !== undefined ? { tags } : {}),
        ...(flags.supersedes !== undefined ? { supersedesCode: flags.supersedes } : {}),
        ...(flags.author !== undefined ? { author: flags.author } : {}),
      };

      const saved = store.upsertPattern(payload, { lang });
      emitOutput(
        flags,
        { ok: true, pattern: saved },
        tr('dbCli.patternSaved', {
          code: saved.code,
          version: saved.version,
          title: saved.title,
        })
      );
      return 0;
    }
  } finally {
    store.close();
  }
  return 0;
}

function handleAdrCommand(rootDir, positionals, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.adrHelp'));
    return 0;
  }

  const sub = positionals[0] ? String(positionals[0]).toLowerCase() : 'list';
  const validSubs = new Set(['list', 'show', 'add']);
  if (!validSubs.has(sub)) {
    emitError(flags, tr('dbCli.unknownSubcommand', { command: 'adr', subcommand: sub }));
    return 1;
  }

  const store = createMemoryStore(rootDir, { lang });
  try {
    if (sub === 'list') {
      const limit = flags.limit ? Number(flags.limit) : 0;
      const adrs = store.listAdrs({ limit });
      if (flags.json) {
        emitOutput(flags, { provider: store.providerName, count: adrs.length, adrs });
        return 0;
      }
      console.log(tr('dbCli.adrListHeader', { provider: store.providerName, count: adrs.length }));
      if (adrs.length === 0) {
        console.log(`  ${tr('dbCli.noResults')}`);
        return 0;
      }
      for (const a of adrs) {
        console.log(`- ${a.code} [${a.date}]: ${a.title}`);
      }
      return 0;
    }

    if (sub === 'show') {
      const id = positionals[1] || flags.id;
      if (!id) {
        emitError(flags, tr('dbCli.missingArg', { arg: '<idOrCode>' }));
        return 1;
      }
      const adr = store.getAdr(id);
      if (!adr) {
        emitError(flags, tr('dbCli.notFound', { id }));
        return 1;
      }
      emitOutput(flags, adr, [
        `${adr.code} [${adr.date}]: ${adr.title}`,
        `  UID      : ${adr.uid}`,
        `  Summary  : ${adr.summary || '-'}`,
        `  Area     : ${adr.relatedArea || '-'}`,
        `  Task     : ${adr.relatedTaskCode || '-'} (${adr.branch || 'main'})`,
        `  Context  : ${adr.context || '-'}`,
        `  Decision : ${adr.decision || '-'}`,
        `  Impact   : ${adr.impact || '-'}`,
      ]);
      return 0;
    }

    if (sub === 'add') {
      const stdinData = flags.stdin ? readJsonFromStdin(tr) : {};
      const title =
        flags.title !== undefined
          ? String(flags.title)
          : stdinData.title !== undefined
            ? String(stdinData.title)
            : positionals.slice(1).join(' ').trim();

      const payload = {
        ...stdinData,
        ...(title ? { title } : {}),
        ...(flags.date !== undefined ? { date: flags.date } : {}),
        ...(flags.summary !== undefined ? { summary: flags.summary } : {}),
        ...(flags.area !== undefined ? { relatedArea: flags.area } : {}),
        ...(flags.task !== undefined ? { relatedTaskCode: flags.task } : {}),
        ...(flags.branch !== undefined ? { branch: flags.branch } : {}),
        ...(flags.context !== undefined ? { context: flags.context } : {}),
        ...(flags.decision !== undefined ? { decision: flags.decision } : {}),
        ...(flags.impact !== undefined ? { impact: flags.impact } : {}),
        ...(flags.author !== undefined ? { author: flags.author } : {}),
      };

      const saved = store.upsertAdr(payload, { lang });
      emitOutput(
        flags,
        { ok: true, adr: saved },
        tr('dbCli.adrSaved', {
          code: saved.code,
          date: saved.date,
          title: saved.title,
        })
      );
      return 0;
    }
  } finally {
    store.close();
  }
  return 0;
}

function handleSearchCommand(rootDir, positionals, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.searchHelp'));
    return 0;
  }

  const query = flags.query !== undefined ? String(flags.query) : positionals.join(' ').trim();
  if (!query) {
    emitError(flags, tr('dbCli.missingArg', { arg: '<query>' }));
    return 1;
  }

  const kind = flags.kind || 'all';
  const limit = flags.limit ? Number(flags.limit) : 10;
  const tokenBudget = flags.budget
    ? Number(flags.budget)
    : flags['token-budget']
      ? Number(flags['token-budget'])
      : 0;

  const store = createMemoryStore(rootDir, { lang });
  try {
    const results = store.search(query, { kind, limit, tokenBudget });
    if (flags.json) {
      emitOutput(flags, { provider: store.providerName, query, count: results.length, results });
      return 0;
    }
    console.log(tr('dbCli.searchHeader', { query, count: results.length }));
    if (results.length === 0) {
      console.log(`  ${tr('dbCli.noResults')}`);
      return 0;
    }
    for (const r of results) {
      console.log(`- [${r.kind}] ${r.code}: ${r.title}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

function handleMigrateCommand(rootDir, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.migrateHelp'));
    return 0;
  }

  if (!flags.to) {
    emitError(flags, tr('dbCli.missingArg', { arg: '--to=<sqlite|markdown>' }));
    return 1;
  }
  const targetProvider = normalizeStorageProvider(flags.to);
  if (!targetProvider) {
    emitError(flags, tr('dbCli.invalidTargetProvider', { to: flags.to }));
    return 1;
  }

  const currentConfig = loadConfig(rootDir);
  const fromProvider = (currentConfig.storage && currentConfig.storage.provider) || 'markdown';
  const isDryRun = Boolean(flags['dry-run']);

  if (targetProvider === 'sqlite') {
    if (!isNodeSqliteAvailable()) {
      throw new Error(tr('storage.sqliteRequired', { version: process.version }));
    }

    if (isDryRun) {
      const { taskFile, completedFile } = resolveTaskFiles(rootDir);
      const counts = {
        tasks: parseTaskMdFile(taskFile).length,
        completedTasks: parseTaskCompletedMdFile(completedFile).length,
        patterns: parsePatternsFromMd(rootDir).length,
        adrs: parseAdrsFromMd(rootDir).length,
      };
      emitOutput(
        flags,
        { ok: true, dryRun: true, from: fromProvider, to: 'sqlite', ...counts },
        tr('dbCli.migrateDryRun', { from: fromProvider, to: 'sqlite', ...counts })
      );
      return 0;
    }

    const nextConfig = {
      ...currentConfig,
      language: currentConfig.language || lang,
      storage: {
        ...currentConfig.storage,
        provider: 'sqlite',
      },
    };
    const sqliteStore = createMemoryStore(rootDir, {
      provider: 'sqlite',
      config: nextConfig,
      skipProjection: true,
      lang,
    });
    let counts;
    try {
      counts = importMarkdownToStore(rootDir, sqliteStore);
    } finally {
      sqliteStore.close();
    }

    saveConfig(rootDir, nextConfig);
    updateMetaStorageProvider(rootDir, 'sqlite');

    emitOutput(
      flags,
      { ok: true, from: fromProvider, to: 'sqlite', ...counts },
      [
        fromProvider === 'sqlite' ? tr('dbCli.migrateAlready', { to: 'sqlite' }) : null,
        tr('dbCli.migrateDone', { to: 'sqlite', ...counts }),
      ]
    );
    return 0;
  }

  // targetProvider === 'markdown'
  const sourceStore = createMemoryStore(rootDir, {
    config: currentConfig,
    skipProjection: true,
    lang,
  });
  let counts;
  try {
    const activeCount = sourceStore.listTasks({ includeDone: false }).length;
    const totalTasks = sourceStore.listTasks({ includeDone: true }).length;
    counts = {
      tasks: activeCount,
      completedTasks: Math.max(0, totalTasks - activeCount),
      patterns: sourceStore.listPatterns().length,
      adrs: sourceStore.listAdrs().length,
    };

    if (isDryRun) {
      emitOutput(
        flags,
        { ok: true, dryRun: true, from: fromProvider, to: 'markdown', ...counts },
        tr('dbCli.migrateDryRun', { from: fromProvider, to: 'markdown', ...counts })
      );
      return 0;
    }

    exportStoreToMarkdown(rootDir, sourceStore, { lang });
  } finally {
    sourceStore.close();
  }

  const nextConfig = {
    ...currentConfig,
    language: currentConfig.language || lang,
    storage: {
      ...currentConfig.storage,
      provider: 'markdown',
    },
  };
  saveConfig(rootDir, nextConfig);
  updateMetaStorageProvider(rootDir, 'markdown');

  emitOutput(
    flags,
    { ok: true, from: fromProvider, to: 'markdown', ...counts },
    [
      fromProvider === 'markdown' ? tr('dbCli.migrateAlready', { to: 'markdown' }) : null,
      tr('dbCli.migrateDone', { to: 'markdown', ...counts }),
    ]
  );
  return 0;
}

function handleExportCommand(rootDir, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.exportHelp'));
    return 0;
  }

  const rawFmt = (flags.format || 'json').toLowerCase();
  const format = rawFmt === 'markdown' ? 'md' : rawFmt;
  if (format !== 'json' && format !== 'md') {
    emitError(flags, tr('dbCli.invalidFormat', { format: flags.format }));
    return 1;
  }

  const store = createMemoryStore(rootDir, { lang, skipProjection: true });
  try {
    if (format === 'md') {
      const targetOut = flags.out ? path.resolve(rootDir, flags.out) : rootDir;
      const files = exportStoreToMarkdown(targetOut, store, { lang });
      emitOutput(
        flags,
        { ok: true, format: 'md', out: targetOut, files },
        tr('dbCli.exportMdDone', { out: targetOut })
      );
      return 0;
    }

    const snapshot = store.exportSnapshot({ includeDeleted: Boolean(flags['include-deleted']) });
    if (flags.out) {
      const outPath = path.resolve(rootDir, flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
      emitOutput(
        flags,
        {
          ok: true,
          format: 'json',
          out: outPath,
          counts: {
            tasks: snapshot.tasks.length,
            patterns: snapshot.patterns.length,
            adrs: snapshot.adrs.length,
          },
        },
        tr('dbCli.exportJsonDone', { out: outPath })
      );
      return 0;
    }

    console.log(JSON.stringify(snapshot, null, 2));
    return 0;
  } finally {
    store.close();
  }
}

function handleImportCommand(rootDir, positionals, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.importHelp'));
    return 0;
  }

  const strategy = (flags.strategy || 'merge').toLowerCase();
  if (!['merge', 'skip', 'replace'].includes(strategy)) {
    emitError(flags, tr('dbCli.invalidStrategy', { strategy: flags.strategy }));
    return 1;
  }

  const fileArg = positionals[0] || (flags.files && flags.files[0]) || (flags.stdin ? '-' : null);
  if (!fileArg) {
    emitError(flags, tr('dbCli.missingArg', { arg: '<file>' }));
    return 1;
  }

  let snapshot;
  if (fileArg === '-' || flags.stdin) {
    snapshot = readJsonFromStdin(tr);
  } else {
    const resolvedFile = path.resolve(rootDir, fileArg);
    if (!fs.existsSync(resolvedFile)) {
      emitError(flags, tr('dbCli.fileNotFound', { file: resolvedFile }));
      return 1;
    }
    snapshot = JSON.parse(fs.readFileSync(resolvedFile, 'utf-8'));
  }

  const store = createMemoryStore(rootDir, { lang });
  try {
    const counts = store.importSnapshot(snapshot, strategy, { lang });
    emitOutput(
      flags,
      { ok: true, strategy, ...counts },
      tr('dbCli.importDone', { strategy, ...counts })
    );
    return 0;
  } finally {
    store.close();
  }
}

function handleSyncCommand(rootDir, flags, lang, tr) {
  if (flags.help) {
    console.log(tr('dbCli.syncHelp'));
    return 0;
  }

  let direction = 'both';
  if (flags.status) direction = 'status';
  else if (flags.pull && !flags.push) direction = 'pull';
  else if (flags.push && !flags.pull) direction = 'push';

  const result = syncWithGitOrphan(rootDir, {
    direction,
    dryRun: Boolean(flags['dry-run']),
    branch: flags.branch,
    remote: flags.remote,
    autoScrub: flags['no-scrub'] ? false : undefined,
    lang,
  });

  if (flags.json) {
    emitOutput(flags, result);
    return 0;
  }

  if (result.skipped) {
    console.log(tr('dbCli.syncNonGitSkip'));
    return 0;
  }

  if (direction === 'status') {
    console.log(
      tr('dbCli.syncStatusHeader', {
        branch: result.branch,
        remote: result.remote,
        localSha: result.localBranchSha || '-',
        remoteSha: result.remoteSha || '-',
        lastSync: result.lastSyncCommit || '-',
      })
    );
    return 0;
  }

  if (result.redactedCount > 0) {
    console.log(
      tr('dbCli.syncScrubWarn', {
        count: result.redactedCount,
        types: (result.redactedTypes || []).join(', '),
      })
    );
  }

  if (result.dryRun) {
    console.log(tr('dbCli.syncDryRun', result));
  } else {
    console.log(tr('dbCli.syncDone', result));
  }
  return 0;
}

/**
 * Executes a DB CLI command and returns a process exit code (0 or 1).
 */
function runDbCli(argv = process.argv.slice(2), rootDirOverride = null) {
  const rootDir = rootDirOverride
    ? path.resolve(rootDirOverride)
    : process.env.ACM_ROOT_DIR
      ? path.resolve(process.env.ACM_ROOT_DIR)
      : process.cwd();

  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(argv);
  const lang = resolveLanguage(rootDir, parsedLang);
  const tr = createTranslator(lang);

  if (invalidLang !== null) {
    console.error(tr('cli.unsupportedLang', { lang: invalidLang }));
    return 1;
  }

  const command = argv[0] ? String(argv[0]).toLowerCase() : '';
  const { positionals, flags } = parseArgs(argv.slice(1), command);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(tr('dbCli.help'));
    return 0;
  }

  try {
    switch (command) {
      case 'task':
        return handleTaskCommand(rootDir, positionals, flags, lang, tr);
      case 'pattern':
        return handlePatternCommand(rootDir, positionals, flags, lang, tr);
      case 'adr':
        return handleAdrCommand(rootDir, positionals, flags, lang, tr);
      case 'search':
        return handleSearchCommand(rootDir, positionals, flags, lang, tr);
      case 'migrate':
        return handleMigrateCommand(rootDir, flags, lang, tr);
      case 'export':
        return handleExportCommand(rootDir, flags, lang, tr);
      case 'import':
        return handleImportCommand(rootDir, positionals, flags, lang, tr);
      case 'sync':
        return handleSyncCommand(rootDir, flags, lang, tr);
      default:
        emitError(flags, tr('dbCli.unknownCommand', { command }));
        return 1;
    }
  } catch (err) {
    emitError(flags, tr('dbCli.execError', { message: err.message }));
    return 1;
  }
}

if (require.main === module) {
  const code = runDbCli(process.argv.slice(2));
  process.exit(code);
}

module.exports = {
  runDbCli,
  parseArgs,
};

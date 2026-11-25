/**
 * scripts/storage/git-orphan-sync.cjs
 *
 * Git orphan branch ('acm-memory') collaboration sync engine using pure Git Plumbing
 * (temporary GIT_INDEX_FILE, hash-object, update-index, write-tree, commit-tree, update-ref)
 * so the main branch history and developer working tree remain 100% untouched.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { checkGitEnvironment } = require('../check-git.cjs');
const { loadConfig } = require('./config.cjs');
const { createMemoryStore } = require('./memory-store.cjs');
const { projectTasksToMarkdown } = require('./markdown-bridge.cjs');
const { generateShortCode } = require('./id-utils.cjs');
const { scrubRecords } = require('./secret-scrubber.cjs');
const { t } = require('../i18n.cjs');

function isValidRefName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock') ||
    trimmed.includes('..') ||
    trimmed.includes('//') ||
    trimmed.includes('@{') ||
    /[\x00-\x1f\x7f\\~^:?*[\]\s]/.test(trimmed)
  ) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed);
}

function runGit(args, options = {}) {
  const { cwd = process.cwd(), input = undefined, env = {}, ignoreError = false } = options;
  const res = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf-8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      ...env,
    },
  });

  const stdout = res.stdout ? String(res.stdout) : '';
  const stderr = res.stderr ? String(res.stderr) : '';
  if (res.error || res.status !== 0) {
    if (ignoreError) {
      return {
        ok: false,
        status: res.status,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    }
    const detail = res.error ? res.error.message : stderr.trim() || stdout.trim();
    throw new Error(`git ${args[0] || ''} failed (${res.status}): ${detail}`);
  }

  return {
    ok: true,
    status: 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function resolveRef(rootDir, refName) {
  const res = runGit(['rev-parse', '--verify', '--quiet', refName], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok && res.stdout ? res.stdout.trim() : null;
}

function hasRemote(rootDir, remoteName) {
  const res = runGit(['remote', 'get-url', remoteName], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok && Boolean(res.stdout);
}

function fetchRemoteBranch(rootDir, remoteName, branch) {
  if (!hasRemote(rootDir, remoteName)) {
    return { remoteConfigured: false, remoteRefExists: false, remoteSha: null };
  }

  const lsRes = runGit(['ls-remote', '--heads', remoteName, `refs/heads/${branch}`], {
    cwd: rootDir,
    ignoreError: true,
  });
  if (!lsRes.ok) {
    return {
      remoteConfigured: true,
      remoteRefExists: false,
      remoteSha: null,
      warning: lsRes.stderr || 'ls-remote failed',
    };
  }
  if (!lsRes.stdout) {
    return { remoteConfigured: true, remoteRefExists: false, remoteSha: null };
  }

  const fetchRes = runGit(
    ['fetch', '--no-tags', remoteName, `refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`],
    { cwd: rootDir, ignoreError: true }
  );
  if (!fetchRes.ok) {
    return {
      remoteConfigured: true,
      remoteRefExists: false,
      remoteSha: resolveRef(rootDir, `refs/remotes/${remoteName}/${branch}`),
      warning: fetchRes.stderr || 'fetch failed',
    };
  }

  const remoteSha = resolveRef(rootDir, `refs/remotes/${remoteName}/${branch}`);
  return {
    remoteConfigured: true,
    remoteRefExists: Boolean(remoteSha),
    remoteSha,
  };
}

function parseJsonl(text) {
  if (!text || !text.trim()) return [];
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    items.push(JSON.parse(trimmed));
  }
  return items;
}

function serializeJsonl(records = []) {
  const sorted = [...records].sort((a, b) => String(a.uid || '').localeCompare(String(b.uid || '')));
  if (sorted.length === 0) return '';
  return sorted.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function readFileFromCommit(rootDir, commitSha, relPath) {
  if (!commitSha) return null;
  const res = runGit(['show', `${commitSha}:${relPath}`], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok ? res.stdout : null;
}

function readSnapshotFromRef(rootDir, commitSha) {
  if (!commitSha) {
    return { patterns: [], adrs: [], tasks: [], manifest: null };
  }
  const patternsRaw = readFileFromCommit(rootDir, commitSha, 'patterns.jsonl');
  const adrsRaw = readFileFromCommit(rootDir, commitSha, 'adrs.jsonl');
  const tasksRaw = readFileFromCommit(rootDir, commitSha, 'tasks-archived.jsonl');
  const manifestRaw = readFileFromCommit(rootDir, commitSha, 'manifest.json');

  let manifest = null;
  if (manifestRaw) {
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (_) {
      manifest = null;
    }
  }

  return {
    patterns: parseJsonl(patternsRaw || ''),
    adrs: parseJsonl(adrsRaw || ''),
    tasks: parseJsonl(tasksRaw || ''),
    manifest,
  };
}

/**
 * Writes a commit directly onto refs/heads/<branch> using an isolated temporary GIT_INDEX_FILE.
 * Never checks out or modifies the main working tree or .git/index.
 */
function writeOrphanCommit(rootDir, { branch, parentShas = [], filesMap, message }) {
  const tempIndexPath = path.join(
    os.tmpdir(),
    `acm-orphan-idx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    const tempEnv = { GIT_INDEX_FILE: tempIndexPath };
    const sortedPaths = Object.keys(filesMap).sort();

    for (const relPath of sortedPaths) {
      const content = String(filesMap[relPath] !== undefined ? filesMap[relPath] : '');
      const hashRes = runGit(['hash-object', '-w', '--stdin'], {
        cwd: rootDir,
        input: content,
      });
      const blobSha = hashRes.stdout.trim();
      runGit(['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`], {
        cwd: rootDir,
        env: tempEnv,
      });
    }

    const treeRes = runGit(['write-tree'], { cwd: rootDir, env: tempEnv });
    const treeSha = treeRes.stdout.trim();

    const uniqueParents = Array.from(new Set(parentShas.filter(Boolean)));
    const effectiveParents = [];
    for (const candidate of uniqueParents) {
      const isAncestorOfOther = uniqueParents.some(
        (other) =>
          other !== candidate &&
          runGit(['merge-base', '--is-ancestor', candidate, other], {
            cwd: rootDir,
            ignoreError: true,
          }).ok
      );
      if (!isAncestorOfOther) {
        effectiveParents.push(candidate);
      }
    }

    const commitArgs = ['commit-tree', treeSha];
    for (const pSha of effectiveParents) {
      commitArgs.push('-p', pSha);
    }

    const commitRes = runGit(commitArgs, {
      cwd: rootDir,
      input: message || 'acm-sync: update shared memory',
    });
    const commitSha = commitRes.stdout.trim();

    runGit(['update-ref', `refs/heads/${branch}`, commitSha], { cwd: rootDir });
    return commitSha;
  } finally {
    if (fs.existsSync(tempIndexPath)) {
      try {
        fs.unlinkSync(tempIndexPath);
      } catch (_) {}
    }
  }
}

function compareTimestamp(a, b) {
  const ta = Date.parse(a || '') || 0;
  const tb = Date.parse(b || '') || 0;
  if (ta !== tb) return ta - tb;
  return String(a || '').localeCompare(String(b || ''));
}

/**
 * Merges local and remote record arrays structurally by UID (LWW on updatedAt)
 * and resolves rare code collisions deterministically by issuing non-colliding short-ids.
 */
function mergeRecordSet(localRecords = [], remoteRecords = [], prefix) {
  const localMap = new Map();
  for (const r of localRecords) {
    if (r && r.uid) localMap.set(r.uid, { ...r });
  }

  const remoteMap = new Map();
  for (const r of remoteRecords) {
    if (r && r.uid) remoteMap.set(r.uid, { ...r });
  }

  const allUids = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const merged = [];
  let pulledCount = 0;

  for (const uid of allUids) {
    const loc = localMap.get(uid);
    const rem = remoteMap.get(uid);
    if (loc && !rem) {
      merged.push(loc);
    } else if (!loc && rem) {
      pulledCount += 1;
      merged.push({ ...rem, provenance: rem.provenance || 'shared' });
    } else {
      const cmp = compareTimestamp(rem.updatedAt, loc.updatedAt);
      if (cmp > 0) {
        pulledCount += 1;
        merged.push({ ...rem, provenance: rem.provenance || 'shared' });
      } else if (cmp < 0) {
        merged.push(loc);
      } else {
        // Tie-break deterministically
        const remKey = `${rem.deletedAt ? '1' : '0'}:${rem.version || 1}:${JSON.stringify(rem)}`;
        const locKey = `${loc.deletedAt ? '1' : '0'}:${loc.version || 1}:${JSON.stringify(loc)}`;
        if (remKey > locKey) {
          pulledCount += 1;
          merged.push(rem);
        } else {
          merged.push(loc);
        }
      }
    }
  }

  // Deterministic code collision resolution across distinct UIDs
  merged.sort((a, b) => {
    const cCmp = compareTimestamp(a.createdAt, b.createdAt);
    if (cCmp !== 0) return cCmp;
    return String(a.uid).localeCompare(String(b.uid));
  });

  const usedCodes = new Set();
  const renumberedUids = new Set();
  let conflictsResolved = 0;
  const resolved = [];

  for (const rec of merged) {
    const rawCode = String(rec.code || '').trim();
    const upperCode = rawCode.toUpperCase();

    if (rawCode && !usedCodes.has(upperCode)) {
      usedCodes.add(upperCode);
      resolved.push(rec);
    } else {
      let nextCode = generateShortCode(prefix);
      while (usedCodes.has(nextCode.toUpperCase())) {
        nextCode = generateShortCode(prefix);
      }
      usedCodes.add(nextCode.toUpperCase());
      renumberedUids.add(rec.uid);
      conflictsResolved += 1;
      resolved.push({
        ...rec,
        code: nextCode,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return {
    records: resolved,
    pulledCount,
    conflictsResolved,
    renumberedUids,
  };
}

function hasSnapshotDiff(existingSnapshot, nextFilesMap) {
  if (!existingSnapshot) return true;
  const oldPatterns = serializeJsonl(existingSnapshot.patterns || []);
  const oldAdrs = serializeJsonl(existingSnapshot.adrs || []);
  const oldTasks = serializeJsonl(existingSnapshot.tasks || []);
  return (
    oldPatterns !== nextFilesMap['patterns.jsonl'] ||
    oldAdrs !== nextFilesMap['adrs.jsonl'] ||
    oldTasks !== nextFilesMap['tasks-archived.jsonl']
  );
}

/**
 * Applies merged records back into SQLite inside a single transaction,
 * avoiding UNIQUE(code) collisions by temporarily parking renumbered local codes.
 */
function applyMergedToSqlite(rootDir, store, { tasks, patterns, adrs }, { lang, markdownProjection }) {
  store._runInTx(() => {
    const incomingTaskUids = new Set(tasks.map((item) => item.uid));
    const existingTasks = store.listTasks({ includeDone: true, includeDeleted: true });
    for (const ex of existingTasks) {
      const target = tasks.find((tItem) => tItem.uid === ex.uid);
      if (target && target.code !== ex.code) {
        store.db
          .prepare('UPDATE tasks SET code = ? WHERE uid = ?')
          .run(`__acm_tmp__${ex.uid}`, ex.uid);
      } else if (!incomingTaskUids.has(ex.uid)) {
        // Keep untouched local task unless code collides with incoming
        const colliding = tasks.find(
          (tItem) => tItem.uid !== ex.uid && String(tItem.code).toUpperCase() === String(ex.code).toUpperCase()
        );
        if (colliding) {
          store.db
            .prepare('UPDATE tasks SET code = ? WHERE uid = ?')
            .run(`__acm_tmp__${ex.uid}`, ex.uid);
        }
      }
    }

    const existingPatterns = store.listPatterns({ includeSuperseded: true, includeDeleted: true });
    for (const ex of existingPatterns) {
      const target = patterns.find((pItem) => pItem.uid === ex.uid);
      const colliding = patterns.find(
        (pItem) => pItem.uid !== ex.uid && String(pItem.code).toUpperCase() === String(ex.code).toUpperCase()
      );
      if ((target && target.code !== ex.code) || colliding) {
        store.db
          .prepare('UPDATE patterns SET code = ? WHERE uid = ?')
          .run(`__acm_tmp__${ex.uid}`, ex.uid);
      }
    }

    const existingAdrs = store.listAdrs({ includeDeleted: true });
    for (const ex of existingAdrs) {
      const target = adrs.find((aItem) => aItem.uid === ex.uid);
      const colliding = adrs.find(
        (aItem) => aItem.uid !== ex.uid && String(aItem.code).toUpperCase() === String(ex.code).toUpperCase()
      );
      if ((target && target.code !== ex.code) || colliding) {
        store.db
          .prepare('UPDATE adrs SET code = ? WHERE uid = ?')
          .run(`__acm_tmp__${ex.uid}`, ex.uid);
      }
    }

    for (const taskItem of tasks) {
      store.upsertTask(taskItem, { skipValidation: true, skipProjection: true });
    }

    const patternUidSet = new Set(patterns.map((p) => p.uid));
    const sortedPatterns = [...patterns].sort((a, b) => {
      const va = Number(a.version) || 1;
      const vb = Number(b.version) || 1;
      if (va !== vb) return va - vb;
      return String(a.uid).localeCompare(String(b.uid));
    });
    for (const patItem of sortedPatterns) {
      const safePattern =
        patItem.supersedesUid && !patternUidSet.has(patItem.supersedesUid)
          ? { ...patItem, supersedesUid: null }
          : patItem;
      store.upsertPattern(safePattern);
    }

    for (const adrItem of adrs) {
      store.upsertAdr(adrItem);
    }
  });

  if (markdownProjection) {
    projectTasksToMarkdown(rootDir, store, { lang });
  }
}

/**
 * Synchronizes shared memory with the Git orphan branch ('acm-memory').
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {object} [options={}]
 * @returns {object}
 */
function syncWithGitOrphan(rootDir = process.cwd(), options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const cfg = loadConfig(resolvedRoot);
  const lang = options.lang || cfg.language || 'en';
  const direction = options.direction || 'both';
  const dryRun = Boolean(options.dryRun);
  const branch = String(options.branch || (cfg.sync && cfg.sync.branch) || 'acm-memory').trim();
  const remote = String(options.remote || (cfg.sync && cfg.sync.remote) || 'origin').trim();
  const autoScrub =
    options.autoScrub !== undefined
      ? Boolean(options.autoScrub)
      : cfg.sync && cfg.sync.autoScrub !== false;
  const shareCompletedTasks =
    options.shareCompletedTasks !== undefined
      ? Boolean(options.shareCompletedTasks)
      : cfg.sync && cfg.sync.shareCompletedTasks !== false;

  if (!isValidRefName(branch)) {
    throw new Error(t('dbCli.syncInvalidRef', { ref: branch }, lang));
  }
  if (!isValidRefName(remote)) {
    throw new Error(t('dbCli.syncInvalidRef', { ref: remote }, lang));
  }

  const gitEnv = checkGitEnvironment(resolvedRoot);
  if (!gitEnv.available || !gitEnv.isRepo) {
    return {
      ok: true,
      skipped: true,
      reason: 'non-git',
      direction,
      branch,
      remote,
    };
  }

  if (!cfg.storage || cfg.storage.provider !== 'sqlite') {
    throw new Error(t('dbCli.syncRequiresSqlite', {}, lang));
  }

  const store = createMemoryStore(resolvedRoot, {
    provider: 'sqlite',
    config: cfg,
    skipProjection: true,
    lang,
  });

  try {
    const localBranchSha = resolveRef(resolvedRoot, `refs/heads/${branch}`);

    if (direction === 'status') {
      const remoteConfigured = hasRemote(resolvedRoot, remote);
      const remoteSha = remoteConfigured
        ? resolveRef(resolvedRoot, `refs/remotes/${remote}/${branch}`)
        : null;
      const stats = store.getStats();
      return {
        ok: true,
        skipped: false,
        direction: 'status',
        branch,
        remote,
        remoteConfigured,
        localBranchSha,
        remoteSha,
        lastSyncCommit: store.getLastSyncCommit(),
        sharedCounts: {
          patterns: stats.patterns.total,
          adrs: stats.adrs.total,
          completedTasks: stats.tasks.done,
        },
        history: store.getSyncHistory(5),
      };
    }

    const fetchInfo = fetchRemoteBranch(resolvedRoot, remote, branch);
    const remoteSha = fetchInfo.remoteSha;
    const baselineSha = remoteSha || localBranchSha;

    if (direction === 'pull' && !baselineSha) {
      return {
        ok: true,
        skipped: false,
        dryRun,
        direction,
        branch,
        remote,
        commitSha: null,
        remoteSha: null,
        pulled: 0,
        pushed: 0,
        conflictsResolved: 0,
        redactedCount: 0,
        redactedTypes: [],
      };
    }

    const remoteSnap = readSnapshotFromRef(resolvedRoot, baselineSha);
    const localSnap = store.exportSnapshot({ includeDeleted: true });

    const localSharedPatterns = (localSnap.patterns || []).filter((p) => p.scope !== 'local');
    const localSharedAdrs = (localSnap.adrs || []).filter((a) => a.scope !== 'local');
    const localAllTasks = localSnap.tasks || [];

    const mergedPatRes = mergeRecordSet(localSharedPatterns, remoteSnap.patterns, 'P');
    const mergedAdrRes = mergeRecordSet(localSharedAdrs, remoteSnap.adrs, 'LOG');
    const mergedTaskRes = mergeRecordSet(localAllTasks, remoteSnap.tasks, 'TSK');

    const totalPulled =
      mergedPatRes.pulledCount + mergedAdrRes.pulledCount + mergedTaskRes.pulledCount;
    const totalConflicts =
      mergedPatRes.conflictsResolved +
      mergedAdrRes.conflictsResolved +
      mergedTaskRes.conflictsResolved;

    const outboundTasksRaw = mergedTaskRes.records.filter((task) =>
      shareCompletedTasks ? task.status === 'done' || task.scope === 'shared' : task.scope === 'shared'
    );

    let outboundPatterns = mergedPatRes.records;
    let outboundAdrs = mergedAdrRes.records;
    let outboundTasks = outboundTasksRaw;
    let redactedCount = 0;
    const redactedTypesSet = new Set();

    if (autoScrub && (direction === 'push' || direction === 'both')) {
      const pScrub = scrubRecords(outboundPatterns);
      const aScrub = scrubRecords(outboundAdrs);
      const tScrub = scrubRecords(outboundTasks);
      outboundPatterns = pScrub.records;
      outboundAdrs = aScrub.records;
      outboundTasks = tScrub.records;
      redactedCount = pScrub.redactedCount + aScrub.redactedCount + tScrub.redactedCount;
      [...pScrub.types, ...aScrub.types, ...tScrub.types].forEach((tp) => redactedTypesSet.add(tp));
    }

    if (!dryRun && (totalPulled > 0 || totalConflicts > 0)) {
      applyMergedToSqlite(
        resolvedRoot,
        store,
        {
          tasks: mergedTaskRes.records,
          patterns: mergedPatRes.records,
          adrs: mergedAdrRes.records,
        },
        {
          lang,
          markdownProjection: cfg.storage.markdownProjection !== false,
        }
      );
    }

    if (direction === 'pull') {
      if (!dryRun && totalPulled > 0) {
        store.recordSyncLog({
          direction: 'pull',
          provider: 'git-orphan',
          commitRef: baselineSha,
          recordsPushed: 0,
          recordsPulled: totalPulled,
          conflictsResolved: totalConflicts,
        });
      }
      return {
        ok: true,
        skipped: false,
        dryRun,
        direction,
        branch,
        remote,
        commitSha: baselineSha,
        remoteSha,
        pulled: totalPulled,
        pushed: 0,
        conflictsResolved: totalConflicts,
        redactedCount: 0,
        redactedTypes: [],
      };
    }

    const patternsJsonl = serializeJsonl(outboundPatterns);
    const adrsJsonl = serializeJsonl(outboundAdrs);
    const tasksJsonl = serializeJsonl(outboundTasks);
    const manifestObj = {
      schemaVersion: 1,
      branch,
      updatedAt: new Date().toISOString(),
      counts: {
        patterns: outboundPatterns.length,
        adrs: outboundAdrs.length,
        tasksArchived: outboundTasks.length,
      },
    };
    const nextFilesMap = {
      'manifest.json': JSON.stringify(manifestObj, null, 2) + '\n',
      'patterns.jsonl': patternsJsonl,
      'adrs.jsonl': adrsJsonl,
      'tasks-archived.jsonl': tasksJsonl,
    };

    const localSnapRef = readSnapshotFromRef(resolvedRoot, localBranchSha);
    const needsCommit = !localBranchSha || hasSnapshotDiff(localSnapRef, nextFilesMap);
    const pushedCount = outboundPatterns.length + outboundAdrs.length + outboundTasks.length;

    let finalCommitSha = localBranchSha;
    if (!dryRun) {
      if (needsCommit) {
        finalCommitSha = writeOrphanCommit(resolvedRoot, {
          branch,
          parentShas: [localBranchSha, remoteSha],
          filesMap: nextFilesMap,
          message: `acm-sync: update shared memory (patterns=${outboundPatterns.length}, adrs=${outboundAdrs.length}, tasks=${outboundTasks.length})`,
        });
      }

      if (fetchInfo.remoteConfigured && finalCommitSha && finalCommitSha !== remoteSha) {
        runGit(['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], {
          cwd: resolvedRoot,
        });
      }

      store.recordSyncLog({
        direction,
        provider: 'git-orphan',
        commitRef: finalCommitSha,
        recordsPushed: needsCommit || finalCommitSha !== remoteSha ? pushedCount : 0,
        recordsPulled: totalPulled,
        conflictsResolved: totalConflicts,
      });
    }

    return {
      ok: true,
      skipped: false,
      dryRun,
      direction,
      branch,
      remote,
      remoteConfigured: fetchInfo.remoteConfigured,
      commitSha: finalCommitSha,
      remoteSha,
      pulled: totalPulled,
      pushed: needsCommit || finalCommitSha !== remoteSha ? pushedCount : 0,
      conflictsResolved: totalConflicts,
      redactedCount,
      redactedTypes: Array.from(redactedTypesSet),
    };
  } finally {
    store.close();
  }
}

module.exports = {
  isValidRefName,
  runGit,
  resolveRef,
  hasRemote,
  readSnapshotFromRef,
  writeOrphanCommit,
  mergeRecordSet,
  syncWithGitOrphan,
};

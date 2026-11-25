/**
 * scripts/acm/backup-git.cjs
 *
 * Pure Git Plumbing engine for storing and restoring ACM backup archives
 * in an isolated orphan branch (default: 'acm-backups') without touching
 * the main branch history or working tree.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { checkGitEnvironment } = require('./check-git.cjs');
const { computeSha256, normalizeBackupFormat } = require('./backup-archive.cjs');

const DEFAULT_BACKUP_BRANCH = 'acm-backups';
const DEFAULT_BACKUP_REMOTE = 'origin';
const DEFAULT_MAX_RETAINED = 10;

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

function runGitText(args, options = {}) {
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

function runGitBinary(args, options = {}) {
  const { cwd = process.cwd(), input = undefined, env = {}, ignoreError = false } = options;
  const res = spawnSync('git', args, {
    cwd,
    input,
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      ...env,
    },
  });

  const stdout = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || '');
  const stderr = res.stderr ? res.stderr.toString('utf-8') : '';
  if (res.error || res.status !== 0) {
    if (ignoreError) {
      return {
        ok: false,
        status: res.status,
        stdout,
        stderr: stderr.trim(),
      };
    }
    const detail = res.error ? res.error.message : stderr.trim() || `exit ${res.status}`;
    throw new Error(`git ${args[0] || ''} failed (${res.status}): ${detail}`);
  }

  return {
    ok: true,
    status: 0,
    stdout,
    stderr: stderr.trim(),
  };
}

function resolveRef(rootDir, refName) {
  const res = runGitText(['rev-parse', '--verify', '--quiet', refName], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok && res.stdout ? res.stdout.trim() : null;
}

function hasRemote(rootDir, remoteName) {
  const res = runGitText(['remote', 'get-url', remoteName], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok && Boolean(res.stdout);
}

function fetchBackupBranch(rootDir, remoteName, branch) {
  if (!hasRemote(rootDir, remoteName)) {
    return { remoteConfigured: false, remoteRefExists: false, remoteSha: null };
  }

  const lsRes = runGitText(['ls-remote', '--heads', remoteName, `refs/heads/${branch}`], {
    cwd: rootDir,
    ignoreError: true,
  });
  if (!lsRes.ok) {
    return {
      remoteConfigured: true,
      remoteRefExists: false,
      remoteSha: resolveRef(rootDir, `refs/remotes/${remoteName}/${branch}`),
      warning: lsRes.stderr || 'ls-remote failed',
    };
  }
  if (!lsRes.stdout) {
    return { remoteConfigured: true, remoteRefExists: false, remoteSha: null };
  }

  const fetchRes = runGitText(
    ['fetch', '--no-tags', remoteName, `refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`],
    { cwd: rootDir, ignoreError: true }
  );
  const remoteSha = resolveRef(rootDir, `refs/remotes/${remoteName}/${branch}`);
  if (!fetchRes.ok) {
    return {
      remoteConfigured: true,
      remoteRefExists: Boolean(remoteSha),
      remoteSha,
      warning: fetchRes.stderr || 'fetch failed',
    };
  }

  return {
    remoteConfigured: true,
    remoteRefExists: Boolean(remoteSha),
    remoteSha,
  };
}

function hashBufferObject(rootDir, buffer) {
  const inputBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const res = runGitBinary(['hash-object', '-w', '--stdin'], {
    cwd: rootDir,
    input: inputBuf,
  });
  return res.stdout.toString('utf-8').trim();
}

function readBlobBuffer(rootDir, commitSha, relPath) {
  if (!commitSha) return null;
  const res = runGitBinary(['cat-file', '-p', `${commitSha}:${relPath}`], {
    cwd: rootDir,
    ignoreError: true,
  });
  return res.ok ? res.stdout : null;
}

function readIndexFromCommit(rootDir, commitSha) {
  if (!commitSha) return { version: 1, backups: [] };
  const buf = readBlobBuffer(rootDir, commitSha, 'backups-index.json');
  if (!buf) return { version: 1, backups: [] };
  try {
    const parsed = JSON.parse(buf.toString('utf-8'));
    const list = Array.isArray(parsed && parsed.backups) ? parsed.backups : [];
    return { version: parsed.version || 1, backups: list };
  } catch (_) {
    return { version: 1, backups: [] };
  }
}

function readArchiveTreeMap(rootDir, commitSha) {
  const map = new Map();
  if (!commitSha) return map;
  const res = runGitText(['ls-tree', commitSha, 'archives'], {
    cwd: rootDir,
    ignoreError: true,
  });
  if (!res.ok || !res.stdout) return map;

  // git ls-tree may list just 'archives' tree; recurse into archives/
  const treeRes = runGitText(['ls-tree', '-r', commitSha, 'archives'], {
    cwd: rootDir,
    ignoreError: true,
  });
  if (!treeRes.ok || !treeRes.stdout) return map;

  for (const line of treeRes.stdout.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/i);
    if (m) {
      map.set(m[3].trim(), m[2].trim());
    }
  }
  return map;
}

function selectNonAncestorParents(rootDir, candidates = []) {
  const uniqueParents = Array.from(new Set(candidates.filter(Boolean)));
  const effective = [];
  for (const candidate of uniqueParents) {
    const isAncestorOfOther = uniqueParents.some(
      (other) =>
        other !== candidate &&
        runGitText(['merge-base', '--is-ancestor', candidate, other], {
          cwd: rootDir,
          ignoreError: true,
        }).ok
    );
    if (!isAncestorOfOther) {
      effective.push(candidate);
    }
  }
  return effective;
}

function writeBackupOrphanCommit(rootDir, { branch, parentShas = [], entriesByPath, message }) {
  const tempIndexPath = path.join(
    os.tmpdir(),
    `acm-backup-idx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    const tempEnv = { GIT_INDEX_FILE: tempIndexPath };
    const sortedPaths = Object.keys(entriesByPath).sort();

    for (const relPath of sortedPaths) {
      const item = entriesByPath[relPath];
      const blobSha =
        typeof item === 'string'
          ? item
          : hashBufferObject(rootDir, Buffer.isBuffer(item) ? item : Buffer.from(String(item || ''), 'utf-8'));

      runGitText(['update-index', '--add', '--cacheinfo', `100644,${blobSha},${relPath}`], {
        cwd: rootDir,
        env: tempEnv,
      });
    }

    const treeSha = runGitText(['write-tree'], { cwd: rootDir, env: tempEnv }).stdout.trim();
    const effectiveParents = selectNonAncestorParents(rootDir, parentShas);
    const commitArgs = ['commit-tree', treeSha];
    for (const pSha of effectiveParents) {
      commitArgs.push('-p', pSha);
    }

    const commitSha = runGitText(commitArgs, {
      cwd: rootDir,
      input: message || 'acm-backup: store backup archive',
    }).stdout.trim();

    runGitText(['update-ref', `refs/heads/${branch}`, commitSha], { cwd: rootDir });
    return commitSha;
  } finally {
    if (fs.existsSync(tempIndexPath)) {
      try {
        fs.unlinkSync(tempIndexPath);
      } catch (_) {}
    }
  }
}

/**
 * Stores a backup archive buffer on an isolated Git orphan branch ('acm-backups'),
 * maintains backups-index.json with SHA-256 checksums, prunes old archives beyond maxRetained,
 * and pushes to remote if configured.
 */
function pushBackupToGit(targetDir, options = {}) {
  const resolvedRoot = path.resolve(targetDir || process.cwd());
  const branch = String(options.branch || DEFAULT_BACKUP_BRANCH).trim();
  const remote = String(options.remote || DEFAULT_BACKUP_REMOTE).trim();
  const maxRetained =
    Number.isInteger(options.maxRetained) && options.maxRetained > 0
      ? options.maxRetained
      : DEFAULT_MAX_RETAINED;
  const dryRun = Boolean(options.dryRun);
  const archiveBuffer = Buffer.isBuffer(options.archiveBuffer)
    ? options.archiveBuffer
    : Buffer.from(options.archiveBuffer || '');
  const filename = path.posix.basename(String(options.filename || ''));
  const format = normalizeBackupFormat(options.format) || 'zip';
  const metadata = options.metadata && typeof options.metadata === 'object' ? options.metadata : {};

  if (!isValidRefName(branch)) {
    throw new Error(`Invalid Git backup branch name: "${branch}"`);
  }
  if (!isValidRefName(remote)) {
    throw new Error(`Invalid Git backup remote name: "${remote}"`);
  }
  if (!filename) {
    throw new Error('Backup filename is required for Git backup');
  }

  const gitEnv = checkGitEnvironment(resolvedRoot);
  if (!gitEnv.available || !gitEnv.isRepo) {
    throw new Error('Git repository is required for Git backup');
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      branch,
      remote,
      filename,
      format,
      sizeBytes: archiveBuffer.length,
    };
  }

  const fetchInfo = fetchBackupBranch(resolvedRoot, remote, branch);
  const localSha = resolveRef(resolvedRoot, `refs/heads/${branch}`);
  const remoteSha = fetchInfo.remoteSha;
  const baselineSha = remoteSha || localSha;

  const existingIndex = readIndexFromCommit(resolvedRoot, baselineSha);
  const existingTreeBlobs = readArchiveTreeMap(resolvedRoot, baselineSha);
  const sha256 = computeSha256(archiveBuffer);
  const createdAt = new Date().toISOString();

  const newEntry = {
    id: filename.replace(/(\.tar\.gz|\.tgz|\.zip)$/i, ''),
    filename,
    format,
    sha256,
    sizeBytes: archiveBuffer.length,
    createdAt,
    storageProvider: metadata.storageProvider || null,
    isLegacy: Boolean(metadata.isLegacy),
    fileCount: Number(metadata.fileCount || 0),
  };

  // Deduplicate by filename and retain up to maxRetained newest backups
  const mergedEntries = [newEntry, ...existingIndex.backups.filter((b) => b && b.filename !== filename)];
  const retainedEntries = mergedEntries.slice(0, maxRetained);

  const indexPayload = Buffer.from(
    JSON.stringify(
      {
        version: 1,
        branch,
        updatedAt: createdAt,
        maxRetained,
        backups: retainedEntries,
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  const entriesByPath = {
    'backups-index.json': indexPayload,
    [`archives/${filename}`]: archiveBuffer,
  };

  for (const retained of retainedEntries) {
    if (!retained || !retained.filename || retained.filename === filename) continue;
    const relArchivePath = `archives/${retained.filename}`;
    const existingBlobSha = existingTreeBlobs.get(relArchivePath);
    if (existingBlobSha) {
      entriesByPath[relArchivePath] = existingBlobSha;
    }
  }

  const commitSha = writeBackupOrphanCommit(resolvedRoot, {
    branch,
    parentShas: [localSha, remoteSha],
    entriesByPath,
    message: `acm-backup: add ${filename} (${retainedEntries.length} retained)`,
  });

  let pushed = false;
  let pushWarning = fetchInfo.warning || null;

  if (fetchInfo.remoteConfigured) {
    const pushRes = runGitText(['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], {
      cwd: resolvedRoot,
      ignoreError: true,
    });
    if (pushRes.ok) {
      pushed = true;
    } else {
      pushWarning = pushRes.stderr || pushRes.stdout || 'git push failed';
    }
  }

  return {
    ok: true,
    dryRun: false,
    branch,
    remote,
    remoteConfigured: fetchInfo.remoteConfigured,
    commitSha,
    filename,
    format,
    sha256,
    sizeBytes: archiveBuffer.length,
    pushed,
    pushWarning,
    retainedCount: retainedEntries.length,
  };
}

/**
 * Discovers backups stored on the Git orphan branch (local and optionally fetched from remote).
 */
function discoverGitBackups(targetDir, options = {}) {
  const resolvedRoot = path.resolve(targetDir || process.cwd());
  const branch = String(options.branch || DEFAULT_BACKUP_BRANCH).trim();
  const remote = String(options.remote || DEFAULT_BACKUP_REMOTE).trim();
  const fetchRemote = Boolean(options.fetchRemote);

  if (!isValidRefName(branch) || !isValidRefName(remote)) {
    return [];
  }

  const gitEnv = checkGitEnvironment(resolvedRoot);
  if (!gitEnv.available || !gitEnv.isRepo) {
    return [];
  }

  let remoteSha = null;
  if (fetchRemote) {
    const fetchInfo = fetchBackupBranch(resolvedRoot, remote, branch);
    remoteSha = fetchInfo.remoteSha;
  } else {
    remoteSha = resolveRef(resolvedRoot, `refs/remotes/${remote}/${branch}`);
  }

  const localSha = resolveRef(resolvedRoot, `refs/heads/${branch}`);
  let commitSha = localSha || remoteSha;
  if (localSha && remoteSha && localSha !== remoteSha) {
    const localIsAncestor = runGitText(['merge-base', '--is-ancestor', localSha, remoteSha], {
      cwd: resolvedRoot,
      ignoreError: true,
    }).ok;
    if (localIsAncestor) {
      commitSha = remoteSha;
    }
  }

  if (!commitSha) {
    return [];
  }

  const indexData = readIndexFromCommit(resolvedRoot, commitSha);
  const treeMap = readArchiveTreeMap(resolvedRoot, commitSha);
  const descriptors = [];

  for (const item of indexData.backups) {
    if (!item || !item.filename) continue;
    const relArchivePath = `archives/${item.filename}`;
    if (!treeMap.has(relArchivePath)) continue;
    const format = normalizeBackupFormat(item.format) || 'zip';
    descriptors.push({
      source: 'git',
      branch,
      remote,
      commitSha,
      name: item.filename,
      format,
      sizeBytes: Number(item.sizeBytes || 0),
      sha256: item.sha256 || null,
      createdAt: item.createdAt || null,
      mtimeMs: Date.parse(item.createdAt || '') || 0,
      isLegacy: Boolean(item.isLegacy),
      storageProvider: item.storageProvider || null,
    });
  }

  return descriptors;
}

/**
 * Extracts a backup archive buffer from Git and verifies its SHA-256 checksum when recorded.
 */
function readGitBackupBuffer(targetDir, entry) {
  const resolvedRoot = path.resolve(targetDir || process.cwd());
  if (!entry || !entry.commitSha || !entry.name) {
    throw new Error('Invalid Git backup descriptor');
  }
  const buf = readBlobBuffer(resolvedRoot, entry.commitSha, `archives/${entry.name}`);
  if (!buf) {
    throw new Error(`Backup archive not found in Git commit ${entry.commitSha}: ${entry.name}`);
  }
  if (entry.sha256) {
    const actualSha = computeSha256(buf);
    if (actualSha !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for Git backup "${entry.name}" (expected ${entry.sha256}, got ${actualSha})`);
    }
  }
  return buf;
}

module.exports = {
  DEFAULT_BACKUP_BRANCH,
  DEFAULT_BACKUP_REMOTE,
  DEFAULT_MAX_RETAINED,
  isValidRefName,
  pushBackupToGit,
  discoverGitBackups,
  readGitBackupBuffer,
};

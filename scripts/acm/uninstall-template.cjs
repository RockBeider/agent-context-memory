#!/usr/bin/env node
/**
 * scripts/acm/uninstall-template.cjs
 *
 * Safely removes and rolls back Agent Context Memory (ACM) assets from a target project
 * based on the Single Source of Truth manifest (scripts/acm/acm-manifest.cjs).
 *
 * Usage:
 *   node scripts/acm/uninstall-template.cjs [target-directory] [options]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ACM_MANIFEST } = require('./acm-manifest.cjs');
const { resolveMetaPath } = require('./storage/config.cjs');
const { checkGitEnvironment } = require('./check-git.cjs');
const { loadClack } = require('./sync-agent-rules.cjs');
const {
  DEFAULT_BACKUP_FORMAT,
  DEFAULT_BACKUP_TARGET,
  normalizeBackupFormat,
  normalizeBackupTarget,
  getBackupExtension,
  collectEntriesFromTargets,
  createZipBuffer,
  writeZipArchive,
  createTarGzBuffer,
  writeTarGzArchive,
  writeDirectoryBackup,
  inspectBackupEntries,
  formatBytes,
} = require('./backup-archive.cjs');
const {
  DEFAULT_BACKUP_BRANCH,
  DEFAULT_BACKUP_REMOTE,
  isValidRefName,
  pushBackupToGit,
} = require('./backup-git.cjs');
const {
  scanPresetRules,
  checkRuleContentDrift,
  removeRuleFromFile,
} = require('./sync-agent-rules.cjs');
const {
  DEFAULT_LANGUAGE,
  parseLangFlag,
  resolveLanguage,
  createTranslator,
  t,
} = require('./i18n.cjs');

function printUsage(lang = DEFAULT_LANGUAGE) {
  console.log(t('uninstall.usage', {}, lang));
}

function promptConfirm(questionText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(questionText, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

function promptBackupConfirmFallback(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    let answered = false;
    rl.on('SIGINT', () => {
      answered = true;
      rl.close();
      resolve(null);
    });
    rl.question(t('uninstall.backupConfirmFallback', {}, lang), (answer) => {
      answered = true;
      rl.close();
      const trimmed = String(answer || '').trim().toLowerCase();
      if (!trimmed || trimmed === 'y' || trimmed === 'yes') {
        return resolve(true);
      }
      if (trimmed === 'n' || trimmed === 'no') {
        return resolve(false);
      }
      resolve(false);
    });
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
  });
}

async function promptBackupConfirm(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const clack = options.useClack === false ? null : await loadClack();
  if (!clack) {
    return promptBackupConfirmFallback(options);
  }

  const ioOpts = {};
  if (options.input) ioOpts.input = options.input;
  if (options.output) ioOpts.output = options.output;

  const selected = await clack.confirm({
    message: t('uninstall.backupConfirmPrompt', {}, lang),
    initialValue: true,
    ...ioOpts,
  });
  if (clack.isCancel(selected)) {
    return null;
  }
  return Boolean(selected);
}

function promptBackupTargetFallback(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const branch = options.branch || DEFAULT_BACKUP_BRANCH;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    let answered = false;
    rl.on('SIGINT', () => {
      answered = true;
      rl.close();
      resolve(null);
    });
    rl.question(t('uninstall.backupTargetFallback', { branch }, lang), (answer) => {
      answered = true;
      rl.close();
      const trimmed = String(answer || '').trim().toLowerCase();
      if (!trimmed || trimmed === '1') return resolve('local');
      if (trimmed === '2') return resolve('git');
      if (trimmed === '3') return resolve('both');
      resolve(normalizeBackupTarget(trimmed) || 'local');
    });
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
  });
}

async function promptBackupTarget(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const branch = options.branch || DEFAULT_BACKUP_BRANCH;
  const clack = options.useClack === false ? null : await loadClack();
  if (!clack) {
    return promptBackupTargetFallback({ ...options, branch });
  }

  const ioOpts = {};
  if (options.input) ioOpts.input = options.input;
  if (options.output) ioOpts.output = options.output;

  const selected = await clack.select({
    message: t('uninstall.backupTargetPrompt', {}, lang),
    options: [
      {
        value: 'local',
        label: t('uninstall.backupTargetLocalLabel', {}, lang),
        hint: t('uninstall.backupTargetLocalHint', {}, lang),
      },
      {
        value: 'git',
        label: t('uninstall.backupTargetGitLabel', { branch }, lang),
        hint: t('uninstall.backupTargetGitHint', { branch }, lang),
      },
      {
        value: 'both',
        label: t('uninstall.backupTargetBothLabel', { branch }, lang),
        hint: t('uninstall.backupTargetBothHint', { branch }, lang),
      },
    ],
    initialValue: DEFAULT_BACKUP_TARGET,
    ...ioOpts,
  });

  if (clack.isCancel(selected)) {
    return null;
  }
  return normalizeBackupTarget(selected) || DEFAULT_BACKUP_TARGET;
}

function normPosix(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPathInsideTarget(targetDir, fullPath) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedFull = path.resolve(fullPath);
  const rel = path.relative(resolvedTarget, resolvedFull);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function collectAncestorDirs(targetDir, fullPath, cleanedDirs) {
  const resolvedTarget = path.resolve(targetDir);
  let currentDir = path.dirname(path.resolve(fullPath));
  while (currentDir && currentDir !== resolvedTarget) {
    if (!isPathInsideTarget(resolvedTarget, currentDir)) {
      break;
    }
    cleanedDirs.add(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

function createBackupState(targetDir, backupFormat = DEFAULT_BACKUP_FORMAT) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const baseName = `.acm-backup-${timestamp}`;
  const ext = getBackupExtension(backupFormat);
  let fileName = `${baseName}${ext}`;
  let suffix = 1;
  while (fs.existsSync(path.resolve(targetDir, fileName))) {
    fileName = `${baseName}_${suffix}${ext}`;
    suffix += 1;
  }
  return {
    dirName: fileName,
    fileName,
    fullPath: path.resolve(targetDir, fileName),
    format: backupFormat,
    recorded: false,
  };
}

function collectBackupTargets(targetDir, context) {
  const { meta, isV2, skippedSet, isLegacyInstall } = context;
  const targets = [];

  for (const dirMeta of ACM_MANIFEST.directories || []) {
    if (!dirMeta.backupRequired) continue;
    const dirRel = normPosix(dirMeta.path);
    const fullDir = path.resolve(targetDir, dirRel);
    if (isPathInsideTarget(targetDir, fullDir) && fs.existsSync(fullDir)) {
      targets.push(dirRel);
    }
  }

  if (isLegacyInstall && ACM_MANIFEST.legacy && Array.isArray(ACM_MANIFEST.legacy.directories)) {
    for (const legacyDir of ACM_MANIFEST.legacy.directories) {
      const legacyRel = normPosix(legacyDir);
      const legacyFull = path.resolve(targetDir, legacyRel);
      if (isPathInsideTarget(targetDir, legacyFull) && fs.existsSync(legacyFull)) {
        targets.push(legacyRel);
      }
    }
  }

  if (!isV2 && ACM_MANIFEST.legacy && Array.isArray(ACM_MANIFEST.legacy.files)) {
    for (const legacyFile of ACM_MANIFEST.legacy.files) {
      const rel = normPosix(legacyFile);
      if (!rel || skippedSet.has(rel)) continue;
      const full = path.resolve(targetDir, rel);
      if (isPathInsideTarget(targetDir, full) && fs.existsSync(full)) {
        targets.push(rel);
      }
    }
  }

  if (isV2 && meta && Array.isArray(meta.installedFiles)) {
    // Legacy individual files are already excluded in v2, and .agents/acm is covered above
  }

  return Array.from(new Set(targets));
}

function executePreDeleteBackup(targetDir, options, stats, tr, context) {
  if (context.noBackup || !context.backupState) return;
  const backupTargets = collectBackupTargets(targetDir, context);
  if (backupTargets.length === 0) return;

  const { backupState, backupFormat, backupTarget, backupBranch, backupRemote, isLegacyInstall } = context;
  const needsLocal = backupTarget === 'local' || backupTarget === 'both';
  const needsGit = backupTarget === 'git' || backupTarget === 'both';

  if (options.dryRun) {
    if (needsLocal) {
      if (backupFormat === 'dir') {
        console.log(tr('uninstall.dryBackup', { backupDir: backupState.fileName }));
      } else {
        console.log(
          tr('uninstall.dryBackupArchive', { backupFile: backupState.fileName, format: backupFormat })
        );
      }
    }
    if (needsGit) {
      const gitFormat = backupFormat === 'tar.gz' ? 'tar.gz' : 'zip';
      const gitFilename = backupFormat === 'dir' ? `${backupState.fileName}.zip` : backupState.fileName;
      console.log(
        tr('uninstall.dryBackupGit', {
          branch: backupBranch,
          remote: backupRemote,
          backupFile: gitFilename,
          format: gitFormat,
        })
      );
    }
    backupState.recorded = true;
    return;
  }

  const entries = collectEntriesFromTargets(targetDir, backupTargets);
  if (entries.length === 0) return;

  let cachedZipBuf = null;
  let cachedTarGzBuf = null;

  if (needsLocal) {
    if (backupFormat === 'zip') {
      cachedZipBuf = writeZipArchive(backupState.fullPath, entries);
      console.log(
        tr('uninstall.backupArchiveDone', {
          file: backupState.fileName,
          format: 'zip',
          size: formatBytes(cachedZipBuf.length),
        })
      );
    } else if (backupFormat === 'tar.gz') {
      cachedTarGzBuf = writeTarGzArchive(backupState.fullPath, entries);
      console.log(
        tr('uninstall.backupArchiveDone', {
          file: backupState.fileName,
          format: 'tar.gz',
          size: formatBytes(cachedTarGzBuf.length),
        })
      );
    } else {
      writeDirectoryBackup(backupState.fullPath, targetDir, backupTargets);
      console.log(tr('uninstall.backupDone', { src: backupTargets.join(', '), dest: backupState.fileName }));
    }
    stats.backups.push(backupState.fileName);
  }

  if (needsGit) {
    const gitFormat = backupFormat === 'tar.gz' ? 'tar.gz' : 'zip';
    const gitFilename = backupFormat === 'dir' ? `${backupState.fileName}.zip` : backupState.fileName;
    const archiveBuffer =
      gitFormat === 'tar.gz'
        ? cachedTarGzBuf || createTarGzBuffer(entries)
        : cachedZipBuf || createZipBuffer(entries);
    const inspected = inspectBackupEntries(entries);
    const gitRes = pushBackupToGit(targetDir, {
      archiveBuffer,
      filename: gitFilename,
      format: gitFormat,
      branch: backupBranch,
      remote: backupRemote,
      metadata: {
        storageProvider: inspected.storageProvider,
        isLegacy: isLegacyInstall,
        fileCount: inspected.fileCount,
      },
    });
    stats.backups.push(`git:${backupBranch}/${gitFilename}`);
    stats.gitBackup = gitRes;
    console.log(
      tr('uninstall.backupGitDone', {
        branch: backupBranch,
        file: gitFilename,
        sha: gitRes.commitSha.slice(0, 7),
      })
    );
    if (gitRes.pushWarning) {
      console.warn(
        tr('uninstall.backupGitPushWarn', {
          remote: backupRemote,
          detail: gitRes.pushWarning,
        })
      );
    }
  }

  backupState.recorded = true;
}

function removeDirectorySelective(targetDir, fullDirPath, skippedSet, tr, dryRun) {
  const entries = fs.readdirSync(fullDirPath, { withFileTypes: true });
  let keptAny = false;
  for (const entry of entries) {
    const childFull = path.join(fullDirPath, entry.name);
    const childRel = normPosix(path.relative(targetDir, childFull));
    if (entry.isDirectory()) {
      const hasProtectedInside = Array.from(skippedSet).some(
        (p) => p === childRel || p.startsWith(childRel + '/')
      );
      if (hasProtectedInside) {
        const subKept = removeDirectorySelective(targetDir, childFull, skippedSet, tr, dryRun);
        if (subKept) {
          keptAny = true;
        } else if (!dryRun) {
          try {
            fs.rmdirSync(childFull);
          } catch (_) {}
        }
      } else if (!dryRun) {
        fs.rmSync(childFull, { recursive: true, force: true });
      }
    } else if (skippedSet.has(childRel)) {
      keptAny = true;
      if (dryRun) {
        console.log(tr('uninstall.dryFileSkippedProtected', { path: childRel }));
      } else {
        console.log(tr('uninstall.fileSkippedProtected', { path: childRel }));
      }
    } else if (!dryRun) {
      fs.unlinkSync(childFull);
    }
  }
  return keptAny;
}

function cleanupEmptyDirs(targetDir, cleanedDirs, tr, dryRun) {
  if (dryRun || cleanedDirs.size === 0) return;
  const resolvedTarget = path.resolve(targetDir);
  const depthOf = (p) => path.relative(resolvedTarget, p).split(/[\\/]/).filter(Boolean).length;
  const sortedDirs = Array.from(cleanedDirs).sort((a, b) => {
    const diff = depthOf(b) - depthOf(a);
    return diff !== 0 ? diff : b.length - a.length;
  });

  for (const pDir of sortedDirs) {
    if (!isPathInsideTarget(resolvedTarget, pDir) || !fs.existsSync(pDir)) {
      continue;
    }
    try {
      const remaining = fs.readdirSync(pDir);
      const relDir = path.relative(resolvedTarget, pDir);
      if (remaining.length === 0) {
        fs.rmdirSync(pDir);
        console.log(tr('uninstall.emptyDirCleaned', { dir: relDir }));
      } else {
        console.log(tr('uninstall.userFilesPreserved', { dir: relDir, count: remaining.length }));
      }
    } catch (_) {
      // Ignore directory cleanup failures
    }
  }
}

/**
 * Step 1: Back up and remove ACM-owned isolated directories (never wholesale-deleting .agents/).
 */
function rollbackDirectories(targetDir, options, stats, tr, context) {
  console.log(tr('uninstall.step1'));
  const { cleanedDirs, skippedSet, isLegacyInstall } = context;

  for (const dirMeta of ACM_MANIFEST.directories) {
    const dirRel = normPosix(dirMeta.path);
    const fullDirPath = path.resolve(targetDir, dirRel);
    if (!fs.existsSync(fullDirPath)) {
      console.log(tr('uninstall.dirMissing', { path: dirRel }));
      continue;
    }

    const hasProtectedInside = Array.from(skippedSet).some(
      (p) => p === dirRel || p.startsWith(dirRel + '/')
    );

    if (hasProtectedInside) {
      const keptAny = removeDirectorySelective(targetDir, fullDirPath, skippedSet, tr, options.dryRun);
      if (!keptAny) {
        if (options.dryRun) {
          console.log(tr('uninstall.dryDirDelete', { path: dirRel }));
        } else {
          fs.rmSync(fullDirPath, { recursive: true, force: true });
          console.log(tr('uninstall.dirDeleted', { path: dirRel }));
        }
        stats.removedDirs.push(dirRel);
      } else {
        cleanedDirs.add(fullDirPath);
      }
    } else if (options.dryRun) {
      console.log(tr('uninstall.dryDirDelete', { path: dirRel }));
      stats.removedDirs.push(dirRel);
    } else {
      fs.rmSync(fullDirPath, { recursive: true, force: true });
      console.log(tr('uninstall.dirDeleted', { path: dirRel }));
      stats.removedDirs.push(dirRel);
    }

    collectAncestorDirs(targetDir, fullDirPath, cleanedDirs);
  }

  // Legacy v1 installations: remove only known ACM subdirectories under .agents/, preserving host assets
  if (isLegacyInstall && ACM_MANIFEST.legacy && Array.isArray(ACM_MANIFEST.legacy.directories)) {
    for (const legacyDir of ACM_MANIFEST.legacy.directories) {
      const legacyRel = normPosix(legacyDir);
      const legacyFull = path.resolve(targetDir, legacyRel);
      if (!fs.existsSync(legacyFull)) continue;

      if (options.dryRun) {
        console.log(tr('uninstall.dryDirDelete', { path: legacyRel }));
      } else {
        fs.rmSync(legacyFull, { recursive: true, force: true });
        console.log(tr('uninstall.dirDeleted', { path: legacyRel }));
      }
      stats.removedDirs.push(legacyRel);
      collectAncestorDirs(targetDir, legacyFull, cleanedDirs);
    }
  }
}

/**
 * Non-destructively strips ACM hook key(s) from .agents/hooks.json.
 * Preserves host hooks, pre-existing empty {} files (createdFile === false), and malformed JSON/JSONC files.
 */
function rollbackHooksJson(targetDir, options, stats, tr, context) {
  const { meta, cleanedDirs } = context;
  const hooksRel = normPosix((ACM_MANIFEST.hooks && ACM_MANIFEST.hooks.file) || '.agents/hooks.json');
  const hooksPath = path.resolve(targetDir, hooksRel);

  if (!fs.existsSync(hooksPath)) {
    console.log(tr('uninstall.hooksMissing', { file: hooksRel }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
    if (!isPlainObject(parsed)) {
      throw new Error('Root JSON value must be a plain object');
    }
  } catch (_) {
    console.warn(tr('uninstall.hooksParseError', { file: hooksRel }));
    return;
  }

  const isV2 = Boolean(meta && meta.schemaVersion >= 2);
  const candidateKeys =
    isV2 && meta.hooks && Array.isArray(meta.hooks.keys)
      ? meta.hooks.keys
      : [
          ...((ACM_MANIFEST.hooks && ACM_MANIFEST.hooks.keys) || []),
          ...((ACM_MANIFEST.hooks && ACM_MANIFEST.hooks.legacyKeys) || []),
        ];

  const removedKeys = candidateKeys.filter((k) =>
    Object.prototype.hasOwnProperty.call(parsed, k)
  );

  if (removedKeys.length === 0) {
    console.log(tr('uninstall.hooksNoKeys', { file: hooksRel }));
    return;
  }

  for (const k of removedKeys) {
    delete parsed[k];
  }

  const remainingKeys = Object.keys(parsed);
  if (remainingKeys.length > 0) {
    if (options.dryRun) {
      console.log(tr('uninstall.dryHooksClean', { file: hooksRel, keys: removedKeys.join(', ') }));
    } else {
      fs.writeFileSync(hooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      console.log(tr('uninstall.hooksCleaned', { file: hooksRel, keys: removedKeys.join(', ') }));
    }
    return;
  }

  const createdByAcm =
    meta && meta.hooks && typeof meta.hooks.createdFile === 'boolean'
      ? meta.hooks.createdFile
      : true;

  if (!createdByAcm) {
    if (options.dryRun) {
      console.log(tr('uninstall.dryHooksKeepEmpty', { file: hooksRel }));
    } else {
      fs.writeFileSync(hooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      console.log(tr('uninstall.hooksKeptEmpty', { file: hooksRel }));
    }
    return;
  }

  if (options.dryRun) {
    console.log(tr('uninstall.dryHooksDelete', { file: hooksRel }));
    stats.removedFiles.push(hooksRel);
  } else {
    fs.unlinkSync(hooksPath);
    console.log(tr('uninstall.hooksDeleted', { file: hooksRel }));
    stats.removedFiles.push(hooksRel);
    collectAncestorDirs(targetDir, hooksPath, cleanedDirs);
  }
}

/**
 * Step 2: Selectively delete ACM-owned individual files, clean .agents/hooks.json,
 * and remove empty parent directories bottom-up.
 */
function rollbackOwnedFiles(targetDir, options, stats, tr, context) {
  console.log(tr('uninstall.step2'));
  const { meta, isV2, skippedSet, cleanedDirs, backupState, isLegacyInstall, hasLegacyScripts } = context;
  const hooksRel = normPosix((ACM_MANIFEST.hooks && ACM_MANIFEST.hooks.file) || '.agents/hooks.json');
  const legacyAgentFileSet = new Set(
    ((ACM_MANIFEST.legacy && ACM_MANIFEST.legacy.files) || []).map(normPosix)
  );

  let targetFiles = [];
  if (isV2 && Array.isArray(meta.installedFiles)) {
    targetFiles = meta.installedFiles.map(normPosix).filter(Boolean);
  } else {
    const ideFiles = (ACM_MANIFEST.ideFiles || []).map(normPosix);
    const runtimeFiles = (ACM_MANIFEST.files || []).map((f) => normPosix(f.path));
    const legacyFiles = isLegacyInstall ? Array.from(legacyAgentFileSet) : [];
    const legacyScriptFiles =
      hasLegacyScripts && ACM_MANIFEST.legacy && Array.isArray(ACM_MANIFEST.legacy.scriptFiles)
        ? ACM_MANIFEST.legacy.scriptFiles.map(normPosix)
        : [];
    targetFiles = Array.from(new Set([...ideFiles, ...runtimeFiles, ...legacyFiles, ...legacyScriptFiles]));
  }

  for (const relFile of targetFiles) {
    if (!relFile || relFile === hooksRel) {
      continue;
    }
    if (isV2 && (relFile === '.agents/acm' || relFile.startsWith('.agents/acm/'))) {
      continue;
    }

    const fullFilePath = path.resolve(targetDir, relFile);
    if (!isPathInsideTarget(targetDir, fullFilePath) || !fs.existsSync(fullFilePath)) {
      continue;
    }

    if (skippedSet.has(relFile)) {
      if (options.dryRun) {
        console.log(tr('uninstall.dryFileSkippedProtected', { path: relFile }));
      } else {
        console.log(tr('uninstall.fileSkippedProtected', { path: relFile }));
      }
      continue;
    }

    if (options.dryRun) {
      console.log(tr('uninstall.dryFileDelete', { path: relFile }));
      stats.removedFiles.push(relFile);
    } else {
      fs.unlinkSync(fullFilePath);
      console.log(tr('uninstall.fileDeleted', { path: relFile }));
      stats.removedFiles.push(relFile);
    }

    collectAncestorDirs(targetDir, fullFilePath, cleanedDirs);
  }

  for (const protectedRel of skippedSet) {
    if (protectedRel === '.agents/acm' || protectedRel.startsWith('.agents/acm/') || targetFiles.includes(protectedRel)) {
      continue;
    }
    const protectedFull = path.resolve(targetDir, protectedRel);
    if (isPathInsideTarget(targetDir, protectedFull) && fs.existsSync(protectedFull)) {
      if (options.dryRun) {
        console.log(tr('uninstall.dryFileSkippedProtected', { path: protectedRel }));
      } else {
        console.log(tr('uninstall.fileSkippedProtected', { path: protectedRel }));
      }
    }
  }

  rollbackHooksJson(targetDir, options, stats, tr, context);
  cleanupEmptyDirs(targetDir, cleanedDirs, tr, options.dryRun);
}

/**
 * Step 3: Revert ACM scripts (both current acm:* and legacy git:*) from package.json.
 */
function rollbackPackageJson(targetDir, options, stats, tr) {
  console.log(tr('uninstall.step3'));
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(tr('uninstall.pkgMissing'));
    return;
  }

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (_) {
    console.warn(tr('uninstall.pkgParseWarn'));
    return;
  }

  if (!pkg.scripts) {
    console.log(tr('uninstall.pkgNoScripts'));
    return;
  }

  const acmScripts = ACM_MANIFEST.packageJson.scripts;
  const legacyScripts = (ACM_MANIFEST.legacy && ACM_MANIFEST.legacy.scripts) || {};
  let removedCount = 0;

  for (const [key, expectedCmd] of Object.entries(acmScripts)) {
    if (pkg.scripts[key]) {
      const currentCmd = pkg.scripts[key];
      if (currentCmd.trim() === expectedCmd.trim()) {
        if (options.dryRun) {
          console.log(tr('uninstall.dryScriptRemove', { key }));
        } else {
          delete pkg.scripts[key];
          console.log(tr('uninstall.scriptRemoved', { key, cmd: currentCmd }));
        }
        removedCount++;
      } else {
        console.log(tr('uninstall.scriptModifiedKeep', { key }));
      }
    }
  }

  // Legacy git:* scripts are removed ONLY on exact canonical command match (host custom git:* scripts untouched)
  for (const [key, expectedCmd] of Object.entries(legacyScripts)) {
    if (pkg.scripts[key] && String(pkg.scripts[key]).trim() === String(expectedCmd).trim()) {
      const currentCmd = pkg.scripts[key];
      if (options.dryRun) {
        console.log(tr('uninstall.dryScriptRemove', { key }));
      } else {
        delete pkg.scripts[key];
        console.log(tr('uninstall.scriptRemoved', { key, cmd: currentCmd }));
      }
      removedCount++;
    }
  }

  if (!options.dryRun && removedCount > 0) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(tr('uninstall.pkgReverted', { count: removedCount }));
  }
  stats.removedScriptsCount = removedCount;
}

/**
 * Step 4: Strip ACM entries (current selective + legacy + conditional hooks.json) from .gitignore
 * without disturbing existing user rules.
 */
function rollbackGitIgnore(targetDir, options, stats, tr, createdGitignore = null, meta = null) {
  console.log(tr('uninstall.step4'));
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    console.log(tr('uninstall.gitignoreMissing'));
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const { headerComment, entries, hooksEntry, legacyEntries } = ACM_MANIFEST.gitignore;
  const normIgnore = (s) => s.trim().replace(/^\//, '').replace(/\/$/, '');

  const metaGitignore = Array.isArray(meta && meta.gitignoreEntries) ? meta.gitignoreEntries : [];
  const metaHooksCreated = Boolean(meta && meta.hooks && meta.hooks.createdFile === true);
  const includeHooksEntry =
    metaHooksCreated ||
    (hooksEntry && metaGitignore.some((e) => normIgnore(e) === normIgnore(hooksEntry)));

  const managedEntries = [
    ...(entries || []),
    ...(legacyEntries || []),
    ...metaGitignore,
  ];
  if (includeHooksEntry && hooksEntry) {
    managedEntries.push(hooksEntry);
  }
  const normalizedManagedSet = new Set(managedEntries.map(normIgnore).filter(Boolean));

  let modified = false;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === headerComment) {
      modified = true;
      continue;
    }
    if (trimmed && normalizedManagedSet.has(normIgnore(trimmed))) {
      modified = true;
      continue;
    }
    newLines.push(lines[i]);
  }

  const remaining = newLines.join('\n').replace(/^\n+|\n+$/g, '');

  if (modified) {
    if (options.dryRun) {
      if (!remaining.trim()) {
        if (createdGitignore === false) {
          console.log(tr('uninstall.dryGitignoreKeepEmpty'));
        } else {
          console.log(tr('uninstall.dryGitignoreDelete'));
        }
      } else {
        console.log(tr('uninstall.dryGitignoreRemoveEntries'));
      }
    } else {
      if (!remaining.trim()) {
        if (createdGitignore === false) {
          fs.writeFileSync(gitignorePath, '', 'utf-8');
          console.log(tr('uninstall.gitignoreKeptEmpty'));
        } else {
          fs.unlinkSync(gitignorePath);
          console.log(tr('uninstall.gitignoreDeleted'));
        }
      } else {
        fs.writeFileSync(gitignorePath, remaining + '\n', 'utf-8');
        console.log(tr('uninstall.gitignoreStripped'));
      }
    }
    stats.gitignoreUpdated = true;
  } else {
    console.log(tr('uninstall.gitignoreNone'));
  }
}

/**
 * Step 5: Strip governance blocks from AI agent rule files with drift detection.
 */
async function rollbackAgentRules(targetDir, options, stats, tr, lang, metaRuleFiles = []) {
  console.log(tr('uninstall.step5'));
  let targetFiles = [];

  if (options.ruleFile) {
    targetFiles = Array.isArray(options.ruleFile)
      ? options.ruleFile
      : options.ruleFile.split(',').map((f) => f.trim()).filter(Boolean);
  } else {
    targetFiles = Array.from(new Set([...scanPresetRules(targetDir), ...metaRuleFiles]));
  }

  for (const relFile of targetFiles) {
    const fullPath = path.resolve(targetDir, relFile);
    if (!fs.existsSync(fullPath)) continue;

    if (options.dryRun) {
      const drift = checkRuleContentDrift(fullPath);
      if (drift.status === 'EXACT_MATCH') {
        console.log(tr('uninstall.dryRuleMatch', { file: relFile }));
      } else if (drift.status === 'MODIFIED') {
        console.log(tr('uninstall.dryRuleModified', { file: relFile }));
      }
      stats.ruleActions.push({ file: relFile, status: drift.status });
    } else {
      const result = await removeRuleFromFile(fullPath, { ...options, lang });
      stats.ruleActions.push(result);
      const relResult = path.relative(targetDir, fullPath);
      if (result.status === 'REMOVED_FILE') {
        console.log(tr('uninstall.ruleRemovedFile', { file: relResult }));
      } else if (result.status === 'CLEANED') {
        console.log(tr('uninstall.ruleCleaned', { file: relResult }));
      } else if (result.status === 'PRESERVED') {
        console.log(tr('uninstall.rulePreserved', { file: relResult, detail: result.detail }));
      }
    }
  }
}

/**
 * Unified uninstall pipeline.
 */
async function uninstall(targetPath = '.', options = {}) {
  const targetDir = path.resolve(process.cwd(), targetPath);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const isInteractive = typeof options.isInteractive === 'boolean'
    ? options.isInteractive
    : Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Read metadata before deleting .agents/acm so language, inventory, hooks, and ruleFiles are preserved for rollback
  let meta = null;
  let metaRuleFiles = [];
  let createdGitignore = null;
  const metaPath = resolveMetaPath(targetDir);
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (Array.isArray(meta.ruleFiles)) {
        metaRuleFiles = meta.ruleFiles;
      }
      if (typeof meta.createdGitignore === 'boolean') {
        createdGitignore = meta.createdGitignore;
      }
    } catch (_) {
      meta = null;
    }
  }

  const lang = resolveLanguage(targetDir, options.lang);
  const tr = createTranslator(lang);

  let backupFormat = DEFAULT_BACKUP_FORMAT;
  if (options.backupFormat !== undefined && options.backupFormat !== null) {
    const normFmt = normalizeBackupFormat(options.backupFormat);
    if (!normFmt) {
      throw new Error(tr('cli.unsupportedBackupFormat', { format: options.backupFormat }));
    }
    backupFormat = normFmt;
  }

  let explicitBackupTarget = null;
  if (options.backupTarget !== undefined && options.backupTarget !== null) {
    const normTgt = normalizeBackupTarget(options.backupTarget);
    if (!normTgt) {
      throw new Error(tr('cli.unsupportedBackupTarget', { target: options.backupTarget }));
    }
    explicitBackupTarget = normTgt;
  }

  const backupBranch = options.backupBranch
    ? String(options.backupBranch).trim()
    : DEFAULT_BACKUP_BRANCH;
  const backupRemote = options.backupRemote
    ? String(options.backupRemote).trim()
    : DEFAULT_BACKUP_REMOTE;

  if (!isValidRefName(backupBranch)) {
    throw new Error(tr('uninstall.invalidBackupRef', { ref: backupBranch }));
  }
  if (!isValidRefName(backupRemote)) {
    throw new Error(tr('uninstall.invalidBackupRef', { ref: backupRemote }));
  }

  const gitStatus = checkGitEnvironment(targetDir);
  const hasGit = Boolean(gitStatus.available && gitStatus.isRepo);

  if (
    !options.noBackup &&
    (explicitBackupTarget === 'git' || explicitBackupTarget === 'both') &&
    !hasGit
  ) {
    throw new Error(tr('uninstall.gitBackupRequiresRepo'));
  }

  const isV2 = Boolean(meta && meta.schemaVersion >= 2);
  const skippedSet = new Set(
    Array.isArray(meta && meta.skippedExistingFiles)
      ? meta.skippedExistingFiles.map(normPosix).filter(Boolean)
      : []
  );
  const hasLegacyScripts = fs.existsSync(path.join(targetDir, 'scripts', 'acm-manifest.cjs'));
  const isLegacyInstall =
    !isV2 &&
    (fs.existsSync(path.join(targetDir, '.agents', '.acm-meta.json')) ||
      fs.existsSync(path.join(targetDir, '.agents', 'MEMORY_GOVERNANCE.md')) ||
      hasLegacyScripts);

  console.log('=======================================================');
  console.log(tr('uninstall.bannerTitle'));
  console.log(tr('uninstall.bannerTarget', { dir: targetDir }));
  console.log(
    tr('uninstall.bannerMode', {
      mode: dryRun ? tr('uninstall.modeDryRun') : tr('uninstall.modeExecute'),
    })
  );
  console.log(
    tr('uninstall.bannerBackup', {
      backup: options.noBackup
        ? tr('uninstall.backupSkip')
        : tr('uninstall.backupActiveFormat', {
            format: backupFormat,
            target: explicitBackupTarget || DEFAULT_BACKUP_TARGET,
          }),
    })
  );
  console.log('=======================================================');

  let effectiveNoBackup = Boolean(options.noBackup);
  let effectiveBackupTarget = explicitBackupTarget || DEFAULT_BACKUP_TARGET;

  if (!dryRun && !force && isInteractive) {
    const confirm = await promptConfirm(tr('uninstall.confirmPrompt'));
    if (!confirm) {
      console.log(tr('uninstall.cancelled'));
      return { success: false, cancelled: true };
    }

    if (!effectiveNoBackup && !explicitBackupTarget) {
      const wantBackup = await promptBackupConfirm({
        lang,
        input: options.input,
        output: options.output,
      });
      if (wantBackup === null) {
        console.log(tr('uninstall.cancelled'));
        return { success: false, cancelled: true };
      }
      if (!wantBackup) {
        effectiveNoBackup = true;
      } else if (hasGit) {
        const chosenTarget = await promptBackupTarget({
          lang,
          branch: backupBranch,
          input: options.input,
          output: options.output,
        });
        if (chosenTarget === null) {
          console.log(tr('uninstall.cancelled'));
          return { success: false, cancelled: true };
        }
        effectiveBackupTarget = chosenTarget;
      } else {
        effectiveBackupTarget = 'local';
      }
    }
  }

  const context = {
    meta,
    isV2,
    skippedSet,
    hasLegacyScripts,
    isLegacyInstall,
    cleanedDirs: new Set(),
    noBackup: effectiveNoBackup,
    backupFormat,
    backupTarget: effectiveBackupTarget,
    backupBranch,
    backupRemote,
    backupState: effectiveNoBackup ? null : createBackupState(targetDir, backupFormat),
  };

  const stats = {
    removedDirs: [],
    removedFiles: [],
    removedScriptsCount: 0,
    gitignoreUpdated: false,
    ruleActions: [],
    backups: [],
    gitBackup: null,
  };

  // Pre-delete atomic backup: complete local/Git backup before removing any files or directories
  executePreDeleteBackup(targetDir, options, stats, tr, context);

  rollbackDirectories(targetDir, options, stats, tr, context);
  rollbackOwnedFiles(targetDir, options, stats, tr, context);
  rollbackPackageJson(targetDir, options, stats, tr);
  rollbackGitIgnore(targetDir, options, stats, tr, createdGitignore, meta);
  await rollbackAgentRules(targetDir, options, stats, tr, lang, metaRuleFiles);

  console.log('\n=======================================================');
  if (dryRun) {
    console.log(tr('uninstall.doneDryRun1'));
    console.log(tr('uninstall.doneDryRun2'));
  } else {
    console.log(tr('uninstall.doneReal'));
  }
  console.log('=======================================================\n');

  if (stats.backups.length > 0) {
    console.log(tr('uninstall.backupListHeader'));
    stats.backups.forEach((b) => console.log(`  - ${b}`));
    console.log('');
  }

  return { success: true, stats, lang };
}

function parseUninstallCliArgs(args = []) {
  const positionals = [];
  let dryRun = false;
  let force = false;
  let noBackup = false;
  let backupFormat = null;
  let backupTarget = null;
  let backupBranch = null;
  let backupRemote = null;
  let ruleFile = null;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--no-backup') {
      noBackup = true;
    } else if (arg.startsWith('--backup-format=')) {
      backupFormat = arg.slice('--backup-format='.length);
    } else if (arg === '--backup-format') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        backupFormat = String(args[i + 1]);
        i += 1;
      } else {
        backupFormat = '';
      }
    } else if (arg.startsWith('--backup-target=')) {
      backupTarget = arg.slice('--backup-target='.length);
    } else if (arg === '--backup-target') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        backupTarget = String(args[i + 1]);
        i += 1;
      } else {
        backupTarget = '';
      }
    } else if (arg.startsWith('--backup-branch=')) {
      backupBranch = arg.slice('--backup-branch='.length);
    } else if (arg === '--backup-branch') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        backupBranch = String(args[i + 1]);
        i += 1;
      } else {
        backupBranch = '';
      }
    } else if (arg.startsWith('--backup-remote=')) {
      backupRemote = arg.slice('--backup-remote='.length);
    } else if (arg === '--backup-remote') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        backupRemote = String(args[i + 1]);
        i += 1;
      } else {
        backupRemote = '';
      }
    } else if (arg.startsWith('--rule-file=')) {
      ruleFile = arg.slice('--rule-file='.length);
    } else if (arg === '--rule-file' || arg === '-r') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        ruleFile = String(args[i + 1]);
        i += 1;
      }
    } else if (arg.startsWith('--lang=') || arg.startsWith('-l=')) {
      // Parsed by parseLangFlag
    } else if (arg === '--lang' || arg === '-l') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        i += 1;
      }
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  return {
    dryRun,
    force,
    noBackup,
    backupFormat,
    backupTarget,
    backupBranch,
    backupRemote,
    ruleFile,
    targetArg: positionals[0] || '.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(args);

  if (invalidLang !== null) {
    console.error(t('cli.unsupportedLang', { lang: invalidLang }, resolveLanguage(process.cwd())));
    process.exit(1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage(resolveLanguage(process.cwd(), parsedLang));
    process.exit(0);
  }

  const {
    dryRun,
    force,
    noBackup,
    backupFormat,
    backupTarget,
    backupBranch,
    backupRemote,
    ruleFile,
    targetArg,
  } = parseUninstallCliArgs(args);

  try {
    const res = await uninstall(targetArg, {
      dryRun,
      force,
      noBackup,
      backupFormat,
      backupTarget,
      backupBranch,
      backupRemote,
      ruleFile,
      lang: parsedLang,
    });
    if (res && res.cancelled) {
      process.exit(0);
    }
  } catch (err) {
    console.error(t('cli.uninstallException', {}, resolveLanguage(targetArg, parsedLang)), err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  uninstall,
  printUsage,
  promptBackupConfirm,
  promptBackupTarget,
};

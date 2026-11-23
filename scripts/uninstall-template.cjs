#!/usr/bin/env node
/**
 * scripts/uninstall-template.cjs
 *
 * Safely removes and rolls back Agent Context Memory (ACM) assets from a target project
 * based on the Single Source of Truth manifest (scripts/acm-manifest.cjs).
 *
 * Usage:
 *   node scripts/uninstall-template.cjs [target-directory] [options]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ACM_MANIFEST } = require('./acm-manifest.cjs');
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

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Step 1: Back up and remove ACM-owned directories.
 */
function rollbackDirectories(targetDir, options, stats, tr) {
  console.log(tr('uninstall.step1'));
  for (const dirMeta of ACM_MANIFEST.directories) {
    const fullDirPath = path.resolve(targetDir, dirMeta.path);
    if (!fs.existsSync(fullDirPath)) {
      console.log(tr('uninstall.dirMissing', { path: dirMeta.path }));
      continue;
    }

    if (dirMeta.backupRequired && !options.noBackup) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const backupDirName = `${dirMeta.path}_backup_${timestamp}`;
      const backupFullPath = path.resolve(targetDir, backupDirName);

      if (options.dryRun) {
        console.log(tr('uninstall.dryBackup', { backupDir: backupDirName }));
      } else {
        copyDirRecursive(fullDirPath, backupFullPath);
        console.log(tr('uninstall.backupDone', { src: dirMeta.path, dest: backupDirName }));
        stats.backups.push(backupDirName);
      }
    }

    if (options.dryRun) {
      console.log(tr('uninstall.dryDirDelete', { path: dirMeta.path }));
      stats.removedDirs.push(dirMeta.path);
    } else {
      fs.rmSync(fullDirPath, { recursive: true, force: true });
      console.log(tr('uninstall.dirDeleted', { path: dirMeta.path }));
      stats.removedDirs.push(dirMeta.path);
    }
  }
}

/**
 * Step 2: Selectively delete ACM-owned individual files and clean up empty parent directories.
 */
function rollbackOwnedFiles(targetDir, options, stats, tr) {
  console.log(tr('uninstall.step2'));
  const cleanedDirs = new Set();

  for (const fileMeta of ACM_MANIFEST.files) {
    const fullFilePath = path.resolve(targetDir, fileMeta.path);
    if (!fs.existsSync(fullFilePath)) {
      continue;
    }

    if (options.dryRun) {
      console.log(tr('uninstall.dryFileDelete', { path: fileMeta.path }));
      stats.removedFiles.push(fileMeta.path);
    } else {
      fs.unlinkSync(fullFilePath);
      console.log(tr('uninstall.fileDeleted', { path: fileMeta.path }));
      stats.removedFiles.push(fileMeta.path);
    }

    if (fileMeta.parentDirCleanup) {
      const parentDir = path.dirname(fullFilePath);
      cleanedDirs.add(parentDir);
    }
  }

  // Sort deepest directories first so child folders are cleaned before parent folders
  if (!options.dryRun) {
    const sortedDirs = Array.from(cleanedDirs).sort((a, b) => b.length - a.length);
    for (const pDir of sortedDirs) {
      if (fs.existsSync(pDir)) {
        try {
          const remaining = fs.readdirSync(pDir);
          if (remaining.length === 0) {
            fs.rmdirSync(pDir);
            const relDir = path.relative(targetDir, pDir);
            console.log(tr('uninstall.emptyDirCleaned', { dir: relDir }));
          } else {
            const relDir = path.relative(targetDir, pDir);
            console.log(tr('uninstall.userFilesPreserved', { dir: relDir, count: remaining.length }));
          }
        } catch (_) {
          // Ignore directory cleanup failures
        }
      }
    }
  }
}

/**
 * Step 3: Revert ACM scripts from package.json.
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

  if (!options.dryRun && removedCount > 0) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(tr('uninstall.pkgReverted', { count: removedCount }));
  }
  stats.removedScriptsCount = removedCount;
}

/**
 * Step 4: Strip ACM entries from .gitignore without disturbing existing user rules.
 */
function rollbackGitIgnore(targetDir, options, stats, tr, createdGitignore = null) {
  console.log(tr('uninstall.step4'));
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    console.log(tr('uninstall.gitignoreMissing'));
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const { headerComment, entries } = ACM_MANIFEST.gitignore;
  const normIgnore = (s) => s.trim().replace(/^\//, '').replace(/\/$/, '');

  let modified = false;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === headerComment) {
      modified = true;
      continue;
    }
    if (entries.some((e) => normIgnore(trimmed) === normIgnore(e))) {
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
    : Boolean(process.stdin.isTTY);

  // Read metadata before deleting .agents so language and custom ruleFiles are preserved for rollback
  let metaRuleFiles = [];
  let createdGitignore = null;
  const metaPath = path.join(targetDir, '.agents', '.acm-meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (Array.isArray(parsed.ruleFiles)) {
        metaRuleFiles = parsed.ruleFiles;
      }
      if (typeof parsed.createdGitignore === 'boolean') {
        createdGitignore = parsed.createdGitignore;
      }
    } catch (_) {}
  }

  const lang = resolveLanguage(targetDir, options.lang);
  const tr = createTranslator(lang);

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
      backup: options.noBackup ? tr('uninstall.backupSkip') : tr('uninstall.backupActive'),
    })
  );
  console.log('=======================================================');

  if (!dryRun && !force && isInteractive) {
    const confirm = await promptConfirm(tr('uninstall.confirmPrompt'));
    if (!confirm) {
      console.log(tr('uninstall.cancelled'));
      return { success: false, cancelled: true };
    }
  }

  const stats = {
    removedDirs: [],
    removedFiles: [],
    removedScriptsCount: 0,
    gitignoreUpdated: false,
    ruleActions: [],
    backups: [],
  };

  rollbackDirectories(targetDir, options, stats, tr);
  rollbackOwnedFiles(targetDir, options, stats, tr);
  rollbackPackageJson(targetDir, options, stats, tr);
  rollbackGitIgnore(targetDir, options, stats, tr, createdGitignore);
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
  let ruleFile = null;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--no-backup') {
      noBackup = true;
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

  const { dryRun, force, noBackup, ruleFile, targetArg } = parseUninstallCliArgs(args);

  try {
    await uninstall(targetArg, { dryRun, force, noBackup, ruleFile, lang: parsedLang });
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
};

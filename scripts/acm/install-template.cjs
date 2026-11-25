#!/usr/bin/env node
/**
 * scripts/acm/install-template.cjs
 *
 * Installs and initializes Agent Context Memory (ACM) templates in a target project.
 * Supports English ('en', default) and Korean ('ko') template overlays and CLI output.
 *
 * Usage:
 *   node scripts/acm/install-template.cjs [target-directory] [--force] [--lang=en|ko] [--rule-file=<files>]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { checkGitEnvironment, printGitNotice } = require('./check-git.cjs');
const {
  loadClack,
  scanPresetRules,
  resolveTargetRuleFiles,
  applyGovernanceRules,
} = require('./sync-agent-rules.cjs');
const { ACM_MANIFEST, getGitignoreEntries, buildGitignoreTemplate } = require('./acm-manifest.cjs');
const {
  isNodeSqliteAvailable,
  normalizeStorageProvider,
  getConfigPath,
  resolveConfigPath,
  getMetaPath,
  resolveMetaPath,
  loadConfig,
  saveConfig,
} = require('./storage/config.cjs');
const { createMemoryStore } = require('./storage/memory-store.cjs');
const { importMarkdownToStore, projectTasksToMarkdown } = require('./storage/markdown-bridge.cjs');
const {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  parseLangFlag,
  resolveLanguage,
  createTranslator,
  t,
} = require('./i18n.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'acm-template');

const LANGUAGE_OPTIONS = [
  {
    value: 'en',
    label: t('install.langOptionEnLabel', {}, 'en'),
    hint: t('install.langOptionEnHint', {}, 'en'),
  },
  {
    value: 'ko',
    label: t('install.langOptionKoLabel', {}, 'ko'),
    hint: t('install.langOptionKoHint', {}, 'ko'),
  },
];

function printUsage(lang = DEFAULT_LANGUAGE) {
  console.log(t('install.usage', {}, lang));
}

function promptLanguageFallback(options = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    rl.question(t('install.langPromptFallback'), (answer) => {
      rl.close();
      const trimmed = String(answer || '').trim();
      if (!trimmed || trimmed === '1') {
        return resolve('en');
      }
      if (trimmed === '2') {
        return resolve('ko');
      }
      resolve(normalizeLanguage(trimmed) || DEFAULT_LANGUAGE);
    });
  });
}

/**
 * Prompts the user to select English (default) or Korean when installing interactively.
 * Returns null if cancelled via Ctrl+C.
 *
 * @param {object} [options={}]
 * @returns {Promise<'en'|'ko'|null>}
 */
async function promptLanguage(options = {}) {
  const clack = options.useClack === false ? null : await loadClack();
  if (!clack) {
    return promptLanguageFallback(options);
  }

  const ioOpts = {};
  if (options.input) ioOpts.input = options.input;
  if (options.output) ioOpts.output = options.output;

  const selected = await clack.select({
    message: t('install.langPromptMessage'),
    options: LANGUAGE_OPTIONS,
    initialValue: DEFAULT_LANGUAGE,
    ...ioOpts,
  });

  if (clack.isCancel(selected)) {
    return null;
  }
  return normalizeLanguage(selected) || DEFAULT_LANGUAGE;
}

function getStorageOptions(lang = DEFAULT_LANGUAGE) {
  return [
    {
      value: 'sqlite',
      label: t('install.storageOptionSqliteLabel', {}, lang),
      hint: t('install.storageOptionSqliteHint', {}, lang),
    },
    {
      value: 'markdown',
      label: t('install.storageOptionMarkdownLabel', {}, lang),
      hint: t('install.storageOptionMarkdownHint', {}, lang),
    },
  ];
}

function promptStorageFallback(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    rl.question(t('install.storagePromptFallback', {}, lang), (answer) => {
      rl.close();
      const trimmed = String(answer || '').trim();
      if (!trimmed || trimmed === '1') {
        return resolve('sqlite');
      }
      if (trimmed === '2') {
        return resolve('markdown');
      }
      resolve(normalizeStorageProvider(trimmed) || 'sqlite');
    });
  });
}

/**
 * Prompts the user to select local SQLite (recommended) or legacy Markdown storage.
 * Returns null if cancelled via Ctrl+C.
 *
 * @param {object} [options={}]
 * @returns {Promise<'sqlite'|'markdown'|null>}
 */
async function promptStorageProvider(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const clack = options.useClack === false ? null : await loadClack();
  if (!clack) {
    return promptStorageFallback(options);
  }

  const ioOpts = {};
  if (options.input) ioOpts.input = options.input;
  if (options.output) ioOpts.output = options.output;

  const selected = await clack.select({
    message: t('install.storagePromptMessage', {}, lang),
    options: getStorageOptions(lang),
    initialValue: 'sqlite',
    ...ioOpts,
  });

  if (clack.isCancel(selected)) {
    return null;
  }
  return normalizeStorageProvider(selected) || 'sqlite';
}

function toPosixRel(targetRoot, fullPath) {
  return path.relative(targetRoot, fullPath).replace(/\\/g, '/');
}

function normPosix(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureInventoryStats(stats) {
  if (!Array.isArray(stats.createdFiles)) stats.createdFiles = [];
  if (!Array.isArray(stats.overwrittenFiles)) stats.overwrittenFiles = [];
  if (!Array.isArray(stats.skippedFiles)) stats.skippedFiles = [];
}

/**
 * Copies template files to dest in a single pass, resolving locale overrides when lang !== 'en'.
 * Never copies root AGENTS.md (injected via syncAgentRules), acm-template/locales/,
 * or .agents/hooks.json (merged non-destructively via syncHooksJson).
 */
function copyTemplateForLocale(src, dest, lang, force, stats, silent = false, options = {}) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }

  ensureInventoryStats(stats);
  const tr = createTranslator(lang);
  const skipMarkdownScaffold = Boolean(options.skipMarkdownScaffold);

  for (const entry of entries) {
    // AGENTS.md is injected per target rule file; locales/ holds internal template overlays only
    if (src === TEMPLATE_DIR && (entry.name === 'AGENTS.md' || entry.name === 'locales')) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relFromTemplate = path.relative(TEMPLATE_DIR, srcPath).replace(/\\/g, '/');

    if (relFromTemplate === '.agents/hooks.json') {
      continue;
    }

    if (
      skipMarkdownScaffold &&
      (relFromTemplate === '.agents/acm/task' ||
        relFromTemplate.startsWith('.agents/acm/task/') ||
        relFromTemplate === '.agents/acm/memory' ||
        relFromTemplate.startsWith('.agents/acm/memory/'))
    ) {
      continue;
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    if (entry.isDirectory()) {
      copyTemplateForLocale(srcPath, destPath, lang, force, stats, silent, options);
    } else {
      let effectiveSrcPath = srcPath;
      if (lang && lang !== DEFAULT_LANGUAGE) {
        const localeOverride = path.join(TEMPLATE_DIR, 'locales', lang, relFromTemplate);
        if (fs.existsSync(localeOverride)) {
          effectiveSrcPath = localeOverride;
        }
      }

      const relDest = path.relative(stats.targetRoot, destPath);
      const relPosix = toPosixRel(stats.targetRoot, destPath);
      const exists = fs.existsSync(destPath);
      if (exists && !force) {
        stats.skipped++;
        stats.skippedFiles.push(relPosix);
        if (!silent) {
          console.log(tr('install.copyKeep', { file: relDest }));
        }
      } else {
        fs.copyFileSync(effectiveSrcPath, destPath);
        if (exists) {
          stats.overwritten++;
          stats.overwrittenFiles.push(relPosix);
          if (!silent) {
            console.log(tr('install.copyOverwrite', { file: relDest }));
          }
        } else {
          stats.created++;
          stats.createdFiles.push(relPosix);
          if (!silent) {
            console.log(tr('install.copyCreate', { file: relDest }));
          }
        }
      }
    }
  }
}

/**
 * Copies ACM-owned runtime scripts listed in ACM_MANIFEST.files from the package's root scripts/ directory.
 */
function copyRuntimeScriptsFromManifest(targetDir, lang, force, stats, silent = false) {
  ensureInventoryStats(stats);
  const tr = createTranslator(lang);

  for (const fileMeta of ACM_MANIFEST.files) {
    const srcPath = path.resolve(ROOT_DIR, fileMeta.path);
    const destPath = path.resolve(targetDir, fileMeta.path);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing ACM runtime script in package bundle: ${fileMeta.path}`);
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const relDest = path.relative(stats.targetRoot, destPath);
    const relPosix = toPosixRel(stats.targetRoot, destPath);
    const exists = fs.existsSync(destPath);
    if (exists && !force) {
      stats.skipped++;
      stats.skippedFiles.push(relPosix);
      if (!silent) {
        console.log(tr('install.copyKeep', { file: relDest }));
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (exists) {
        stats.overwritten++;
        stats.overwrittenFiles.push(relPosix);
        if (!silent) {
          console.log(tr('install.copyOverwrite', { file: relDest }));
        }
      } else {
        stats.created++;
        stats.createdFiles.push(relPosix);
        if (!silent) {
          console.log(tr('install.copyCreate', { file: relDest }));
        }
      }
    }
  }
}

/**
 * Non-destructively creates or merges ACM hook keys into .agents/hooks.json.
 * Handles 4 scenarios:
 * 1) Missing -> creates file (createdFile: true)
 * 2) Existing valid JSON with host hooks -> preserves host hooks and merges ACM key(s) (createdFile: false)
 * 3) Existing empty JSON {} -> merges ACM key(s) while retaining createdFile: false
 * 4) Malformed JSON / JSONC / non-object root -> warns and leaves original bytes untouched
 */
function syncHooksJson(targetDir, options = {}) {
  const force = Boolean(options.force);
  const silent = Boolean(options.silent);
  const lang = options.lang || DEFAULT_LANGUAGE;
  const stats = options.stats || null;
  const prevHooksMeta = options.prevHooksMeta || null;
  const tr = createTranslator(lang);

  const hooksRel = (ACM_MANIFEST.hooks && ACM_MANIFEST.hooks.file) || '.agents/hooks.json';
  const tplHooksPath = path.join(TEMPLATE_DIR, hooksRel);
  const tplHooks = JSON.parse(fs.readFileSync(tplHooksPath, 'utf-8'));
  const targetHooksPath = path.resolve(targetDir, hooksRel);

  const prevKeys = Array.isArray(prevHooksMeta && prevHooksMeta.keys) ? prevHooksMeta.keys : [];
  const prevCreatedFile =
    prevHooksMeta && typeof prevHooksMeta.createdFile === 'boolean' ? prevHooksMeta.createdFile : null;

  if (!fs.existsSync(targetHooksPath)) {
    fs.mkdirSync(path.dirname(targetHooksPath), { recursive: true });
    fs.writeFileSync(targetHooksPath, JSON.stringify(tplHooks, null, 2) + '\n', 'utf-8');
    const keys = Object.keys(tplHooks);
    if (stats) stats.created++;
    if (!silent) {
      console.log(tr('install.hooksCreated', { file: hooksRel, keys: keys.join(', ') }));
    }
    return {
      status: 'CREATED',
      file: hooksRel,
      keys,
      createdFile: true,
    };
  }

  let parsedExisting;
  try {
    parsedExisting = JSON.parse(fs.readFileSync(targetHooksPath, 'utf-8'));
    if (!isPlainObject(parsedExisting)) {
      throw new Error('Root JSON value must be a plain object');
    }
  } catch (_) {
    if (stats) stats.skipped++;
    if (!silent) {
      console.warn(tr('install.hooksParseError', { file: hooksRel }));
    }
    return {
      status: 'PARSE_ERROR',
      file: hooksRel,
      keys: [...prevKeys],
      createdFile: prevCreatedFile !== null ? prevCreatedFile : false,
    };
  }

  const merged = { ...parsedExisting };
  const syncedKeys = [];
  let changed = false;

  for (const [hookKey, hookVal] of Object.entries(tplHooks)) {
    const hasKey = Object.prototype.hasOwnProperty.call(parsedExisting, hookKey);
    if (!hasKey || force) {
      merged[hookKey] = hookVal;
      syncedKeys.push(hookKey);
      changed = true;
    }
  }

  const ownedKeys = Array.from(new Set([...prevKeys, ...syncedKeys]));
  const createdFile = prevCreatedFile !== null ? prevCreatedFile : false;

  if (changed) {
    fs.writeFileSync(targetHooksPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    if (stats) stats.overwritten++;
    if (!silent) {
      console.log(tr('install.hooksMerged', { file: hooksRel, keys: syncedKeys.join(', ') }));
    }
    return {
      status: 'MERGED',
      file: hooksRel,
      keys: ownedKeys,
      createdFile,
    };
  }

  if (stats) stats.skipped++;
  if (!silent) {
    console.log(tr('install.hooksKept', { file: hooksRel }));
  }
  return {
    status: 'KEPT',
    file: hooksRel,
    keys: ownedKeys,
    createdFile,
  };
}

function updateTargetPackageJson(targetDir, silent = false, lang = DEFAULT_LANGUAGE) {
  const tr = createTranslator(lang);
  const pkgPath = path.join(targetDir, 'package.json');
  const acmScripts = ACM_MANIFEST.packageJson.scripts;

  let pkg = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (_) {
      if (!silent) {
        console.warn(tr('install.pkgParseWarn'));
      }
      return { addedCount: 0, addedKeys: [], managedKeys: [], skipped: true };
    }
  } else {
    pkg = {
      name: path.basename(targetDir),
      version: '0.1.0',
      private: true,
    };
  }

  pkg.scripts = pkg.scripts || {};
  let addedCount = 0;
  const addedKeys = [];
  const managedKeys = [];
  for (const [key, cmd] of Object.entries(acmScripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = cmd;
      addedCount++;
      addedKeys.push(key);
      managedKeys.push(key);
    } else if (String(pkg.scripts[key]).trim() === String(cmd).trim()) {
      managedKeys.push(key);
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  if (!silent) {
    console.log(tr('install.pkgSynced', { count: addedCount }));
  }
  return { addedCount, addedKeys, managedKeys, skipped: false };
}

function updateGitIgnore(targetDir, silent = false, lang = DEFAULT_LANGUAGE, options = {}) {
  const tr = createTranslator(lang);
  const gitignorePath = path.join(targetDir, '.gitignore');
  const includeHooks = Boolean(options && options.includeHooks);
  const entries = getGitignoreEntries({ includeHooks });
  const template = buildGitignoreTemplate({ includeHooks });

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, template, 'utf-8');
    if (!silent) {
      console.log(tr('install.gitignoreCreated', { entries: entries.join(', ') }));
    }
    return { created: true, appended: false, exists: false, entries, addedEntries: entries };
  }

  const normIgnore = (s) => s.trim().replace(/^\//, '').replace(/\/$/, '');
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const missingEntries = entries.filter((entry) => {
    const cleanEntry = normIgnore(entry);
    return !lines.some((line) => normIgnore(line) === cleanEntry);
  });

  if (missingEntries.length === 0) {
    if (!silent) {
      console.log(tr('install.gitignorePreserved', { entries: entries.join(', ') }));
    }
    return { created: false, appended: false, exists: true, entries, addedEntries: [] };
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r');
  const appendContent = (needsNewline ? '\n' : '') + missingEntries.join('\n') + '\n';
  fs.appendFileSync(gitignorePath, appendContent, 'utf-8');
  if (!silent) {
    console.log(tr('install.gitignoreAppended', { entries: missingEntries.join(', ') }));
  }
  return { created: false, appended: true, exists: false, entries, addedEntries: missingEntries };
}

function executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, silent, options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const tr = createTranslator(lang);
  const stats = {
    created: 0,
    overwritten: 0,
    skipped: 0,
    createdFiles: [],
    overwrittenFiles: [],
    skippedFiles: [],
    targetRoot: targetDir,
  };
  const skipPackageJsonUpdate = Boolean(options.skipPackageJsonUpdate);

  // Pre-read existing metadata before any template files are copied or overwritten
  const metaPath = getMetaPath(targetDir);
  const readMetaPath = resolveMetaPath(targetDir);
  let prevMeta = null;
  if (fs.existsSync(readMetaPath)) {
    try {
      prevMeta = JSON.parse(fs.readFileSync(readMetaPath, 'utf-8'));
    } catch (_) {
      prevMeta = null;
    }
  }

  const agentsDir = path.join(targetDir, '.agents');
  const desiredStorage = options.storageProvider || (isNodeSqliteAvailable() ? 'sqlite' : 'markdown');
  const configPath = resolveConfigPath(targetDir);
  const hasExistingConfig = fs.existsSync(configPath);
  const baseExisting = hasExistingConfig ? loadConfig(targetDir) : null;
  const preserveExistingConfig =
    hasExistingConfig &&
    !force &&
    !options.explicitStorage &&
    options.markdownProjection === undefined;

  const targetStorage = preserveExistingConfig
    ? (baseExisting.storage && baseExisting.storage.provider) || desiredStorage
    : options.explicitStorage
      ? desiredStorage
      : (hasExistingConfig && !force && baseExisting.storage && baseExisting.storage.provider) ||
        desiredStorage;

  const targetMarkdownProjection = preserveExistingConfig
    ? Boolean(baseExisting.storage && baseExisting.storage.markdownProjection)
    : typeof options.markdownProjection === 'boolean'
      ? options.markdownProjection
      : baseExisting && baseExisting.storage && typeof baseExisting.storage.markdownProjection === 'boolean'
        ? baseExisting.storage.markdownProjection
        : false;

  const skipMarkdownScaffold = targetStorage === 'sqlite' && !targetMarkdownProjection;

  if (!silent) console.log(tr('install.step2Copy'));
  copyTemplateForLocale(TEMPLATE_DIR, targetDir, lang, force, stats, silent, { skipMarkdownScaffold });
  copyRuntimeScriptsFromManifest(targetDir, lang, force, stats, silent);
  const hooksResult = syncHooksJson(targetDir, {
    force,
    silent,
    lang,
    stats,
    prevHooksMeta: prevMeta && prevMeta.hooks,
  });
  if (!silent) {
    console.log(
      tr('install.step2Stats', {
        created: stats.created,
        overwritten: stats.overwritten,
        skipped: stats.skipped,
      })
    );
    console.log(tr('install.step3Rules'));
  }

  const ruleResult = applyGovernanceRules(targetDir, targetRuleFiles, { silent, lang });

  let pkgResult = { addedCount: 0, addedKeys: [], managedKeys: [], skipped: true };
  if (skipPackageJsonUpdate) {
    if (!silent) {
      console.log(tr('install.pkgPostinstallSkip'));
    }
  } else {
    if (!silent) console.log(tr('install.pkgSyncStart'));
    pkgResult = updateTargetPackageJson(targetDir, silent, lang);
  }

  let gitignoreResult = {
    created: false,
    appended: false,
    exists: false,
    entries: [],
    addedEntries: [],
    skipped: !hasGit,
  };
  if (hasGit) {
    if (!silent) console.log(tr('install.gitignoreGitDetected'));
    gitignoreResult = updateGitIgnore(targetDir, silent, lang, {
      includeHooks: Boolean(hooksResult.createdFile),
    });
  } else if (!silent) {
    console.log(tr('install.gitignoreNoGit'));
  }

  let effectiveConfig;
  if (preserveExistingConfig) {
    effectiveConfig = baseExisting;
  } else {
    effectiveConfig = saveConfig(targetDir, {
      ...(baseExisting || {}),
      language: lang,
      storage: {
        ...((baseExisting && baseExisting.storage) || {}),
        provider: targetStorage,
        dbPath:
          (baseExisting && baseExisting.storage && baseExisting.storage.dbPath) ||
          '.agents/acm/local/memory.db',
        markdownProjection: targetMarkdownProjection,
      },
    });
  }

  const effectiveStorage = (effectiveConfig.storage && effectiveConfig.storage.provider) || desiredStorage;
  const effectiveMarkdownProjection = Boolean(
    effectiveConfig.storage && effectiveConfig.storage.markdownProjection
  );
  let migratedCounts = { tasks: 0, completedTasks: 0, patterns: 0, adrs: 0 };
  if (effectiveStorage === 'sqlite' && isNodeSqliteAvailable()) {
    const store = createMemoryStore(targetDir, { config: effectiveConfig, lang, skipProjection: true });
    try {
      const dbStats = store.getStats();
      if (dbStats.tasks.total === 0 && dbStats.patterns.total === 0 && dbStats.adrs.total === 0) {
        migratedCounts = importMarkdownToStore(targetDir, store);
        const migratedTotal =
          migratedCounts.tasks +
          migratedCounts.completedTasks +
          migratedCounts.patterns +
          migratedCounts.adrs;
        if (migratedTotal > 0 && !silent) {
          console.log(tr('install.storageMigrated', migratedCounts));
        }
      } else if (effectiveMarkdownProjection) {
        projectTasksToMarkdown(targetDir, store, { lang });
      }
    } finally {
      store.close();
    }
  }

  if (fs.existsSync(agentsDir)) {
    const existingRuleFiles = Array.isArray(prevMeta && prevMeta.ruleFiles) ? prevMeta.ruleFiles : [];
    const existingCreatedGitignore =
      prevMeta && typeof prevMeta.createdGitignore === 'boolean' ? prevMeta.createdGitignore : null;

    const mergedRuleFiles = Array.from(new Set([...existingRuleFiles, ...targetRuleFiles]));
    const createdGitignore =
      existingCreatedGitignore !== null ? existingCreatedGitignore : Boolean(gitignoreResult.created);

    const installedSet = new Set(
      Array.isArray(prevMeta && prevMeta.installedFiles)
        ? prevMeta.installedFiles.map(normPosix).filter(Boolean)
        : []
    );
    const skippedSet = new Set(
      Array.isArray(prevMeta && prevMeta.skippedExistingFiles)
        ? prevMeta.skippedExistingFiles.map(normPosix).filter(Boolean)
        : []
    );

    for (const rel of [...stats.createdFiles, ...stats.overwrittenFiles].map(normPosix)) {
      if (!rel) continue;
      installedSet.add(rel);
      skippedSet.delete(rel);
    }
    for (const rel of stats.skippedFiles.map(normPosix)) {
      if (!rel) continue;
      if (!installedSet.has(rel)) {
        skippedSet.add(rel);
      }
    }

    const prevGitignoreEntries = Array.isArray(prevMeta && prevMeta.gitignoreEntries)
      ? prevMeta.gitignoreEntries
      : [];
    const mergedGitignoreEntries = hasGit
      ? Array.from(new Set([...prevGitignoreEntries, ...(gitignoreResult.entries || [])]))
      : [...prevGitignoreEntries];

    const prevPackageScripts = Array.isArray(prevMeta && prevMeta.packageScripts)
      ? prevMeta.packageScripts
      : [];
    const mergedPackageScripts = Array.from(
      new Set([...prevPackageScripts, ...(pkgResult.managedKeys || [])])
    );

    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          schemaVersion: 2,
          language: lang,
          storageProvider: effectiveStorage,
          ruleFiles: mergedRuleFiles,
          createdGitignore,
          installedFiles: Array.from(installedSet),
          skippedExistingFiles: Array.from(skippedSet),
          hooks: {
            file: hooksResult.file,
            keys: hooksResult.keys,
            createdFile: Boolean(hooksResult.createdFile),
          },
          gitignoreEntries: mergedGitignoreEntries,
          packageScripts: mergedPackageScripts,
        },
        null,
        2
      ) + '\n',
      'utf-8'
    );
  }

  return {
    stats,
    hooksResult,
    ruleResult,
    pkgResult,
    gitignoreResult,
    storageProvider: effectiveStorage,
    markdownProjection: effectiveMarkdownProjection,
    migratedCounts,
  };
}

function buildNextStepsLines(
  targetDir,
  targetRuleFiles,
  hasGit,
  lang = DEFAULT_LANGUAGE,
  storageProvider = 'sqlite',
  markdownProjection = false
) {
  const tr = createTranslator(lang);
  const lines = [];
  if (targetDir !== process.cwd()) {
    lines.push(tr('install.nextCd', { dir: targetDir }));
  }
  if (storageProvider !== 'sqlite' || markdownProjection) {
    lines.push(tr('install.nextTask'));
  }
  if (storageProvider === 'sqlite') {
    lines.push(tr('install.nextDbTip'));
  }
  lines.push(tr('install.nextRules', { files: targetRuleFiles.join(', ') }));
  if (hasGit) {
    lines.push(tr('install.nextGitStatus'));
  } else {
    lines.push(tr('install.nextNonGitNote'));
  }
  return lines;
}

async function install(targetPath = '.', options = {}) {
  const force = Boolean(options.force);
  const targetDir = path.resolve(process.cwd(), targetPath);

  if (options.lang !== undefined && options.lang !== null) {
    const normExplicit = normalizeLanguage(options.lang);
    if (!normExplicit) {
      throw new Error(t('cli.unsupportedLang', { lang: options.lang }, resolveLanguage(targetDir)));
    }
  }

  let explicitStorage = null;
  if (options.storage !== undefined && options.storage !== null && options.storage !== '') {
    explicitStorage = normalizeStorageProvider(options.storage);
    if (!explicitStorage) {
      throw new Error(
        t(
          'cli.unsupportedStorage',
          { storage: options.storage },
          normalizeLanguage(options.lang) || resolveLanguage(targetDir)
        )
      );
    }
    if (explicitStorage === 'sqlite' && !isNodeSqliteAvailable()) {
      throw new Error(
        t(
          'storage.sqliteRequired',
          { version: process.version },
          normalizeLanguage(options.lang) || resolveLanguage(targetDir)
        )
      );
    }
  }

  if (!fs.existsSync(TEMPLATE_DIR)) {
    const fallbackLang = normalizeLanguage(options.lang) || DEFAULT_LANGUAGE;
    console.error(t('install.missingTemplateDir', { dir: TEMPLATE_DIR }, fallbackLang));
    process.exit(1);
  }

  const isInteractive =
    Boolean(options.forceInteractive || (process.stdin.isTTY && process.stdout.isTTY)) &&
    !options.nonInteractive;
  const clack = isInteractive ? await loadClack() : null;

  let lang = null;
  if (options.lang) {
    lang = normalizeLanguage(options.lang);
  } else if (process.env.ACM_LANG) {
    lang = normalizeLanguage(process.env.ACM_LANG) || DEFAULT_LANGUAGE;
  }

  let storageProvider = explicitStorage;
  if (!storageProvider && process.env.ACM_STORAGE) {
    const envStorage = normalizeStorageProvider(process.env.ACM_STORAGE);
    if (envStorage) {
      storageProvider = envStorage === 'sqlite' && !isNodeSqliteAvailable() ? 'markdown' : envStorage;
    }
  }

  if (clack) {
    const ioOpts = {};
    if (options.input) ioOpts.input = options.input;
    if (options.output) ioOpts.output = options.output;

    clack.intro('Agent Context Memory (ACM)', ioOpts);

    if (!lang) {
      lang = await promptLanguage({ ...options, ...ioOpts });
      if (lang === null) {
        clack.cancel('Installation cancelled. / 설치가 취소되었습니다.', ioOpts);
        return { success: false, cancelled: true };
      }
    }

    const tr = createTranslator(lang);

    if (!storageProvider) {
      if (isNodeSqliteAvailable()) {
        storageProvider = await promptStorageProvider({ ...options, ...ioOpts, lang, useClack: true });
        if (storageProvider === null) {
          clack.cancel(tr('install.cancelled'), ioOpts);
          return { success: false, cancelled: true };
        }
      } else {
        clack.log.warn(tr('install.storageFallbackMarkdownWarn', { version: process.version }), ioOpts);
        storageProvider = 'markdown';
      }
    }

    clack.log.info(
      tr('install.targetAndMode', {
        targetDir,
        mode: force ? tr('install.modeForce') : tr('install.modeSafe'),
      }),
      ioOpts
    );

    const gitStatus = checkGitEnvironment(targetDir);
    const hasGit = Boolean(gitStatus.available && gitStatus.isRepo);
    if (hasGit) {
      clack.log.success(tr('install.gitEnabled', { version: gitStatus.version }), ioOpts);
    } else if (gitStatus.available) {
      clack.log.warn(tr('install.gitNonRepo', { version: gitStatus.version }), ioOpts);
    } else {
      clack.log.warn(tr('install.gitMissing'), ioOpts);
    }

    const scannedBefore = !options.ruleFile ? scanPresetRules(targetDir) : [];
    const targetRuleFiles = await resolveTargetRuleFiles(targetDir, { ...options, lang, silent: true });
    if (targetRuleFiles === null) {
      clack.cancel(tr('install.cancelled'), ioOpts);
      return { success: false, cancelled: true };
    }

    if (options.ruleFile) {
      clack.log.info(tr('install.specifiedRuleFiles', { files: targetRuleFiles.join(', ') }), ioOpts);
    } else if (scannedBefore.length > 0) {
      clack.log.success(
        tr('install.detectedRuleFiles', {
          count: scannedBefore.length,
          files: scannedBefore.join(', '),
        }),
        ioOpts
      );
    }

    const spin = clack.spinner(ioOpts);
    spin.start(tr('install.spinnerStart'));
    const {
      stats,
      pkgResult,
      storageProvider: finalStorage,
      markdownProjection: finalProjection,
      migratedCounts,
    } = executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, true, {
      ...options,
      lang,
      storageProvider,
      explicitStorage: Boolean(explicitStorage),
    });
    spin.stop(tr('install.spinnerStop'));

    const migratedTotal =
      migratedCounts.tasks +
      migratedCounts.completedTasks +
      migratedCounts.patterns +
      migratedCounts.adrs;
    if (migratedTotal > 0) {
      clack.log.info(tr('install.storageMigrated', migratedCounts).trim(), ioOpts);
    }

    clack.log.step(
      tr('install.summary', {
        created: stats.created,
        overwritten: stats.overwritten,
        skipped: stats.skipped,
        files: targetRuleFiles.join(', '),
        addedCount: pkgResult.addedCount,
      }) + `\n${tr('install.summaryStorage', { storage: finalStorage })}`,
      ioOpts
    );

    clack.note(
      buildNextStepsLines(targetDir, targetRuleFiles, hasGit, lang, finalStorage, finalProjection).join('\n'),
      tr('install.nextStepsTitle'),
      ioOpts
    );
    clack.outro(tr('install.outro'), ioOpts);

    return {
      success: true,
      lang,
      storageProvider: finalStorage,
      stats,
      gitAvailable: hasGit,
      ruleFiles: targetRuleFiles,
    };
  }

  if (!lang) {
    if (isInteractive) {
      lang = await promptLanguage({ ...options, useClack: false });
      if (lang === null) {
        return { success: false, cancelled: true };
      }
    } else {
      lang = DEFAULT_LANGUAGE;
    }
  }

  const tr = createTranslator(lang);

  if (!storageProvider) {
    if (isInteractive && isNodeSqliteAvailable()) {
      storageProvider = await promptStorageProvider({ ...options, lang, useClack: false });
      if (storageProvider === null) {
        return { success: false, cancelled: true };
      }
    } else {
      storageProvider = isNodeSqliteAvailable() ? 'sqlite' : 'markdown';
    }
  }

  console.log('=======================================================');
  console.log(tr('install.bannerStart'));
  console.log(tr('install.bannerSource', { dir: TEMPLATE_DIR }));
  console.log(tr('install.bannerTarget', { dir: targetDir }));
  console.log(tr('install.bannerLang', { lang }));
  console.log(tr('install.bannerStorage', { storage: storageProvider }));
  console.log(tr('install.bannerMode', { mode: force ? tr('install.modeForce') : tr('install.modeSafe') }));
  if (options.ruleFile) {
    console.log(tr('install.bannerRule', { ruleFile: options.ruleFile }));
  }
  console.log('=======================================================\n');

  const gitStatus = checkGitEnvironment(targetDir);
  const hasGit = printGitNotice(gitStatus, lang);

  console.log(tr('install.step1Scan'));
  const targetRuleFiles = await resolveTargetRuleFiles(targetDir, { ...options, lang });
  if (targetRuleFiles === null) {
    console.log(tr('install.cancelledCli'));
    return { success: false, cancelled: true };
  }

  const { stats, storageProvider: finalStorage, markdownProjection: finalProjection } = executeInstallSteps(
    targetDir,
    targetRuleFiles,
    hasGit,
    force,
    false,
    {
      ...options,
      lang,
      storageProvider,
      explicitStorage: Boolean(explicitStorage),
    }
  );

  console.log('\n=======================================================');
  console.log(tr('install.bannerComplete'));
  console.log('=======================================================\n');
  console.log(tr('install.nextStepsHeading'));
  buildNextStepsLines(targetDir, targetRuleFiles, hasGit, lang, finalStorage, finalProjection).forEach((line, idx) => {
    console.log(`  ${idx === 0 && targetDir !== process.cwd() ? '1.' : '-'} ${line}`);
  });
  console.log('=======================================================\n');

  return {
    success: true,
    lang,
    storageProvider: finalStorage,
    stats,
    gitAvailable: hasGit,
    ruleFiles: targetRuleFiles,
  };
}

/**
 * Runs automatic host initialization from npm postinstall unless guarded out.
 */
async function runPostInstall(env = process.env) {
  const skipEnv = String(env.ACM_SKIP_POSTINSTALL || '').toLowerCase();
  if (skipEnv === '1' || skipEnv === 'true') {
    return { skipped: true, reason: 'ACM_SKIP_POSTINSTALL enabled' };
  }

  const ciEnv = String(env.CI || '').toLowerCase();
  if (ciEnv === 'true' || ciEnv === '1' || String(env.GITHUB_ACTIONS || '').toLowerCase() === 'true') {
    return { skipped: true, reason: 'CI environment detected' };
  }

  if (env.npm_command === 'ci') {
    return { skipped: true, reason: 'npm ci clean install detected' };
  }

  if (env.npm_config_global === 'true') {
    return { skipped: true, reason: 'Global npm install detected' };
  }

  if (env.npm_command === 'exec' || env.npm_lifecycle_event === 'npx') {
    return { skipped: true, reason: 'npx/exec invocation detected (handled by CLI binary)' };
  }

  const initCwd = env.INIT_CWD;
  if (!initCwd) {
    return { skipped: true, reason: 'INIT_CWD not set' };
  }

  const resolvedInitCwd = path.resolve(initCwd);
  const resolvedRootDir = path.resolve(ROOT_DIR);

  if (resolvedInitCwd === resolvedRootDir) {
    return { skipped: true, reason: 'Self-repository root directory detected' };
  }

  const targetPkgPath = path.join(resolvedInitCwd, 'package.json');
  if (fs.existsSync(targetPkgPath)) {
    try {
      const targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf-8'));
      if (targetPkg && targetPkg.name === 'agent-context-memory') {
        return { skipped: true, reason: 'Target package.json belongs to agent-context-memory' };
      }
    } catch (_) {
      // Ignore malformed host package.json
    }
  }

  if (
    fs.existsSync(path.join(resolvedInitCwd, '.agents', 'acm', 'ACM_GOVERNANCE.md')) ||
    fs.existsSync(path.join(resolvedInitCwd, '.agents', 'MEMORY_GOVERNANCE.md'))
  ) {
    return { skipped: true, reason: 'ACM is already initialized in target project' };
  }

  const postInstallLang = normalizeLanguage(env.ACM_LANG) || DEFAULT_LANGUAGE;
  const tr = createTranslator(postInstallLang);

  try {
    console.log(tr('install.postinstallStart'));
    const res = await install(resolvedInitCwd, {
      force: false,
      nonInteractive: true,
      skipPackageJsonUpdate: true,
      lang: postInstallLang,
    });
    return { skipped: false, result: res };
  } catch (err) {
    // Warn and exit cleanly so postinstall never breaks host npm install
    console.warn(tr('install.postinstallWarn', { message: err.message }));
    return { skipped: true, reason: err.message, error: err };
  }
}

function parseInstallCliArgs(args = []) {
  const positionals = [];
  let force = false;
  let nonInteractive = false;
  let ruleFile = null;
  let storage = null;
  let markdownProjection;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--non-interactive') {
      nonInteractive = true;
    } else if (arg === '--markdown-projection') {
      markdownProjection = true;
    } else if (arg === '--no-markdown-projection') {
      markdownProjection = false;
    } else if (arg.startsWith('--rule-file=')) {
      ruleFile = arg.slice('--rule-file='.length);
    } else if (arg === '--rule-file' || arg === '-r') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        ruleFile = String(args[i + 1]);
        i += 1;
      }
    } else if (arg.startsWith('--storage=')) {
      storage = arg.slice('--storage='.length);
    } else if (arg === '--storage') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) {
        storage = String(args[i + 1]);
        i += 1;
      } else {
        storage = '';
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
    force,
    nonInteractive,
    ruleFile,
    storage,
    markdownProjection,
    targetArg: positionals[0] || '.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(args);

  if (invalidLang !== null) {
    console.error(t('cli.unsupportedLang', { lang: invalidLang }, DEFAULT_LANGUAGE));
    process.exit(1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage(parsedLang || DEFAULT_LANGUAGE);
    process.exit(0);
  }

  if (args.includes('--postinstall')) {
    await runPostInstall();
    process.exit(0);
  }

  const { force, nonInteractive, ruleFile, storage, markdownProjection, targetArg } = parseInstallCliArgs(args);

  try {
    await install(targetArg, { force, ruleFile, storage, markdownProjection, nonInteractive, lang: parsedLang });
  } catch (err) {
    console.error(t('cli.installException', {}, parsedLang || DEFAULT_LANGUAGE), err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  LANGUAGE_OPTIONS,
  promptLanguage,
  normalizeStorageProvider,
  getStorageOptions,
  promptStorageProvider,
  install,
  runPostInstall,
  syncHooksJson,
  updateGitIgnore,
  printUsage,
};

#!/usr/bin/env node
/**
 * scripts/install-template.cjs
 *
 * Installs and initializes Agent Context Memory (ACM) templates in a target project.
 * Supports English ('en', default) and Korean ('ko') template overlays and CLI output.
 *
 * Usage:
 *   node scripts/install-template.cjs [target-directory] [--force] [--lang=en|ko] [--rule-file=<files>]
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
const { ACM_MANIFEST } = require('./acm-manifest.cjs');
const {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  parseLangFlag,
  resolveLanguage,
  createTranslator,
  t,
} = require('./i18n.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
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

/**
 * Copies template files to dest in a single pass, resolving locale overrides when lang !== 'en'.
 * Never copies root AGENTS.md (injected via syncAgentRules) or acm-template/locales/ to host.
 */
function copyTemplateForLocale(src, dest, lang, force, stats, silent = false) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const tr = createTranslator(lang);

  for (const entry of entries) {
    // AGENTS.md is injected per target rule file; locales/ holds internal template overlays only
    if (src === TEMPLATE_DIR && (entry.name === 'AGENTS.md' || entry.name === 'locales')) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyTemplateForLocale(srcPath, destPath, lang, force, stats, silent);
    } else {
      let effectiveSrcPath = srcPath;
      if (lang && lang !== DEFAULT_LANGUAGE) {
        const relFromTemplate = path.relative(TEMPLATE_DIR, srcPath);
        const localeOverride = path.join(TEMPLATE_DIR, 'locales', lang, relFromTemplate);
        if (fs.existsSync(localeOverride)) {
          effectiveSrcPath = localeOverride;
        }
      }

      const relDest = path.relative(stats.targetRoot, destPath);
      const exists = fs.existsSync(destPath);
      if (exists && !force) {
        stats.skipped++;
        if (!silent) {
          console.log(tr('install.copyKeep', { file: relDest }));
        }
      } else {
        fs.copyFileSync(effectiveSrcPath, destPath);
        if (exists) {
          stats.overwritten++;
          if (!silent) {
            console.log(tr('install.copyOverwrite', { file: relDest }));
          }
        } else {
          stats.created++;
          if (!silent) {
            console.log(tr('install.copyCreate', { file: relDest }));
          }
        }
      }
    }
  }
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
      return { addedCount: 0, skipped: true };
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
  for (const [key, cmd] of Object.entries(acmScripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = cmd;
      addedCount++;
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  if (!silent) {
    console.log(tr('install.pkgSynced', { count: addedCount }));
  }
  return { addedCount, skipped: false };
}

function updateGitIgnore(targetDir, silent = false, lang = DEFAULT_LANGUAGE) {
  const tr = createTranslator(lang);
  const gitignorePath = path.join(targetDir, '.gitignore');
  const { entries, template } = ACM_MANIFEST.gitignore;

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, template, 'utf-8');
    if (!silent) {
      console.log(tr('install.gitignoreCreated', { entries: entries.join(', ') }));
    }
    return { created: true, appended: false, exists: false };
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
    return { created: false, appended: false, exists: true };
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r');
  const appendContent = (needsNewline ? '\n' : '') + missingEntries.join('\n') + '\n';
  fs.appendFileSync(gitignorePath, appendContent, 'utf-8');
  if (!silent) {
    console.log(tr('install.gitignoreAppended', { entries: missingEntries.join(', ') }));
  }
  return { created: false, appended: true, exists: false };
}

function executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, silent, options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const tr = createTranslator(lang);
  const stats = { created: 0, overwritten: 0, skipped: 0, targetRoot: targetDir };
  const skipPackageJsonUpdate = Boolean(options.skipPackageJsonUpdate);

  if (!silent) console.log(tr('install.step2Copy'));
  copyTemplateForLocale(TEMPLATE_DIR, targetDir, lang, force, stats, silent);
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

  let pkgResult = { addedCount: 0, skipped: true };
  if (skipPackageJsonUpdate) {
    if (!silent) {
      console.log(tr('install.pkgPostinstallSkip'));
    }
  } else {
    if (!silent) console.log(tr('install.pkgSyncStart'));
    pkgResult = updateTargetPackageJson(targetDir, silent, lang);
  }

  let gitignoreResult = { created: false, appended: false, exists: false, skipped: !hasGit };
  if (hasGit) {
    if (!silent) console.log(tr('install.gitignoreGitDetected'));
    gitignoreResult = updateGitIgnore(targetDir, silent, lang);
  } else if (!silent) {
    console.log(tr('install.gitignoreNoGit'));
  }

  const agentsDir = path.join(targetDir, '.agents');
  if (fs.existsSync(agentsDir)) {
    const metaPath = path.join(agentsDir, '.acm-meta.json');
    let existingRuleFiles = [];
    let existingCreatedGitignore = null;
    if (fs.existsSync(metaPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (Array.isArray(parsed.ruleFiles)) {
          existingRuleFiles = parsed.ruleFiles;
        }
        if (typeof parsed.createdGitignore === 'boolean') {
          existingCreatedGitignore = parsed.createdGitignore;
        }
      } catch (_) {}
    }
    const mergedRuleFiles = Array.from(new Set([...existingRuleFiles, ...targetRuleFiles]));
    const createdGitignore =
      existingCreatedGitignore !== null ? existingCreatedGitignore : Boolean(gitignoreResult.created);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ language: lang, ruleFiles: mergedRuleFiles, createdGitignore }, null, 2) + '\n',
      'utf-8'
    );
  }

  return { stats, ruleResult, pkgResult, gitignoreResult };
}

function buildNextStepsLines(targetDir, targetRuleFiles, hasGit, lang = DEFAULT_LANGUAGE) {
  const tr = createTranslator(lang);
  const lines = [];
  if (targetDir !== process.cwd()) {
    lines.push(tr('install.nextCd', { dir: targetDir }));
  }
  lines.push(tr('install.nextTask'));
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
    const { stats, pkgResult } = executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, true, {
      ...options,
      lang,
    });
    spin.stop(tr('install.spinnerStop'));

    clack.log.step(
      tr('install.summary', {
        created: stats.created,
        overwritten: stats.overwritten,
        skipped: stats.skipped,
        files: targetRuleFiles.join(', '),
        addedCount: pkgResult.addedCount,
      }),
      ioOpts
    );

    clack.note(
      buildNextStepsLines(targetDir, targetRuleFiles, hasGit, lang).join('\n'),
      tr('install.nextStepsTitle'),
      ioOpts
    );
    clack.outro(tr('install.outro'), ioOpts);

    return { success: true, lang, stats, gitAvailable: hasGit, ruleFiles: targetRuleFiles };
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
  console.log('=======================================================');
  console.log(tr('install.bannerStart'));
  console.log(tr('install.bannerSource', { dir: TEMPLATE_DIR }));
  console.log(tr('install.bannerTarget', { dir: targetDir }));
  console.log(tr('install.bannerLang', { lang }));
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

  const { stats } = executeInstallSteps(targetDir, targetRuleFiles, hasGit, force, false, {
    ...options,
    lang,
  });

  console.log('\n=======================================================');
  console.log(tr('install.bannerComplete'));
  console.log('=======================================================\n');
  console.log(tr('install.nextStepsHeading'));
  buildNextStepsLines(targetDir, targetRuleFiles, hasGit, lang).forEach((line, idx) => {
    console.log(`  ${idx === 0 && targetDir !== process.cwd() ? '1.' : '-'} ${line}`);
  });
  console.log('=======================================================\n');

  return { success: true, lang, stats, gitAvailable: hasGit, ruleFiles: targetRuleFiles };
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

  if (fs.existsSync(path.join(resolvedInitCwd, '.agents', 'MEMORY_GOVERNANCE.md'))) {
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

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--non-interactive') {
      nonInteractive = true;
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
    force,
    nonInteractive,
    ruleFile,
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

  const { force, nonInteractive, ruleFile, targetArg } = parseInstallCliArgs(args);

  try {
    await install(targetArg, { force, ruleFile, nonInteractive, lang: parsedLang });
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
  install,
  runPostInstall,
  updateGitIgnore,
  printUsage,
};

#!/usr/bin/env node
/**
 * bin/agent-context-memory.js
 *
 * Agent Context Memory unified CLI entry point (npx agent-context-memory / acm / npm run acm --)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { install } = require('../scripts/acm/install-template.cjs');
const { uninstall } = require('../scripts/acm/uninstall-template.cjs');
const { checkGitEnvironment, printGitNotice } = require('../scripts/acm/check-git.cjs');
const { normalizeStorageProvider } = require('../scripts/acm/storage/config.cjs');
const { normalizeBackupFormat, normalizeBackupTarget } = require('../scripts/acm/backup-archive.cjs');
const {
  normalizeLanguage,
  parseLangFlag,
  resolveLanguage,
  createTranslator,
} = require('../scripts/acm/i18n.cjs');

const pkgPath = path.resolve(__dirname, '../package.json');
let pkgVersion = '0.2.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkgVersion = pkg.version;
} catch (_) {
  // Ignore package.json read errors
}

/**
 * Parses common CLI flags without misidentifying flag values as positional target paths.
 */
function parseCliArgs(argv = []) {
  const positionals = [];
  let force = false;
  let nonInteractive = false;
  let dryRun = false;
  let noBackup = false;
  let backupFormat = null;
  let backupTarget = null;
  let backupBranch = null;
  let backupRemote = null;
  let restoreBackup = null;
  let noRestoreBackup = false;
  let ruleFile = null;
  let storage = null;
  let markdownProjection;

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (arg === '--non-interactive') {
      nonInteractive = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--no-backup') {
      noBackup = true;
    } else if (arg === '--no-restore-backup') {
      noRestoreBackup = true;
    } else if (arg.startsWith('--restore-backup=')) {
      const val = arg.slice('--restore-backup='.length);
      restoreBackup = val || true;
    } else if (arg === '--restore-backup') {
      const next = argv[i + 1] ? String(argv[i + 1]) : '';
      if (
        next &&
        !next.startsWith('-') &&
        (next === 'latest' ||
          next === 'local' ||
          next === 'git' ||
          next.startsWith('.acm-backup-') ||
          next.endsWith('.zip') ||
          next.endsWith('.tar.gz') ||
          next.endsWith('.tgz'))
      ) {
        restoreBackup = next;
        i += 1;
      } else {
        restoreBackup = true;
      }
    } else if (arg.startsWith('--backup-format=')) {
      backupFormat = arg.slice('--backup-format='.length);
    } else if (arg === '--backup-format') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        backupFormat = String(argv[i + 1]);
        i += 1;
      } else {
        backupFormat = '';
      }
    } else if (arg.startsWith('--backup-target=')) {
      backupTarget = arg.slice('--backup-target='.length);
    } else if (arg === '--backup-target') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        backupTarget = String(argv[i + 1]);
        i += 1;
      } else {
        backupTarget = '';
      }
    } else if (arg.startsWith('--backup-branch=')) {
      backupBranch = arg.slice('--backup-branch='.length);
    } else if (arg === '--backup-branch') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        backupBranch = String(argv[i + 1]);
        i += 1;
      } else {
        backupBranch = '';
      }
    } else if (arg.startsWith('--backup-remote=')) {
      backupRemote = arg.slice('--backup-remote='.length);
    } else if (arg === '--backup-remote') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        backupRemote = String(argv[i + 1]);
        i += 1;
      } else {
        backupRemote = '';
      }
    } else if (arg === '--markdown-projection') {
      markdownProjection = true;
    } else if (arg === '--no-markdown-projection') {
      markdownProjection = false;
    } else if (arg.startsWith('--rule-file=')) {
      ruleFile = arg.slice('--rule-file='.length);
    } else if (arg === '--rule-file' || arg === '-r') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        ruleFile = String(argv[i + 1]);
        i += 1;
      }
    } else if (arg.startsWith('--storage=')) {
      storage = arg.slice('--storage='.length);
    } else if (arg === '--storage') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        storage = String(argv[i + 1]);
        i += 1;
      } else {
        storage = '';
      }
    } else if (arg.startsWith('--lang=') || arg.startsWith('-l=')) {
      // Handled by parseLangFlag
    } else if (arg === '--lang' || arg === '-l') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        i += 1;
      }
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  return {
    force,
    nonInteractive,
    dryRun,
    noBackup,
    backupFormat,
    backupTarget,
    backupBranch,
    backupRemote,
    restoreBackup,
    noRestoreBackup,
    ruleFile,
    storage,
    markdownProjection,
    targetDir: positionals[0] || '.',
  };
}

/**
 * Resolves engine script path, preferring the host project's scripts/acm/ over legacy scripts/ (only when ACM legacy marker exists) or the package bundle.
 */
function resolveEngineScript(scriptName) {
  const hostNamespacedScript = path.resolve(process.cwd(), 'scripts', 'acm', scriptName);
  if (fs.existsSync(hostNamespacedScript)) {
    return hostNamespacedScript;
  }
  const hasLegacyAcmMarker = fs.existsSync(path.resolve(process.cwd(), 'scripts', 'acm-manifest.cjs'));
  if (hasLegacyAcmMarker) {
    const hostLegacyScript = path.resolve(process.cwd(), 'scripts', scriptName);
    if (fs.existsSync(hostLegacyScript)) {
      return hostLegacyScript;
    }
  }
  const bundleScript = path.resolve(__dirname, '../scripts/acm', scriptName);
  if (fs.existsSync(bundleScript)) {
    return bundleScript;
  }
  return null;
}

/**
 * Spawns an engine script in a child process and inherits I/O and exit status.
 */
function runEngine(scriptName, scriptArgs = [], explicitLang = null) {
  const tr = createTranslator(resolveLanguage(process.cwd(), explicitLang));
  const scriptPath = resolveEngineScript(scriptName);
  if (!scriptPath) {
    console.error(tr('cli.scriptNotFound', { scriptName }));
    process.exit(1);
  }

  const childEnv = {
    ...process.env,
    ACM_ROOT_DIR: process.cwd(),
    GIT_PAGER: 'cat',
    PAGER: 'cat',
  };
  if (explicitLang) {
    childEnv.ACM_LANG = explicitLang;
  }

  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: childEnv,
  });

  if (result.error) {
    console.error(tr('cli.execError'), result.error.message);
    process.exit(1);
  }
  process.exit(result.status !== null ? result.status : 0);
}

function printHelp(lang) {
  const tr = createTranslator(resolveLanguage(process.cwd(), lang));
  console.log(tr('cli.help', { version: pkgVersion }));
}

const DB_COMMANDS = new Set([
  'id',
  'task',
  'pattern',
  'adr',
  'search',
  'migrate',
  'export',
  'import',
  'sync',
  'compact',
  'config',
  'stats',
]);

const KNOWN_COMMANDS = new Set([
  'init',
  'uninstall',
  'remove',
  'check-git',
  'status',
  'commit',
  'pull',
  'resolve',
  'audit',
  'audit-push',
  ...DB_COMMANDS,
  'mcp',
  'help',
  'version',
]);

function isImplicitInitInvocation(firstArg) {
  if (!firstArg) return true;
  if (
    firstArg === '-f' ||
    firstArg === '--force' ||
    firstArg === '-r' ||
    firstArg === '--rule-file' ||
    firstArg === '-l' ||
    firstArg === '--lang' ||
    firstArg === '--storage' ||
    firstArg === '--markdown-projection' ||
    firstArg === '--no-markdown-projection' ||
    firstArg === '--non-interactive' ||
    firstArg === '--restore-backup' ||
    firstArg === '--no-restore-backup' ||
    firstArg === '--backup-branch' ||
    firstArg === '--backup-remote' ||
    firstArg.startsWith('--rule-file=') ||
    firstArg.startsWith('--storage=') ||
    firstArg.startsWith('--restore-backup=') ||
    firstArg.startsWith('--backup-branch=') ||
    firstArg.startsWith('--backup-remote=') ||
    firstArg.startsWith('--lang=') ||
    firstArg.startsWith('-l=')
  ) {
    return true;
  }
  if (
    firstArg === '.' ||
    firstArg === '..' ||
    firstArg.includes('/') ||
    firstArg.includes('\\') ||
    fs.existsSync(path.resolve(process.cwd(), firstArg))
  ) {
    return true;
  }
  return false;
}

function ensureGit(actionName, explicitLang = null) {
  const gitEnv = checkGitEnvironment(process.cwd());
  if (!gitEnv.available || !gitEnv.isRepo) {
    const tr = createTranslator(resolveLanguage(process.cwd(), explicitLang));
    if (actionName === 'commit') {
      console.log(tr('cli.nonGitCommitSkip'));
      console.log(tr('cli.nonGitCommitHint'));
    } else {
      console.log(tr('cli.nonGitToolSkip', { action: actionName }));
    }
    process.exit(0);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(args);

  if (invalidLang !== null) {
    const tr = createTranslator(resolveLanguage(process.cwd()));
    console.error(tr('cli.unsupportedLang', { lang: invalidLang }));
    process.exit(1);
  }

  if (args[0] === 'help' || (!DB_COMMANDS.has(args[0]) && args[0] !== 'mcp' && (args.includes('-h') || args.includes('--help')))) {
    printHelp(parsedLang);
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version') || args[0] === 'version') {
    console.log(`agent-context-memory v${pkgVersion}`);
    process.exit(0);
  }

  const isImplicitInit = !KNOWN_COMMANDS.has(args[0]) && isImplicitInitInvocation(args[0]);
  const command = isImplicitInit ? 'init' : args[0];
  const commandArgs = isImplicitInit ? args : args.slice(1);
  const effectiveLang = parsedLang ? normalizeLanguage(parsedLang) : null;

  switch (command) {
    case 'init': {
      const parsed = parseCliArgs(commandArgs);
      let storage = null;
      if (parsed.storage !== null) {
        storage = normalizeStorageProvider(parsed.storage);
        if (!storage) {
          const tr = createTranslator(resolveLanguage(process.cwd(), effectiveLang));
          console.error(tr('cli.unsupportedStorage', { storage: parsed.storage }));
          process.exit(1);
        }
      }
      try {
        const result = await install(parsed.targetDir, {
          force: parsed.force,
          ruleFile: parsed.ruleFile,
          nonInteractive: parsed.nonInteractive,
          lang: effectiveLang,
          storage,
          markdownProjection: parsed.markdownProjection,
          restoreBackup: parsed.restoreBackup,
          noRestoreBackup: parsed.noRestoreBackup,
          backupBranch: parsed.backupBranch,
          backupRemote: parsed.backupRemote,
        });
        if (result && result.cancelled) {
          process.exit(0);
        }
      } catch (err) {
        const tr = createTranslator(resolveLanguage(process.cwd(), effectiveLang));
        console.error(tr('cli.installException'), err.message);
        process.exit(1);
      }
      break;
    }

    case 'uninstall':
    case 'remove': {
      const parsed = parseCliArgs(args.slice(1));
      if (parsed.backupFormat !== null) {
        const normFmt = normalizeBackupFormat(parsed.backupFormat);
        if (!normFmt) {
          const tr = createTranslator(resolveLanguage(parsed.targetDir, effectiveLang));
          console.error(tr('cli.unsupportedBackupFormat', { format: parsed.backupFormat }));
          process.exit(1);
        }
      }
      if (parsed.backupTarget !== null) {
        const normTgt = normalizeBackupTarget(parsed.backupTarget);
        if (!normTgt) {
          const tr = createTranslator(resolveLanguage(parsed.targetDir, effectiveLang));
          console.error(tr('cli.unsupportedBackupTarget', { target: parsed.backupTarget }));
          process.exit(1);
        }
      }
      try {
        const result = await uninstall(parsed.targetDir, {
          force: parsed.force,
          nonInteractive: parsed.nonInteractive,
          dryRun: parsed.dryRun,
          noBackup: parsed.noBackup,
          backupFormat: parsed.backupFormat,
          backupTarget: parsed.backupTarget,
          backupBranch: parsed.backupBranch,
          backupRemote: parsed.backupRemote,
          ruleFile: parsed.ruleFile,
          lang: effectiveLang,
        });
        if (result && result.cancelled) {
          process.exit(0);
        }
      } catch (err) {
        const tr = createTranslator(resolveLanguage(process.cwd(), effectiveLang));
        console.error(tr('cli.uninstallException'), err.message);
        process.exit(1);
      }
      break;
    }

    case 'check-git': {
      const status = checkGitEnvironment();
      printGitNotice(status, resolveLanguage(process.cwd(), effectiveLang));
      break;
    }

    case 'status': {
      runEngine('group-status.cjs', args.slice(1), effectiveLang);
      break;
    }

    case 'commit': {
      ensureGit('commit', effectiveLang);
      const rawArgs = args.slice(1);
      const commitArgs = [];
      for (let i = 0; i < rawArgs.length; i++) {
        const a = String(rawArgs[i] || '');
        if (a.startsWith('--lang=') || a.startsWith('-l=')) continue;
        if (a === '--lang' || a === '-l') {
          if (rawArgs[i + 1] && !String(rawArgs[i + 1]).startsWith('-')) i += 1;
          continue;
        }
        commitArgs.push(a);
      }
      if (commitArgs.length === 0) {
        commitArgs.push('--all');
      }
      runEngine('group-status.cjs', commitArgs, effectiveLang);
      break;
    }

    case 'pull': {
      ensureGit('pull', effectiveLang);
      runEngine('smart-pull.cjs', args.slice(1), effectiveLang);
      break;
    }

    case 'resolve': {
      ensureGit('resolve', effectiveLang);
      const resolveArgs = ['--resolve', ...args.slice(1).filter((a) => a !== '--resolve')];
      runEngine('smart-pull.cjs', resolveArgs, effectiveLang);
      break;
    }

    case 'audit':
    case 'audit-push': {
      ensureGit('audit', effectiveLang);
      runEngine('audit-push.cjs', args.slice(1), effectiveLang);
      break;
    }

    case 'id':
    case 'task':
    case 'pattern':
    case 'adr':
    case 'search':
    case 'migrate':
    case 'export':
    case 'import':
    case 'sync':
    case 'compact':
    case 'config':
    case 'stats': {
      runEngine('acm-db-cli.cjs', [command, ...args.slice(1)], effectiveLang);
      break;
    }

    case 'mcp': {
      runEngine('mcp-server.cjs', args.slice(1), effectiveLang);
      break;
    }

    default: {
      const tr = createTranslator(resolveLanguage(process.cwd(), effectiveLang));
      console.error(tr('cli.unknownCommand', { command }));
      printHelp(effectiveLang);
      process.exit(1);
    }
  }
}

main();

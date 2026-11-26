/**
 * scripts/acm/locales/en.cjs
 *
 * English (default) message catalog for Agent Context Memory (ACM).
 */

module.exports = {
  cli: {
    scriptNotFound: '[Error] Target script not found: {{scriptName}}',
    execError: '[Error] Failed to execute script:',
    unsupportedLang: '[Error] Unsupported language: "{{lang}}". Supported languages: en, ko',
    nonGitCommitSkip: '[Notice] Non-Git environment detected; skipping Git commit.',
    nonGitCommitHint: '         After user verification and approval, archive to task-completed.md.',
    nonGitToolSkip: '[Notice] Not a Git repository or Git is unavailable; skipping {{action}} tool.',
    installException: '[Error] Exception during installation:',
    uninstallException: '[Error] Exception during uninstallation:',
    unknownCommand: '[Error] Unknown command: "{{command}}"\n',
    unsupportedStorage: '[Error] Unsupported storage provider: "{{storage}}". Supported providers: sqlite, markdown',
    unsupportedBackupFormat: '[Error] Unsupported backup format: "{{format}}". Supported formats: zip, tar.gz, dir',
    unsupportedBackupTarget: '[Error] Unsupported backup target: "{{target}}". Supported targets: local, git, both',
    help: `
Agent Context Memory CLI (v{{version}})
Three-Tier Context Memory Governance & Task-Centric Engine

Usage:
  npx agent-context-memory [command] [options]
  npm run acm -- [db-command] [options]  (or: node scripts/acm/acm-db-cli.cjs [db-command])
  Or local: node bin/agent-context-memory.js [command] [options]

Commands:
  init [path] [options]       (default) Install Agent Context Memory templates into target path (default: '.')
                              * Omitting the command ('npx agent-context-memory') automatically runs init.
  uninstall [path] [options]  Safely remove and roll back ACM assets & injected rules (alias: remove)
  check-git                   Diagnose Git installation and repository status
  status [options]            Inspect task-centric Git status (group-status)
  commit [options]            Execute atomic task-centric commits (default: --all)
  pull [options]              Intelligent 3-Way remote sync & hybrid merge (smart-pull)
  resolve [options]           Resolve remaining 3-Way conflicts and complete merge commit
  audit                       Pre-push hygiene and static audit gate (alias: audit-push)
  id [task|pattern|adr]       Generate collision-free 6-char short IDs (TSK-XXXXXX / P-XXXXXX / LOG-XXXXXX)
  task [subcommand]           Manage tasks in local storage (list, add, update, complete, show, lease)
  pattern [subcommand]        Manage learned patterns (list, add, show)
  adr [subcommand]            Manage architecture decision records (list, add, show)
  search <query> [options]    Full-text search across tasks, patterns, and ADRs
  migrate [options]           Migrate storage between sqlite and markdown (--to=sqlite|markdown)
  export [options]            Export full memory store as JSON or Markdown
  import <file> [options]     Import a JSON snapshot into memory store
  sync [options]              Sync shared memories with Git orphan branch (acm-memory)
  compact [options]           Archive aged completed tasks, prune sync_log, and vacuum SQLite DB
  config [show|get|set]       Inspect or update retention and storage settings (.agents/acm/config.json)
  stats [--json]              Display memory store counts, DB size, and active retention policy
  mcp [--print-config]        Start zero-dependency stdio MCP server (or print client JSON config)

Options:
  -v, --version               Print CLI version
  -h, --help                  Show help
  -f, --force                 Skip prompts and force overwrite / strip modified rule blocks
  -l, --lang <en|ko>          Set installation/runtime language (default: en)
  --lang=<en|ko>              Same as --lang <en|ko>
  --storage=<sqlite|markdown> Select storage backend during init (default: sqlite on Node >= 22.13)
  --markdown-projection       Enable .agents/acm/task/*.md projection in SQLite mode (default: disabled)
  --non-interactive           Skip prompts on init/uninstall/status/pull/resolve safely (also ACM_NON_INTERACTIVE=1 / CI=true)
  --dry-run                   Preview actions without modifying files
  --no-backup                 (uninstall only) Skip creating .acm-backup-* backup
  --backup-format=<fmt>       (uninstall only) Backup format: zip (default), tar.gz, dir
  --backup-target=<target>    (uninstall only) Backup destination: local (default), git, both
  --backup-branch=<branch>    (init/uninstall) Git orphan branch for backups (default: acm-backups)
  --backup-remote=<remote>    (init/uninstall) Git remote for backup branch (default: origin)
  --restore-backup[=<ref>]    (init only) Restore from existing backup (latest, local, git, name, path)
  --no-restore-backup         (init only) Skip backup discovery/restore prompts
  --rule-file=<files>         Explicitly specify rule file(s) (comma-separated)
  -r <files>                  Shorthand for --rule-file

Examples:
  npx agent-context-memory
  npx agent-context-memory init --non-interactive --lang=ko --storage=sqlite --no-restore-backup
  npx agent-context-memory --force
  npx agent-context-memory init --storage=markdown
  npx agent-context-memory task list
  npx agent-context-memory search "atomic commit"
  npx agent-context-memory mcp --print-config
  npx agent-context-memory status
  npx agent-context-memory commit
  npx agent-context-memory commit --commit=1
  npx agent-context-memory pull
  npx agent-context-memory audit
  npx agent-context-memory uninstall --dry-run
  npx agent-context-memory uninstall --non-interactive
`,
  },

  install: {
    usage: `=======================================================
  Agent Context Memory Template Installer
=======================================================

Usage:
  node scripts/acm/install-template.cjs [target-directory] [options]

Options:
  --force, -f                 : Force overwrite existing files
  --lang=<en|ko>, -l          : Select template & CLI language (default: en)
  --storage=<sqlite|markdown> : Select storage backend (default: sqlite on Node >= 22.13)
  --markdown-projection       : Enable .agents/acm/task/*.md projection in SQLite mode (default: disabled)
  --non-interactive           : Skip interactive prompts (default: en, sqlite, AGENTS.md; also ACM_NON_INTERACTIVE=1 / CI=true)
  --restore-backup[=<ref>]    : Restore existing backup (latest, local, git, filename, or path)
  --no-restore-backup         : Skip backup detection and restore prompts
  --backup-branch=<name>      : Override Git backup orphan branch (default: acm-backups)
  --backup-remote=<name>      : Override Git remote for backup branch (default: origin)
  --rule-file=<files>         : Explicitly specify target rule file(s) (comma-separated)
  -r <files>                  : Shorthand for --rule-file

Examples:
  node scripts/acm/install-template.cjs .
  node scripts/acm/install-template.cjs D:/work/new-project --lang=ko
  node scripts/acm/install-template.cjs ./my-app --storage=markdown
  node scripts/acm/install-template.cjs ./my-app --rule-file=CLAUDE.md
  node scripts/acm/install-template.cjs ./my-app --force
`,
    missingTemplateDir: '[Error] Template source directory does not exist: {{dir}}',
    intro: 'Agent Context Memory (ACM) Setup & Initialization',
    langPromptMessage: 'Select language / 언어를 선택하세요:',
    langOptionEnLabel: 'English (Default)',
    langOptionEnHint: 'Recommended default for AI coding agents & lower token usage',
    langOptionKoLabel: '한국어 (Korean)',
    langOptionKoHint: '한국어 거버넌스 문서 및 CLI 출력',
    langPromptFallback: '  Select language / 언어를 선택하세요 [1: English (Default), 2: 한국어 (Korean)] (default: 1): ',
    langSelected: 'Language: {{label}}',
    storagePromptMessage: 'Select primary memory storage backend:',
    storageOptionSqliteLabel: 'Local SQLite DB (Recommended)',
    storageOptionSqliteHint: 'Built-in node:sqlite + FTS5 BM25 search (.agents/acm/local/memory.db); online sync ready later',
    storageOptionMarkdownLabel: 'Legacy Markdown Files',
    storageOptionMarkdownHint: 'Classic file-only .agents/ markdown governance (compatible with older Node.js)',
    storagePromptFallback: '  Select storage backend [1: Local SQLite DB (Recommended), 2: Legacy Markdown] (default: 1): ',
    storageSelected: 'Storage backend: {{label}}',
    storageFallbackMarkdownWarn: '  [Notice] Built-in node:sqlite requires Node.js >= 22.13.0 (current: {{version}}); falling back to markdown.',
    storageMigrated: '  [Migrate] Imported existing Markdown records into SQLite (tasks: {{tasks}}, completed: {{completedTasks}}, patterns: {{patterns}}, adrs: {{adrs}}).',
    backupPromptMessage: 'Existing ACM backup(s) detected. Restore one?',
    backupOptionRestoreLabel: 'Restore {{name}}',
    backupOptionRestoreHint: '{{source}} | {{format}} | {{size}} | {{date}}',
    backupOptionFreshLabel: 'Start fresh (ignore backups)',
    backupOptionFreshHint: 'Install clean ACM templates without restoring previous memory',
    backupPromptFallback: '  Existing backup(s) found:\n{{list}}\n  Select backup to restore [1-{{count}}] or 0 for fresh install (default: 1): ',
    backupSourceLocal: 'Local',
    backupSourceGit: 'Git: {{branch}}',
    backupSelected: 'Backup restore selected: {{name}} ({{source}})',
    backupRestored: '  [Restore] Restored {{count}} file(s) from {{name}} ({{source}}).',
    backupDetectedHint: '  [Notice] {{count}} ACM backup(s) found (latest: {{name}}, {{source}}). Re-run with --restore-backup to restore.',
    backupNotFound: 'Backup not found for restore specification: "{{spec}}"',
    backupInvalid: 'Invalid or corrupted backup "{{name}}": {{detail}}',
    summaryBackupRestored: 'Restored backup: {{name}} ({{source}}, {{count}} file(s))',
    targetAndMode: 'Target path: {{targetDir}}\nMode: {{mode}}',
    modeForce: 'Force overwrite (--force)',
    modeSafe: 'Safe preserve mode',
    gitEnabled: '{{version}} detected (Git repository integration active)',
    gitNonRepo: '{{version}} detected (Non-Git project: Git features run in limited mode)',
    gitMissing: 'Git not detected (Initializing in non-Git memory governance mode)',
    cancelled: 'Installation cancelled by user.',
    cancelledCli: '\n[Cancelled] Installation cancelled by user.\n',
    specifiedRuleFiles: 'Specified rule file(s): {{files}}',
    detectedRuleFiles: 'Auto-detected {{count}} existing AI agent rule file(s): {{files}}',
    spinnerStart: 'Copying template files and syncing governance rules...',
    spinnerStop: 'Template assets and governance sync complete',
    summary:
      'Template copy: {{created}} created / {{overwritten}} overwritten / {{skipped}} preserved' +
      '\nRule injection target(s): {{files}}' +
      '\npackage.json scripts added: {{addedCount}}',
    summaryStorage: 'Storage backend: {{storage}} (.agents/acm/config.json)',
    nextStepsTitle: 'Next Steps',
    outro: 'Agent Context Memory installation complete.',
    bannerStart: '  Agent Context Memory Setup & Initialization',
    bannerSource: '  Source   : {{dir}}',
    bannerTarget: '  Target   : {{dir}}',
    bannerLang: '  Language : {{lang}}',
    bannerStorage: '  Storage  : {{storage}}',
    bannerMode: '  Mode     : {{mode}}',
    bannerRule: '  Rules    : {{ruleFile}} (explicit)',
    bannerComplete: '  Agent Context Memory installation complete.',
    nextStepsHeading: 'Next Steps:',
    step1Scan: '[1/3] Scanning and resolving AI agent rule target files...',
    step2Copy: '\n[2/3] Copying template system files...',
    step2Stats: '  -> Copy result: {{created}} created / {{overwritten}} overwritten / {{skipped}} preserved\n',
    step3Rules: '[3/3] Syncing AI agent rule files...',
    copyKeep: '  [KEEP] {{file}} (already exists)',
    copyOverwrite: '  [OVERWRITE] {{file}}',
    copyCreate: '  [CREATE] {{file}}',
    hooksCreated: '  [CREATE] {{file}} (registered ACM hook: {{keys}})',
    hooksMerged: '  [MERGE] {{file}} (preserved host hooks, synced ACM key(s): {{keys}})',
    hooksKept: '  [KEEP] {{file}} (ACM hook already registered)',
    hooksParseError: '  [Warn] Failed to parse existing {{file}} as JSON object; preserving original file untouched.',
    pkgPostinstallSkip: '\n[Hook 1/2] postinstall mode: host package.json left untouched (run "npx agent-context-memory init" to inject acm / acm:* scripts).',
    pkgSyncStart: '\n[Hook 1/2] Configuring target package.json scripts...',
    pkgParseWarn: '  [Warn] Failed to parse existing package.json. Skipping script injection.',
    pkgSynced: '  -> Synced {{count}} acm:* script(s) into package.json.',
    gitignoreGitDetected: '\n[Hook 2/2] Git environment detected: syncing .gitignore...',
    gitignoreNoGit: '\n[Hook 2/2] Git not installed: skipping .gitignore sync.',
    gitignoreCreated: '  [CREATE] .gitignore (registered {{entries}})',
    gitignorePreserved: '  [KEEP] .gitignore ({{entries}} already registered)',
    gitignoreAppended: '  [SYNC] .gitignore (appended {{entries}})',
    nextCd: 'Move to project: cd "{{dir}}"',
    nextTask: 'Check working memory: .agents/acm/task/task.md',
    nextDbTip: 'Manage local memory DB: npm run acm -- task list / npm run acm -- search "<query>" (export MD: npm run acm -- export --format=md)',
    nextRules: 'Inspect governance rules: {{files}} and .agents/acm/ACM_GOVERNANCE.md',
    nextGitStatus: 'Check task-centric commit status: npm run acm:status',
    nextNonGitNote: '[Note] Git is unavailable; commit tools run in limited mode.',
    postinstallStart: '\n[ACM postinstall] Host project detected; starting automatic initialization...',
    postinstallWarn: '[ACM postinstall Warn] Skipping auto-init due to exception: {{message}}',
  },

  uninstall: {
    usage: `=======================================================
  Agent Context Memory Template Uninstaller
=======================================================

Usage:
  node scripts/acm/uninstall-template.cjs [target-directory] [options]

Options:
  --dry-run                : Simulate removal without deleting or modifying files
  --non-interactive        : Skip prompts safely (keeps default backup and preserves modified rule blocks)
  --force, -f              : Skip prompts and force-remove modified rule blocks
  --no-backup              : Skip creating .acm-backup-* backup
  --backup-format=<fmt>    : Backup format: zip (default), tar.gz, dir
  --backup-target=<target> : Backup destination: local (default), git, both
  --backup-branch=<name>   : Git backup orphan branch name (default: acm-backups)
  --backup-remote=<name>   : Git remote name for backup push (default: origin)
  --lang=<en|ko>, -l       : Set output language
  --rule-file=<files>      : Explicitly specify rule file(s) to clean (comma-separated)
  -r <files>               : Shorthand for --rule-file

Examples:
  node scripts/acm/uninstall-template.cjs .
  node scripts/acm/uninstall-template.cjs ./my-app --dry-run
  node scripts/acm/uninstall-template.cjs ./my-app --non-interactive
  node scripts/acm/uninstall-template.cjs ./my-app --force
  node scripts/acm/uninstall-template.cjs ./my-app --force --backup-target=both --backup-format=tar.gz
`,
    bannerTitle: '  Agent Context Memory Uninstall & Rollback',
    bannerTarget: '  Target : {{dir}}',
    bannerMode: '  Mode   : {{mode}}',
    modeDryRun: 'Simulation mode (--dry-run)',
    modeExecute: 'Live removal mode',
    bannerBackup: '  Backup : {{backup}}',
    backupSkip: 'Skip backup (--no-backup)',
    backupActive: 'Safe backup enabled',
    backupActiveFormat: 'Enabled (format={{format}}, target={{target}})',
    confirmPrompt: '\nAre you sure you want to remove Agent Context Memory from the target project? (y/N): ',
    backupConfirmPrompt: 'Back up ACM data (.agents/acm) before removal?',
    backupConfirmFallback: 'Back up ACM data before removal? (Y/n): ',
    backupTargetPrompt: 'Choose backup storage destination:',
    backupTargetLocalLabel: 'Local project archive (.acm-backup-*)',
    backupTargetLocalHint: 'Save compressed backup in project root',
    backupTargetGitLabel: 'Git orphan branch ({{branch}})',
    backupTargetGitHint: 'Commit isolated backup snapshot to {{branch}} (and push if remote exists)',
    backupTargetBothLabel: 'Both (Local + Git {{branch}})',
    backupTargetBothHint: 'Save locally and push isolated snapshot to Git branch {{branch}}',
    backupTargetFallback: 'Select backup destination [1: Local (default), 2: Git ({{branch}}), 3: Both]: ',
    gitBackupRequiresRepo: 'Git backup (--backup-target=git|both) requires an initialized Git repository.',
    invalidBackupRef: 'Invalid Git branch or remote reference name: "{{ref}}"',
    cancelled: '\n[Cancelled] Uninstallation aborted by user.\n',
    step1: '\n[1/5] Inspecting and removing ACM-owned directories...',
    dirMissing: '  [SKIP] {{path}} (not found)',
    dryBackup: '  [DRY-RUN] Would create backup directory: {{backupDir}}',
    dryBackupArchive: '  [DRY-RUN] Would create backup archive ({{format}}): {{backupFile}}',
    dryBackupGit: '  [DRY-RUN] Would push backup archive ({{format}}) to Git branch {{branch}} (remote: {{remote}}): {{backupFile}}',
    backupDone: '  [BACKUP] {{src}} -> {{dest}}',
    backupArchiveDone: '  [BACKUP] Created {{format}} archive: {{file}} ({{size}})',
    backupGitDone: '  [BACKUP GIT] Stored {{file}} on branch {{branch}} (commit: {{sha}})',
    backupGitPushWarn: '  [Warn] Saved backup commit locally, but pushing to remote "{{remote}}" failed: {{detail}}',
    dryDirDelete: '  [DRY-RUN] Would delete directory: {{path}}',
    dirDeleted: '  [REMOVED DIR] {{path}}',
    step2: '\n[2/5] Removing ACM-owned individual files...',
    dryFileDelete: '  [DRY-RUN] Would delete file: {{path}}',
    fileDeleted: '  [DELETED] {{path}}',
    fileSkippedProtected: '  [KEEP PROTECTED] {{path}} (pre-existing file protected from uninstall)',
    dryFileSkippedProtected: '  [DRY-RUN KEEP] {{path}} (pre-existing file protected from uninstall)',
    hooksMissing: '  [SKIP] {{file}} (not found)',
    hooksParseError: '  [Warn] Failed to parse {{file}} as JSON object; preserving original file untouched.',
    hooksNoKeys: '  [KEEP] {{file}} (no ACM hook keys found; preserved untouched)',
    dryHooksDelete: '  [DRY-RUN] Would delete {{file}} (created by ACM and no remaining keys)',
    dryHooksClean: '  [DRY-RUN] Would remove ACM hook key(s) [{{keys}}] from {{file}} (preserving host hooks)',
    dryHooksKeepEmpty: '  [DRY-RUN] Would clean ACM hook key(s) from {{file}} and keep empty host file',
    hooksDeleted: '  [DELETED] {{file}} (created by ACM and no remaining keys)',
    hooksCleaned: '  [CLEANED] Removed ACM hook key(s) [{{keys}}] from {{file}} (host hooks preserved)',
    hooksKeptEmpty: '  [KEEP] Cleaned ACM hook key(s) from {{file}}; preserved pre-existing host file',
    emptyDirCleaned: '  [CLEANED DIR] {{dir}}',
    userFilesPreserved: '  [KEEP DIR] {{dir}} (preserved {{count}} user file(s))',
    step3: '\n[3/5] Reverting package.json scripts...',
    pkgMissing: '  [SKIP] package.json not found',
    pkgParseWarn: '  [Warn] Failed to parse package.json; skipping script rollback.',
    pkgNoScripts: '  [SKIP] No scripts field found',
    dryScriptRemove: '  [DRY-RUN] Would remove script: "{{key}}"',
    scriptRemoved: '  [REMOVED SCRIPT] "{{key}}": "{{cmd}}"',
    scriptModifiedKeep: '  [KEEP] "{{key}}" was modified by user; preserving.',
    pkgReverted: '  -> Reverted {{count}} ACM script(s) from package.json.',
    step4: '\n[4/5] Reverting .gitignore rules...',
    gitignoreMissing: '  [SKIP] .gitignore not found',
    dryGitignoreKeepEmpty: '  [DRY-RUN] .gitignore (preserve existing user file, remove ACM entries only)',
    dryGitignoreDelete: '  [DRY-RUN] .gitignore (would delete file; no remaining non-ACM content)',
    dryGitignoreRemoveEntries: '  [DRY-RUN] Would strip ACM entries from .gitignore',
    gitignoreKeptEmpty: '  [KEEP] .gitignore (preserved existing user file, removed ACM entries)',
    gitignoreDeleted: '  [DELETED] .gitignore (no remaining non-ACM content)',
    gitignoreStripped: '  [CLEANED] Stripped ACM entries from .gitignore',
    gitignoreNone: '  [KEEP] No ACM entries found in .gitignore',
    step5: '\n[5/5] Stripping governance blocks from AI agent rule files...',
    dryRuleMatch: '  [DRY-RUN] {{file}} (governance block matches canonical -> will strip)',
    dryRuleModified: '  [DRY-RUN WARN] {{file}} (governance block modified -> requires confirmation)',
    ruleRemovedFile: '  [REMOVED FILE] {{file}} (governance stripped and empty file cleaned)',
    ruleCleaned: '  [CLEANED] {{file}} (governance block stripped, user rules preserved)',
    rulePreserved: '  [PRESERVED] {{file}} ({{detail}})',
    doneDryRun1: '  [DONE] Dry-run simulation complete.',
    doneDryRun2: '  No files were modified on disk.',
    doneReal: '  Agent Context Memory uninstall and rollback complete.',
    backupListHeader: 'Created backups:',
  },

  rules: {
    optAgentsHint: 'Standard guardrail single source of truth (Recommended)',
    optClaudeHint: 'Claude Code',
    optGeminiHint: 'Gemini CLI',
    optCursorHint: 'Cursor IDE',
    optWindsurfHint: 'Windsurf',
    optCustomLabel: 'Custom input (other rule file path)',
    optCustomHint: 'e.g. .github/copilot-instructions.md',
    detailNotExists: 'File does not exist',
    detailNoMarker: 'ACM governance marker not found',
    driftWarn: '\n  [Warn] ACM governance block inside "{{file}}" differs from the canonical template.',
    driftPrompt: '  -> Remove the modified governance block anyway? (y/N): ',
    driftPreservedUser: '  [KEEP] Preserved modified governance block in "{{file}}" per user confirmation.',
    detailUserDeclined: 'User declined removal',
    driftPreservedNonInteractive: '  [KEEP] Modified governance block detected in non-interactive session; preserved safely. (Force removal: --force)',
    detailNonInteractiveSafe: 'Preserved in non-interactive session',
    detailRemovedEmpty: 'File removed because no non-governance content remained',
    detailCleaned: 'Governance block stripped and user content preserved',
    fallbackNoRules: '\n  [Notice] No existing AI agent rule files were detected in the target project.',
    fallbackExamples: '  Examples: Claude (CLAUDE.md), Gemini (GEMINI.md), Cursor (.cursorrules), Standard (AGENTS.md)',
    fallbackPrompt: '  -> Enter rule file name(s) (default: AGENTS.md, comma-separated): ',
    clackNoRules: 'No existing AI agent rule files were detected in the target project.',
    clackSelectPrompt: 'Select AI agent rule file(s) (Up/Down to move, Space to toggle, Enter to confirm):',
    clackCustomPrompt: 'Enter custom rule file path(s) (comma-separated):',
    clackCustomRequired: 'Please enter at least one file path.',
    autoScanDetected: '  [Auto-Scan] Detected {{count}} existing AI agent rule file(s): {{files}}',
    autoFallbackDefault: '  [Auto-Fallback] No rule files detected; defaulting to AGENTS.md.',
    ruleCreated: '  [CREATE RULE] {{file}} (injected Agent Context Memory governance)',
    ruleSynced: '  [SYNC RULE] {{file}} (preserved existing content and updated governance)',
  },

  checkGit: {
    repoActive: '[Check] {{version}} detected (Git repository integration active)',
    nonRepo: '[Check] {{version}} detected (Non-Git project)',
    nonRepoDesc1: '[Notice] Target directory is not a Git repository (.git).',
    nonRepoDesc2: '  - Three-tier context memory governance and docs operate normally.',
    nonRepoDesc3: '  - Git-coupled features (auto commit, smart pull, audit) run in disabled/fallback mode.',
    nonRepoDesc4: '  - Run `git init` anytime to initialize Git integration.\n',
    noGitHeader: '[Notice] Git is not installed or not available in PATH.',
    noGitLine1: '1. Three-tier context memory governance and document workflows operate normally.',
    noGitLine2: '2. The following Git-coupled features run in limited fallback mode:',
    noGitFeature1: '   - Task-centric commit engine (group-status.cjs / commit)',
    noGitFeature2: '   - Commit SHA completion tracking (supports user-confirmed Non-Git archiving)',
    noGitFeature3: '   - Smart 3-Way merge & pre-push audit pipeline (smart-pull / audit-push)',
    noGitInstallTip: '3. Install Git to enable full capabilities:',
    noGitDownloadUrl: '   Official download: https://git-scm.com/downloads',
  },

  groupStatus: {
    taskParseWarn: '[Warn] Failed to parse task.md:',
    patternTitle: '[{{id}}] {{category}} Pattern',
    memoryStatus: 'Memory ({{id}})',
    changelogPurposeFallback: '{{key}}: {{val}}',
    commitBodyPurpose: '- Purpose: {{purpose}}',
    commitBodyDetails: '- Details:',
    bucketRulesTitle: 'Update project execution rules & governance docs',
    bucketRulesPurpose: 'Update GEMINI.md, AGENTS.md, README.md, and rule documents',
    bucketMemoryTitle: 'Sync memory tasks & knowledge base docs',
    bucketMemoryPurpose: 'Update working memory (task) and pattern/changelog docs',
    bucketScriptsTitle: 'Update development & automation scripts',
    bucketScriptsPurpose: 'Improve build, VCS, and workflow automation tools',
    bucketUiTitle: 'Refine UI components & stylesheets',
    bucketUiPurpose: 'Update design tokens, stylesheets, and UI components',
    bucketCoreTitle: 'Update shared config & project infrastructure',
    bucketCorePurpose: 'Update package manifests and global configuration files',
    bucketMiscTitle: 'Unregistered working tree changes (not in task.md)',
    bucketMiscPurpose: 'Files not registered as [Ready] in task.md (register in task.md before committing)',
    statusAuxiliary: 'Auxiliary',
    statusUnregistered: 'Unregistered (Needs task.md entry)',
    sourceAuto: 'Auto-classified',
    autoCompleteSqlite: '[Auto-Archive] {{tskId}} completion recorded in SQLite DB{{projMsg}}.',
    autoCompleteSqliteProj: ' and projected to task-completed.md',
    autoCompleteSqliteWarn: '[Warn] Failed to auto-archive completed task in SQLite: {{message}}',
    autoCompleteMd: '[Auto-Archive] {{tskId}} archived to {{file}}.',
    autoCompleteMdWarn: '[Warn] Failed to auto-archive completed task: {{message}}',
    sharedMissingSha: '[Error] Cannot verify HEAD SHA for shared task archive: {{title}}',
    sharedArchiveLog: '\n>>> [Shared Commit Archive] {{title}} (Preceding SHA: {{sha}})',
    commitExecLog: '\n>>> [Executing Commit] {{title}} ({{count}} file(s))',
    errTempIndexInit: '[Error] Failed to initialize temporary index: {{detail}}',
    errTempIndexRm: '[Error] Failed git rm in temporary index: {{title}}',
    errTempIndexAdd: '[Error] Failed git add in temporary index: {{title}}',
    errConflictMarkers: '[Error] Unresolved conflict marker(s) (<<<<<<<) detected:\n{{detail}}',
    errWriteTree: '[Error] git write-tree failed: {{detail}}',
    errNoActualChanges: '[Error] No actual file changes to commit: {{title}}',
    errCommitTree: '[Error] git commit-tree failed:\n{{detail}}',
    errUpdateRef: '[Error] git update-ref failed:\n{{detail}}',
    errGitRm: '[Error] git rm failed: {{title}}',
    errGitAdd: '[Error] git add failed: {{title}}',
    errGitCommit: '[Error] git commit failed:\n{{detail}}',
    commitSuccess: '[Success] Commit complete! (SHA: {{sha}})',
    commitHeader: '          Header: {{header}}',
    nonGitCompact: '[Non-Git] Git change detection disabled | Active tasks: {{activeCount}} | Patterns: {{patternCount}}',
    nonGitHeader: '  Agent Context Memory Status (Non-Git Mode)',
    nonGitSub1: '  [Notice] Not a Git repository or Git is unavailable.',
    nonGitSub2: '           (Change detection & auto-commit disabled; Memory Viewer active)',
    nonGitSec1: '[1] Working Memory ({{storageLabel}}) - {{count}} active task(s):',
    nonGitNoActive: '    (No active tasks in progress.)\n',
    nonGitPurpose: '       Purpose: {{purpose}}',
    nonGitTargets: '       Targets: {{targets}}',
    nonGitSec2: '[2] Changelog / ADRs - Latest {{count}}:',
    nonGitNoAdr: '    (No recent changelog entries recorded.)\n',
    nonGitSec3: '[3] Learned Patterns - Total {{count}}:',
    nonGitNoPattern: '    (No learned patterns recorded yet.)\n',
    nonGitFooterTitle: '  [Non-Git Task Completion Guide]',
    nonGitFooter1: '  - After reporting verification results to the user and obtaining approval,',
    nonGitFooter2: '    archive completed tasks (acm task complete / task-completed.md).',
    nonGitCommitBlocked: '[Notice] Cannot execute Git commit in a non-Git environment.',
    nonGitCommitBlockedHint: '         Confirm verification with the user and archive the completed task.',
    cleanCompact: '[CLEAN] No changes to commit (working tree clean)',
    cleanBanner: '  [Notice] Working tree is clean. (No files to commit)',
    compactSummary: '[Task-Centric Commit Status] {{totalFiles}} file(s) / {{groupCount}} group(s)',
    compactSharedCount: '{{count}} shared file(s)',
    compactFileCount: '{{count}} file(s)',
    compactRow: '[Group {{idx}}] {{status}} | {{title}} ({{countLabel}}) -> {{header}}',
    errNoMatchingGroup: '[Error] No matching task group found: {{arg}}',
    errNoReadyAll: '  [Aborted] No [Ready] task matched in working memory.',
    errNoReadyAllHint1: '            First record the task as "[Ready] TSK-K7M29A" via "acm task" (SQLite) or task.md (Markdown)',
    errNoReadyAllHint2: '            with (Purpose / Results / Targets), then run again.',
    allStart: '  [Sequential Atomic Commit Start] {{count}} [Ready] task(s)',
    allStepError: '\n[Aborted] Error occurred while committing task {{idx}}; stopping subsequent tasks.',
    allDone: '  [Done] Completed {{count}} atomic task commit(s).',
    allDoneRow: '- [Task {{idx}}] (SHA: {{sha}}) {{header}}',
    preservedTitle: '[Preserved] {{count}} file(s) not mapped to a [Ready] task were safely kept',
    preservedSubtitle: '            in the working tree to prevent unintended commits:',
    reportTitle: '  Agent Context Memory Task-Centric Commit Engine',
    reportPrinciple: '  [Principle] Atomic task commits driven by MemoryStore & task definitions',
    reportSummary: '[Notice] {{totalFiles}} file(s) grouped into {{groupCount}} task unit(s):\n',
    reportSharedCount: 'Shares {{count}} file(s) with preceding task - archives with its SHA on commit',
    reportFileCount: '{{count}} file(s)',
    reportGroupHeader: '[Group {{idx}}] [{{status}}] {{title}} ({{countLabel}})',
    reportSource: '  Source : {{source}}',
    reportPurpose: '  Purpose: {{purpose}}',
    reportRenameSuffix: ' (was: {{oldFile}})',
    reportSharedTag: '[SHARED]',
    reportCommitMsgLabel: '\n  [Generated Commit Message]:',
    optionsTitle: '  [Execution Options]',
    optCommitOne: '  - Commit single group : node scripts/acm/group-status.cjs --commit=<num|TSK-XXXXXX|prefix>',
    optCommitAll: '  - Commit all [Ready]  : node scripts/acm/group-status.cjs --all',
    optCompact: '  - Agent compact view  : node scripts/acm/group-status.cjs --compact',
    dryRunDone: '[Dry-Run Complete] Exited without executing commits.',
    nonInteractiveSkip1: '[Non-Interactive] Skipping interactive prompt and exiting cleanly.',
    nonInteractiveSkip2: '                  Use --commit=<num> or --all to execute commits.\n',
    promptSelect: '[Select] Enter task group number to commit (e.g. 1 or 2, "all" for [Ready], "q" to quit): ',
    promptCancelled: '[Cancelled] Commit operation aborted.',
    promptNoReady: '\n[Aborted] No [Ready] task matched in task.md.',
    promptAllStart: '\n[Executing Sequential Atomic Commits] {{count}} [Ready] task(s)',
    promptAbortedError: '[Aborted due to error]',
    promptInvalidRange: '[Error] Please enter a number between 1 and {{max}}.',
  },

  smartPull: {
    bannerTitle: '  Agent Context Memory Smart Remote Sync & Merge Engine (smart-pull)',
    virtualMergeLog: '[Pre-Check] Simulating in-memory virtual merge (git merge-tree) for {{remote}}/{{branch}}...',
    ruleImportExport: 'Import/Export union coexistence merge',
    ruleJsonKeyValue: 'JSON key-value coexistence merge',
    ruleFunctionBlock: 'Independent function/method sequential merge',
    ruleJsxProps: 'JSX/HTML tag attributes coexistence merge',
    ruleUnresolved: 'Auto-resolution unavailable (manual selection or review required)',
    fileNotFound: 'File not found',
    gatesTitle: '  Agent Context Memory Post-Merge 3 Quality Gates',
    gate1Start: '[Gate 1/3] Checking for leftover conflict markers (<<<<<<<)...',
    gate1Fail: '  [Fail] Leftover conflict markers detected:\n',
    gate1Pass: '  -> Pass: 0 conflict markers remaining.\n',
    gate2Start: '[Gate 2/3] Static analysis check (lint / typecheck)...',
    gate2Skip: '  -> [Skip] Neither lint nor typecheck script is defined in package.json.\n',
    gate2Run: '  -> Running: npm run {{scriptName}}',
    gate2Fail: '  [Fail] Static analysis (npm run {{scriptName}}) failed:\n',
    gate2Pass: '  -> Pass: Static analysis complete.\n',
    gate3Start: '[Gate 3/3] Project build integrity check (npm run build)...',
    gate3Skip: '  -> [Skip] No build script defined in package.json.\n',
    gate3Pass: '\n  -> Pass: Project build integrity verified.\n',
    gate3Fail: '\n  [Fail] Project build failed. Please inspect source syntax or imports.',
    manualNeeded: '[Manual Choice Required] File: {{filePath}} (Chunk #{{chunkIdx}})',
    manualOurs: '<<< [Local HEAD (Ours)]:\n{{ours}}\n===',
    manualTheirs: '>>> [Remote Changes (Theirs)]:\n{{theirs}}',
    manualPromptTitle: 'Choose resolution:',
    manualChoice1: '  1: Keep Ours (local)',
    manualChoice2: '  2: Keep Theirs (remote)',
    manualChoice3: '  3: Keep Both (Ours then Theirs)',
    manualChoice4: '  4: Keep Both (Theirs then Ours)',
    manualChoice5: '  5: Skip (leave markers for manual edit)',
    manualQuestion: 'Choice (1-5): ',
    checkFetchStart: '[1/2] Fetching remote branch info (git fetch {{remote}} {{branch}})...',
    checkFetchDone: '  -> Remote sync complete.\n',
    checkFetchWarn: '  [Warn] Remote fetch failed (offline/network). Checking against local cache.\n',
    checkSimStart: '[2/2] Running virtual merge simulation...',
    branchStatus: '\n[Branch Status] Local ahead: {{ahead}} commit(s) / Remote behind: {{behind}} commit(s)',
    alreadyUpToDate: '\n[Success] Local branch already has all latest remote commits.',
    noMergeNeeded: '          No pull or merge required.\n',
    conflictsExpected: '[Notice] Conflicts predicted in {{count}} file(s):',
    conflictFileLine: '  [CONFLICT] {{file}}',
    autoMergeableTitle: '\n[Info] The following file(s) will merge cleanly:',
    autoMergeableLine: '  [AUTO-MERGE] {{file}}',
    checkResolutionHint1: '\n[Next Step]',
    checkResolutionHint2: '  Run "npm run acm:pull" to trigger the hybrid conflict resolver',
    checkResolutionHint3: '  and 3 quality gates automatically.\n',
    checkCleanSuccess: '\n[Success] Zero conflicts predicted! (100% auto-mergeable)',
    autoMergeTargetTitle: '\n[Auto-Merge Files]:',
    checkCleanHint: '\nRun "npm run acm:pull" to merge safely.\n',
    resolveModeStart: '[Resolve Mode] Inspecting conflicted files in working tree...',
    resolveAllStaged: '  -> All conflicts appear already resolved and staged.',
    resolveProceedGates: '  -> Proceeding to quality gates and merge commit.\n',
    resolveNothing: '  -> No unmerged files or active merge in progress.\n',
    resolveDetectedCount: '  -> Detected {{count}} conflicted file(s):\n',
    resolvingFile: '[Resolving] {{file}} ...',
    resolvingFilePull: '  [Analyzing & Merging] {{file}} ...',
    resolvedAllChunks: '  -> Success: Auto-resolved {{count}} conflict chunk(s)!',
    resolvedAllChunksPull: '    -> Success: Auto-resolved {{count}} conflict chunk(s)!',
    chunkApplied: '     Chunk #{{index}}: Applied [{{rule}}]',
    chunkAppliedPull: '       Chunk #{{index}}: Applied [{{rule}}]',
    partialResolve: '  -> Notice: Some chunks could not be auto-resolved ({{resolved}}/{{total}} resolved)',
    partialResolvePull: '    -> Notice: Some chunks could not be auto-resolved ({{resolved}}/{{total}} resolved)',
    manualChoiceApplied: '     Chunk #{{index}}: Applied manual selection',
    manualChoiceAppliedPull: '       Chunk #{{index}}: Applied manual selection',
    markersRemainWarn: '  [Warn] Unresolved conflict markers remain in {{file}}.',
    markersRemainWarnPull: '    [Warn] Unresolved conflict markers remain in {{file}}.',
    resolveUnresolvedErr: '\n[Error] Some conflicts could not be resolved automatically. Inspect the file(s) manually.\n',
    resolveDryRunDone: '\n[Dry-Run Complete] No files were written or committed.\n',
    gatesFailedHold: '\n[Quality Gate Failed] Merge commit held because one or more quality gates failed.\n',
    creatingMergeCommit: '[Creating Merge Commit] Finalizing atomic merge commit...',
    mergeCommitMsg: 'merge: hybrid precision merge of remote ({{remote}}/{{branch}})',
    resolveSuccess: '\n[Success] Precision hybrid merge and commit complete! (Commit: {{sha}})\n',
    mergeCommitErr: '  [Error] Merge commit failed:',
    pullStep1: '[1/5] Checking working tree status...',
    pullDirtyErr1: '\n[Error] Uncommitted changes exist in the working tree.',
    pullDirtyErr2: '        Run "npm run acm:commit" or stash changes first.\n',
    pullCleanOk: '  -> Working tree is clean.\n',
    pullStep2: '[2/5] Fetching remote repository (git fetch {{remote}} {{branch}})...',
    pullFetchOk: '  -> Remote fetch complete.\n',
    pullFetchErr: '  [Error] Remote fetch failed:',
    pullStep3: '[3/5] Running pre-merge virtual diagnosis...',
    pullStatusLine: '  -> Local ahead: {{ahead}} commit(s) / Remote behind: {{behind}} commit(s)',
    pullAlreadyLatest: '\n[Notice] Already up to date with all remote commits. Exiting.\n',
    pullFastForward: '\n[Fast-forward] No local ahead commits; performing fast-forward merge...',
    pullFastForwardOk: '\n[Success] Fast-forward merge complete.\n',
    pullStep4: '\n[4/5] Merging remote branch (git merge {{remote}}/{{branch}})...',
    pullCleanMergeOk: '  -> Merged cleanly with zero conflicts!\n',
    pullConflictDetected: '  -> Conflicts detected. Launching precision hybrid merge engine.\n',
    pullBuildFailWarn: '\n[Warn] Post-merge build verification failed. Please inspect the codebase.\n',
    pullMergeOk: '\n[Success] Remote merge complete. (Commit: {{sha}})\n',
    pullStep5: '[5/5] Running precision hybrid conflict resolution engine...',
    pullConflictCount: '  -> Conflicted file(s): {{count}}\n',
    pullUnresolvedWarn: '\n[Notice] Unresolved files remain. Edit conflict markers manually and run "npm run acm:resolve".\n',
    pullGatesFailed1: '\n[Quality Gate Failed] Merge commit withheld due to quality gate failure.',
    pullGatesFailed2: 'Fix the issues and run "npm run acm:resolve".\n',
    pullCommitStart: '\n[Creating Merge Commit] Finalizing hybrid merge commit...',
    pullSuccessBannerTitle: '  [Success] Precision remote merge & quality gates passed!',
    pullSuccessSha: '  Merge Commit SHA: {{sha}}',
    fatalErr: '\n[Fatal Error]:',
  },

  auditPush: {
    bannerTitle: '  Agent Context Memory Pre-Push Hygiene Audit Gate',
    gate1Start: '[1/3] Scanning for leftover conflict markers (<<<<<<<)...',
    gate1DetectErr: '  [Error] Leftover conflict markers detected:',
    gate1Pass: '  -> Pass: No leftover conflict markers.\n',
    gate1Fail: '  [Error] Failed conflict marker check:\n',
    gate2Start: '[2/3] Checking local working tree cleanliness...',
    gate2Dirty: '  [Notice] Uncommitted changes exist in your working tree:',
    gate2DirtyHint: '  -> Run "npm run acm:status" or commit changes before pushing.\n',
    gate2Pass: '  -> Pass: Working tree is clean.\n',
    gate3Start: '[3/3] Auditing pending push files against {{target}}...',
    localHeadLabel: 'local HEAD',
    gate3Fallback: '  [Notice] Comparison with {{target}} failed. Falling back to HEAD inspection.',
    gate3NoDiff: '  -> No new commits pending push compared to remote (already up to date).\n',
    gate3Count: '  [Notice] {{count}} file(s) included in pending push.',
    reasonTempScript: 'One-off temporary script',
    reasonScratchScript: 'One-off scratch script',
    reasonLocalTestScript: 'Ad-hoc local test script',
    reasonReportTxt: 'One-off analysis report text file',
    reasonTmpFile: 'Temporary file (*.tmp)',
    reasonBakFile: 'Backup file (*.bak)',
    reasonLogFile: 'Log file (*.log)',
    reasonLocalDbFile: 'Local SQLite DB file (*.db / *.db-wal / *.db-shm)',
    forbiddenDetected: '\n  [Warn] Unwanted temporary or one-off files detected in push payload:',
    remediationHeader: '\n  [Action Required] Remove them with git rm and amend/commit before pushing:',
    remediationCommit: '    git commit -m "chore: remove temporary scripts"\n',
    gate3Pass: '  -> Pass: No one-off scripts or forbidden temporary files detected.\n',
    failBanner: '  [FAIL] Pre-push hygiene audit failed.',
    passBanner: '  [PASS] Pre-push hygiene audit passed 100%! Safe to push.',
  },

  storage: {
    invalidTaskNumber: 'Invalid task number: {{num}}',
    invalidPatternNumber: 'Invalid pattern number: {{num}}',
    invalidAdrNumber: 'Invalid ADR number: {{num}}',
    ambiguousCodePrefix: 'Ambiguous code prefix "{{id}}"; multiple matches found: {{matches}}',
    invalidConfigJson: 'Failed to parse config.json ({{path}}): {{message}}',
    invalidProviderReg: 'A valid provider name and factory function are required.',
    unknownProvider: '[Config Error] Unregistered storage provider: "{{name}}" (supported: {{supported}})',
    readyMissingPurpose: 'purpose',
    readyMissingResults: 'results',
    readyMissingTargets: 'targets',
    readyValidationError: '[Validation Failed] Transitioning to [Ready] requires all 3 elements. Missing: {{missing}}',
    sqliteRequired:
      '[Environment Error] Local SQLite storage requires built-in node:sqlite in Node.js >= 22.13.0. ' +
      'Current runtime ({{version}}): upgrade Node.js or set storage.provider to "markdown".',
    taskInputRequired: 'Task input object is required.',
    taskTitleRequired: 'Task title is required.',
    taskNotFoundComplete: 'Task to complete not found: {{id}}',
    taskNotFound: 'Task not found: {{id}}',
    leaseOwnerRequired: 'Lease owner identifier is required.',
    leaseTaskNotFoundSet: 'Task not found for lease acquisition: {{id}}',
    leaseTaskNotFoundRelease: 'Task not found for lease release: {{id}}',
    patternInputRequired: 'Pattern input object is required.',
    patternSupersedesNotFound: 'Superseded pattern not found: {{ref}}',
    patternTitleRequired: 'Pattern title is required.',
    adrInputRequired: 'ADR input object is required.',
    adrTitleRequired: 'ADR title is required.',
    snapshotInvalid: 'Valid snapshot object is required.',
    defaultCategory: 'General',
  },

  dbCli: {
    help: `
ACM Memory DB CLI

Usage:
  acm <command> [subcommand] [options]

Commands:
  id [task|pattern|adr] [--count=N]           Generate collision-free short IDs
  task [list|add|update|complete|show|lease]  Manage tasks
  pattern [list|add|show]                     Manage learned patterns
  adr [list|add|show]                         Manage architecture decision records
  search <query>                              Full-text BM25 search across memory store
  migrate --to=<sqlite|markdown>              Migrate between SQLite DB and Markdown files
  export [--format=json|md] [--out=<path>]    Export memory store snapshot
  import <file> [--strategy=merge|skip|replace] Import snapshot into memory store
  sync [--pull|--push|--status] [--dry-run]   Sync shared memories via Git orphan branch
  compact [--dry-run] [--days=N]              Archive aged done tasks, prune sync_log, and vacuum DB
  config [show|get|set]                       Inspect or update .agents/acm/config.json settings
  stats [--json]                              Show DB counts, size, and retention settings

Common options:
  --json                 Output machine-readable JSON
  --lang=<en|ko>         Set CLI output language
  -h, --help             Show command-specific help
`,
    taskHelp: `
Usage: acm task <subcommand> [options]

Subcommands:
  list [--status=todo|in_progress|ready|done|paused] [--all|--done] [--json]
  show <idOrCode> [--json]
  add [title] [--title=...] [--status=...] [--purpose=...] [--result=...] [--target=...] [--group=...] [--owner=...] [--stdin] [--skip-validation] [--json]
  update <idOrCode> [--title=...] [--status=...] [--purpose=...] [--result=...] [--target=...] [--group=...] [--owner=...] [--stdin] [--skip-validation] [--json]
  complete <idOrCode> [--sha=<sha>] [--json]
  lease <idOrCode> --owner=<agentId> [--ttl=600] [--release] [--force] [--json]
`,
    patternHelp: `
Usage: acm pattern <subcommand> [options]

Subcommands:
  list [--category=...] [--include-superseded] [--json]
  show <idOrCode> [--json]
  add [title] [--title=...] [--category=...] [--summary=...] [--symptom=...] [--solution=...] [--file=...] [--tag=...] [--supersedes=<uid|code>] [--author=...] [--stdin] [--json]
`,
    adrHelp: `
Usage: acm adr <subcommand> [options]

Subcommands:
  list [--limit=20] [--json]
  show <idOrCode> [--json]
  add [title] [--date=YYYY-MM-DD] [--summary=...] [--area=...] [--task=TSK-XXXXXX] [--branch=...] [--context=...] [--decision=...] [--impact=...] [--author=...] [--stdin] [--json]
`,
    idHelp: `
Usage: acm id [task|pattern|adr] [options]

Options:
  --count=<1..20>   Number of collision-free short IDs to generate (default: 1)
  --json            Output machine-readable JSON
`,
    invalidIdKind: '[Error] Invalid ID kind: "{{kind}}". Expected task, pattern, or adr.',
    invalidIdCount: '[Error] Invalid --count value: "{{count}}". Expected an integer between 1 and 20.',
    searchHelp: `
Usage: acm search <query> [options]

Options:
  --kind=all|task|pattern|adr   Filter entity kind (default: all)
  --limit=10                    Max number of results
  --budget=0                    Token budget cap (0 = unlimited)
  --json                        Output machine-readable JSON
`,
    migrateHelp: `
Usage: acm migrate --to=<sqlite|markdown> [options]

Options:
  --to=<sqlite|markdown>  Target storage backend
  --dry-run               Preview migration counts without writing files or config
  --json                  Output machine-readable JSON
`,
    exportHelp: `
Usage: acm export [options]

Options:
  --format=json|md    Export format (default: json)
  --out=<path>        Output file (json) or directory (md)
  --include-deleted   Include soft-deleted records (json only)
  --json              Output machine-readable JSON summary
`,
    importHelp: `
Usage: acm import <file|-> [options]

Options:
  --strategy=merge|skip|replace  Import conflict strategy (default: merge)
  --stdin                        Read JSON snapshot from stdin
  --json                         Output machine-readable JSON
`,
    unknownCommand: '[Error] Unknown DB command: "{{command}}"',
    unknownSubcommand: '[Error] Unknown subcommand "{{subcommand}}" for "{{command}}"',
    missingArg: '[Error] Missing required argument: {{arg}}',
    invalidJsonStdin: '[Error] Failed to parse JSON input from stdin: {{message}}',
    invalidStrategy: '[Error] Invalid import strategy: "{{strategy}}". Expected merge, skip, or replace.',
    invalidFormat: '[Error] Invalid export format: "{{format}}". Expected json or md.',
    invalidTargetProvider: '[Error] Invalid migration target: "{{to}}". Expected sqlite or markdown.',
    fileNotFound: '[Error] Input file not found: {{file}}',
    notFound: '[Error] Record not found: {{id}}',
    execError: '[Error] {{message}}',
    noResults: '(No matching records found.)',
    taskListHeader: '[Tasks] ({{provider}}) - {{count}} record(s):',
    patternListHeader: '[Patterns] ({{provider}}) - {{count}} record(s):',
    adrListHeader: '[ADRs] ({{provider}}) - {{count}} record(s):',
    searchHeader: '[Search: "{{query}}"] - {{count}} match(es):',
    taskCreated: '[Task Created] {{code}}: {{title}} [{{status}}]',
    taskUpdated: '[Task Updated] {{code}}: {{title}} [{{status}}]',
    taskCompleted: '[Task Completed] {{code}}: {{title}} (Commit/Ref: {{sha}})',
    leaseAcquired: '[Lease Acquired] {{code}} -> {{owner}} (expires: {{expiresAt}})',
    leaseBusy: '[Lease Conflict] {{code}} is currently held by {{holder}} until {{expiresAt}}',
    leaseReleased: '[Lease Released] {{code}}',
    patternSaved: '[Pattern Saved] {{code}} (v{{version}}): {{title}}',
    adrSaved: '[ADR Saved] {{code}} [{{date}}]: {{title}}',
    migrateDryRun: '[Dry-Run] Migration preview ({{from}} -> {{to}}): tasks={{tasks}}, completed={{completedTasks}}, patterns={{patterns}}, adrs={{adrs}}',
    migrateDone: '[Migrated] Storage switched to "{{to}}": tasks={{tasks}}, completed={{completedTasks}}, patterns={{patterns}}, adrs={{adrs}}',
    migrateAlready: '[Info] Storage provider is already configured as "{{to}}"; refreshed records.',
    exportJsonDone: '[Exported JSON] Wrote snapshot to {{out}}',
    exportMdDone: '[Exported Markdown] Wrote Markdown views to {{out}}',
    importDone: '[Imported] Strategy={{strategy}}: tasks={{tasks}}, patterns={{patterns}}, adrs={{adrs}}, skipped={{skipped}}',
    syncHelp: `
Usage: acm sync [options]

Options:
  --pull                 Fetch and merge remote shared memories into local SQLite DB
  --push                 Merge, scrub secrets, and push shared memories to orphan branch
  --status               Show orphan branch status, counts, and recent sync history
  --dry-run              Preview sync counts and secret redactions without writing
  --branch=<name>        Override sync branch (default: acm-memory)
  --remote=<name>        Override Git remote (default: origin)
  --no-scrub             Disable outbound Secret Scrubber (not recommended)
  --json                 Output machine-readable JSON
`,
    syncInvalidRef: '[Error] Invalid Git branch or remote reference name: "{{ref}}"',
    syncRequiresSqlite: '[Error] Git orphan sync requires SQLite storage mode. Run "acm migrate --to=sqlite" first.',
    syncNonGitSkip: '[Notice] Non-Git environment detected; skipping Git orphan sync.',
    syncStatusHeader: '[Sync Status] branch={{branch}} remote={{remote}} localSha={{localSha}} remoteSha={{remoteSha}} lastSync={{lastSync}}',
    syncDryRun: '[Dry-Run] Sync preview ({{direction}} -> {{branch}}): pulled={{pulled}}, pushed={{pushed}}, conflicts={{conflictsResolved}}, redacted={{redactedCount}}',
    syncDone: '[Synced] {{direction}} on {{branch}} (commit={{commitSha}}): pulled={{pulled}}, pushed={{pushed}}, conflicts={{conflictsResolved}}, redacted={{redactedCount}}',
    syncScrubWarn: '[Secret Scrubber] Redacted {{count}} sensitive token(s) before sync ({{types}}).',
    compactHelp: `
Usage: acm compact [options]

Options:
  --dry-run              Preview candidates without modifying DB or files
  --days=<N>             Override retention.doneTaskFtsDays (-1 = unlimited, 0 = immediate)
  --sync-log-max=<N>     Override retention.syncLogMaxRows (-1 = unlimited)
  --no-vacuum            Skip FTS5 optimize, WAL checkpoint, and VACUUM
  --export-archive       Export newly archived tasks to .agents/acm/memory/archive/tasks-YYYY.jsonl
  --json                 Output machine-readable JSON
`,
    configHelp: `
Usage: acm config <subcommand> [options]

Subcommands:
  show                        Show current configuration (default)
  get <key>                   Get a configuration value (e.g. retention.doneTaskFtsDays)
  set <key> <value>           Update a setting in .agents/acm/config.json
                              Writable keys: retention.doneTaskFtsDays, retention.doneTaskProjectionLimit,
                              retention.syncLogMaxRows, retention.stalePatternDays,
                              retention.tombstoneRetentionDays, storage.markdownProjection
  --json                      Output machine-readable JSON
`,
    statsHelp: `
Usage: acm stats [options]

Options:
  --json                 Output machine-readable JSON
`,
    invalidIntFlag: '[Error] Invalid value for {{flag}}: "{{value}}". Expected an integer >= -1.',
    compactSkipped: '[Compact] Skipped in "{{provider}}" storage mode.',
    compactDryRun: '[Dry-Run] Compact preview: tasksToArchive={{archivedTasks}}, syncLogsToPrune={{prunedSyncLogs}}, dbSize={{sizeBefore}}',
    compactDone: '[Compacted] Archived tasks={{archivedTasks}}, pruned sync_log={{prunedSyncLogs}}, dbSize={{sizeBefore}} -> {{sizeAfter}} (reclaimed {{reclaimed}})',
    compactArchiveFiles: '  [Cold Archive] Exported to: {{files}}',
    configHeader: '[ACM Config] provider={{provider}} explicit={{explicit}}',
    configUnknownKey: '[Error] Unknown config key: "{{key}}"',
    configInvalidValue: '[Error] Invalid value "{{value}}" for "{{key}}".',
    configImmutableOrUnknown: '[Error] Unknown or read-only config key: "{{key}}"',
    configUpdated: '[Config Updated] {{key}} = {{value}}',
    statsHeader: '[ACM Stats] provider={{provider}} schema=v{{schemaVersion}} dbSize={{size}}',
    statsTasks: '  Tasks    : total={{total}}, active={{active}}, ready={{ready}}, done={{done}}, archived={{archived}}',
    statsPatterns: '  Patterns : total={{total}}, active={{active}}, superseded={{superseded}}, archived={{archived}}',
    statsAdrs: '  ADRs     : total={{total}} | sync_log={{syncLogs}}',
    statsRetention: '  Retention: doneTaskFtsDays={{doneTaskFtsDays}}, doneTaskProjectionLimit={{doneTaskProjectionLimit}}, syncLogMaxRows={{syncLogMaxRows}}',
  },

  mcp: {
    help: `
ACM Stdio MCP Server

Usage:
  npx agent-context-memory mcp [options]
  node scripts/acm/mcp-server.cjs [options]

Options:
  --print-config         Print ready-to-paste MCP client JSON configuration snippets
  --json                 Print raw JSON snippets when combined with --print-config
  --root=<dir>           Target workspace root directory (default: current directory)
  -l, --lang <en|ko>     Output language for CLI notices and validation messages
  -h, --help             Show this help message
`,
    printConfigHeader: '[ACM MCP] Ready-to-paste MCP client configuration snippets (workspace: {{rootDir}}):',
    printConfigNote: 'Tip: Merge either "mcpServers" entry into your MCP client config (Antigravity, Claude Code, Cursor, etc.). Diagnostics log to stderr; stdio speaks JSON-RPC 2.0.',
  },
};

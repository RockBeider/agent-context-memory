/**
 * scripts/locales/en.cjs
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
    help: `
Agent Context Memory CLI (v{{version}})
Three-Tier Context Memory Governance & Task-Centric Engine

Usage:
  npx agent-context-memory [command] [options]
  npx acm [command] [options]
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

Options:
  -v, --version               Print CLI version
  -h, --help                  Show help
  -f, --force                 Skip confirmation prompts and force overwrite
  -l, --lang <en|ko>          Set installation/runtime language (default: en)
  --lang=<en|ko>              Same as --lang <en|ko>
  --non-interactive           Skip interactive prompts (auto-defaults to en & AGENTS.md)
  --dry-run                   Preview actions without modifying files
  --no-backup                 (uninstall only) Skip creating .agents backup directory
  --rule-file=<files>         Explicitly specify rule file(s) (comma-separated)
  -r <files>                  Shorthand for --rule-file

Examples:
  npx agent-context-memory
  npx agent-context-memory --lang=ko
  npx agent-context-memory --force
  npx agent-context-memory init
  npx agent-context-memory status
  npx agent-context-memory commit
  npx agent-context-memory commit --commit=1
  npx agent-context-memory pull
  npx agent-context-memory audit
  npx agent-context-memory uninstall --dry-run
`,
  },

  install: {
    usage: `=======================================================
  Agent Context Memory Template Installer
=======================================================

Usage:
  node scripts/install-template.cjs [target-directory] [options]

Options:
  --force, -f             : Force overwrite existing files
  --lang=<en|ko>, -l      : Select template & CLI language (default: en)
  --non-interactive       : Skip interactive prompts (default: en, AGENTS.md)
  --rule-file=<files>     : Explicitly specify target rule file(s) (comma-separated)
  -r <files>              : Shorthand for --rule-file

Examples:
  node scripts/install-template.cjs .
  node scripts/install-template.cjs D:/work/new-project --lang=ko
  node scripts/install-template.cjs ./my-app --rule-file=CLAUDE.md
  node scripts/install-template.cjs ./my-app --force
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
    nextStepsTitle: 'Next Steps',
    outro: 'Agent Context Memory installation complete.',
    bannerStart: '  Agent Context Memory Setup & Initialization',
    bannerSource: '  Source   : {{dir}}',
    bannerTarget: '  Target   : {{dir}}',
    bannerLang: '  Language : {{lang}}',
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
    pkgPostinstallSkip: '\n[Hook 1/2] postinstall mode: host package.json left untouched (run "npx acm init" to inject git:* scripts).',
    pkgSyncStart: '\n[Hook 1/2] Configuring target package.json scripts...',
    pkgParseWarn: '  [Warn] Failed to parse existing package.json. Skipping script injection.',
    pkgSynced: '  -> Synced {{count}} git:* script(s) into package.json.',
    gitignoreGitDetected: '\n[Hook 2/2] Git environment detected: syncing .gitignore...',
    gitignoreNoGit: '\n[Hook 2/2] Git not installed: skipping .gitignore sync.',
    gitignoreCreated: '  [CREATE] .gitignore (registered {{entries}})',
    gitignorePreserved: '  [KEEP] .gitignore ({{entries}} already registered)',
    gitignoreAppended: '  [SYNC] .gitignore (appended {{entries}})',
    nextCd: 'Move to project: cd "{{dir}}"',
    nextTask: 'Check working memory: .agents/task/task.md',
    nextRules: 'Inspect governance rules: {{files}} and .agents/MEMORY_GOVERNANCE.md',
    nextGitStatus: 'Check task-centric commit status: npm run git:status',
    nextNonGitNote: '[Note] Git is unavailable; commit tools run in limited mode.',
    postinstallStart: '\n[ACM postinstall] Host project detected; starting automatic initialization...',
    postinstallWarn: '[ACM postinstall Warn] Skipping auto-init due to exception: {{message}}',
  },

  uninstall: {
    usage: `=======================================================
  Agent Context Memory Template Uninstaller
=======================================================

Usage:
  node scripts/uninstall-template.cjs [target-directory] [options]

Options:
  --dry-run               : Simulate removal without deleting or modifying files
  --force, -f             : Skip interactive confirmation prompts
  --no-backup             : Skip creating .agents backup directory
  --lang=<en|ko>, -l      : Set output language
  --rule-file=<files>     : Explicitly specify rule file(s) to clean (comma-separated)
  -r <files>              : Shorthand for --rule-file

Examples:
  node scripts/uninstall-template.cjs .
  node scripts/uninstall-template.cjs ./my-app --dry-run
  node scripts/uninstall-template.cjs ./my-app --force
`,
    bannerTitle: '  Agent Context Memory Uninstall & Rollback',
    bannerTarget: '  Target : {{dir}}',
    bannerMode: '  Mode   : {{mode}}',
    modeDryRun: 'Simulation mode (--dry-run)',
    modeExecute: 'Live removal mode',
    bannerBackup: '  Backup : {{backup}}',
    backupSkip: 'Skip backup (--no-backup)',
    backupActive: 'Safe backup enabled',
    confirmPrompt: '\nAre you sure you want to remove Agent Context Memory from the target project? (y/N): ',
    cancelled: '\n[Cancelled] Uninstallation aborted by user.\n',
    step1: '\n[1/5] Inspecting and removing ACM-owned directories...',
    dirMissing: '  [SKIP] {{path}} (not found)',
    dryBackup: '  [DRY-RUN] Would create backup directory: {{backupDir}}',
    backupDone: '  [BACKUP] {{src}} -> {{dest}}',
    dryDirDelete: '  [DRY-RUN] Would delete directory: {{path}}',
    dirDeleted: '  [REMOVED DIR] {{path}}',
    step2: '\n[2/5] Removing ACM-owned individual files...',
    dryFileDelete: '  [DRY-RUN] Would delete file: {{path}}',
    fileDeleted: '  [DELETED] {{path}}',
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
    nonGitSec2: '[2] Changelog / ADRs (project-changelog.md) - Latest {{count}}:',
    nonGitNoAdr: '    (No recent changelog entries recorded.)\n',
    nonGitSec3: '[3] Learned Patterns (patterns/) - Total {{count}}:',
    nonGitNoPattern: '    (No learned patterns recorded yet.)\n',
    nonGitFooterTitle: '  [Non-Git Task Completion Guide]',
    nonGitFooter1: '  - After reporting verification results to the user and obtaining approval,',
    nonGitFooter2: '    archive completed tasks to task-completed.md.',
    nonGitCommitBlocked: '[Notice] Cannot execute Git commit in a non-Git environment.',
    nonGitCommitBlockedHint: '         Confirm verification with the user and archive to task-completed.md.',
    cleanCompact: '[CLEAN] No changes to commit (working tree clean)',
    cleanBanner: '  [Notice] Working tree is clean. (No files to commit)',
    compactSummary: '[Task-Centric Commit Status] {{totalFiles}} file(s) / {{groupCount}} group(s)',
    compactSharedCount: '{{count}} shared file(s)',
    compactFileCount: '{{count}} file(s)',
    compactRow: '[Group {{idx}}] {{status}} | {{title}} ({{countLabel}}) -> {{header}}',
    errNoMatchingGroup: '[Error] No matching task group found: {{arg}}',
    errNoReadyAll: '  [Aborted] No [Ready] task matched in task.md.',
    errNoReadyAllHint1: '            First record the task in task.md as "[Ready] TSK-X"',
    errNoReadyAllHint2: '            with (Purpose / Results / Targets), then run again.',
    allStart: '  [Sequential Atomic Commit Start] {{count}} [Ready] task(s)',
    allStepError: '\n[Aborted] Error occurred while committing task {{idx}}; stopping subsequent tasks.',
    allDone: '  [Done] Completed {{count}} atomic task commit(s).',
    allDoneRow: '- [Task {{idx}}] (SHA: {{sha}}) {{header}}',
    preservedTitle: '[Preserved] {{count}} file(s) not mapped to a [Ready] task were safely kept',
    preservedSubtitle: '            in the working tree to prevent unintended commits:',
    reportTitle: '  Agent Context Memory Task-Centric Commit Engine',
    reportPrinciple: '  [Principle] Atomic task commits driven by task.md & memory docs',
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
    optCommitOne: '  - Commit single group : node scripts/group-status.cjs --commit=<num|TSK-X>',
    optCommitAll: '  - Commit all [Ready]  : node scripts/group-status.cjs --all',
    optCompact: '  - Agent compact view  : node scripts/group-status.cjs --compact',
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
    checkResolutionHint2: '  Run "npm run git:pull" to trigger the hybrid conflict resolver',
    checkResolutionHint3: '  and 3 quality gates automatically.\n',
    checkCleanSuccess: '\n[Success] Zero conflicts predicted! (100% auto-mergeable)',
    autoMergeTargetTitle: '\n[Auto-Merge Files]:',
    checkCleanHint: '\nRun "npm run git:pull" to merge safely.\n',
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
    pullDirtyErr2: '        Run "npm run git:commit" or stash changes first.\n',
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
    pullUnresolvedWarn: '\n[Notice] Unresolved files remain. Edit conflict markers manually and run "npm run git:resolve".\n',
    pullGatesFailed1: '\n[Quality Gate Failed] Merge commit withheld due to quality gate failure.',
    pullGatesFailed2: 'Fix the issues and run "npm run git:resolve".\n',
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
    gate2DirtyHint: '  -> Run "npm run git:status" or commit changes before pushing.\n',
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
    invalidConfigJson: 'Failed to parse .agents/config.json ({{path}}): {{message}}',
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
};

/**
 * scripts/acm/smart-pull.cjs
 *
 * Agent Context Memory smart remote branch sync and precision hybrid conflict resolver CLI.
 *
 * Modes:
 *   node scripts/acm/smart-pull.cjs          : [Default] fetch -> virtual check -> merge -> hybrid resolve -> 3 quality gates -> merge commit
 *   node scripts/acm/smart-pull.cjs --check  : [Check] Simulate in-memory virtual merge (merge-tree) without touching the working tree
 *   node scripts/acm/smart-pull.cjs --resolve: [Resolve] Resolve existing conflicted working tree files and complete merge commit
 *   node scripts/acm/smart-pull.cjs --dry-run: Preview conflict resolution without modifying files
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

const ROOT_DIR = process.env.ACM_ROOT_DIR ? path.resolve(process.env.ACM_ROOT_DIR) : path.resolve(__dirname, '..', '..');
const ACTIVE_LANG = resolveLanguage(ROOT_DIR, parseLangFlag(process.argv.slice(2)).lang);
const tr = createTranslator(ACTIVE_LANG);

const ALLOWED_NPM_GATE_SCRIPTS = new Set(['lint', 'typecheck', 'build']);

/**
 * Synchronous Git command wrapper using argument arrays (shell: false) with Windows pager deadlock protection.
 */
function runGit(args, options = {}) {
  const { ignoreError = false, cwd = ROOT_DIR, stdio = ['pipe', 'pipe', 'pipe'], input } = options;
  const spawnOpts = {
    cwd,
    encoding: 'utf-8',
    stdio,
    shell: false,
    env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
  };
  if (input !== undefined) {
    spawnOpts.input = input;
  }

  const res = spawnSync('git', args, spawnOpts);
  const stdout = res.stdout ? res.stdout.toString() : '';
  const stderr = res.stderr ? res.stderr.toString() : '';

  if (res.error || res.status !== 0) {
    if (ignoreError) {
      return (stdout + stderr).trim();
    }
    const errMsg = res.error ? res.error.message : stderr.trim() || stdout.trim() || `git ${args[0] || ''} failed (${res.status})`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }

  return stdout ? stdout.trim() : '';
}

/**
 * Validates branch name against leading-dash flag injection and Git ref format rules.
 */
function isValidBranchName(branch, cwd = ROOT_DIR) {
  if (typeof branch !== 'string') return false;
  const trimmed = branch.trim();
  if (!trimmed || trimmed.startsWith('-') || /[\s;&|`$><\\]/.test(trimmed)) {
    return false;
  }
  const res = spawnSync('git', ['check-ref-format', '--branch', trimmed], {
    cwd,
    encoding: 'utf-8',
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return res.status === 0;
}

/**
 * Safely runs allowlisted npm scripts without passing arbitrary shell strings (avoids Windows .cmd EINVAL).
 */
function runNpmScript(scriptName, cwd = ROOT_DIR) {
  if (!ALLOWED_NPM_GATE_SCRIPTS.has(scriptName)) {
    throw new Error(`Disallowed npm gate script: ${scriptName}`);
  }

  const npmExecPath = process.env.npm_execpath;
  let res;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    res = spawnSync(process.execPath, [npmExecPath, 'run', scriptName], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
  } else if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    res = spawnSync(comspec, ['/d', '/s', '/c', 'npm', 'run', scriptName], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
  } else {
    res = spawnSync('npm', ['run', scriptName], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
  }

  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`npm run ${scriptName} exited with code ${res.status}`);
  }
}

/**
 * 1. Gets the current Git branch name.
 */
function getCurrentBranch() {
  try {
    return runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch (_) {
    return 'main';
  }
}

/**
 * 2. Checks whether the working tree is clean.
 */
function isWorkingTreeClean() {
  const status = runGit(['status', '--porcelain=v1']);
  return status.length === 0;
}

/**
 * 3. Runs in-memory virtual merge diagnosis using git merge-tree.
 */
function checkVirtualMerge(remote = 'origin', branch = getCurrentBranch()) {
  console.log(tr('smartPull.virtualMergeLog', { remote, branch }));
  const output = runGit(['merge-tree', '--write-tree', 'HEAD', `${remote}/${branch}`], { ignoreError: true });

  const lines = output.split('\n');
  const conflicts = [];
  const autoMerged = [];

  lines.forEach((line) => {
    if (line.includes('CONFLICT (content): Merge conflict in ')) {
      const file = line.replace('CONFLICT (content): Merge conflict in ', '').trim();
      conflicts.push(file);
    } else if (line.startsWith('Auto-merging ')) {
      const file = line.replace('Auto-merging ', '').trim();
      autoMerged.push(file);
    }
  });

  const uniqueConflicts = [...new Set(conflicts)];
  const uniqueAutoMerged = [...new Set(autoMerged.filter((f) => !uniqueConflicts.includes(f)))];

  let ahead = 0;
  let behind = 0;
  try {
    const revCount = runGit(['rev-list', '--left-right', '--count', `HEAD...${remote}/${branch}`]);
    const parts = revCount.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  } catch (_) {
    // Ignore when tracking branch is absent
  }

  return {
    ahead,
    behind,
    conflicts: uniqueConflicts,
    autoMerged: uniqueAutoMerged,
  };
}

/**
 * 4. Lists currently conflicted (unmerged) files in the working tree.
 */
function getUnmergedFiles() {
  const statusRaw = runGit(['-c', 'core.quotepath=false', 'status', '--porcelain=v1'], { ignoreError: true });
  if (!statusRaw) return [];

  const files = [];
  const lines = statusRaw.split(/\r?\n/).filter((l) => l.trim().length >= 3);

  for (const line of lines) {
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const unquoted = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
    const filePath = unquoted.replace(/^"|"$/g, '').replace(/\\/g, '/');

    if (code === 'UU' || code === 'AA' || code === 'UD' || code === 'DU' || code === 'AU' || code === 'UA') {
      files.push(filePath);
    }
  }

  // Fallback scan for conflict markers in files marked as regular 'M'
  if (files.length === 0) {
    for (const line of lines) {
      const rawPath = line.slice(3).trim();
      const unquoted = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
      const filePath = unquoted.replace(/^"|"$/g, '').replace(/\\/g, '/');
      const absPath = path.join(ROOT_DIR, filePath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          if (/^<<<<<<< [^\r\n]*\r?\n[\s\S]*?\r?\n=======\r?\n[\s\S]*?\r?\n>>>>>>> [^\r\n]*/m.test(content)) {
            files.push(filePath);
          }
        } catch (_) {
          // Ignore binary/unreadable files
        }
      }
    }
  }

  return [...new Set(files)];
}

/**
 * 5. Precision Hybrid Conflict Resolution Engine
 */

// A. Re-export and Import union merge
function tryResolveExportsOrImports(ours, theirs) {
  const oursLines = ours.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const theirsLines = theirs.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const isAllExports = (lines) => lines.length > 0 && lines.every((l) => l.startsWith('export ') || l.startsWith('//'));
  const isAllImports = (lines) => lines.length > 0 && lines.every((l) => l.startsWith('import ') || l.startsWith('//'));

  if ((isAllExports(oursLines) && isAllExports(theirsLines)) || (isAllImports(oursLines) && isAllImports(theirsLines))) {
    const combined = [];
    const seen = new Set();

    // Preserve union of remote (theirs) and local (ours) statements
    const all = [...theirsLines, ...oursLines];
    for (const line of all) {
      if (!seen.has(line)) {
        seen.add(line);
        combined.push(line);
      }
    }
    return combined.join('\n');
  }

  return null;
}

// B. JSON key-value union merge (e.g. package.json)
function tryResolveJsonKeyValues(ours, theirs, filePath) {
  if (!filePath.endsWith('.json')) return null;

  const parseLines = (text) => text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const oursLines = parseLines(ours);
  const theirsLines = parseLines(theirs);

  const isKeyVal = (l) => /^\s*"[^"]+"\s*:\s*.*,?$/.test(l.trim());
  if (oursLines.every(isKeyVal) && theirsLines.every(isKeyVal)) {
    const combined = [];
    const seenKeys = new Set();

    const extractKey = (line) => {
      const match = line.match(/"([^"]+)"\s*:/);
      return match ? match[1] : line.trim();
    };

    const all = [...theirsLines, ...oursLines];
    all.forEach((line) => {
      const key = extractKey(line);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push(line);
      }
    });

    return combined
      .map((line, idx) => {
        const trimmed = line.trimEnd();
        if (idx < combined.length - 1) {
          return trimmed.endsWith(',') ? trimmed : trimmed + ',';
        }
        return trimmed;
      })
      .join('\n');
  }

  return null;
}

const RESERVED_CONTROL_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw',
  'await', 'typeof', 'delete', 'new', 'do', 'else', 'try', 'finally', 'constructor',
]);

function extractFunctionBlockName(text) {
  const trimmed = text.trim();
  const fnMatch = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  if (fnMatch) return fnMatch[1];
  const methodMatch = trimmed.match(/^(?:(?:public|private|protected|static|readonly)\s+)*(?:async\s+)?([a-zA-Z_$#][a-zA-Z0-9_$#]*)\s*\([^)]*\)\s*\{/);
  if (methodMatch && !RESERVED_CONTROL_WORDS.has(methodMatch[1])) {
    return methodMatch[1];
  }
  return null;
}

// C. Distinct independent function/method block merge (excludes control statements & duplicate names)
function tryResolveFunctionBlocks(ours, theirs) {
  const oursName = extractFunctionBlockName(ours);
  const theirsName = extractFunctionBlockName(theirs);

  if (oursName && theirsName && oursName !== theirsName) {
    return `${theirs.trim()}\n\n${ours.trim()}`;
  }

  return null;
}

function parseJsxAttributes(attrStr) {
  const trimmed = attrStr.trim();
  if (!trimmed) return [];
  const attrs = [];
  const tokenRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?/g;
  let cursor = 0;
  let match;
  while ((match = tokenRegex.exec(trimmed)) !== null) {
    const gap = trimmed.slice(cursor, match.index);
    if (gap.trim().length > 0) return null;
    attrs.push({ key: match[1], raw: match[0] });
    cursor = tokenRegex.lastIndex;
  }
  if (trimmed.slice(cursor).trim().length > 0) return null;
  return attrs;
}

// D. JSX/Props coexistence merge (rejects conflicting values on identical attribute names)
function tryResolveJsxProps(ours, theirs) {
  const singleTagRegex = /^\s*<([A-Za-z0-9_.]+)\s+([^>]+?)(\/?>)\s*$/;
  const tagMatchOurs = ours.match(singleTagRegex);
  const tagMatchTheirs = theirs.match(singleTagRegex);

  if (!tagMatchOurs || !tagMatchTheirs || tagMatchOurs[1] !== tagMatchTheirs[1]) {
    return null;
  }

  const attrsOurs = parseJsxAttributes(tagMatchOurs[2]);
  const attrsTheirs = parseJsxAttributes(tagMatchTheirs[2]);
  if (!attrsOurs || !attrsTheirs) return null;

  const mergedMap = new Map();
  for (const attr of attrsTheirs) {
    if (mergedMap.has(attr.key) && mergedMap.get(attr.key) !== attr.raw) return null;
    mergedMap.set(attr.key, attr.raw);
  }
  for (const attr of attrsOurs) {
    if (mergedMap.has(attr.key) && mergedMap.get(attr.key) !== attr.raw) {
      return null;
    }
    mergedMap.set(attr.key, attr.raw);
  }

  const tagName = tagMatchOurs[1];
  const ending = tagMatchOurs[3];
  return `<${tagName} ${Array.from(mergedMap.values()).join(' ')}${ending}`;
}

/**
 * Resolves a single conflict chunk using precision rules.
 */
function resolveConflictChunk(ours, theirs, filePath) {
  const exportImportRes = tryResolveExportsOrImports(ours, theirs);
  if (exportImportRes !== null) {
    return { resolved: exportImportRes, rule: tr('smartPull.ruleImportExport') };
  }

  const jsonRes = tryResolveJsonKeyValues(ours, theirs, filePath);
  if (jsonRes !== null) {
    return { resolved: jsonRes, rule: tr('smartPull.ruleJsonKeyValue') };
  }

  const fnRes = tryResolveFunctionBlocks(ours, theirs);
  if (fnRes !== null) {
    return { resolved: fnRes, rule: tr('smartPull.ruleFunctionBlock') };
  }

  const jsxRes = tryResolveJsxProps(ours, theirs);
  if (jsxRes !== null) {
    return { resolved: jsxRes, rule: tr('smartPull.ruleJsxProps') };
  }

  return null;
}

/**
 * Parses all conflict markers in a file and applies auto-resolution when safe.
 */
function resolveFileConflicts(filePath, dryRun = false) {
  const absPath = path.join(ROOT_DIR, filePath);
  if (!fs.existsSync(absPath)) return { success: false, reason: tr('smartPull.fileNotFound') };

  const content = fs.readFileSync(absPath, 'utf-8');
  const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> [^\r\n]*/g;

  let match;
  const matches = [];
  while ((match = conflictRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      ours: match[1],
      theirs: match[2],
      index: match.index,
    });
  }

  if (matches.length === 0) {
    return { success: true, count: 0, details: [] };
  }

  const details = [];
  let updatedContent = content;
  let allResolved = true;

  for (let i = 0; i < matches.length; i++) {
    const chunk = matches[i];
    const resolution = resolveConflictChunk(chunk.ours, chunk.theirs, filePath);

    if (resolution) {
      details.push({
        index: i + 1,
        unresolved: false,
        rule: resolution.rule,
        resolved: resolution.resolved,
      });
      updatedContent = updatedContent.replace(chunk.fullMatch, resolution.resolved);
    } else {
      allResolved = false;
      details.push({
        index: i + 1,
        unresolved: true,
        rule: tr('smartPull.ruleUnresolved'),
        ours: chunk.ours,
        theirs: chunk.theirs,
      });
    }
  }

  if (allResolved && !dryRun) {
    fs.writeFileSync(absPath, updatedContent, 'utf-8');
  }

  return {
    success: allResolved,
    count: matches.length,
    resolvedCount: details.filter((d) => !d.unresolved).length,
    details,
    updatedContent,
  };
}

function readTargetPackageJson() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

/**
 * 6. Runs post-merge 3 quality gates.
 */
function runQualityGates() {
  console.log('\n=======================================================');
  console.log(tr('smartPull.gatesTitle'));
  console.log('=======================================================\n');

  // Gate 1: Conflict markers check (always required)
  console.log(tr('smartPull.gate1Start'));
  const diffCheck = runGit(['--no-pager', 'diff', '--check'], { ignoreError: true });
  if (diffCheck && diffCheck.includes('leftover conflict marker')) {
    console.error(tr('smartPull.gate1Fail'), diffCheck);
    return false;
  }
  console.log(tr('smartPull.gate1Pass'));

  const pkg = readTargetPackageJson();
  const pkgScripts = (pkg && pkg.scripts) || {};

  // Gate 2: Static analysis (conditional on lint / typecheck scripts)
  console.log(tr('smartPull.gate2Start'));
  const staticChecks = ['lint', 'typecheck'].filter((name) => Boolean(pkgScripts[name]));
  if (staticChecks.length === 0) {
    console.log(tr('smartPull.gate2Skip'));
  } else {
    for (const scriptName of staticChecks) {
      try {
        console.log(tr('smartPull.gate2Run', { scriptName }));
        runNpmScript(scriptName, ROOT_DIR);
      } catch (err) {
        console.error(tr('smartPull.gate2Fail', { scriptName }), err.message);
        return false;
      }
    }
    console.log(tr('smartPull.gate2Pass'));
  }

  // Gate 3: Build integrity check (conditional on build script)
  console.log(tr('smartPull.gate3Start'));
  if (!pkgScripts.build) {
    console.log(tr('smartPull.gate3Skip'));
  } else {
    try {
      runNpmScript('build', ROOT_DIR);
      console.log(tr('smartPull.gate3Pass'));
    } catch (_) {
      console.error(tr('smartPull.gate3Fail'));
      return false;
    }
  }

  return true;
}

/**
 * 7. Interactive manual conflict resolver prompt.
 */
function promptUserResolution(ours, theirs, filePath, chunkIdx) {
  return new Promise((resolve) => {
    console.log('\n-------------------------------------------------------');
    console.log(tr('smartPull.manualNeeded', { filePath, chunkIdx }));
    console.log('-------------------------------------------------------');
    console.log(tr('smartPull.manualOurs', { ours }));
    console.log(tr('smartPull.manualTheirs', { theirs }));
    console.log('-------------------------------------------------------');
    console.log(tr('smartPull.manualPromptTitle'));
    console.log(tr('smartPull.manualChoice1'));
    console.log(tr('smartPull.manualChoice2'));
    console.log(tr('smartPull.manualChoice3'));
    console.log(tr('smartPull.manualChoice4'));
    console.log(tr('smartPull.manualChoice5'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(tr('smartPull.manualQuestion'), (answer) => {
      rl.close();
      const choice = answer.trim();
      if (choice === '1') resolve(ours);
      else if (choice === '2') resolve(theirs);
      else if (choice === '3') resolve(`${ours.trim()}\n\n${theirs.trim()}`);
      else if (choice === '4') resolve(`${theirs.trim()}\n\n${ours.trim()}`);
      else resolve(null);
    });
  });
}

/**
 * Main CLI execution flow.
 */
async function main() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check') || args.includes('-c');
  const isResolveMode = args.includes('--resolve') || args.includes('-r');
  const isDryRun = args.includes('--dry-run');
  const skipBuild = args.includes('--no-build');

  console.log('=======================================================');
  console.log(tr('smartPull.bannerTitle'));
  console.log('=======================================================\n');

  const currentBranch = getCurrentBranch();
  const branchArg = args.find((a) => a.startsWith('--branch='));
  const targetRemote = 'origin';
  const targetBranch = branchArg ? branchArg.slice('--branch='.length).trim() : currentBranch;
  if (!isValidBranchName(targetBranch)) {
    console.error(`[Error] Invalid branch name: "${targetBranch}"`);
    process.exit(1);
  }

  // Mode 1: Virtual merge check (--check)
  if (isCheckMode) {
    console.log(tr('smartPull.checkFetchStart', { remote: targetRemote, branch: targetBranch }));
    try {
      runGit(['fetch', '--', targetRemote, targetBranch]);
      console.log(tr('smartPull.checkFetchDone'));
    } catch (_) {
      console.log(tr('smartPull.checkFetchWarn'));
    }

    console.log(tr('smartPull.checkSimStart'));
    const diag = checkVirtualMerge(targetRemote, targetBranch);

    console.log(tr('smartPull.branchStatus', { ahead: diag.ahead, behind: diag.behind }));

    if (diag.behind === 0) {
      console.log(tr('smartPull.alreadyUpToDate'));
      console.log(tr('smartPull.noMergeNeeded'));
      process.exit(0);
    }

    if (diag.conflicts.length > 0) {
      console.log('\n-------------------------------------------------------');
      console.log(tr('smartPull.conflictsExpected', { count: diag.conflicts.length }));
      console.log('-------------------------------------------------------');
      diag.conflicts.forEach((file) => console.log(tr('smartPull.conflictFileLine', { file })));

      if (diag.autoMerged.length > 0) {
        console.log(tr('smartPull.autoMergeableTitle'));
        diag.autoMerged.forEach((file) => console.log(tr('smartPull.autoMergeableLine', { file })));
      }

      console.log(tr('smartPull.checkResolutionHint1'));
      console.log(tr('smartPull.checkResolutionHint2'));
      console.log(tr('smartPull.checkResolutionHint3'));
      process.exit(1);
    } else {
      console.log(tr('smartPull.checkCleanSuccess'));
      if (diag.autoMerged.length > 0) {
        console.log(tr('smartPull.autoMergeTargetTitle'));
        diag.autoMerged.forEach((file) => console.log(`  - ${file}`));
      }
      console.log(tr('smartPull.checkCleanHint'));
      process.exit(0);
    }
  }

  // Mode 2: Resolve existing conflicts (--resolve)
  if (isResolveMode) {
    console.log(tr('smartPull.resolveModeStart'));
    const unmergedFiles = getUnmergedFiles();
    const isMerging = fs.existsSync(path.join(ROOT_DIR, '.git', 'MERGE_HEAD'));

    if (unmergedFiles.length === 0) {
      if (isMerging) {
        console.log(tr('smartPull.resolveAllStaged'));
        console.log(tr('smartPull.resolveProceedGates'));
      } else {
        console.log(tr('smartPull.resolveNothing'));
        process.exit(0);
      }
    } else {
      console.log(tr('smartPull.resolveDetectedCount', { count: unmergedFiles.length }));
      unmergedFiles.forEach((f) => console.log(`     - ${f}`));
      console.log('');
    }

    let fullyResolved = true;

    for (const file of unmergedFiles) {
      console.log(tr('smartPull.resolvingFile', { file }));
      const res = resolveFileConflicts(file, isDryRun);

      if (res.success) {
        console.log(tr('smartPull.resolvedAllChunks', { count: res.count }));
        res.details.forEach((d) => console.log(tr('smartPull.chunkApplied', { index: d.index, rule: d.rule })));
        if (!isDryRun) {
          runGit(['add', '--', file]);
        }
      } else {
        console.log(tr('smartPull.partialResolve', { resolved: res.resolvedCount, total: res.count }));
        for (const d of res.details) {
          if (d.unresolved && !isDryRun && process.stdin.isTTY) {
            const chosen = await promptUserResolution(d.ours, d.theirs, file, d.index);
            if (chosen !== null) {
              const absPath = path.join(ROOT_DIR, file);
              const currentTxt = fs.readFileSync(absPath, 'utf-8');
              const escOurs = d.ours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const escTheirs = d.theirs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(`<<<<<<< HEAD\\r?\\n${escOurs}\\r?\\n=======\\r?\\n${escTheirs}\\r?\\n>>>>>>> [^\\r\\n]*`);
              fs.writeFileSync(absPath, currentTxt.replace(re, () => chosen), 'utf-8');
              console.log(tr('smartPull.manualChoiceApplied', { index: d.index }));
            } else {
              fullyResolved = false;
            }
          } else if (d.unresolved) {
            fullyResolved = false;
          }
        }
        if (!fullyResolved) {
          console.log(tr('smartPull.markersRemainWarn', { file }));
        } else if (!isDryRun) {
          runGit(['add', '--', file]);
        }
      }
    }

    if (!fullyResolved) {
      console.error(tr('smartPull.resolveUnresolvedErr'));
      process.exit(1);
    }

    if (isDryRun) {
      console.log(tr('smartPull.resolveDryRunDone'));
      process.exit(0);
    }

    if (!skipBuild) {
      const gatesPass = runQualityGates();
      if (!gatesPass) {
        console.error(tr('smartPull.gatesFailedHold'));
        process.exit(1);
      }
    }

    console.log(tr('smartPull.creatingMergeCommit'));
    const commitMsg = tr('smartPull.mergeCommitMsg', { remote: targetRemote, branch: targetBranch });
    try {
      runGit(['commit', '-F', '-'], { input: commitMsg });
      const newSha = runGit(['rev-parse', '--short', 'HEAD']);
      console.log(tr('smartPull.resolveSuccess', { sha: newSha }));
      process.exit(0);
    } catch (err) {
      console.error(tr('smartPull.mergeCommitErr'), err.message);
      process.exit(1);
    }
  }

  // Mode 3: Full pull & hybrid merge pipeline (default)
  console.log(tr('smartPull.pullStep1'));
  if (!isWorkingTreeClean()) {
    console.error(tr('smartPull.pullDirtyErr1'));
    console.error(tr('smartPull.pullDirtyErr2'));
    process.exit(1);
  }
  console.log(tr('smartPull.pullCleanOk'));

  console.log(tr('smartPull.pullStep2', { remote: targetRemote, branch: targetBranch }));
  try {
    runGit(['fetch', '--', targetRemote, targetBranch]);
    console.log(tr('smartPull.pullFetchOk'));
  } catch (err) {
    console.error(tr('smartPull.pullFetchErr'), err.message);
    process.exit(1);
  }

  console.log(tr('smartPull.pullStep3'));
  const diag = checkVirtualMerge(targetRemote, targetBranch);
  console.log(tr('smartPull.pullStatusLine', { ahead: diag.ahead, behind: diag.behind }));

  if (diag.behind === 0) {
    console.log(tr('smartPull.pullAlreadyLatest'));
    process.exit(0);
  }

  if (diag.ahead === 0) {
    console.log(tr('smartPull.pullFastForward'));
    runGit(['merge', '--ff-only', `${targetRemote}/${targetBranch}`]);
    console.log(tr('smartPull.pullFastForwardOk'));
    process.exit(0);
  }

  console.log(tr('smartPull.pullStep4', { remote: targetRemote, branch: targetBranch }));
  let mergeFailed = false;
  try {
    runGit(['merge', `${targetRemote}/${targetBranch}`]);
    console.log(tr('smartPull.pullCleanMergeOk'));
  } catch (_) {
    mergeFailed = true;
    console.log(tr('smartPull.pullConflictDetected'));
  }

  if (!mergeFailed) {
    if (!skipBuild) {
      const gatesPass = runQualityGates();
      if (!gatesPass) {
        console.error(tr('smartPull.pullBuildFailWarn'));
        process.exit(1);
      }
    }
    const newSha = runGit(['rev-parse', '--short', 'HEAD']);
    console.log(tr('smartPull.pullMergeOk', { sha: newSha }));
    process.exit(0);
  }

  console.log(tr('smartPull.pullStep5'));
  const unmergedFiles = getUnmergedFiles();
  console.log(tr('smartPull.pullConflictCount', { count: unmergedFiles.length }));

  let fullyResolved = true;

  for (const file of unmergedFiles) {
    console.log(tr('smartPull.resolvingFilePull', { file }));
    const res = resolveFileConflicts(file, isDryRun);

    if (res.success) {
      console.log(tr('smartPull.resolvedAllChunksPull', { count: res.count }));
      res.details.forEach((d) => console.log(tr('smartPull.chunkAppliedPull', { index: d.index, rule: d.rule })));
      if (!isDryRun) {
        runGit(['add', '--', file]);
      }
    } else {
      console.log(tr('smartPull.partialResolvePull', { resolved: res.resolvedCount, total: res.count }));
      for (const d of res.details) {
        if (d.unresolved && !isDryRun && process.stdin.isTTY) {
          const chosen = await promptUserResolution(d.ours, d.theirs, file, d.index);
          if (chosen !== null) {
            const absPath = path.join(ROOT_DIR, file);
            const currentTxt = fs.readFileSync(absPath, 'utf-8');
            const escOurs = d.ours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escTheirs = d.theirs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`<<<<<<< HEAD\\r?\\n${escOurs}\\r?\\n=======\\r?\\n${escTheirs}\\r?\\n>>>>>>> [^\\r\\n]*`);
            fs.writeFileSync(absPath, currentTxt.replace(re, () => chosen), 'utf-8');
            console.log(tr('smartPull.manualChoiceAppliedPull', { index: d.index }));
          } else {
            fullyResolved = false;
          }
        } else if (d.unresolved) {
          fullyResolved = false;
        }
      }
      if (!fullyResolved) {
        console.log(tr('smartPull.markersRemainWarnPull', { file }));
      } else if (!isDryRun) {
        runGit(['add', '--', file]);
      }
    }
  }

  if (!fullyResolved) {
    console.error(tr('smartPull.pullUnresolvedWarn'));
    process.exit(1);
  }

  if (!skipBuild) {
    const gatesPass = runQualityGates();
    if (!gatesPass) {
      console.error(tr('smartPull.pullGatesFailed1'));
      console.error(tr('smartPull.pullGatesFailed2'));
      process.exit(1);
    }
  }

  console.log(tr('smartPull.pullCommitStart'));
  const commitMsg = tr('smartPull.mergeCommitMsg', { remote: targetRemote, branch: targetBranch });
  try {
    runGit(['commit', '-F', '-'], { input: commitMsg });
    const newSha = runGit(['rev-parse', '--short', 'HEAD']);
    console.log('\n=======================================================');
    console.log(tr('smartPull.pullSuccessBannerTitle'));
    console.log(tr('smartPull.pullSuccessSha', { sha: newSha }));
    console.log('=======================================================\n');
    process.exit(0);
  } catch (err) {
    console.error(tr('smartPull.mergeCommitErr'), err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(tr('smartPull.fatalErr'), err);
    process.exit(1);
  });
}

module.exports = {
  runGit,
  isValidBranchName,
  runNpmScript,
  parseJsxAttributes,
  tryResolveJsxProps,
  extractFunctionBlockName,
  tryResolveFunctionBlocks,
  tryResolveExportsOrImports,
  tryResolveJsonKeyValues,
  resolveConflictChunk,
};

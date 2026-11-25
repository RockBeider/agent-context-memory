/**
 * scripts/audit-push.cjs
 *
 * Pre-push hygiene quality gate CLI checking:
 * 1. Leftover conflict markers (<<<<<<<)
 * 2. One-off test/scratch scripts and temporary/log artifacts
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

const ROOT_DIR = process.env.ACM_ROOT_DIR ? path.resolve(process.env.ACM_ROOT_DIR) : process.cwd();

/**
 * Synchronous Git command wrapper using argument arrays (shell: false) with pager deadlock protection.
 */
function runGit(args, ignoreError = false, cwd = ROOT_DIR) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
  });
  const stdout = res.stdout ? res.stdout.toString() : '';
  const stderr = res.stderr ? res.stderr.toString() : '';

  if (res.error || res.status !== 0) {
    if (ignoreError) {
      return (stdout + stderr).trim();
    }
    throw new Error(res.error ? res.error.message : stderr.trim() || stdout.trim() || `git ${args[0] || ''} failed (${res.status})`);
  }
  return stdout.trim();
}

// Dynamically locate target upstream tracking branch
function getTargetRemoteBranch(cwd = ROOT_DIR) {
  try {
    const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], true, cwd);
    if (upstream && !upstream.includes('fatal')) return upstream;
  } catch (_) {}

  const candidates = ['origin/main', 'origin/master', 'origin/develop'];
  for (const b of candidates) {
    try {
      const res = runGit(['rev-parse', '--verify', b], true, cwd);
      if (res && !res.includes('fatal')) return b;
    } catch (_) {}
  }
  return null;
}

// Disallowed temporary or one-off artifact patterns
const FORBIDDEN_PATTERNS = [
  { pattern: /^scripts\/temp-.*\.cjs$/, reasonKey: 'auditPush.reasonTempScript' },
  { pattern: /^scripts\/scratch_.*$/, reasonKey: 'auditPush.reasonScratchScript' },
  { pattern: /^scripts\/test-.*\.cjs$/, reasonKey: 'auditPush.reasonLocalTestScript' },
  { pattern: /^scripts\/.*_report\.txt$/, reasonKey: 'auditPush.reasonReportTxt' },
  { pattern: /\.tmp$/i, reasonKey: 'auditPush.reasonTmpFile' },
  { pattern: /\.bak$/i, reasonKey: 'auditPush.reasonBakFile' },
  { pattern: /\.log$/i, reasonKey: 'auditPush.reasonLogFile' },
  { pattern: /(?:^|\/)\.agents\/(?:acm\/)?local\/.*\.db(?:-wal|-shm)?$/i, reasonKey: 'auditPush.reasonLocalDbFile' },
  { pattern: /\.(?:sqlite|sqlite3|db-wal|db-shm)$/i, reasonKey: 'auditPush.reasonLocalDbFile' },
];

function main() {
  const { lang } = parseLangFlag(process.argv.slice(2));
  const tr = createTranslator(resolveLanguage(ROOT_DIR, lang));

  console.log('=======================================================');
  console.log(tr('auditPush.bannerTitle'));
  console.log('=======================================================\n');

  let hasError = false;
  const targetRemote = getTargetRemoteBranch();

  // 1. Conflict marker inspection
  console.log(tr('auditPush.gate1Start'));
  try {
    const diffTarget = targetRemote ? `${targetRemote}..HEAD` : 'HEAD';
    const checkOut = runGit(['--no-pager', 'diff', '--check', diffTarget], true);
    if (checkOut && checkOut.includes('leftover conflict marker')) {
      console.error(tr('auditPush.gate1DetectErr'));
      console.error(checkOut);
      hasError = true;
    } else {
      console.log(tr('auditPush.gate1Pass'));
    }
  } catch (err) {
    console.error(tr('auditPush.gate1Fail'), err.message);
    hasError = true;
  }

  // 2. Working tree cleanliness check
  console.log(tr('auditPush.gate2Start'));
  const statusOut = runGit(['-c', 'core.quotepath=false', 'status', '--porcelain']);
  if (statusOut) {
    console.log(tr('auditPush.gate2Dirty'));
    statusOut.split(/\r?\n/).forEach((l) => console.log(`    ${l}`));
    console.log(tr('auditPush.gate2DirtyHint'));
  } else {
    console.log(tr('auditPush.gate2Pass'));
  }

  // 3. Pending push payload & staged local DB leak audit
  console.log(tr('auditPush.gate3Start', { target: targetRemote || tr('auditPush.localHeadLabel') }));
  let diffNameStatus = '';
  if (targetRemote) {
    try {
      diffNameStatus = runGit(['-c', 'core.quotepath=false', 'diff', '--name-status', `${targetRemote}..HEAD`]);
    } catch (_) {
      console.log(tr('auditPush.gate3Fallback', { target: targetRemote }));
    }
  }
  const stagedNameStatus = runGit(['-c', 'core.quotepath=false', 'diff', '--cached', '--name-status'], true);
  const combinedLines = [
    ...(diffNameStatus ? diffNameStatus.split(/\r?\n/) : []),
    ...(stagedNameStatus && !stagedNameStatus.includes('fatal') ? stagedNameStatus.split(/\r?\n/) : []),
  ].filter(Boolean);

  if (combinedLines.length === 0) {
    console.log(tr('auditPush.gate3NoDiff'));
  } else {
    console.log(tr('auditPush.gate3Count', { count: combinedLines.length }));

    const forbiddenDetected = [];
    const seenForbidden = new Set();

    combinedLines.forEach((line) => {
      const parts = line.split('\t');
      const status = (parts[0] || '').trim();
      const filePath = (status.startsWith('R') || status.startsWith('C'))
        ? (parts[2] || '').trim()
        : (parts[1] || '').trim();

      // Allow deletions even when the deleted filename matches a forbidden pattern
      if (!filePath || status === 'D') return;

      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.pattern.test(filePath)) {
          if (!seenForbidden.has(filePath)) {
            seenForbidden.add(filePath);
            forbiddenDetected.push({ filePath, reason: tr(rule.reasonKey) });
          }
          break;
        }
      }
    });

    if (forbiddenDetected.length > 0) {
      console.error(tr('auditPush.forbiddenDetected'));
      forbiddenDetected.forEach(({ filePath, reason }) => {
        console.error(`    - ${filePath} (${reason})`);
      });
      console.error(tr('auditPush.remediationHeader'));
      const filesToRm = forbiddenDetected.map((f) => `"${f.filePath}"`).join(' ');
      console.error(`    git rm ${filesToRm}`);
      console.error(tr('auditPush.remediationCommit'));
      hasError = true;
    } else {
      console.log(tr('auditPush.gate3Pass'));
    }
  }

  if (hasError) {
    console.log('=======================================================');
    console.log(tr('auditPush.failBanner'));
    console.log('=======================================================\n');
    process.exit(1);
  } else {
    console.log('=======================================================');
    console.log(tr('auditPush.passBanner'));
    console.log('=======================================================\n');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runGit,
  getTargetRemoteBranch,
  FORBIDDEN_PATTERNS,
  main,
};

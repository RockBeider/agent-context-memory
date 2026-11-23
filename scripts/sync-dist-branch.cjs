#!/usr/bin/env node
/**
 * scripts/sync-dist-branch.cjs
 *
 * Automated distribution engine that selects publishable files declared in package.json
 * and creates an isolated commit on the `dist` branch using Git plumbing.
 *
 * Features:
 * - Uses Git plumbing (GIT_INDEX_FILE, write-tree, commit-tree, update-ref)
 * - Syncs without checking out or disturbing the current working branch
 * - Keeps the `dist` branch strictly scoped to npm distribution assets with linear history
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_INDEX_REL = '.git/temp-dist-index';
const TEMP_INDEX_PATH = path.join(REPO_ROOT, TEMP_INDEX_REL);

/**
 * Source/release-only files excluded from the dist branch and npm package.
 */
const EXCLUDED_DIST_FILES = [
  'scripts/sync-dist-branch.cjs',
];

/**
 * Runs a Git command via argument array (shell: false) with pager deadlock protection.
 */
function runGit(args, options = {}) {
  const env = {
    ...process.env,
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    ...(options.env || {}),
  };
  const spawnOpts = {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env,
    shell: false,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  };
  if (options.input !== undefined) {
    spawnOpts.input = options.input;
  }

  const res = spawnSync('git', args, spawnOpts);
  const stdout = res.stdout ? res.stdout.toString() : '';
  const stderr = res.stderr ? res.stderr.toString() : '';

  if (res.error || res.status !== 0) {
    throw new Error(res.error ? res.error.message : stderr.trim() || stdout.trim() || `git ${args[0] || ''} failed (${res.status})`);
  }
  return stdout.trim();
}

/**
 * Generates a sanitized package.json for dist/npm without repo-internal or test scripts.
 */
function generateDistributionPackageJson(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  if (pkg.scripts) {
    const cleaned = { ...pkg.scripts };

    // 1) Remove release pipeline scripts
    delete cleaned['dist:sync'];
    delete cleaned['dist:push'];

    // 2) Remove test scripts referencing excluded tests/ directory
    delete cleaned['test'];
    delete cleaned['prepublishOnly'];

    // 3) Remove local aliases replaced by CLI (`npx acm`)
    delete cleaned['acm:install'];
    delete cleaned['acm:uninstall'];
    delete cleaned['check-git'];

    pkg.scripts = cleaned;
  }

  return JSON.stringify(pkg, null, 2) + '\n';
}

/**
 * Uses Git plumbing (hash-object, update-index) to inject sanitized package.json
 * into the temporary index without modifying the working tree file.
 */
function injectSanitizedPackageJson(gitEnv) {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const sanitizedContent = generateDistributionPackageJson(pkgPath);

  const blobHash = runGit(['hash-object', '-w', '--stdin'], {
    env: gitEnv,
    input: sanitizedContent,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  runGit(['update-index', '--cacheinfo', '100644', blobHash, 'package.json'], { env: gitEnv });
  console.log(`[dist-sync] Injected sanitized package.json (blob: ${blobHash.substring(0, 7)})`);
}

/**
 * Injects clean template AGENTS.md (acm-template/AGENTS.md) as root AGENTS.md on dist branch.
 */
function injectSanitizedAgentsMd(gitEnv) {
  const templateAgentsPath = path.join(REPO_ROOT, 'acm-template', 'AGENTS.md');
  if (!fs.existsSync(templateAgentsPath)) return;

  const cleanAgentsContent = fs.readFileSync(templateAgentsPath, 'utf-8');
  const blobHash = runGit(['hash-object', '-w', '--stdin'], {
    env: gitEnv,
    input: cleanAgentsContent,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  runGit(['update-index', '--cacheinfo', '100644', blobHash, 'AGENTS.md'], { env: gitEnv });
  console.log(`[dist-sync] Injected clean template AGENTS.md (blob: ${blobHash.substring(0, 7)})`);
}

function getPackageDistributionFiles() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package.json not found.');
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const declaredFiles = Array.isArray(pkg.files) ? pkg.files : [];

  const requiredDefaults = ['package.json', 'README.md', 'LICENSE', 'AGENTS.md'];
  const targetPatterns = Array.from(new Set([...requiredDefaults, ...declaredFiles]));

  const validTargets = targetPatterns.filter((item) => {
    if (item.startsWith('!')) return false;
    const fullPath = path.join(REPO_ROOT, item);
    return fs.existsSync(fullPath);
  });

  return {
    version: pkg.version || '0.0.0',
    validTargets,
  };
}

function syncDistBranch(options = {}) {
  const dryRun = options.dryRun || false;
  const shouldPush = options.push || false;
  const forcePush = options.forcePush || false;

  console.log('[dist-sync] Starting distribution branch (dist) sync.');

  try {
    const isInside = runGit(['rev-parse', '--is-inside-work-tree']);
    if (isInside !== 'true') {
      throw new Error('Not inside a Git work tree.');
    }
  } catch (e) {
    console.error('[Error] Failed to verify Git repository:', e.message);
    process.exit(1);
  }

  let currentBranch = 'unknown';
  let currentCommit = 'unknown';
  try {
    currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    currentCommit = runGit(['rev-parse', '--short', 'HEAD']);
  } catch (_) {}

  const { version, validTargets } = getPackageDistributionFiles();
  console.log(`[dist-sync] Package version: v${version}`);
  console.log(`[dist-sync] Source branch  : ${currentBranch} (${currentCommit})`);
  console.log(`[dist-sync] Sync targets (${validTargets.length}):`, validTargets.join(', '));

  if (dryRun) {
    console.log('[dist-sync] --dry-run enabled; skipping dist commit creation.');
    return;
  }

  if (fs.existsSync(TEMP_INDEX_PATH)) {
    try {
      fs.unlinkSync(TEMP_INDEX_PATH);
    } catch (_) {}
  }

  const gitEnv = { GIT_INDEX_FILE: TEMP_INDEX_REL };

  try {
    console.log('[dist-sync] Staging distribution items into temporary index...');
    runGit(['add', '-A', '--', ...validTargets], { env: gitEnv });

    for (const file of EXCLUDED_DIST_FILES) {
      try {
        runGit(['rm', '--cached', '-f', '--', file], {
          env: gitEnv,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        console.log(`[dist-sync] Excluded file removed from index: ${file}`);
      } catch (_) {}
    }

    injectSanitizedPackageJson(gitEnv);
    injectSanitizedAgentsMd(gitEnv);

    console.log('[dist-sync] Temporary index staging and sanitization complete.');

    const treeHash = runGit(['write-tree'], { env: gitEnv });
    console.log(`[dist-sync] Distribution tree hash: ${treeHash}`);

    let parentCommit = null;

    try {
      runGit(['fetch', 'origin', 'dist'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) {}

    const candidateRefs = [
      'refs/heads/dist',
      'refs/remotes/origin/dist',
      'origin/dist',
    ];

    for (const ref of candidateRefs) {
      try {
        const hash = runGit(['rev-parse', '--verify', ref]);
        if (hash) {
          parentCommit = hash;
          console.log(`[dist-sync] Found previous dist HEAD (${ref}): ${parentCommit}`);
          break;
        }
      } catch (_) {}
    }

    if (!parentCommit) {
      console.log('[dist-sync] No existing dist branch found; creating initial orphan commit.');
    }

    const commitMsg = options.message || `release(dist): v${version} (${currentBranch}@${currentCommit})`;
    const commitTreeArgs = ['commit-tree', treeHash, ...(parentCommit ? ['-p', parentCommit] : []), '-F', '-'];
    const newCommitHash = runGit(commitTreeArgs, {
      env: gitEnv,
      input: commitMsg,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`[dist-sync] Created dist commit: ${newCommitHash}`);

    runGit(['update-ref', 'refs/heads/dist', newCommitHash]);
    console.log(`[dist-sync] Updated refs/heads/dist -> ${newCommitHash}.`);

    if (shouldPush) {
      console.log('[dist-sync] Pushing dist branch to origin: git push origin dist');
      try {
        runGit(['push', 'origin', 'dist']);
      } catch (pushErr) {
        if (!forcePush) {
          console.error('[dist-sync] Push rejected due to remote divergence. Re-run with --force-push to use --force-with-lease.');
          throw pushErr;
        }
        console.warn('[dist-sync] Standard push rejected; pushing with --force-with-lease (--force-push enabled).');
        runGit(['push', '--force-with-lease', 'origin', 'dist']);
      }
      console.log('[dist-sync] Remote push succeeded.');
    }

    console.log('[dist-sync] Isolated dist branch sync completed successfully.');
  } finally {
    if (fs.existsSync(TEMP_INDEX_PATH)) {
      try {
        fs.unlinkSync(TEMP_INDEX_PATH);
      } catch (_) {}
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const push = args.includes('--push');
  const forcePush = args.includes('--force-push');
  const msgIdx = args.indexOf('--message');
  const message = msgIdx !== -1 && args[msgIdx + 1] ? args[msgIdx + 1] : null;

  syncDistBranch({ dryRun, push, forcePush, message });
}

module.exports = {
  syncDistBranch,
  getPackageDistributionFiles,
};

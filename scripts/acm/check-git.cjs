#!/usr/bin/env node
/**
 * scripts/check-git.cjs
 *
 * Diagnoses system Git availability and whether the target directory is a Git repository,
 * providing non-blocking guidance in the active language.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTranslator, resolveLanguage, parseLangFlag } = require('./i18n.cjs');

function checkGitEnvironment(targetDir = process.cwd()) {
  let available = false;
  let version = null;
  let isRepo = false;

  try {
    const versionOutput = execSync('git --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    available = true;
    version = versionOutput.trim();
  } catch (_) {
    available = false;
  }

  if (available) {
    try {
      const insideWorkTree = execSync('git rev-parse --is-inside-work-tree', {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      isRepo = insideWorkTree.trim() === 'true';
    } catch (_) {
      const gitDir = path.join(targetDir, '.git');
      isRepo = fs.existsSync(gitDir);
    }
  }

  return {
    available,
    isRepo,
    version,
  };
}

function printGitNotice(status, explicitLang = null) {
  const tr = createTranslator(resolveLanguage(process.cwd(), explicitLang));

  if (status.available && status.isRepo) {
    console.log(tr('checkGit.repoActive', { version: status.version }));
    return true;
  }

  if (status.available && !status.isRepo) {
    console.log(tr('checkGit.nonRepo', { version: status.version }));
    console.log(tr('checkGit.nonRepoDesc1'));
    console.log(tr('checkGit.nonRepoDesc2'));
    console.log(tr('checkGit.nonRepoDesc3'));
    console.log(tr('checkGit.nonRepoDesc4'));
    return false;
  }

  console.warn('\n================================================================');
  console.warn(tr('checkGit.noGitHeader'));
  console.warn('----------------------------------------------------------------');
  console.warn(tr('checkGit.noGitLine1'));
  console.warn(tr('checkGit.noGitLine2'));
  console.warn(tr('checkGit.noGitFeature1'));
  console.warn(tr('checkGit.noGitFeature2'));
  console.warn(tr('checkGit.noGitFeature3'));
  console.warn(tr('checkGit.noGitInstallTip'));
  console.warn(tr('checkGit.noGitDownloadUrl'));
  console.warn('================================================================\n');

  return false;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const { lang } = parseLangFlag(args);
  const targetArg = args.find((a) => !a.startsWith('-')) || process.cwd();
  const status = checkGitEnvironment(targetArg);
  printGitNotice(status, lang || resolveLanguage(targetArg));
}

module.exports = {
  checkGitEnvironment,
  printGitNotice,
};

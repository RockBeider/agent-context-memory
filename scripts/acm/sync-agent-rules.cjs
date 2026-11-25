/**
 * scripts/sync-agent-rules.cjs
 *
 * Scans existing AI coding agent rule files (CLAUDE.md, GEMINI.md, AGENTS.md, .cursorrules, etc.),
 * prompts the user when none are detected, idempotently injects/syncs ACM governance blocks,
 * and safely strips them during uninstall with drift detection.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  ACM_MANIFEST,
  getFullGovernanceSnippet,
  getAllGovernanceBodies,
} = require('./acm-manifest.cjs');
const { t, createTranslator, resolveLanguage, DEFAULT_LANGUAGE } = require('./i18n.cjs');

const PRESET_RULE_FILES = [
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  '.cursorrules',
  '.windsurfrules',
];

function getRuleFileOptions(lang = DEFAULT_LANGUAGE) {
  return [
    { value: 'AGENTS.md', label: 'AGENTS.md', hint: t('rules.optAgentsHint', {}, lang) },
    { value: 'CLAUDE.md', label: 'CLAUDE.md', hint: t('rules.optClaudeHint', {}, lang) },
    { value: 'GEMINI.md', label: 'GEMINI.md', hint: t('rules.optGeminiHint', {}, lang) },
    { value: '.cursorrules', label: '.cursorrules', hint: t('rules.optCursorHint', {}, lang) },
    { value: '.windsurfrules', label: '.windsurfrules', hint: t('rules.optWindsurfHint', {}, lang) },
    {
      value: '__custom__',
      label: t('rules.optCustomLabel', {}, lang),
      hint: t('rules.optCustomHint', {}, lang),
    },
  ];
}

const RULE_FILE_OPTIONS = getRuleFileOptions(DEFAULT_LANGUAGE);

/**
 * Safely imports pure-ESM @clack/prompts inside CJS.
 * Returns null if unavailable so the built-in readline fallback takes over cleanly.
 */
async function loadClack() {
  try {
    return await import('@clack/prompts');
  } catch (_) {
    return null;
  }
}

function isEnvTruthy(value) {
  const norm = String(value || '').trim().toLowerCase();
  return norm === '1' || norm === 'true';
}

/**
 * Determines whether the current session can safely run interactive terminal prompts.
 * Respects explicit flags, CI/agent non-interactive env vars, and TTY capabilities.
 *
 * @param {object} [options={}]
 * @returns {boolean}
 */
function isInteractiveTerminal(options = {}) {
  if (options.nonInteractive) {
    return false;
  }
  if (typeof options.isInteractive === 'boolean') {
    return options.isInteractive;
  }
  if (options.forceInteractive) {
    return true;
  }
  const env = options.env || process.env;
  if (
    isEnvTruthy(env.ACM_NON_INTERACTIVE) ||
    isEnvTruthy(env.CI) ||
    isEnvTruthy(env.GITHUB_ACTIONS) ||
    String(env.TERM || '').trim().toLowerCase() === 'dumb'
  ) {
    return false;
  }
  const inStream = options.input || process.stdin;
  const outStream = options.output || process.stdout;
  return Boolean(inStream && inStream.isTTY && outStream && outStream.isTTY);
}

const START_MARKER = ACM_MANIFEST.governanceRules.startMarker;
const END_MARKER = ACM_MANIFEST.governanceRules.endMarker;
const EXPECTED_BODY = ACM_MANIFEST.governanceRules.expectedBody;
const GOVERNANCE_SNIPPET = getFullGovernanceSnippet(DEFAULT_LANGUAGE);

/**
 * Normalizes line endings and trailing whitespace for reliable text comparison.
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Scans targetDir for preset AI agent rule files.
 * @param {string} targetDir
 * @returns {string[]}
 */
function scanPresetRules(targetDir) {
  const detected = [];
  for (const file of PRESET_RULE_FILES) {
    const fullPath = path.join(targetDir, file);
    if (fs.existsSync(fullPath)) {
      detected.push(file);
    }
  }
  return detected;
}

/**
 * Idempotently injects or updates the ACM governance marker block inside a rule file.
 * @param {string} filePath
 * @param {object} [options={}]
 * @returns {{ file: string, created: boolean, updated: boolean }}
 */
function injectRuleToFile(filePath, options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const snippet = getFullGovernanceSnippet(lang);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, snippet + '\n', 'utf-8');
    return { file: filePath, created: true, updated: false };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex !== -1 && endIndex !== -1) {
    const before = content.slice(0, startIndex).trimEnd();
    const after = content.slice(endIndex + END_MARKER.length).trimStart();
    const newContent = (before ? before + '\n\n' : '') + snippet + (after ? '\n\n' + after : '') + '\n';
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { file: filePath, created: false, updated: true };
  }

  const newContent = snippet + '\n\n---\n\n' + content.trimStart();
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { file: filePath, created: false, updated: true };
}

/**
 * Inspects a rule file to verify whether the ACM governance block matches any official canonical template.
 * @param {string} filePath
 * @returns {{ status: 'NOT_EXISTS' | 'NOT_FOUND' | 'EXACT_MATCH' | 'MODIFIED', actualBody?: string, expectedBody: string }}
 */
function checkRuleContentDrift(filePath) {
  if (!fs.existsSync(filePath)) {
    return { status: 'NOT_EXISTS', expectedBody: EXPECTED_BODY };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { status: 'NOT_FOUND', expectedBody: EXPECTED_BODY };
  }

  const actualRaw = content.slice(startIndex + START_MARKER.length, endIndex);
  const normalizedActual = normalizeText(actualRaw);
  const matchedExpected = getAllGovernanceBodies().find(
    (body) => normalizeText(body) === normalizedActual
  );

  if (matchedExpected) {
    return { status: 'EXACT_MATCH', actualBody: actualRaw, expectedBody: matchedExpected };
  }

  return { status: 'MODIFIED', actualBody: actualRaw, expectedBody: EXPECTED_BODY };
}

/**
 * Prompts the user interactively for confirmation.
 */
function promptConfirm(questionText, options = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.on('SIGINT', () => finish(false));
    rl.on('close', () => finish(false));
    rl.question(questionText, (answer) => {
      const trimmed = String(answer || '').trim().toLowerCase();
      finish(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/**
 * Safely strips the ACM governance marker block from a rule file.
 * @param {string} filePath
 * @param {object} [options={}]
 * @returns {Promise<{ file: string, status: 'SKIPPED' | 'PRESERVED' | 'CLEANED' | 'REMOVED_FILE', detail?: string }>}
 */
async function removeRuleFromFile(filePath, options = {}) {
  const force = Boolean(options.force);
  const lang = options.lang || DEFAULT_LANGUAGE;
  const tr = createTranslator(lang);
  const isInteractive = isInteractiveTerminal(options);

  if (!fs.existsSync(filePath)) {
    return { file: filePath, status: 'SKIPPED', detail: tr('rules.detailNotExists') };
  }

  const driftResult = checkRuleContentDrift(filePath);

  if (driftResult.status === 'NOT_FOUND') {
    return { file: filePath, status: 'SKIPPED', detail: tr('rules.detailNoMarker') };
  }

  if (driftResult.status === 'MODIFIED' && !force) {
    const relName = path.basename(filePath);
    console.log(tr('rules.driftWarn', { file: relName }));
    if (isInteractive) {
      const confirmed = await promptConfirm(tr('rules.driftPrompt'), {
        input: options.input,
        output: options.output,
      });
      if (!confirmed) {
        console.log(tr('rules.driftPreservedUser', { file: relName }));
        return { file: filePath, status: 'PRESERVED', detail: tr('rules.detailUserDeclined') };
      }
    } else {
      console.log(tr('rules.driftPreservedNonInteractive'));
      return { file: filePath, status: 'PRESERVED', detail: tr('rules.detailNonInteractiveSafe') };
    }
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  let before = content.slice(0, startIndex);
  let after = content.slice(endIndex + END_MARKER.length);

  after = after.replace(/^\s*---\s*(\r?\n)?/, '');
  before = before.replace(/(\r?\n)?\s*---\s*$/, '');

  const remaining = (before.trimEnd() + (after.trim() ? '\n\n' + after.trimStart() : '')).trim();

  if (!remaining) {
    fs.unlinkSync(filePath);
    return { file: filePath, status: 'REMOVED_FILE', detail: tr('rules.detailRemovedEmpty') };
  }

  fs.writeFileSync(filePath, remaining + '\n', 'utf-8');
  return { file: filePath, status: 'CLEANED', detail: tr('rules.detailCleaned') };
}

/**
 * Built-in readline fallback when @clack/prompts cannot be loaded.
 * @param {string} [lang=DEFAULT_LANGUAGE]
 * @param {object} [options={}]
 * @returns {Promise<string[] | null>}
 */
function promptCustomRuleFileFallback(lang = DEFAULT_LANGUAGE, options = {}) {
  const tr = createTranslator(lang);
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: options.input || process.stdin,
      output: options.output || process.stdout,
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.on('SIGINT', () => finish(null));
    rl.on('close', () => finish(null));

    if (!options.silent) {
      console.log(tr('rules.fallbackNoRules'));
      console.log(tr('rules.fallbackExamples'));
    }
    rl.question(tr('rules.fallbackPrompt'), (answer) => {
      const trimmed = String(answer || '').trim();
      if (!trimmed) {
        return finish(['AGENTS.md']);
      }
      const files = trimmed
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      finish(files.length > 0 ? files : ['AGENTS.md']);
    });
  });
}

/**
 * Prompts for AI agent rule file selection via @clack/prompts multiselect when no presets are found.
 * Returns null if the user cancels (e.g. Ctrl+C).
 * @param {object} [options={}]
 * @returns {Promise<string[] | null>}
 */
async function promptCustomRuleFile(options = {}) {
  const lang = options.lang || DEFAULT_LANGUAGE;
  const tr = createTranslator(lang);
  const clack = options.useClack === false ? null : await loadClack();
  if (!clack) {
    return promptCustomRuleFileFallback(lang, options);
  }

  const ioOpts = {};
  if (options.input) ioOpts.input = options.input;
  if (options.output) ioOpts.output = options.output;

  if (!options.silent) {
    clack.log.info(tr('rules.clackNoRules'), ioOpts);
  }

  const selected = await clack.multiselect({
    message: tr('rules.clackSelectPrompt'),
    options: getRuleFileOptions(lang),
    initialValues: ['AGENTS.md'],
    required: true,
    ...ioOpts,
  });

  if (clack.isCancel(selected)) {
    return null;
  }

  const resolvedFiles = selected.filter((item) => item !== '__custom__');

  if (selected.includes('__custom__')) {
    const customInput = await clack.text({
      message: tr('rules.clackCustomPrompt'),
      placeholder: '.github/copilot-instructions.md',
      validate: (value) => {
        if (!value || !value.trim()) {
          return tr('rules.clackCustomRequired');
        }
        return undefined;
      },
      ...ioOpts,
    });

    if (clack.isCancel(customInput)) {
      return null;
    }

    const customList = String(customInput)
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    resolvedFiles.push(...customList);
  }

  const uniqueFiles = Array.from(new Set(resolvedFiles));
  return uniqueFiles.length > 0 ? uniqueFiles : ['AGENTS.md'];
}

/**
 * Resolves the target AI agent rule files for the project.
 * Returns null if the user cancels interactive selection.
 */
async function resolveTargetRuleFiles(targetDir, options = {}) {
  let targetFiles = [];
  const silent = Boolean(options.silent);
  const lang = options.lang || resolveLanguage(targetDir);
  const tr = createTranslator(lang);

  if (options.ruleFile) {
    if (Array.isArray(options.ruleFile)) {
      targetFiles = options.ruleFile;
    } else if (typeof options.ruleFile === 'string') {
      targetFiles = options.ruleFile
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    }
  }

  if (targetFiles.length === 0) {
    const scanned = scanPresetRules(targetDir);
    if (scanned.length > 0) {
      if (!silent) {
        console.log(tr('rules.autoScanDetected', { count: scanned.length, files: scanned.join(', ') }));
      }
      targetFiles = scanned;
    }
  }

  if (targetFiles.length === 0) {
    const isInteractive = isInteractiveTerminal(options);
    if (isInteractive) {
      const selected = await promptCustomRuleFile({ ...options, lang });
      if (selected === null) {
        return null;
      }
      targetFiles = selected;
    } else {
      if (!silent) {
        console.log(tr('rules.autoFallbackDefault'));
      }
      targetFiles = ['AGENTS.md'];
    }
  }

  return targetFiles;
}

/**
 * Injects or updates governance rules in all target files.
 */
function applyGovernanceRules(targetDir, targetFiles, options = {}) {
  const silent = Boolean(options.silent);
  const lang = options.lang || resolveLanguage(targetDir);
  const tr = createTranslator(lang);
  const actions = [];
  for (const relFile of targetFiles) {
    const fullPath = path.resolve(targetDir, relFile);
    const result = injectRuleToFile(fullPath, { lang });
    const relResult = path.relative(targetDir, fullPath);
    actions.push({ ...result, relFile: relResult });
    if (!silent) {
      if (result.created) {
        console.log(tr('rules.ruleCreated', { file: relResult }));
      } else {
        console.log(tr('rules.ruleSynced', { file: relResult }));
      }
    }
  }
  return { files: targetFiles, actions };
}

/**
 * Strips governance rules from target files in a project.
 */
async function removeGovernanceRules(targetDir, targetFiles = [], options = {}) {
  const candidates = targetFiles.length > 0 ? targetFiles : PRESET_RULE_FILES;
  const lang = options.lang || resolveLanguage(targetDir);
  const tr = createTranslator(lang);
  const results = [];

  for (const relFile of candidates) {
    const fullPath = path.resolve(targetDir, relFile);
    if (!fs.existsSync(fullPath)) continue;

    const res = await removeRuleFromFile(fullPath, { ...options, lang });
    results.push(res);
    const relResult = path.relative(targetDir, fullPath);

    if (res.status === 'REMOVED_FILE') {
      console.log(tr('uninstall.ruleRemovedFile', { file: relResult }));
    } else if (res.status === 'CLEANED') {
      console.log(tr('uninstall.ruleCleaned', { file: relResult }));
    } else if (res.status === 'PRESERVED') {
      console.log(tr('uninstall.rulePreserved', { file: relResult, detail: res.detail }));
    }
  }

  return results;
}

/**
 * Unified governance rule sync entry point.
 */
async function syncAgentRules(targetDir, options = {}) {
  const targetFiles = await resolveTargetRuleFiles(targetDir, options);
  if (targetFiles === null) {
    return { cancelled: true, files: [], actions: [] };
  }
  return applyGovernanceRules(targetDir, targetFiles, options);
}

module.exports = {
  PRESET_RULE_FILES,
  RULE_FILE_OPTIONS,
  getRuleFileOptions,
  START_MARKER,
  END_MARKER,
  EXPECTED_BODY,
  GOVERNANCE_SNIPPET,
  isInteractiveTerminal,
  loadClack,
  normalizeText,
  scanPresetRules,
  injectRuleToFile,
  checkRuleContentDrift,
  promptConfirm,
  removeRuleFromFile,
  removeGovernanceRules,
  promptCustomRuleFile,
  promptCustomRuleFileFallback,
  resolveTargetRuleFiles,
  applyGovernanceRules,
  syncAgentRules,
};

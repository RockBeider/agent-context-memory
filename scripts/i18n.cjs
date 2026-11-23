/**
 * scripts/i18n.cjs
 *
 * Zero-dependency i18n utility for Agent Context Memory (ACM).
 * Supports English ('en', default) and Korean ('ko').
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['en', 'ko'];
const DEFAULT_LANGUAGE = 'en';

const catalogCache = new Map();

/**
 * Normalizes a language identifier to 'en' or 'ko', or returns null if invalid/empty.
 *
 * @param {string|null|undefined} raw
 * @returns {'en'|'ko'|null}
 */
function normalizeLanguage(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (!cleaned) return null;

  if (
    cleaned === 'en' ||
    cleaned.startsWith('en-') ||
    cleaned === 'english' ||
    cleaned === 'eng' ||
    cleaned === '영어'
  ) {
    return 'en';
  }
  if (
    cleaned === 'ko' ||
    cleaned.startsWith('ko-') ||
    cleaned === 'korean' ||
    cleaned === 'kor' ||
    cleaned === 'kr' ||
    cleaned === '한글' ||
    cleaned === '한국어'
  ) {
    return 'ko';
  }
  return null;
}

/**
 * Extracts explicit --lang=<val>, --lang <val>, -l=<val>, or -l <val> flags from argv.
 *
 * @param {string[]} [argv=[]]
 * @returns {{ lang: 'en'|'ko'|null, invalid: string|null }}
 */
function parseLangFlag(argv = []) {
  if (!Array.isArray(argv)) return { lang: null, invalid: null };

  let rawValue = null;
  let foundFlag = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg.startsWith('--lang=')) {
      foundFlag = true;
      rawValue = arg.slice('--lang='.length);
    } else if (arg.startsWith('-l=')) {
      foundFlag = true;
      rawValue = arg.slice('-l='.length);
    } else if (arg === '--lang' || arg === '-l') {
      foundFlag = true;
      const next = argv[i + 1];
      if (next !== undefined && !String(next).startsWith('-')) {
        rawValue = String(next);
        i += 1;
      } else {
        rawValue = '';
      }
    }
  }

  if (!foundFlag) {
    return { lang: null, invalid: null };
  }

  const normalized = normalizeLanguage(rawValue);
  if (!normalized) {
    return { lang: null, invalid: rawValue || '<missing>' };
  }
  return { lang: normalized, invalid: null };
}

function readLanguageFromJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed && typeof parsed.language === 'string') {
      return normalizeLanguage(parsed.language);
    }
  } catch (_) {
    // Ignore malformed metadata/config files during locale lookup
  }
  return null;
}

/**
 * Resolves the effective ACM language in priority order:
 * 1) explicitLang
 * 2) process.env.ACM_LANG
 * 3) .agents/config.json (when explicitly set)
 * 4) .agents/.acm-meta.json
 * 5) DEFAULT_LANGUAGE ('en')
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {string|null} [explicitLang=null]
 * @returns {'en'|'ko'}
 */
function resolveLanguage(rootDir = process.cwd(), explicitLang = null) {
  const fromExplicit = normalizeLanguage(explicitLang);
  if (fromExplicit) return fromExplicit;

  const fromEnv = normalizeLanguage(process.env.ACM_LANG);
  if (fromEnv) return fromEnv;

  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const fromConfig = readLanguageFromJsonFile(path.join(resolvedRoot, '.agents', 'config.json'));
  if (fromConfig) return fromConfig;

  const fromMeta = readLanguageFromJsonFile(path.join(resolvedRoot, '.agents', '.acm-meta.json'));
  if (fromMeta) return fromMeta;

  return DEFAULT_LANGUAGE;
}

/**
 * Loads and caches the locale message catalog.
 *
 * @param {string} [lang=DEFAULT_LANGUAGE]
 * @returns {object}
 */
function getCatalog(lang = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  if (catalogCache.has(norm)) {
    return catalogCache.get(norm);
  }

  const localePath = path.join(__dirname, 'locales', `${norm}.cjs`);
  if (fs.existsSync(localePath)) {
    const loaded = require(localePath);
    catalogCache.set(norm, loaded);
    return loaded;
  }

  if (norm !== DEFAULT_LANGUAGE) {
    return getCatalog(DEFAULT_LANGUAGE);
  }
  return {};
}

function lookupDottedKey(obj, dottedKey) {
  if (!obj || typeof obj !== 'object' || !dottedKey) return undefined;
  const parts = String(dottedKey).split('.');
  let current = obj;
  for (const part of parts) {
    if (current && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Replaces {{key}} placeholders in a template string.
 *
 * @param {string} template
 * @param {object} [params={}]
 * @returns {string}
 */
function formatMessage(template, params = {}) {
  if (typeof template !== 'string') return String(template === undefined ? '' : template);
  if (!params || typeof params !== 'object') return template;
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined && params[key] !== null) {
      return String(params[key]);
    }
    return '';
  });
}

/**
 * Translates a dotted key using the requested language with fallback to English.
 *
 * @param {string} key
 * @param {object} [params={}]
 * @param {string} [lang=DEFAULT_LANGUAGE]
 * @returns {string}
 */
function t(key, params = {}, lang = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  let value = lookupDottedKey(getCatalog(norm), key);
  if (value === undefined && norm !== DEFAULT_LANGUAGE) {
    value = lookupDottedKey(getCatalog(DEFAULT_LANGUAGE), key);
  }
  if (value === undefined) {
    return String(key);
  }
  if (typeof value === 'string') {
    return formatMessage(value, params);
  }
  return value;
}

/**
 * Creates a bound translator function for a resolved language.
 *
 * @param {string} [lang=DEFAULT_LANGUAGE]
 * @returns {Function}
 */
function createTranslator(lang = DEFAULT_LANGUAGE) {
  const norm = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  const fn = (key, params = {}) => t(key, params, norm);
  fn.lang = norm;
  return fn;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  parseLangFlag,
  resolveLanguage,
  getCatalog,
  formatMessage,
  t,
  createTranslator,
};

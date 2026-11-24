/**
 * scripts/storage/config.cjs
 *
 * Loads and saves Agent Context Memory (ACM) storage and sync configuration (.agents/config.json).
 */

const fs = require('fs');
const path = require('path');
const { normalizeLanguage, t } = require('../i18n.cjs');

const DEFAULT_CONFIG = {
  version: 1,
  storage: {
    provider: 'sqlite',
    dbPath: '.agents/local/memory.db',
    markdownProjection: true,
  },
  sync: {
    mode: 'git-orphan',
    branch: 'acm-memory',
    remote: 'origin',
    autoScrub: true,
    shareCompletedTasks: true,
  },
  online: {
    provider: null,
  },
};

/**
 * Checks whether the current Node.js runtime provides built-in node:sqlite (DatabaseSync).
 */
function isNodeSqliteAvailable() {
  try {
    const sqlite = require('node:sqlite');
    return Boolean(sqlite && typeof sqlite.DatabaseSync === 'function');
  } catch (_) {
    return false;
  }
}

/**
 * Returns the path to .agents/config.json within the project root.
 */
function getConfigPath(rootDir) {
  return path.join(path.resolve(rootDir), '.agents', 'config.json');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepMerge(base, override) {
  const result = { ...base };
  if (!isPlainObject(override)) return result;

  for (const [key, val] of Object.entries(override)) {
    if (isPlainObject(val) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Loads the project's ACM configuration.
 * Legacy host projects without .agents/config.json automatically resolve to 'markdown'
 * when no local SQLite database exists, preserving 100% backward compatibility.
 *
 * @param {string} rootDir
 * @returns {object}
 */
function loadConfig(rootDir) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const configPath = getConfigPath(resolvedRoot);

  if (fs.existsSync(configPath)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      throw new Error(t('storage.invalidConfigJson', { path: configPath, message: err.message }));
    }
    const merged = deepMerge(DEFAULT_CONFIG, parsed);
    if (parsed && parsed.language !== undefined) {
      const normLang = normalizeLanguage(parsed.language);
      if (normLang) {
        merged.language = normLang;
      } else {
        delete merged.language;
      }
    }
    if (parsed && typeof parsed.author === 'string' && parsed.author.trim()) {
      merged.author = parsed.author.trim();
    } else {
      delete merged.author;
    }
    Object.defineProperty(merged, 'explicit', { value: true, enumerable: false });
    Object.defineProperty(merged, 'configPath', { value: configPath, enumerable: false });
    return merged;
  }

  const fallbackConfig = deepMerge(DEFAULT_CONFIG, {});
  const defaultDbFullPath = path.resolve(resolvedRoot, DEFAULT_CONFIG.storage.dbPath);
  if (!fs.existsSync(defaultDbFullPath)) {
    fallbackConfig.storage.provider = 'markdown';
  }
  Object.defineProperty(fallbackConfig, 'explicit', { value: false, enumerable: false });
  Object.defineProperty(fallbackConfig, 'configPath', { value: configPath, enumerable: false });
  return fallbackConfig;
}

/**
 * Saves configuration to .agents/config.json.
 *
 * @param {string} rootDir
 * @param {object} config
 * @returns {object}
 */
function saveConfig(rootDir, config = {}) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const configPath = getConfigPath(resolvedRoot);
  const merged = deepMerge(DEFAULT_CONFIG, config);
  const sanitized = {
    version: merged.version,
    storage: {
      provider: merged.storage.provider,
      dbPath: merged.storage.dbPath,
      markdownProjection: Boolean(merged.storage.markdownProjection),
    },
    sync: {
      mode: merged.sync.mode,
      branch: merged.sync.branch,
      remote: merged.sync.remote,
      autoScrub: Boolean(merged.sync.autoScrub),
      shareCompletedTasks: Boolean(merged.sync.shareCompletedTasks),
    },
    online: merged.online,
  };

  const explicitLang = normalizeLanguage(config.language || merged.language);
  if (explicitLang) {
    sanitized.language = explicitLang;
  }

  const rawAuthor = config.author !== undefined ? config.author : merged.author;
  if (typeof rawAuthor === 'string' && rawAuthor.trim()) {
    sanitized.author = rawAuthor.trim();
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2) + '\n', 'utf-8');
  Object.defineProperty(sanitized, 'explicit', { value: true, enumerable: false });
  Object.defineProperty(sanitized, 'configPath', { value: configPath, enumerable: false });
  return sanitized;
}

/**
 * Normalizes a storage provider identifier to 'sqlite' or 'markdown', or returns null if invalid.
 *
 * @param {string|null|undefined} raw
 * @returns {'sqlite'|'markdown'|null}
 */
function normalizeStorageProvider(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'sqlite' || cleaned === 'db' || cleaned === 'local-db' || cleaned === 'local') {
    return 'sqlite';
  }
  if (cleaned === 'markdown' || cleaned === 'md' || cleaned === 'legacy') {
    return 'markdown';
  }
  return null;
}

/**
 * Resolves the absolute path to the local SQLite database.
 */
function resolveDbPath(rootDir, config) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const cfg = config || loadConfig(resolvedRoot);
  const relOrAbs = (cfg.storage && cfg.storage.dbPath) || DEFAULT_CONFIG.storage.dbPath;
  return path.resolve(resolvedRoot, relOrAbs);
}

/**
 * Resolves the optional author identifier from ACM_AUTHOR or .agents/config.json (never auto-reads git user.name).
 */
function resolveDefaultAuthor(config) {
  return String(process.env.ACM_AUTHOR || (config && config.author) || '').trim();
}

module.exports = {
  DEFAULT_CONFIG,
  isNodeSqliteAvailable,
  normalizeStorageProvider,
  getConfigPath,
  loadConfig,
  saveConfig,
  resolveDbPath,
  resolveDefaultAuthor,
};

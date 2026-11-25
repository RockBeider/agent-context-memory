/**
 * scripts/acm/storage/config.cjs
 *
 * Loads and saves Agent Context Memory (ACM) storage and sync configuration (.agents/acm/config.json).
 */

const fs = require('fs');
const path = require('path');
const { normalizeLanguage, t } = require('../i18n.cjs');

const RETENTION_KEYS = [
  'doneTaskFtsDays',
  'doneTaskProjectionLimit',
  'syncLogMaxRows',
  'stalePatternDays',
  'tombstoneRetentionDays',
];

const DEFAULT_CONFIG = {
  version: 1,
  storage: {
    provider: 'sqlite',
    dbPath: '.agents/acm/local/memory.db',
    markdownProjection: false,
  },
  retention: {
    doneTaskFtsDays: 90,
    doneTaskProjectionLimit: 50,
    syncLogMaxRows: 100,
    stalePatternDays: 180,
    tombstoneRetentionDays: 90,
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
 * Validates a retention policy integer value (must be an integer >= -1).
 */
function validateRetentionValue(key, rawValue) {
  if (!RETENTION_KEYS.includes(key)) {
    return { valid: false, value: null, error: `Unknown retention key: ${key}` };
  }
  if (rawValue === null || rawValue === undefined || typeof rawValue === 'boolean') {
    return { valid: false, value: null, error: `Invalid integer value for ${key}` };
  }
  const str = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue);
  if (!/^-?[0-9]+$/.test(str)) {
    return { valid: false, value: null, error: `Invalid integer value for ${key}: ${rawValue}` };
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < -1) {
    return { valid: false, value: null, error: `${key} must be an integer >= -1` };
  }
  return { valid: true, value: num, error: null };
}

/**
 * Normalizes a retention config object, falling back to DEFAULT_CONFIG.retention for missing or invalid fields.
 */
function normalizeRetentionConfig(rawRetention) {
  const src = isPlainObject(rawRetention) ? rawRetention : {};
  const normalized = {};
  for (const key of RETENTION_KEYS) {
    const check = validateRetentionValue(key, src[key]);
    normalized[key] = check.valid ? check.value : DEFAULT_CONFIG.retention[key];
  }
  return normalized;
}

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
 * Returns the path to .agents/acm/config.json within the project root.
 */
function getConfigPath(rootDir) {
  return path.join(path.resolve(rootDir), '.agents', 'acm', 'config.json');
}

/**
 * Returns the legacy path to .agents/config.json within the project root.
 */
function getLegacyConfigPath(rootDir) {
  return path.join(path.resolve(rootDir), '.agents', 'config.json');
}

/**
 * Resolves the effective config.json path (namespaced .agents/acm/config.json first, then legacy .agents/config.json).
 */
function resolveConfigPath(rootDir) {
  const newPath = getConfigPath(rootDir);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = getLegacyConfigPath(rootDir);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
}

/**
 * Returns the path to .agents/acm/meta.json within the project root.
 */
function getMetaPath(rootDir) {
  return path.join(path.resolve(rootDir), '.agents', 'acm', 'meta.json');
}

/**
 * Returns the legacy path to .agents/.acm-meta.json within the project root.
 */
function getLegacyMetaPath(rootDir) {
  return path.join(path.resolve(rootDir), '.agents', '.acm-meta.json');
}

/**
 * Resolves the effective metadata path (namespaced .agents/acm/meta.json first, then legacy .agents/.acm-meta.json).
 */
function resolveMetaPath(rootDir) {
  const newPath = getMetaPath(rootDir);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = getLegacyMetaPath(rootDir);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (isPlainObject(value)) {
    const copy = {};
    for (const [k, v] of Object.entries(value)) {
      copy[k] = clonePlain(v);
    }
    return copy;
  }
  return value;
}

function deepMerge(base, override) {
  const result = clonePlain(base);
  if (!isPlainObject(override)) return result;

  for (const [key, val] of Object.entries(override)) {
    if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else if (val !== undefined) {
      result[key] = clonePlain(val);
    }
  }
  return result;
}

/**
 * Loads the project's ACM configuration.
 * Legacy host projects without config.json automatically resolve to 'markdown'
 * when no local SQLite database exists, preserving 100% backward compatibility.
 *
 * @param {string} rootDir
 * @returns {object}
 */
function loadConfig(rootDir) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const newConfigPath = getConfigPath(resolvedRoot);
  const legacyConfigPath = getLegacyConfigPath(resolvedRoot);
  const configPath = resolveConfigPath(resolvedRoot);
  const isLegacyConfig = configPath === legacyConfigPath && fs.existsSync(legacyConfigPath);

  if (fs.existsSync(configPath)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      throw new Error(t('storage.invalidConfigJson', { path: configPath, message: err.message }));
    }
    const merged = deepMerge(DEFAULT_CONFIG, parsed);
    merged.retention = normalizeRetentionConfig(merged.retention);
    if (
      isLegacyConfig &&
      (!parsed || !parsed.storage || !parsed.storage.dbPath) &&
      !fs.existsSync(path.resolve(resolvedRoot, DEFAULT_CONFIG.storage.dbPath)) &&
      fs.existsSync(path.resolve(resolvedRoot, '.agents/local/memory.db'))
    ) {
      merged.storage.dbPath = '.agents/local/memory.db';
    }
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
  const legacyDbRelPath = '.agents/local/memory.db';
  const legacyDbFullPath = path.resolve(resolvedRoot, legacyDbRelPath);
  if (fs.existsSync(defaultDbFullPath)) {
    // Namespaced SQLite DB exists
  } else if (fs.existsSync(legacyDbFullPath)) {
    fallbackConfig.storage.dbPath = legacyDbRelPath;
  } else {
    fallbackConfig.storage.provider = 'markdown';
  }
  Object.defineProperty(fallbackConfig, 'explicit', { value: false, enumerable: false });
  Object.defineProperty(fallbackConfig, 'configPath', { value: newConfigPath, enumerable: false });
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
    retention: normalizeRetentionConfig(merged.retention),
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
 * Resolves the optional author identifier from ACM_AUTHOR or config.json (never auto-reads git user.name).
 */
function resolveDefaultAuthor(config) {
  return String(process.env.ACM_AUTHOR || (config && config.author) || '').trim();
}

module.exports = {
  DEFAULT_CONFIG,
  RETENTION_KEYS,
  validateRetentionValue,
  normalizeRetentionConfig,
  isNodeSqliteAvailable,
  normalizeStorageProvider,
  getConfigPath,
  getLegacyConfigPath,
  resolveConfigPath,
  getMetaPath,
  getLegacyMetaPath,
  resolveMetaPath,
  loadConfig,
  saveConfig,
  resolveDbPath,
  resolveDefaultAuthor,
};

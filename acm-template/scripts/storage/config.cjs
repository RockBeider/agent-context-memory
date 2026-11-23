/**
 * scripts/storage/config.cjs
 *
 * Agent Context Memory(ACM) 저장소 및 동기화 설정(.agents/config.json) 로드/저장 모듈
 */

const fs = require('fs');
const path = require('path');

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
 * 현재 Node.js 런타임이 내장 node:sqlite(DatabaseSync)를 지원하는지 확인합니다.
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
 * 프로젝트 내 .agents/config.json 경로를 반환합니다.
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
 * 프로젝트의 ACM 설정을 로드합니다.
 * .agents/config.json이 없는 레거시 호스트 프로젝트는 기존 DB 유무를 확인해
 * DB가 없으면 자동으로 'markdown' 프로바이더로 해석하여 100% 하위 호환을 보장합니다.
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
      throw new Error(`.agents/config.json 파싱 실패 (${configPath}): ${err.message}`);
    }
    const merged = deepMerge(DEFAULT_CONFIG, parsed);
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
 * .agents/config.json에 설정을 저장합니다.
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

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2) + '\n', 'utf-8');
  Object.defineProperty(sanitized, 'explicit', { value: true, enumerable: false });
  Object.defineProperty(sanitized, 'configPath', { value: configPath, enumerable: false });
  return sanitized;
}

/**
 * 설정에 따른 로컬 SQLite DB 절대 경로를 반환합니다.
 */
function resolveDbPath(rootDir, config) {
  const resolvedRoot = path.resolve(rootDir || process.cwd());
  const cfg = config || loadConfig(resolvedRoot);
  const relOrAbs = (cfg.storage && cfg.storage.dbPath) || DEFAULT_CONFIG.storage.dbPath;
  return path.resolve(resolvedRoot, relOrAbs);
}

module.exports = {
  DEFAULT_CONFIG,
  isNodeSqliteAvailable,
  getConfigPath,
  loadConfig,
  saveConfig,
  resolveDbPath,
};

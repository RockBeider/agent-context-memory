/**
 * scripts/storage/memory-store.cjs
 *
 * StorageProvider registry and unified MemoryStore factory.
 * Future online DB/cloud adapters (Turso, Postgres, Gist, etc.) plug in via registerProvider().
 */

const path = require('path');
const { loadConfig } = require('./config.cjs');
const { t } = require('../i18n.cjs');
const { SqliteProvider } = require('./sqlite-provider.cjs');
const { MarkdownProvider } = require('./markdown-provider.cjs');
const { projectTasksToMarkdown } = require('./markdown-bridge.cjs');

const providerRegistry = new Map();

function registerProvider(name, factory) {
  if (!name || typeof factory !== 'function') {
    throw new Error(t('storage.invalidProviderReg'));
  }
  providerRegistry.set(String(name).trim().toLowerCase(), factory);
}

registerProvider('sqlite', (rootDir, opts) => new SqliteProvider(rootDir, opts));
registerProvider('markdown', (rootDir, opts) => new MarkdownProvider(rootDir, opts));

/**
 * Automatically projects read-only .agents/task/*.md views on SQLite store mutations.
 */
function attachMarkdownProjection(rootDir, provider, defaultOptions = {}) {
  const origUpsertTask = provider.upsertTask.bind(provider);
  const origCompleteTask = provider.completeTask.bind(provider);
  const origImportSnapshot = provider.importSnapshot.bind(provider);

  provider.upsertTask = (input, opts = {}) => {
    const result = origUpsertTask(input, opts);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider, { lang: opts.lang || defaultOptions.lang });
    }
    return result;
  };

  provider.completeTask = (idOrCode, commitSha, opts = {}) => {
    const result = origCompleteTask(idOrCode, commitSha, opts);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider, { lang: opts.lang || defaultOptions.lang });
    }
    return result;
  };

  provider.importSnapshot = (snapshot, strategy = 'merge', opts = {}) => {
    const result = origImportSnapshot(snapshot, strategy);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider, { lang: opts.lang || defaultOptions.lang });
    }
    return result;
  };

  return provider;
}

/**
 * Creates and opens a MemoryStore instance matching project configuration (.agents/config.json).
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {object} [options={}]
 * @returns {SqliteProvider|MarkdownProvider}
 */
function createMemoryStore(rootDir = process.cwd(), options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const config = options.config || loadConfig(resolvedRoot);
  const providerName = String(options.provider || (config.storage && config.storage.provider) || 'markdown')
    .trim()
    .toLowerCase();

  const factory = providerRegistry.get(providerName);
  if (!factory) {
    const registered = Array.from(providerRegistry.keys()).join(', ');
    throw new Error(t('storage.unknownProvider', { name: providerName, supported: registered }));
  }

  const provider = factory(resolvedRoot, { ...options, config });
  if (typeof provider.open === 'function') {
    provider.open();
  }

  const shouldProject =
    providerName === 'sqlite' &&
    config.storage &&
    config.storage.markdownProjection !== false &&
    !options.skipProjection;

  if (shouldProject) {
    return attachMarkdownProjection(resolvedRoot, provider, options);
  }

  return provider;
}

module.exports = {
  registerProvider,
  getRegisteredProviders: () => Array.from(providerRegistry.keys()),
  createMemoryStore,
};

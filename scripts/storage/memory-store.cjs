/**
 * scripts/storage/memory-store.cjs
 *
 * StorageProvider 레지스트리 및 통합 MemoryStore 팩토리
 * 향후 온라인 DB/클라우드 백엔드(Turso, Postgres, Gist 등) 어댑터를 registerProvider()로 플러그인 연동합니다.
 */

const path = require('path');
const { loadConfig } = require('./config.cjs');
const { SqliteProvider } = require('./sqlite-provider.cjs');
const { MarkdownProvider } = require('./markdown-provider.cjs');
const { projectTasksToMarkdown } = require('./markdown-bridge.cjs');

const providerRegistry = new Map();

function registerProvider(name, factory) {
  if (!name || typeof factory !== 'function') {
    throw new Error('유효한 프로바이더 이름과 팩토리 함수가 필요합니다.');
  }
  providerRegistry.set(String(name).trim().toLowerCase(), factory);
}

registerProvider('sqlite', (rootDir, opts) => new SqliteProvider(rootDir, opts));
registerProvider('markdown', (rootDir, opts) => new MarkdownProvider(rootDir, opts));

/**
 * SQLite 백엔드 변경 시 설정에 따라 .agents/task/*.md 읽기 전용 뷰를 자동 투영합니다.
 */
function attachMarkdownProjection(rootDir, provider) {
  const origUpsertTask = provider.upsertTask.bind(provider);
  const origCompleteTask = provider.completeTask.bind(provider);
  const origImportSnapshot = provider.importSnapshot.bind(provider);

  provider.upsertTask = (input, opts = {}) => {
    const result = origUpsertTask(input, opts);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider);
    }
    return result;
  };

  provider.completeTask = (idOrCode, commitSha, opts = {}) => {
    const result = origCompleteTask(idOrCode, commitSha, opts);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider);
    }
    return result;
  };

  provider.importSnapshot = (snapshot, strategy = 'merge', opts = {}) => {
    const result = origImportSnapshot(snapshot, strategy);
    if (!opts.skipProjection) {
      projectTasksToMarkdown(rootDir, provider);
    }
    return result;
  };

  return provider;
}

/**
 * 프로젝트 설정(.agents/config.json)에 맞는 MemoryStore 인스턴스를 생성·초기화합니다.
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
    throw new Error(
      `[설정 오류] 등록되지 않은 스토리지 프로바이더입니다: "${providerName}" (지원 목록: ${registered})`
    );
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
    return attachMarkdownProjection(resolvedRoot, provider);
  }

  return provider;
}

module.exports = {
  registerProvider,
  getRegisteredProviders: () => Array.from(providerRegistry.keys()),
  createMemoryStore,
};

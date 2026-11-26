#!/usr/bin/env node
/**
 * scripts/mcp-server.cjs
 *
 * Zero-dependency daemonless stdio MCP (Model Context Protocol) server for Agent Context Memory.
 * Transport: Newline-delimited JSON-RPC 2.0 over stdin/stdout (diagnostics strictly to stderr).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ACM_MANIFEST } = require('./acm-manifest.cjs');
const { loadConfig } = require('./storage/config.cjs');
const { createMemoryStore } = require('./storage/memory-store.cjs');
const { isValidRefName, syncWithGitOrphan } = require('./storage/git-orphan-sync.cjs');
const { checkGitEnvironment } = require('./check-git.cjs');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

const ROOT_DIR_PROPERTY = {
  type: 'string',
  description:
    'Optional absolute path to target ACM workspace root (overrides server default rootDir for multi-workspace sessions).',
};

const TOOLS = [
  {
    name: 'acm_status',
    description:
      'Inspect Agent Context Memory workspace status, storage backend, record counts, active tasks summary, Git availability, and sync metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        rootDir: ROOT_DIR_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'acm_search',
    description:
      'Perform full-text BM25 search across tasks, learned patterns, and ADRs with optional kind filtering and token budget packing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string (keywords or phrase).',
        },
        kind: {
          type: 'string',
          enum: ['all', 'task', 'pattern', 'adr'],
          description: 'Filter search scope by record kind (default: all).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of matching records to return (default: 10).',
        },
        tokenBudget: {
          type: 'integer',
          minimum: 0,
          description: 'Optional approximate token budget cap (0 = unlimited).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'acm_task_list',
    description: 'List working memory tasks from the configured ACM MemoryStore.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'ready', 'done', 'paused'],
          description: 'Optional status filter.',
        },
        includeDone: {
          type: 'boolean',
          description: 'Whether to include completed tasks when status is omitted (default: false).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'acm_task_upsert',
    description:
      'Create a new task or update an existing task (provide idOrCode to update). Transitioning to "ready" enforces the 3 required elements (purpose, results, targets) unless skipValidation is true.',
    inputSchema: {
      type: 'object',
      properties: {
        idOrCode: {
          type: 'string',
          description: 'Existing task UID, code (e.g. TSK-K7M29A or legacy TSK-1), or unambiguous prefix (e.g. K7M2) when updating.',
        },
        title: {
          type: 'string',
          description: 'Task title (required when creating a new task).',
        },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'ready', 'done', 'paused'],
          description: 'Task lifecycle status.',
        },
        purpose: {
          type: 'string',
          description: 'Concise background and goal summary.',
        },
        results: {
          type: 'array',
          items: { type: 'string' },
          description: 'File-by-file change summary bullets (recommended <= 5 items).',
        },
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modified file or directory paths.',
        },
        groupName: {
          type: 'string',
          description: 'Logical group heading for the task.',
        },
        owner: {
          type: 'string',
          description: 'Agent or developer owner identifier.',
        },
        scope: {
          type: 'string',
          enum: ['local', 'shared'],
          description: 'Record sharing scope (default: local).',
        },
        skipValidation: {
          type: 'boolean',
          description: 'Skip strict 3-element [Ready] validation (default: false).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'acm_task_complete',
    description:
      'Mark an existing task as done with an optional Git commit SHA reference and archive it.',
    inputSchema: {
      type: 'object',
      properties: {
        idOrCode: {
          type: 'string',
          description: 'Task UID, code (e.g. TSK-K7M29A or legacy TSK-1), or unambiguous prefix (e.g. K7M2).',
        },
        commitSha: {
          type: 'string',
          description: 'Optional Git commit SHA or completion reference.',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      required: ['idOrCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'acm_pattern_save',
    description:
      'Distill or update a reusable learned pattern (P-XXXXXX / legacy P-XX) with optional supersedes version chaining.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Pattern title.',
        },
        category: {
          type: 'string',
          description: 'Domain or component category.',
        },
        summary: {
          type: 'string',
          description: 'One-line index summary.',
        },
        symptom: {
          type: 'string',
          description: 'Observed symptom and root cause.',
        },
        solution: {
          type: 'string',
          description: 'Verified reusable solution pattern.',
        },
        relatedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related source file or directory paths.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable keywords/tags.',
        },
        supersedesCode: {
          type: 'string',
          description: 'Existing pattern code (e.g. P-M3N8Q2 or legacy P-01) or unambiguous prefix that this new version supersedes.',
        },
        supersedesUid: {
          type: 'string',
          description: 'Existing pattern UID that this new version supersedes.',
        },
        author: {
          type: 'string',
          description: 'Author or agent identifier.',
        },
        scope: {
          type: 'string',
          enum: ['shared', 'local'],
          description: 'Record sharing scope (default: shared).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'acm_pattern_get',
    description: 'Retrieve a specific learned pattern record by UID, code (e.g. P-M3N8Q2 or legacy P-01), or unambiguous prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        idOrCode: {
          type: 'string',
          description: 'Pattern UID, code (e.g. P-M3N8Q2 or legacy P-01), or unambiguous prefix.',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      required: ['idOrCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'acm_adr_add',
    description: 'Record a macro Architecture Decision Record (LOG-XXXXXX / legacy LOG-XX) in the memory store.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'ADR title.',
        },
        date: {
          type: 'string',
          description: 'ISO date string YYYY-MM-DD (defaults to today).',
        },
        summary: {
          type: 'string',
          description: 'One-line architectural decision summary for index tables.',
        },
        relatedArea: {
          type: 'string',
          description: 'Affected modules, directories, or subsystems.',
        },
        relatedTaskCode: {
          type: 'string',
          description: 'Associated task code (e.g. TSK-K7M29A or legacy TSK-23).',
        },
        branch: {
          type: 'string',
          description: 'Associated Git branch name.',
        },
        context: {
          type: 'string',
          description: 'Context and architectural goals.',
        },
        decision: {
          type: 'string',
          description: 'Chosen architectural decisions.',
        },
        impact: {
          type: 'string',
          description: 'Expected impact and trade-offs.',
        },
        author: {
          type: 'string',
          description: 'Author or agent identifier.',
        },
        scope: {
          type: 'string',
          enum: ['shared', 'local'],
          description: 'Record sharing scope (default: shared).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'acm_sync',
    description:
      'Inspect status or synchronize shared patterns, ADRs, and completed tasks via the Git orphan branch (acm-memory) with outbound Secret Scrubber.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['both', 'pull', 'push', 'status'],
          description: 'Sync operation mode (default: status).',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview merge/redaction counts without modifying Git refs or SQLite.',
        },
        branch: {
          type: 'string',
          description: 'Override orphan sync branch name (default: acm-memory).',
        },
        remote: {
          type: 'string',
          description: 'Override Git remote name (default: origin).',
        },
        autoScrub: {
          type: 'boolean',
          description: 'Enable outbound secret scrubbing before push (default: true).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'acm_compact',
    description:
      'Archive aged completed tasks out of FTS5/Markdown projection, prune excess sync_log rows, and run SQLite FTS optimize + WAL checkpoint + VACUUM. Defaults to dryRun=true.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'Preview compaction candidates without modifying DB or files (default: true).',
        },
        doneTaskFtsDays: {
          type: 'integer',
          minimum: -1,
          description: 'Override retention.doneTaskFtsDays (-1 = unlimited, 0 = immediate).',
        },
        syncLogMaxRows: {
          type: 'integer',
          minimum: -1,
          description: 'Override retention.syncLogMaxRows (-1 = unlimited).',
        },
        vacuum: {
          type: 'boolean',
          description: 'Run FTS5 optimize, WAL truncate checkpoint, and VACUUM (default: true).',
        },
        exportArchive: {
          type: 'boolean',
          description: 'Write archived completed tasks to .agents/acm/memory/archive/tasks-YYYY.jsonl (default: false).',
        },
        rootDir: ROOT_DIR_PROPERTY,
      },
      additionalProperties: false,
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function pickDefined(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj && obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Parses CLI flags specific to scripts/mcp-server.cjs.
 */
function parseMcpArgs(argv = []) {
  let help = false;
  let printConfig = false;
  let json = false;
  let rootDir = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '-h' || arg === '--help' || arg === 'help') {
      help = true;
    } else if (arg === '--print-config') {
      printConfig = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else if (arg === '--root') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        rootDir = String(argv[i + 1]);
        i += 1;
      }
    } else if (arg === '--lang' || arg === '-l') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) {
        i += 1;
      }
    }
  }

  return { help, printConfig, json, rootDir };
}

/**
 * Builds ready-to-paste MCP client configuration snippets (Antigravity, Claude Code, Cursor, generic mcpServers).
 */
function buildMcpConfigSnippets(rootDir = process.cwd()) {
  const resolvedRoot = path.resolve(rootDir);
  const localScriptPath = path.join(resolvedRoot, 'scripts', 'acm', 'mcp-server.cjs').replace(/\\/g, '/');
  return {
    recommendedNpx: {
      mcpServers: {
        'agent-context-memory': {
          command: 'npx',
          args: ['-y', 'agent-context-memory', 'mcp'],
          env: {
            ACM_ROOT_DIR: resolvedRoot.replace(/\\/g, '/'),
          },
        },
      },
    },
    localNodeScript: {
      mcpServers: {
        'agent-context-memory': {
          command: 'node',
          args: [localScriptPath, `--root=${resolvedRoot.replace(/\\/g, '/')}`],
        },
      },
    },
    globalMultiWorkspace: {
      mcpServers: {
        'agent-context-memory': {
          command: 'npx',
          args: ['-y', 'agent-context-memory', 'mcp'],
        },
      },
      note: 'Omit fixed ACM_ROOT_DIR / --root and pass optional rootDir per tool call to isolate multiple workspaces safely.',
    },
  };
}

function resolveEffectiveRootDir(rawRootDir, defaultRootDir) {
  if (rawRootDir === undefined || rawRootDir === null) {
    return defaultRootDir;
  }
  const trimmed = String(rawRootDir).trim();
  if (!trimmed) {
    return defaultRootDir;
  }
  const resolved = path.resolve(trimmed);
  let isDir = false;
  try {
    isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch (_) {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Invalid rootDir: "${rawRootDir}" does not exist or is not a directory.`);
  }
  return resolved;
}

function executeToolCall(name, rawArgs, ctx) {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  const effectiveRootDir = resolveEffectiveRootDir(args.rootDir, ctx.rootDir);
  const isDefaultRoot = effectiveRootDir === ctx.rootDir;
  const effectiveLang = isDefaultRoot
    ? ctx.lang
    : resolveLanguage(effectiveRootDir, ctx.explicitLang || null);
  const effectiveTr = isDefaultRoot ? ctx.tr : createTranslator(effectiveLang);

  if (name === 'acm_sync') {
    const direction = args.direction || 'status';
    if (!['both', 'pull', 'push', 'status'].includes(String(direction))) {
      throw new Error(`Invalid sync direction: "${direction}". Expected both, pull, push, or status.`);
    }
    if (args.branch !== undefined && !isValidRefName(args.branch)) {
      throw new Error(effectiveTr('dbCli.syncInvalidRef', { ref: args.branch }));
    }
    if (args.remote !== undefined && !isValidRefName(args.remote)) {
      throw new Error(effectiveTr('dbCli.syncInvalidRef', { ref: args.remote }));
    }
    return syncWithGitOrphan(effectiveRootDir, {
      direction,
      dryRun: Boolean(args.dryRun),
      branch: args.branch,
      remote: args.remote,
      autoScrub: args.autoScrub !== undefined ? Boolean(args.autoScrub) : undefined,
      lang: effectiveLang,
    });
  }

  const config = loadConfig(effectiveRootDir);
  const skipProjForCall =
    name !== 'acm_task_upsert' && name !== 'acm_task_complete' && name !== 'acm_compact';
  const store = createMemoryStore(effectiveRootDir, {
    config,
    lang: effectiveLang,
    skipProjection: skipProjForCall,
  });

  try {
    switch (name) {
      case 'acm_status': {
        const stats = store.getStats();
        const activeTasks = store.listTasks({ includeDone: false }).map((task) => ({
          uid: task.uid,
          code: task.code,
          title: task.title,
          status: task.status,
          owner: task.owner || '',
          groupName: task.groupName || '',
        }));
        const gitEnv = checkGitEnvironment(effectiveRootDir);
        const payload = {
          provider: stats.provider,
          rootDir: effectiveRootDir,
          stats,
          retention: config.retention,
          activeTasks,
          syncConfig: config.sync,
          gitAvailable: Boolean(gitEnv.available && gitEnv.isRepo),
        };
        if (stats.provider === 'sqlite' && typeof store.getLastSyncCommit === 'function') {
          payload.lastSyncCommit = store.getLastSyncCommit() || null;
          payload.recentSyncHistoryCount =
            typeof store.getSyncHistory === 'function' ? store.getSyncHistory(5).length : 0;
        }
        return payload;
      }

      case 'acm_search': {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) {
          throw new Error(effectiveTr('dbCli.missingArg', { arg: 'query' }));
        }
        const results = store.search(query, {
          kind: args.kind || 'all',
          limit: args.limit !== undefined ? Number(args.limit) : 10,
          tokenBudget: args.tokenBudget !== undefined ? Number(args.tokenBudget) : 0,
        });
        return {
          query,
          count: results.length,
          results,
        };
      }

      case 'acm_task_list': {
        const tasks = store.listTasks({
          status: args.status,
          includeDone: Boolean(args.includeDone),
        });
        return {
          provider: config.storage.provider,
          count: tasks.length,
          tasks,
        };
      }

      case 'acm_task_upsert': {
        let existing = null;
        if (args.idOrCode !== undefined && args.idOrCode !== null && String(args.idOrCode).trim()) {
          existing = store.getTask(String(args.idOrCode).trim());
          if (!existing || existing.deletedAt) {
            throw new Error(effectiveTr('dbCli.notFound', { id: args.idOrCode }));
          }
        }

        const fields = pickDefined(args, [
          'title',
          'status',
          'purpose',
          'results',
          'targets',
          'groupName',
          'owner',
          'scope',
        ]);
        const payload = existing
          ? { uid: existing.uid, code: existing.code, ...fields }
          : fields;

        const task = store.upsertTask(payload, {
          skipValidation: Boolean(args.skipValidation),
          lang: effectiveLang,
        });
        return {
          action: existing ? 'updated' : 'created',
          task,
        };
      }

      case 'acm_task_complete': {
        const idOrCode = typeof args.idOrCode === 'string' ? args.idOrCode.trim() : '';
        if (!idOrCode) {
          throw new Error(effectiveTr('dbCli.missingArg', { arg: 'idOrCode' }));
        }
        const commitSha =
          args.commitSha !== undefined && args.commitSha !== null && String(args.commitSha).trim()
            ? String(args.commitSha).trim()
            : null;
        const task = store.completeTask(idOrCode, commitSha, { lang: effectiveLang });
        return {
          completed: true,
          task,
        };
      }

      case 'acm_pattern_save': {
        const payload = pickDefined(args, [
          'title',
          'category',
          'summary',
          'symptom',
          'solution',
          'relatedFiles',
          'tags',
          'supersedesCode',
          'supersedesUid',
          'author',
          'scope',
        ]);
        const pattern = store.upsertPattern(payload, { lang: effectiveLang });
        return {
          saved: true,
          pattern,
        };
      }

      case 'acm_pattern_get': {
        const idOrCode = typeof args.idOrCode === 'string' ? args.idOrCode.trim() : '';
        if (!idOrCode) {
          throw new Error(effectiveTr('dbCli.missingArg', { arg: 'idOrCode' }));
        }
        const pattern = store.getPattern(idOrCode);
        if (!pattern || pattern.deletedAt) {
          throw new Error(effectiveTr('dbCli.notFound', { id: idOrCode }));
        }
        return { pattern };
      }

      case 'acm_adr_add': {
        const payload = pickDefined(args, [
          'title',
          'date',
          'summary',
          'relatedArea',
          'relatedTaskCode',
          'branch',
          'context',
          'decision',
          'impact',
          'author',
          'scope',
        ]);
        const adr = store.upsertAdr(payload, { lang: effectiveLang });
        return {
          saved: true,
          adr,
        };
      }

      case 'acm_compact': {
        const dryRun = args.dryRun !== undefined ? Boolean(args.dryRun) : true;
        const compactOpts = {
          dryRun,
          vacuum: args.vacuum !== undefined ? Boolean(args.vacuum) : true,
          exportArchive: Boolean(args.exportArchive),
          lang: effectiveLang,
        };
        if (args.doneTaskFtsDays !== undefined) {
          compactOpts.doneTaskFtsDays = Number(args.doneTaskFtsDays);
        }
        if (args.syncLogMaxRows !== undefined) {
          compactOpts.syncLogMaxRows = Number(args.syncLogMaxRows);
        }
        return store.compact(compactOpts);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } finally {
    store.close();
  }
}

/**
 * Handles a single parsed JSON-RPC 2.0 request or notification.
 * Returns a JSON-RPC 2.0 response object, or null for notifications.
 */
function handleJsonRpcMessage(msg, ctx) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: msg && typeof msg === 'object' && !Array.isArray(msg) && msg.id !== undefined ? msg.id : null,
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    };
  }

  const { id, method, params } = msg;

  // JSON-RPC notifications must not produce a response
  if (
    id === undefined ||
    method === 'notifications/initialized' ||
    method === 'notifications/cancelled' ||
    method.startsWith('notifications/')
  ) {
    return null;
  }

  switch (method) {
    case 'initialize': {
      const requestedVersion =
        params && typeof params.protocolVersion === 'string' && params.protocolVersion.trim()
          ? params.protocolVersion.trim()
          : DEFAULT_PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requestedVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'agent-context-memory',
            version: ACM_MANIFEST.version,
          },
        },
      };
    }

    case 'ping': {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    case 'tools/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS,
        },
      };
    }

    case 'tools/call': {
      const toolName = params && typeof params.name === 'string' ? params.name : '';
      if (!toolName || !TOOLS_BY_NAME.has(toolName)) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${toolName}`,
          },
        };
      }

      try {
        const payload = executeToolCall(toolName, params.arguments, ctx);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: err.message }, null, 2),
              },
            ],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

/**
 * Starts a newline-delimited JSON-RPC 2.0 MCP server bound to input/output streams.
 */
function createMcpServer(options = {}) {
  const rootDir = path.resolve(
    options.rootDir || process.env.ACM_ROOT_DIR || process.cwd()
  );
  const explicitLang = options.explicitLang !== undefined ? options.explicitLang : options.lang || null;
  const lang = resolveLanguage(rootDir, explicitLang);
  const tr = createTranslator(lang);
  const ctx = { rootDir, lang, explicitLang, tr };

  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const errStream = options.errStream || process.stderr;

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  const writeResponse = (resp) => {
    if (resp === null || resp === undefined) return;
    output.write(`${JSON.stringify(resp)}\n`);
  };

  rl.on('line', (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
      return;
    }

    try {
      const response = handleJsonRpcMessage(parsed, ctx);
      writeResponse(response);
    } catch (err) {
      errStream.write(`[acm-mcp] Unexpected handler error: ${err.stack || err.message}\n`);
      if (parsed && parsed.id !== undefined) {
        writeResponse({
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32603,
            message: 'Internal error',
          },
        });
      }
    }
  });

  const done = new Promise((resolve) => {
    rl.on('close', () => resolve(0));
  });

  return {
    rl,
    done,
    close: () => rl.close(),
  };
}

function main(argv = process.argv.slice(2)) {
  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(argv);
  const parsedArgs = parseMcpArgs(argv);
  const rootDir = path.resolve(
    parsedArgs.rootDir || process.env.ACM_ROOT_DIR || process.cwd()
  );
  const lang = resolveLanguage(rootDir, parsedLang);
  const tr = createTranslator(lang);

  if (invalidLang !== null) {
    process.stderr.write(`${tr('cli.unsupportedLang', { lang: invalidLang })}\n`);
    process.exit(1);
  }

  if (parsedArgs.help) {
    process.stdout.write(`${tr('mcp.help')}\n`);
    process.exit(0);
  }

  if (parsedArgs.printConfig) {
    const snippets = buildMcpConfigSnippets(rootDir);
    if (parsedArgs.json) {
      process.stdout.write(`${JSON.stringify(snippets, null, 2)}\n`);
    } else {
      process.stdout.write(`${tr('mcp.printConfigHeader', { rootDir })}\n\n`);
      process.stdout.write(`${JSON.stringify(snippets, null, 2)}\n\n`);
      process.stdout.write(`${tr('mcp.printConfigNote')}\n`);
    }
    process.exit(0);
  }

  const server = createMcpServer({ rootDir, lang, explicitLang: parsedLang || null });
  server.done.then((code) => process.exit(code));
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOLS,
  DEFAULT_PROTOCOL_VERSION,
  parseMcpArgs,
  buildMcpConfigSnippets,
  handleJsonRpcMessage,
  createMcpServer,
};

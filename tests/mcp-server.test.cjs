/**
 * tests/mcp-server.test.cjs
 *
 * End-to-end stdio JSON-RPC 2.0 test suite for `acm mcp` (scripts/mcp-server.cjs).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');
const readline = require('readline');
const { spawn, spawnSync, execSync } = require('child_process');

console.log('=== Starting Agent Context Memory Stdio MCP Server E2E Tests ===');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

function runGit(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', shell: false });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function createMcpClient(proc) {
  const pending = new Map();
  const nullIdWaiters = [];
  const stderrChunks = [];

  proc.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString('utf-8'));
  });

  const rl = readline.createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`MCP server emitted non-JSON line on stdout: ${trimmed}\n${err.message}`);
    }

    if (msg.id === null && nullIdWaiters.length > 0) {
      const waiter = nullIdWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return;
    }

    if (msg.id !== undefined && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    }
  });

  function sendRequest(method, params, id, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for response id=${id} method=${method}\nstderr: ${stderrChunks.join('')}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  function sendNotification(method, params) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  function sendRawLineAndAwaitNullId(rawLine, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for id=null error response\nstderr: ${stderrChunks.join('')}`));
      }, timeoutMs);
      nullIdWaiters.push({ resolve, reject, timer });
      proc.stdin.write(`${rawLine}\n`);
    });
  }

  async function close() {
    rl.close();
    const exitPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Timeout waiting for MCP server process exit\nstderr: ${stderrChunks.join('')}`));
      }, 120000);
      proc.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    proc.stdin.end();
    return exitPromise;
  }

  return {
    sendRequest,
    sendNotification,
    sendRawLineAndAwaitNullId,
    close,
    getStderr: () => stderrChunks.join(''),
  };
}

function parseToolPayload(resp) {
  assert.ok(resp && resp.result, `Expected result payload, got: ${JSON.stringify(resp)}`);
  assert.ok(Array.isArray(resp.result.content) && resp.result.content.length > 0, 'Missing tool content array');
  return JSON.parse(resp.result.content[0].text);
}

async function runTests() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-mcp-e2e-'));
  const remoteDir = path.join(tempRoot, 'remote.git');
  const repoDir = path.join(tempRoot, 'repo');
  let activeProc = null;

  try {
    // 1. CLI --help & --print-config checks
    console.log('[Stage 1] Verify acm mcp --help and --print-config');
    const helpRes = spawnSync(process.execPath, [CLI_PATH, 'mcp', '--help'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });
    assert.strictEqual(helpRes.status, 0, `mcp --help failed: ${helpRes.stderr || helpRes.stdout}`);
    assert.ok(helpRes.stdout.includes('--print-config'), 'mcp --help missing --print-config');

    const printCfgRes = spawnSync(process.execPath, [CLI_PATH, 'mcp', '--print-config', '--json'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });
    assert.strictEqual(printCfgRes.status, 0, `mcp --print-config --json failed: ${printCfgRes.stderr || printCfgRes.stdout}`);
    const snippets = JSON.parse(printCfgRes.stdout);
    assert.ok(
      snippets.recommendedNpx &&
        snippets.recommendedNpx.mcpServers &&
        snippets.recommendedNpx.mcpServers['agent-context-memory'] &&
        snippets.recommendedNpx.mcpServers['agent-context-memory'].args.includes('mcp'),
      'Invalid recommendedNpx config snippet'
    );
    assert.ok(
      snippets.localNodeScript &&
        snippets.localNodeScript.mcpServers &&
        snippets.localNodeScript.mcpServers['agent-context-memory'] &&
        snippets.localNodeScript.mcpServers['agent-context-memory'].args[0].endsWith('/scripts/acm/mcp-server.cjs'),
      'Invalid localNodeScript config snippet (expected scripts/acm/mcp-server.cjs)'
    );

    const printHumanRes = spawnSync(process.execPath, [CLI_PATH, 'mcp', '--print-config'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });
    assert.strictEqual(printHumanRes.status, 0, 'mcp --print-config failed');
    assert.ok(printHumanRes.stdout.includes('mcpServers'), 'mcp --print-config output missing mcpServers');
    console.log('[PASS] acm mcp --help and --print-config verified.');

    // 2. Initialize bare Git remote + host SQLite workspace
    console.log('[Stage 2] Setup temp Git repo + bare remote and initialize ACM SQLite workspace');
    fs.mkdirSync(remoteDir, { recursive: true });
    runGit(['init', '--bare'], remoteDir);
    runGit(['clone', remoteDir, repoDir], tempRoot);
    runGit(['config', 'user.name', 'MCP Test'], repoDir);
    runGit(['config', 'user.email', 'mcp@example.com'], repoDir);
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'mcp-host-app', version: '1.0.0', scripts: {} }, null, 2)
    );
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# MCP Host App\n');
    runGit(['add', '.'], repoDir);
    runGit(['commit', '-m', 'chore: initial commit'], repoDir);
    runGit(['push', '-u', 'origin', 'HEAD'], repoDir);

    const initRes = spawnSync(
      process.execPath,
      [CLI_PATH, 'init', '--force', '--non-interactive', '--storage=sqlite'],
      { cwd: repoDir, encoding: 'utf-8' }
    );
    assert.strictEqual(initRes.status, 0, `init failed: ${initRes.stderr || initRes.stdout}`);
    assert.ok(fs.existsSync(path.join(repoDir, '.agents', 'acm', 'local', 'memory.db')), 'SQLite DB missing after init');
    const mcpCfg = JSON.parse(fs.readFileSync(path.join(repoDir, '.agents', 'acm', 'config.json'), 'utf-8'));
    assert.strictEqual(mcpCfg.storage.markdownProjection, false, 'Default sqlite MCP repo should disable markdownProjection');
    assert.ok(!fs.existsSync(path.join(repoDir, '.agents', 'acm', 'task', 'task.md')), 'Default sqlite init must not create task.md');

    // 3. Spawn stdio MCP server and test full JSON-RPC 2.0 protocol + all 9 tools
    console.log('[Stage 3] Spawn stdio MCP server (`acm mcp`) and test JSON-RPC lifecycle + all 9 tools');
    const proc = spawn(process.execPath, [CLI_PATH, 'mcp'], {
      cwd: repoDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    activeProc = proc;
    const client = createMcpClient(proc);

    // 3-1. initialize + notifications/initialized + ping
    const initRpc = await client.sendRequest(
      'initialize',
      { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client', version: '1.0' } },
      1
    );
    assert.strictEqual(initRpc.jsonrpc, '2.0');
    assert.strictEqual(initRpc.id, 1);
    assert.strictEqual(initRpc.result.serverInfo.name, 'agent-context-memory');
    assert.ok(initRpc.result.capabilities && initRpc.result.capabilities.tools, 'capabilities.tools missing');

    client.sendNotification('notifications/initialized', {});
    const pingRpc = await client.sendRequest('ping', {}, 2);
    assert.strictEqual(pingRpc.id, 2, 'notifications/initialized emitted unexpected response before ping');
    assert.deepStrictEqual(pingRpc.result, {});

    // 3-2. tools/list
    const listRpc = await client.sendRequest('tools/list', {}, 3);
    const toolNames = listRpc.result.tools.map((tool) => tool.name);
    const expectedTools = [
      'acm_status',
      'acm_search',
      'acm_task_list',
      'acm_task_upsert',
      'acm_task_complete',
      'acm_pattern_save',
      'acm_pattern_get',
      'acm_adr_add',
      'acm_sync',
      'acm_compact',
    ];
    assert.deepStrictEqual(toolNames, expectedTools, `Tool list mismatch: ${JSON.stringify(toolNames)}`);
    for (const tool of listRpc.result.tools) {
      assert.strictEqual(tool.inputSchema.type, 'object', `Invalid schema for ${tool.name}`);
    }

    // 3-3. acm_status
    const statusPayload = parseToolPayload(
      await client.sendRequest('tools/call', { name: 'acm_status', arguments: {} }, 4)
    );
    assert.strictEqual(statusPayload.provider, 'sqlite');
    assert.strictEqual(statusPayload.gitAvailable, true);
    assert.strictEqual(statusPayload.stats.tasks.total, 0);
    assert.ok(statusPayload.retention && statusPayload.retention.doneTaskProjectionLimit === 50, 'Expected retention defaults in acm_status');
    assert.strictEqual(typeof statusPayload.stats.dbSizeBytes, 'number');

    // 3-4. acm_task_upsert invalid [Ready] missing 3 elements -> isError: true
    const invalidReadyResp = await client.sendRequest(
      'tools/call',
      {
        name: 'acm_task_upsert',
        arguments: { title: 'Incomplete ready task', status: 'ready' },
      },
      5
    );
    assert.strictEqual(invalidReadyResp.result.isError, true, 'Missing 3 elements should yield isError: true');

    // 3-5. acm_task_upsert valid create (with Korean text, quotes, backticks)
    const tskShortRe = /^TSK-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
    const patShortRe = /^P-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
    const adrShortRe = /^LOG-[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

    const upsertCreatePayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        {
          name: 'acm_task_upsert',
          arguments: {
            title: 'MCP 한글 "quoted" `backtick` task validation',
            status: 'ready',
            purpose: 'Verify stdio MCP server writes UTF-8 and projects to task.md cleanly.',
            results: ['`scripts/mcp-server.cjs`: Created JSON-RPC 2.0 stdio transport'],
            targets: ['scripts/mcp-server.cjs'],
            owner: 'agent-mcp',
          },
        },
        6
      )
    );
    assert.strictEqual(upsertCreatePayload.action, 'created');
    const taskCode = upsertCreatePayload.task.code;
    assert.ok(tskShortRe.test(taskCode), `Expected short-id task code, got: ${taskCode}`);
    assert.strictEqual(upsertCreatePayload.task.status, 'ready');
    assert.ok(
      !fs.existsSync(path.join(repoDir, '.agents', 'acm', 'task', 'task.md')),
      'acm_task_upsert should not create .agents/acm/task/task.md when markdownProjection is false'
    );

    // 3-6. acm_task_list
    const taskListPayload = parseToolPayload(
      await client.sendRequest('tools/call', { name: 'acm_task_list', arguments: { status: 'ready' } }, 7)
    );
    assert.strictEqual(taskListPayload.count, 1);
    assert.strictEqual(taskListPayload.tasks[0].code, taskCode);

    // 3-7. acm_task_complete (via 4-char short-id prefix)
    const completePayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        { name: 'acm_task_complete', arguments: { idOrCode: taskCode.slice(4, 8), commitSha: 'deadbeef' } },
        8
      )
    );
    assert.strictEqual(completePayload.completed, true);
    assert.strictEqual(completePayload.task.code, taskCode);
    assert.strictEqual(completePayload.task.status, 'done');
    assert.strictEqual(completePayload.task.commitSha, 'deadbeef');

    // 3-8. acm_pattern_save v1 + v2 supersedes + acm_pattern_get (via prefix)
    const pat1Payload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        {
          name: 'acm_pattern_save',
          arguments: {
            title: 'Stdio JSON-RPC Hygiene',
            category: 'MCP',
            summary: 'Route logs strictly to stderr when running stdio MCP',
            symptom: 'stdout log corrupts JSON-RPC parser',
            solution: 'Use process.stderr.write for diagnostics',
            relatedFiles: ['scripts/mcp-server.cjs'],
            tags: ['mcp', 'stdio'],
          },
        },
        9
      )
    );
    assert.strictEqual(pat1Payload.saved, true);
    assert.ok(patShortRe.test(pat1Payload.pattern.code), `Expected short-id pattern code, got: ${pat1Payload.pattern.code}`);
    assert.strictEqual(pat1Payload.pattern.version, 1);

    const pat2Payload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        {
          name: 'acm_pattern_save',
          arguments: {
            title: 'Stdio JSON-RPC Hygiene v2',
            category: 'MCP',
            summary: 'Always close sqlite connection in finally and log to stderr',
            solution: 'Wrap executeToolCall in try/finally with store.close()',
            supersedesCode: pat1Payload.pattern.code,
            tags: ['mcp', 'sqlite'],
          },
        },
        10
      )
    );
    assert.ok(patShortRe.test(pat2Payload.pattern.code));
    assert.strictEqual(pat2Payload.pattern.version, 2);
    assert.strictEqual(pat2Payload.pattern.supersedesUid, pat1Payload.pattern.uid);

    const patGetPayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        { name: 'acm_pattern_get', arguments: { idOrCode: pat2Payload.pattern.code.slice(2, 6) } },
        11
      )
    );
    assert.strictEqual(patGetPayload.pattern.uid, pat2Payload.pattern.uid);

    const patMissingResp = await client.sendRequest(
      'tools/call',
      { name: 'acm_pattern_get', arguments: { idOrCode: 'P-99' } },
      12
    );
    assert.strictEqual(patMissingResp.result.isError, true, 'Missing pattern should yield isError: true');

    // 3-9. acm_adr_add
    const adrPayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        {
          name: 'acm_adr_add',
          arguments: {
            title: 'Zero-dependency stdio MCP transport',
            summary: 'Use Node built-in readline for newline-delimited MCP JSON-RPC',
            relatedArea: 'scripts/mcp-server.cjs',
            relatedTaskCode: taskCode,
            branch: 'main',
          },
        },
        13
      )
    );
    assert.strictEqual(adrPayload.saved, true);
    assert.ok(adrShortRe.test(adrPayload.adr.code), `Expected short-id ADR code, got: ${adrPayload.adr.code}`);

    // 3-10. acm_search (FTS5 BM25 + tokenBudget)
    const searchPayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        { name: 'acm_search', arguments: { query: 'JSON-RPC stdio', kind: 'all', limit: 5, tokenBudget: 2000 } },
        14
      )
    );
    assert.ok(searchPayload.count >= 2, `Expected >= 2 search results, got ${searchPayload.count}`);

    // 3-11. acm_sync status & push to bare remote
    const syncStatusPayload = parseToolPayload(
      await client.sendRequest('tools/call', { name: 'acm_sync', arguments: { direction: 'status' } }, 15)
    );
    assert.strictEqual(syncStatusPayload.ok, true);
    assert.strictEqual(syncStatusPayload.branch, 'acm-memory');

    const syncPushPayload = parseToolPayload(
      await client.sendRequest('tools/call', { name: 'acm_sync', arguments: { direction: 'push' } }, 16)
    );
    assert.strictEqual(syncPushPayload.ok, true);
    assert.ok(syncPushPayload.commitSha, 'Expected commitSha from acm_sync push');
    assert.ok(syncPushPayload.pushed >= 3, 'Expected patterns + adr + done task pushed');

    const remoteBranchCheck = execSync('git ls-remote --heads origin acm-memory', {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    assert.ok(remoteBranchCheck.includes('refs/heads/acm-memory'), 'acm-memory branch was not pushed to bare remote');

    // 3-11b. acm_compact (default dryRun=true, then dryRun=false)
    const compactDryPayload = parseToolPayload(
      await client.sendRequest('tools/call', { name: 'acm_compact', arguments: {} }, 20)
    );
    assert.strictEqual(compactDryPayload.ok, true);
    assert.strictEqual(compactDryPayload.dryRun, true);
    assert.strictEqual(compactDryPayload.vacuumed, false);

    const compactExecPayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        { name: 'acm_compact', arguments: { dryRun: false, doneTaskFtsDays: 0, vacuum: true } },
        21
      )
    );
    assert.strictEqual(compactExecPayload.ok, true);
    assert.strictEqual(compactExecPayload.dryRun, false);
    assert.strictEqual(compactExecPayload.archivedTasksCount, 1);
    assert.strictEqual(compactExecPayload.vacuumed, true);

    // 3-11c. Opt-in markdownProjection via config set -> subsequent acm_task_upsert projects task.md
    const enableProj = spawnSync(
      process.execPath,
      [CLI_PATH, 'config', 'set', 'storage.markdownProjection', 'true'],
      { cwd: repoDir, encoding: 'utf-8' }
    );
    assert.strictEqual(enableProj.status, 0, enableProj.stderr || enableProj.stdout);
    const optInPayload = parseToolPayload(
      await client.sendRequest(
        'tools/call',
        {
          name: 'acm_task_upsert',
          arguments: {
            title: 'Opt-in MCP projection verification',
            status: 'in_progress',
            purpose: 'Verify opt-in markdownProjection projects task.md on acm_task_upsert.',
          },
        },
        22
      )
    );
    const projectedTaskMd = fs.readFileSync(path.join(repoDir, '.agents', 'acm', 'task', 'task.md'), 'utf-8');
    assert.ok(
      projectedTaskMd.includes(`${optInPayload.task.code}.`),
      `${optInPayload.task.code} was not projected to .agents/acm/task/task.md after opt-in`
    );

    // 3-12. Error handling: unknown tool (-32602), unknown method (-32601), malformed JSON (-32700), final ping
    const unknownToolResp = await client.sendRequest(
      'tools/call',
      { name: 'acm_nonexistent', arguments: {} },
      17
    );
    assert.strictEqual(unknownToolResp.error.code, -32602);

    const unknownMethodResp = await client.sendRequest('unknown/method', {}, 18);
    assert.strictEqual(unknownMethodResp.error.code, -32601);

    const parseErrorResp = await client.sendRawLineAndAwaitNullId('{invalid json');
    assert.strictEqual(parseErrorResp.error.code, -32700);

    const finalPing = await client.sendRequest('ping', {}, 19);
    assert.deepStrictEqual(finalPing.result, {});

    // 4. Clean process shutdown (zero stdin/stdout hang or SQLite EBUSY lock)
    const exitCode = await client.close();
    activeProc = null;
    assert.strictEqual(exitCode, 0, `MCP server exited with code ${exitCode}. stderr: ${client.getStderr()}`);
    const unexpectedStderr = client
      .getStderr()
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim() !== '' &&
          !/ExperimentalWarning:\s*SQLite is an experimental feature/i.test(line) &&
          !/Use `node --trace-warnings \.\.\.` to show where the warning was created/i.test(line)
      )
      .join('\n');
    assert.strictEqual(unexpectedStderr, '', `Unexpected stderr during clean run: ${client.getStderr()}`);
    console.log('[PASS] All 10 MCP tools, JSON-RPC 2.0 error codes, FTS5 search, Git orphan sync, compact, and clean shutdown verified.');

    console.log('=== All stdio MCP Server E2E tests passed (0 errors) ===\n');
  } finally {
    if (activeProc && activeProc.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            activeProc.kill('SIGKILL');
          } catch (_) {}
          resolve();
        }, 2000);
        activeProc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          activeProc.stdin.end();
        } catch (_) {}
      });
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (err) {
      console.error(`[WARN] Cleanup failed: ${err.message}`);
    }
  }
}

runTests().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

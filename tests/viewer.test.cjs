/**
 * tests/viewer.test.cjs
 *
 * Read-Model, CLI/TUI(acm view), 로컬 HTTP 서버(acm ui), 정적 HTML 내보내기(--format=html) 검증 스위트.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const vm = require('vm');
const assert = require('assert');
const { spawnSync } = require('child_process');

const { createMemoryStore } = require('../scripts/acm/storage/memory-store.cjs');
const { saveConfig } = require('../scripts/acm/storage/config.cjs');
const {
  getViewerOverview,
  listViewerItems,
  searchViewerItems,
  getViewerItemDetail,
  buildViewerSnapshot,
  upsertViewerTask,
  runViewerCompact,
} = require('../scripts/acm/viewer/read-model.cjs');
const { startViewerServer } = require('../scripts/acm/ui-viewer.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'bin', 'agent-context-memory.js');

function requestHttp(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== null && body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== Starting Agent Context Memory Viewer Tests ===');

  const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-viewer-sqlite-'));
  const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-viewer-md-'));

  try {
    // 1. Seed SQLite workspace with tasks (active, done, archived), pattern (with XSS & secret), ADR
    saveConfig(sqliteDir, {
      storage: { provider: 'sqlite', markdownProjection: false },
      language: 'en',
    });
    const store = createMemoryStore(sqliteDir, { lang: 'en', skipProjection: true });
    let activeTask;
    let doneTask;
    let oldArchivedTask;
    let pat;
    let adr;
    try {
      activeTask = store.upsertTask({
        title: 'Active Viewer Task',
        status: 'in_progress',
        purpose: 'Verify viewer read-model listing and editing',
        results: ['Added read-model'],
        targets: ['scripts/acm/viewer/read-model.cjs'],
      });
      doneTask = store.upsertTask(
        {
          title: 'Completed Task For Secret Test',
          status: 'done',
          purpose: 'Token check ghp_1234567890abcdefghij123456',
          results: ['Verified secret scrubbing'],
          targets: ['scripts/acm/storage/secret-scrubber.cjs'],
          commitSha: 'abcdef1234567',
        },
        { skipValidation: true }
      );
      oldArchivedTask = store.upsertTask(
        {
          title: 'Legacy Archived Task',
          status: 'done',
          purpose: 'Old work archived long ago',
          results: ['Archived cleanly'],
          targets: ['scripts/acm/legacy.cjs'],
          completedAt: '2025-01-01T00:00:00.000Z',
        },
        { skipValidation: true }
      );
      pat = store.upsertPattern({
        category: 'Security',
        title: 'Escape XSS </script><img src=x onerror=alert(1)>',
        summary: 'Always escape HTML output',
        symptom: 'Raw </script> tag breaks inline script',
        solution: 'Use escapeHtml and serializeInlineJson',
        relatedFiles: ['scripts/acm/viewer/ui-template.cjs'],
        tags: ['xss', 'viewer'],
      });
      adr = store.upsertAdr({
        title: 'Adopt Zero-Dependency Local Viewer',
        summary: 'Use Node built-in http without external frontend packages',
        relatedArea: 'scripts/acm/viewer/',
        context: 'Need offline-safe viewer',
        decision: 'Self-contained HTML template',
        impact: 'Zero extra npm dependencies',
      });
      store.compact({ dryRun: false, doneTaskFtsDays: 90, vacuum: false });
    } finally {
      store.close();
    }

    // 2. Test read-model.cjs on SQLite
    const overview = getViewerOverview(sqliteDir, { lang: 'en' });
    assert.strictEqual(overview.provider, 'sqlite');
    assert.strictEqual(overview.counts.tasks.total, 3);
    assert.strictEqual(overview.counts.tasks.archived, 1);
    assert.strictEqual(overview.counts.tasks.visible, 2);
    assert.strictEqual(overview.counts.patterns.total, 1);
    assert.strictEqual(overview.counts.adrs.total, 1);
    assert.strictEqual(overview.counts.archive, 1);

    const tasksTab = listViewerItems(sqliteDir, { tab: 'tasks', status: 'all' });
    assert.strictEqual(tasksTab.total, 2, 'tasks tab must exclude archived tasks');
    assert.ok(tasksTab.items.some((t) => t.code === activeTask.code));
    assert.ok(!tasksTab.items.some((t) => t.code === oldArchivedTask.code));

    const activeFilter = listViewerItems(sqliteDir, { tab: 'tasks', status: 'active' });
    assert.strictEqual(activeFilter.total, 1);
    assert.strictEqual(activeFilter.items[0].code, activeTask.code);

    const patTab = listViewerItems(sqliteDir, { tab: 'patterns' });
    assert.strictEqual(patTab.total, 1);
    assert.strictEqual(patTab.items[0].code, pat.code);

    const adrTab = listViewerItems(sqliteDir, { tab: 'adrs' });
    assert.strictEqual(adrTab.total, 1);
    assert.strictEqual(adrTab.items[0].code, adr.code);

    const archiveTab = listViewerItems(sqliteDir, { tab: 'archive' });
    assert.strictEqual(archiveTab.total, 1);
    assert.strictEqual(archiveTab.items[0].code, oldArchivedTask.code);

    const searchAll = searchViewerItems(sqliteDir, { query: 'Zero-Dependency' });
    assert.ok(searchAll.items.some((i) => i.code === adr.code));

    const searchArchive = searchViewerItems(sqliteDir, { query: 'Legacy Archived', kind: 'archive' });
    assert.strictEqual(searchArchive.total, 1);
    assert.strictEqual(searchArchive.items[0].code, oldArchivedTask.code);

    const detail = getViewerItemDetail(sqliteDir, { idOrCode: activeTask.code });
    assert.ok(detail && detail.code === activeTask.code);

    const scrubbedSnap = buildViewerSnapshot(sqliteDir, { scrubSecrets: true });
    assert.ok(scrubbedSnap.redactedCount >= 1, 'Snapshot must redact ghp_ secret by default');
    const scrubbedDone = scrubbedSnap.tabs.tasks.find((t) => t.code === doneTask.code);
    assert.ok(!scrubbedDone.purpose.includes('ghp_1234567890'), 'Secret must be redacted in scrubbed snapshot');

    const rawSnap = buildViewerSnapshot(sqliteDir, { scrubSecrets: false });
    const rawDone = rawSnap.tabs.tasks.find((t) => t.code === doneTask.code);
    assert.ok(rawDone.purpose.includes('ghp_1234567890'), '--no-scrub must preserve raw text');

    console.log('[PASS] read-model.cjs overview, tabs, search, detail, and secret scrubbing verified.');

    // 3. Test CLI `acm view` (static, --json, --id, Non-TTY -i fallback)
    const viewStaticRes = spawnSync(process.execPath, [CLI_PATH, 'view', '--tab=tasks', '--no-color'], {
      cwd: sqliteDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(viewStaticRes.status, 0, `acm view failed: ${viewStaticRes.stderr || viewStaticRes.stdout}`);
    assert.ok(viewStaticRes.stdout.includes(activeTask.code));

    const viewJsonRes = spawnSync(
      process.execPath,
      [CLI_PATH, 'view', '--id=' + activeTask.code, '--json'],
      { cwd: sqliteDir, encoding: 'utf-8' }
    );
    assert.strictEqual(viewJsonRes.status, 0);
    const viewJson = JSON.parse(viewJsonRes.stdout);
    assert.strictEqual(viewJson.ok, true);
    assert.strictEqual(viewJson.item.code, activeTask.code);

    const viewTuiFallbackRes = spawnSync(process.execPath, [CLI_PATH, 'view', '-i'], {
      cwd: sqliteDir,
      encoding: 'utf-8',
      timeout: 5000,
    });
    assert.strictEqual(viewTuiFallbackRes.status, 0, 'Non-TTY -i must fall back immediately without hanging');
    assert.ok(viewTuiFallbackRes.stdout.includes(activeTask.code));

    console.log('[PASS] cli-viewer.cjs (acm view static, --json, Non-TTY -i fallback) verified.');

    // 4. Test `acm export --format=html` offline HTML, XSS escaping, and secret scrubbing
    const htmlOutPath = path.join(sqliteDir, 'out', 'viewer.html');
    const exportHtmlRes = spawnSync(
      process.execPath,
      [CLI_PATH, 'export', '--format=html', `--out=${htmlOutPath}`, '--json'],
      { cwd: sqliteDir, encoding: 'utf-8' }
    );
    assert.strictEqual(
      exportHtmlRes.status,
      0,
      `acm export --format=html failed: ${exportHtmlRes.stderr || exportHtmlRes.stdout}`
    );
    const exportPayload = JSON.parse(exportHtmlRes.stdout);
    assert.strictEqual(exportPayload.format, 'html');
    assert.ok(exportPayload.redactedCount >= 1);

    const exportedHtml = fs.readFileSync(htmlOutPath, 'utf-8');
    assert.ok(!/<script[^>]+src=/i.test(exportedHtml), 'Exported HTML must have zero external script src');
    assert.ok(!/<link[^>]+href=/i.test(exportedHtml), 'Exported HTML must have zero external link href');
    assert.ok(!exportedHtml.includes('ghp_1234567890'), 'Exported HTML must scrub secrets by default');
    assert.ok(!exportedHtml.includes('</script><img'), 'Raw </script> XSS payload must be escaped in inline JSON');
    assert.ok(exportedHtml.includes('\\u003c/script\\u003e'), 'Serialized inline JSON must unicode-escape </script>');

    // Verify single offline bundle integrity, size cap, and single <script> vm.Script execution
    const bundlePath = path.join(ROOT_DIR, 'scripts', 'acm', 'viewer', 'ui-bundle.cjs');
    assert.ok(fs.existsSync(bundlePath), 'ui-bundle.cjs must exist');
    assert.ok(
      fs.statSync(bundlePath).size < 150 * 1024,
      `ui-bundle.cjs must stay under 150KB (actual: ${fs.statSync(bundlePath).size} bytes)`
    );
    const exportedScripts = exportedHtml.match(/<script>/g) || [];
    assert.strictEqual(exportedScripts.length, 1, 'Exported HTML must contain exactly one inline <script>');
    const exportedScriptMatch = exportedHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(exportedScriptMatch, 'Exported HTML must have extractable inline script');
    new vm.Script(exportedScriptMatch[1]);

    const htmlRawOutPath = path.join(sqliteDir, 'out', 'viewer-raw.html');
    const exportRawRes = spawnSync(
      process.execPath,
      [CLI_PATH, 'export', '--format=html', '--no-scrub', `--out=${htmlRawOutPath}`],
      { cwd: sqliteDir, encoding: 'utf-8' }
    );
    assert.strictEqual(exportRawRes.status, 0);
    assert.ok(fs.readFileSync(htmlRawOutPath, 'utf-8').includes('ghp_1234567890'));

    console.log('[PASS] acm export --format=html offline bundle, XSS safety, and scrubbing verified.');

    // 5. Test `ui-viewer.cjs` HTTP server (read APIs, security guards, governance guards, compact, --read-only)
    const srv = await startViewerServer(sqliteDir, { port: 0, lang: 'en' });
    try {
      const rootRes = await requestHttp(`${srv.url}/`);
      assert.strictEqual(rootRes.status, 200);
      assert.ok(rootRes.headers['content-security-policy'], 'CSP header must be present');
      assert.ok(rootRes.text.includes('ACM Local Viewer'));
      assert.ok(!/<script[^>]+src=/i.test(rootRes.text), 'Viewer HTML must have zero external script src');
      assert.ok(!/<link[^>]+href=/i.test(rootRes.text), 'Viewer HTML must have zero external link href');
      const rootScriptMatch = rootRes.text.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(rootScriptMatch, 'Viewer HTML must contain inline script');
      new vm.Script(rootScriptMatch[1]);

      const ovRes = await requestHttp(`${srv.url}/api/overview`);
      assert.strictEqual(ovRes.status, 200);
      assert.strictEqual(ovRes.json.provider, 'sqlite');

      const itemsRes = await requestHttp(`${srv.url}/api/items?tab=tasks&status=all`);
      assert.strictEqual(itemsRes.status, 200);
      assert.strictEqual(itemsRes.json.total, 2);

      const searchRes = await requestHttp(`${srv.url}/api/search?q=Zero-Dependency`);
      assert.strictEqual(searchRes.status, 200);
      assert.ok(searchRes.json.items.some((i) => i.code === adr.code));

      const itemRes = await requestHttp(`${srv.url}/api/item?id=${activeTask.code}`);
      assert.strictEqual(itemRes.status, 200);
      assert.strictEqual(itemRes.json.item.code, activeTask.code);

      const expJsonRes = await requestHttp(`${srv.url}/api/export?format=json`);
      assert.strictEqual(expJsonRes.status, 200);
      assert.ok(Array.isArray(expJsonRes.json.tabs.tasks));

      const expHtmlRes = await requestHttp(`${srv.url}/api/export?format=html`);
      assert.strictEqual(expHtmlRes.status, 200);
      assert.ok(expHtmlRes.text.includes('<!DOCTYPE html>'));

      // Security checks: missing token, bad token, bad Host, non-JSON Content-Type
      const noTokRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { title: 'Blocked' },
      });
      assert.strictEqual(noTokRes.status, 403);

      const badTokRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': 'wrong-token' },
        body: { title: 'Blocked' },
      });
      assert.strictEqual(badTokRes.status, 403);

      const badHostRes = await requestHttp(`${srv.url}/api/overview`, {
        headers: { Host: 'evil.example:43821' },
      });
      assert.strictEqual(badHostRes.status, 403);

      const badCtRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-ACM-Token': srv.sessionToken },
        body: '{"title":"x"}',
      });
      assert.strictEqual(badCtRes.status, 415);

      // Governance checks: block done transition, enforce ready 3-elements, block editing done task
      const doneBlockRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { title: 'Should Fail', status: 'done' },
      });
      assert.strictEqual(doneBlockRes.status, 400);

      const readyMissingRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { title: 'Incomplete Ready', status: 'ready' },
      });
      assert.strictEqual(readyMissingRes.status, 400);

      const editDoneRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { idOrCode: doneTask.code, title: 'Cannot Edit Done' },
      });
      assert.strictEqual(editDoneRes.status, 400);

      // Valid create + update to ready
      const createRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { title: 'Viewer Created Task', status: 'todo', purpose: 'Test create via UI API' },
      });
      assert.strictEqual(createRes.status, 200);
      assert.strictEqual(createRes.json.ok, true);
      const createdCode = createRes.json.task.code;

      const updateReadyRes = await requestHttp(`${srv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: {
          idOrCode: createdCode,
          status: 'ready',
          purpose: 'Ready via API',
          results: ['Verified 3-element guard'],
          targets: ['tests/viewer.test.cjs'],
        },
      });
      assert.strictEqual(updateReadyRes.status, 200);
      assert.strictEqual(updateReadyRes.json.task.status, 'ready');

      // Compact dry-run + execute
      const compactDryRes = await requestHttp(`${srv.url}/api/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { dryRun: true, days: 0 },
      });
      assert.strictEqual(compactDryRes.status, 200);
      assert.strictEqual(compactDryRes.json.result.dryRun, true);
      assert.strictEqual(compactDryRes.json.result.archivedTasksCount, 1);

      const compactExecRes = await requestHttp(`${srv.url}/api/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': srv.sessionToken },
        body: { dryRun: false, days: 0, noVacuum: true },
      });
      assert.strictEqual(compactExecRes.status, 200);
      assert.strictEqual(compactExecRes.json.result.archivedTasksCount, 1);

      const archiveAfterRes = await requestHttp(`${srv.url}/api/items?tab=archive`);
      assert.strictEqual(archiveAfterRes.status, 200);
      assert.strictEqual(archiveAfterRes.json.total, 2);
    } finally {
      await srv.close();
    }

    // Read-only mode server verification
    const roSrv = await startViewerServer(sqliteDir, { port: 0, readOnly: true, lang: 'en' });
    try {
      const roOv = await requestHttp(`${roSrv.url}/api/overview`);
      assert.strictEqual(roOv.status, 200);

      const roPostTask = await requestHttp(`${roSrv.url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': roSrv.sessionToken },
        body: { title: 'Blocked ReadOnly' },
      });
      assert.strictEqual(roPostTask.status, 403);

      const roPostCompact = await requestHttp(`${roSrv.url}/api/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ACM-Token': roSrv.sessionToken },
        body: { dryRun: true },
      });
      assert.strictEqual(roPostCompact.status, 403);
    } finally {
      await roSrv.close();
    }

    console.log('[PASS] ui-viewer.cjs HTTP server, security tokens, governance guards, and --read-only verified.');

    // 6. Test MarkdownProvider parity
    saveConfig(mdDir, {
      storage: { provider: 'markdown' },
      language: 'en',
    });
    const mdStore = createMemoryStore(mdDir, { lang: 'en' });
    let mdTask;
    try {
      mdTask = mdStore.upsertTask({
        title: 'Markdown Viewer Task',
        status: 'todo',
        purpose: 'Verify Markdown mode viewer parity',
      });
    } finally {
      mdStore.close();
    }

    const mdOv = getViewerOverview(mdDir, { lang: 'en' });
    assert.strictEqual(mdOv.provider, 'markdown');
    assert.strictEqual(mdOv.counts.tasks.total, 1);

    const mdList = listViewerItems(mdDir, { tab: 'tasks' });
    assert.strictEqual(mdList.total, 1);
    assert.strictEqual(mdList.items[0].code, mdTask.code);

    const mdSearch = searchViewerItems(mdDir, { query: 'Markdown Viewer' });
    assert.strictEqual(mdSearch.total, 1);

    assert.throws(
      () => upsertViewerTask(mdDir, { title: 'No Done', status: 'done' }),
      /done/i
    );
    const mdCreated = upsertViewerTask(mdDir, { title: 'Markdown Created', status: 'todo' });
    assert.strictEqual(mdCreated.ok, true);
    assert.strictEqual(mdCreated.task.status, 'todo');

    const mdCompact = runViewerCompact(mdDir, { dryRun: true });
    assert.strictEqual(mdCompact.result.skipped, true);

    console.log('[PASS] MarkdownProvider viewer parity verified.');
    console.log('ALL VIEWER TESTS PASSED SUCCESSFULLY!');
  } finally {
    fs.rmSync(sqliteDir, { recursive: true, force: true });
    fs.rmSync(mdDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('[Viewer Test Failed]', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * scripts/acm/ui-viewer.cjs
 *
 * Node 내장 http 모듈 기반 원샷 로컬 루프백 DB 뷰어 서버 (`acm ui`).
 * 상주 데몬 없이 실행하며, Ctrl+C(SIGINT/SIGTERM)로 즉시 종료된다.
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const {
  ALLOWED_VIEWER_TABS,
  getViewerOverview,
  listViewerItems,
  searchViewerItems,
  getViewerItemDetail,
  buildViewerSnapshot,
  upsertViewerTask,
  runViewerCompact,
} = require('./viewer/read-model.cjs');
const { renderViewerHtml } = require('./viewer/ui-template.cjs');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

const DEFAULT_PORT = 43821;
const MAX_FALLBACK_PORT = 43840;
const MAX_JSON_BODY_BYTES = 256 * 1024;

function parseUiArgs(argv = []) {
  const opts = {
    port: undefined,
    noOpen: false,
    readOnly: false,
    tab: 'tasks',
    help: false,
    invalidPort: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--no-open') {
      opts.noOpen = true;
    } else if (arg === '--read-only') {
      opts.readOnly = true;
    } else if (arg.startsWith('--port=')) {
      const raw = arg.slice('--port='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        opts.invalidPort = raw;
      } else {
        opts.port = parsed;
      }
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      const raw = String(argv[++i]);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        opts.invalidPort = raw;
      } else {
        opts.port = parsed;
      }
    } else if (arg.startsWith('--tab=')) {
      opts.tab = arg.slice('--tab='.length);
    } else if (arg === '--tab' && argv[i + 1]) {
      opts.tab = String(argv[++i]);
    } else if (arg === '--lang' || arg === '-l') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) i += 1;
    }
  }

  return opts;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function isAllowedHost(hostHeader, actualPort) {
  if (!hostHeader || typeof hostHeader !== 'string') return false;
  const normalized = hostHeader.trim().toLowerCase();
  return normalized === `127.0.0.1:${actualPort}` || normalized === `localhost:${actualPort}`;
}

function isAllowedOrigin(originHeader, actualPort) {
  if (!originHeader) return true;
  const normalized = String(originHeader).trim().toLowerCase();
  return normalized === `http://127.0.0.1:${actualPort}` || normalized === `http://localhost:${actualPort}`;
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf-8');
  const bufB = Buffer.from(String(b || ''), 'utf-8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        settled = true;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        const err = new Error('Invalid JSON body');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Starts the loopback-only HTTP viewer server and returns handle with close().
 */
async function startViewerServer(rootDir = process.cwd(), options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const effLang = resolveLanguage(resolvedRoot, options.lang || null);
  const tr = createTranslator(effLang);
  const readOnly = Boolean(options.readOnly);
  const initialTab = ALLOWED_VIEWER_TABS.includes(String(options.tab || 'tasks').toLowerCase())
    ? String(options.tab).toLowerCase()
    : 'tasks';
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const sockets = new Set();

  let actualPort = 0;

  const server = http.createServer(async (req, res) => {
    if (!isAllowedHost(req.headers.host, actualPort)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden host header' });
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${actualPort}`);
    const pathname = parsedUrl.pathname;

    try {
      if (req.method === 'GET' && pathname === '/') {
        const html = renderViewerHtml({
          mode: 'http',
          lang: effLang,
          sessionToken: readOnly ? '' : sessionToken,
          readOnly,
          initialTab,
          hostLabel: `127.0.0.1:${actualPort}`,
        });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; base-uri 'none'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/overview') {
        const overview = getViewerOverview(resolvedRoot, { lang: effLang });
        sendJson(res, 200, overview);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/items') {
        const tab = parsedUrl.searchParams.get('tab') || 'tasks';
        const status = parsedUrl.searchParams.get('status') || 'all';
        const limit = parsedUrl.searchParams.get('limit') || '200';
        const data = listViewerItems(resolvedRoot, { tab, status, limit, lang: effLang });
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/search') {
        const query = parsedUrl.searchParams.get('q') || '';
        const kind = parsedUrl.searchParams.get('kind') || 'all';
        const limit = parsedUrl.searchParams.get('limit') || '50';
        const data = searchViewerItems(resolvedRoot, { query, kind, limit, lang: effLang });
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/item') {
        const kind = parsedUrl.searchParams.get('kind') || '';
        const idOrCode = parsedUrl.searchParams.get('id') || '';
        const item = getViewerItemDetail(resolvedRoot, { kind, idOrCode, lang: effLang });
        if (!item) {
          sendJson(res, 404, { ok: false, error: tr('dbCli.notFound', { id: idOrCode }) });
          return;
        }
        sendJson(res, 200, { ok: true, item });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/export') {
        const fmt = String(parsedUrl.searchParams.get('format') || 'json').toLowerCase();
        const snapshot = buildViewerSnapshot(resolvedRoot, { scrubSecrets: true, lang: effLang });
        if (fmt === 'html') {
          const html = renderViewerHtml({
            mode: 'snapshot',
            lang: effLang,
            readOnly: true,
            snapshot,
          });
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'attachment; filename="acm-viewer-snapshot.html"',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          });
          res.end(html);
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="acm-snapshot.json"',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(snapshot, null, 2) + '\n');
        return;
      }

      if (req.method === 'POST' && (pathname === '/api/tasks' || pathname === '/api/compact')) {
        if (readOnly) {
          sendJson(res, 403, { ok: false, error: tr('viewer.readOnlyBlocked') });
          return;
        }
        if (!isAllowedOrigin(req.headers.origin, actualPort)) {
          sendJson(res, 403, { ok: false, error: 'Forbidden origin' });
          return;
        }
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/json')) {
          sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' });
          return;
        }
        if (!timingSafeEqualString(req.headers['x-acm-token'], sessionToken)) {
          sendJson(res, 403, { ok: false, error: 'Invalid or missing X-ACM-Token' });
          return;
        }

        const body = await readJsonBody(req);
        if (pathname === '/api/tasks') {
          const out = upsertViewerTask(resolvedRoot, body, { lang: effLang });
          sendJson(res, 200, out);
          return;
        }
        const out = runViewerCompact(resolvedRoot, body, { lang: effLang });
        sendJson(res, 200, out);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      const code = err && Number.isInteger(err.statusCode) ? err.statusCode : 400;
      sendJson(res, code, { ok: false, error: err.message });
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  if (options.port !== undefined && options.port !== null) {
    actualPort = await listenOnPort(server, Number(options.port));
  } else {
    let bound = false;
    for (let candidate = DEFAULT_PORT; candidate <= MAX_FALLBACK_PORT; candidate++) {
      try {
        actualPort = await listenOnPort(server, candidate);
        bound = true;
        break;
      } catch (err) {
        if (err && err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (!bound) {
      actualPort = await listenOnPort(server, 0);
    }
  }

  const close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch (_) {}
      }
      server.close(() => resolve());
    });

  return {
    server,
    host: '127.0.0.1',
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    sessionToken,
    readOnly,
    close,
  };
}

function openBrowser(url) {
  if (
    process.env.CI === 'true' ||
    process.env.ACM_NON_INTERACTIVE === '1' ||
    !process.stdout.isTTY
  ) {
    return false;
  }

  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

async function runUiViewer(argv = process.argv.slice(2), rootDirOverride = null) {
  const rootDir = rootDirOverride
    ? path.resolve(rootDirOverride)
    : process.env.ACM_ROOT_DIR
      ? path.resolve(process.env.ACM_ROOT_DIR)
      : process.cwd();

  const { lang: parsedLang, invalid: invalidLang } = parseLangFlag(argv);
  const lang = resolveLanguage(rootDir, parsedLang);
  const tr = createTranslator(lang);

  if (invalidLang !== null) {
    console.error(tr('cli.unsupportedLang', { lang: invalidLang }));
    return 1;
  }

  const opts = parseUiArgs(argv);
  if (opts.help) {
    console.log(tr('viewer.uiHelp'));
    return 0;
  }

  if (opts.invalidPort !== null) {
    console.error(tr('viewer.invalidPort', { port: opts.invalidPort }));
    return 1;
  }

  const normTab = String(opts.tab || 'tasks').trim().toLowerCase();
  if (!ALLOWED_VIEWER_TABS.includes(normTab)) {
    console.error(tr('viewer.invalidTab', { tab: opts.tab }));
    return 1;
  }

  const instance = await startViewerServer(rootDir, {
    port: opts.port,
    readOnly: opts.readOnly,
    tab: normTab,
    lang,
  });

  console.log(tr('viewer.serverStarted', { url: instance.url }));
  if (instance.readOnly) {
    console.log(tr('viewer.serverReadOnlyNote'));
  }
  console.log(tr('viewer.serverStopHint'));

  if (!opts.noOpen) {
    openBrowser(instance.url);
  }

  await new Promise((resolve) => {
    const shutdown = async () => {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      await instance.close();
      console.log(`\n${tr('viewer.serverClosed')}`);
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  return 0;
}

if (require.main === module) {
  runUiViewer(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[Error] ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_PORT,
  parseUiArgs,
  startViewerServer,
  openBrowser,
  runUiViewer,
};

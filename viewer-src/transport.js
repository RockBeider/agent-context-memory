/**
 * viewer-src/transport.js
 *
 * HTTP(acm ui), 정적 스냅샷(export --format=html), MCP App 3모드 통신 계층.
 */

export async function apiGet(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function apiPost(url, body, sessionToken) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ACM-Token': sessionToken || '',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Antigravity / MCP App JSON-RPC 2.0 postMessage 브릿지를 생성한다.
 */
export function createMcpBridge({ config, onHostContext, onToolResult }) {
  if (config.mode !== 'mcp-app') return null;

  let nextId = 1;
  let initialResultReceived = false;
  const pending = new Map();

  function handleMessage(event) {
    const msg = event && event.data;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

    if (msg.id !== undefined && msg.method === undefined && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error.message || 'MCP App RPC error'));
      else entry.resolve(msg.result);
      return;
    }

    if (msg.method === 'ping' && msg.id !== undefined) {
      window.parent.postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, '*');
      return;
    }

    if (msg.method === 'ui/notifications/host-context-changed') {
      if (onHostContext) onHostContext(msg.params);
      return;
    }

    if (msg.method === 'ui/notifications/tool-result') {
      if (msg.params && msg.params.structuredContent) {
        initialResultReceived = true;
        if (onToolResult) onToolResult(msg.params.structuredContent);
      }
    }
  }

  window.addEventListener('message', handleMessage);

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP App bridge timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params: params || {} }, '*');
    });
  }

  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: '2.0', method, params: params || {} }, '*');
  }

  function toFileUri(rootDir, relPath) {
    const base = String(rootDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const joined = base ? `${base}/${rel}` : rel;
    const encoded = joined
      .split('/')
      .map((seg, idx) => (idx === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/');
    return /^[A-Za-z]:\//.test(joined)
      ? `file:///${encoded}`
      : `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
  }

  return {
    hasInitialToolResult: () => initialResultReceived,
    destroy() {
      window.removeEventListener('message', handleMessage);
    },
    async connect() {
      const initRes = await request('ui/initialize', {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'agent-context-memory', version: '0.2.0' },
        appCapabilities: {},
      });
      if (initRes && initRes.hostContext && onHostContext) {
        onHostContext(initRes.hostContext);
      }
      notify('ui/notifications/initialized', {});
      if (typeof ResizeObserver === 'function' && document.body) {
        let lastH = 0;
        const ro = new ResizeObserver(() => {
          const h = Math.ceil(document.body.scrollHeight);
          if (h > 0 && Math.abs(h - lastH) >= 2) {
            lastH = h;
            notify('ui/notifications/size-changed', { height: h });
          }
        });
        ro.observe(document.body);
      }
      return initRes;
    },
    async callServerTool(name, args) {
      const res = await request('tools/call', { name, arguments: args || {} });
      if (res && res.isError) {
        const txt = res.content && res.content[0] && res.content[0].text;
        let errMsg = txt || 'Tool call failed';
        try {
          const parsed = JSON.parse(txt);
          if (parsed && parsed.error) errMsg = parsed.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      if (res && res.structuredContent) return res.structuredContent;
      const text = res && res.content && res.content[0] && res.content[0].text;
      return text ? JSON.parse(text) : {};
    },
    openWorkspaceFile(rootDir, relPath) {
      if (!rootDir || !relPath) return;
      const uri = toFileUri(rootDir, relPath);
      request('com.google.antigravity/toggle-aux-pane', {
        tabType: 'fileView',
        uri,
      }).catch(() => {});
    },
  };
}

/**
 * 실행 모드별 데이터 로드 및 뮤테이션 트랜스포트를 생성한다.
 */
export function createTransport({ config, mcpBridge, getRootDir, getSessionToken }) {
  return {
    async loadOverview() {
      if (config.mode === 'snapshot') return config.snapshot ? config.snapshot.overview : null;
      if (config.mode === 'http') return apiGet('/api/overview');
      if (config.mode === 'mcp-app' && mcpBridge) {
        return mcpBridge.callServerTool('acm_viewer_data', {
          action: 'overview',
          rootDir: getRootDir() || undefined,
        });
      }
      return null;
    },

    async loadItems(tab, statusFilter, query) {
      if (config.mode === 'snapshot') {
        const snap = config.snapshot || { tabs: {} };
        const q = String(query || '').trim().toLowerCase();
        if (q) {
          const pool =
            tab === 'archive'
              ? snap.tabs.archive || []
              : [
                  ...(snap.tabs.tasks || []),
                  ...(snap.tabs.patterns || []),
                  ...(snap.tabs.adrs || []),
                ];
          const tokens = q.split(/\s+/).filter(Boolean);
          const matched = pool.filter((it) => {
            const hay = [
              it.code,
              it.title,
              it.purpose,
              it.summary,
              it.symptom,
              it.solution,
              it.context,
              it.decision,
              it.impact,
              ...(it.results || []),
              ...(it.targets || []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return tokens.every((tok) => hay.includes(tok));
          });
          return { items: matched, total: matched.length };
        }

        let list = (snap.tabs && snap.tabs[tab]) || [];
        if (tab === 'tasks' && statusFilter !== 'all') {
          list =
            statusFilter === 'active'
              ? list.filter((x) => x.status !== 'done')
              : list.filter((x) => x.status === statusFilter);
        }
        return { items: list, total: list.length };
      }

      if (config.mode === 'http') {
        const q = String(query || '').trim();
        if (q) {
          const kindParam = tab === 'archive' ? 'archive' : 'all';
          return apiGet(
            `/api/search?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kindParam)}`
          );
        }
        return apiGet(
          `/api/items?tab=${encodeURIComponent(tab)}&status=${encodeURIComponent(statusFilter)}`
        );
      }

      if (config.mode === 'mcp-app' && mcpBridge) {
        const q = String(query || '').trim();
        if (q) {
          return mcpBridge.callServerTool('acm_viewer_data', {
            action: 'search',
            query: q,
            kind: tab === 'archive' ? 'archive' : 'all',
            rootDir: getRootDir() || undefined,
          });
        }
        return mcpBridge.callServerTool('acm_viewer_data', {
          action: 'items',
          tab,
          status: statusFilter,
          rootDir: getRootDir() || undefined,
        });
      }

      return { items: [], total: 0 };
    },

    async saveTask(payload) {
      if (config.mode === 'http') {
        return apiPost('/api/tasks', payload, getSessionToken());
      }
      if (config.mode === 'mcp-app' && mcpBridge && !config.readOnly) {
        return mcpBridge.callServerTool('acm_viewer_data', {
          action: 'task_upsert',
          payload,
          rootDir: getRootDir() || undefined,
        });
      }
      throw new Error('Read-only mode');
    },

    async runCompact(opts) {
      if (config.mode === 'http') {
        return apiPost('/api/compact', opts, getSessionToken());
      }
      if (config.mode === 'mcp-app' && mcpBridge && !config.readOnly) {
        return mcpBridge.callServerTool('acm_viewer_data', {
          action: 'compact',
          payload: opts,
          rootDir: getRootDir() || undefined,
        });
      }
      throw new Error('Read-only mode');
    },
  };
}

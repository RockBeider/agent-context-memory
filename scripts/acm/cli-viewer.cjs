#!/usr/bin/env node
/**
 * scripts/acm/cli-viewer.cjs
 *
 * 터미널용 ACM 정적 텍스트 / 경량 대화형 TUI(@clack/prompts) 뷰어 (`acm view`).
 */

const path = require('path');
const {
  ALLOWED_VIEWER_TABS,
  ALLOWED_TASK_FILTERS,
  WRITABLE_TASK_STATUSES,
  getViewerOverview,
  listViewerItems,
  searchViewerItems,
  getViewerItemDetail,
  upsertViewerTask,
  runViewerCompact,
} = require('./viewer/read-model.cjs');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function isInteractiveTerminal() {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      process.env.CI !== 'true' &&
      process.env.ACM_NON_INTERACTIVE !== '1'
  );
}

function parseViewArgs(argv = []) {
  const opts = {
    tab: 'tasks',
    status: 'all',
    search: '',
    id: '',
    limit: 50,
    interactive: false,
    noColor: false,
    readOnly: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-i' || arg === '--interactive') {
      opts.interactive = true;
    } else if (arg === '--no-color') {
      opts.noColor = true;
    } else if (arg === '--read-only') {
      opts.readOnly = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--tab=')) {
      opts.tab = arg.slice('--tab='.length);
    } else if (arg === '--tab' && argv[i + 1]) {
      opts.tab = String(argv[++i]);
    } else if (arg.startsWith('--status=')) {
      opts.status = arg.slice('--status='.length);
    } else if (arg === '--status' && argv[i + 1]) {
      opts.status = String(argv[++i]);
    } else if (arg.startsWith('--search=')) {
      opts.search = arg.slice('--search='.length);
    } else if ((arg === '--search' || arg === '-q') && argv[i + 1]) {
      opts.search = String(argv[++i]);
    } else if (arg.startsWith('-q=')) {
      opts.search = arg.slice('-q='.length);
    } else if (arg.startsWith('--id=')) {
      opts.id = arg.slice('--id='.length);
    } else if (arg === '--id' && argv[i + 1]) {
      opts.id = String(argv[++i]);
    } else if (arg.startsWith('--limit=')) {
      opts.limit = Number(arg.slice('--limit='.length)) || 50;
    } else if (arg === '--limit' && argv[i + 1]) {
      opts.limit = Number(argv[++i]) || 50;
    } else if (arg === '--lang' || arg === '-l') {
      if (argv[i + 1] && !String(argv[i + 1]).startsWith('-')) i += 1;
    } else if (!arg.startsWith('-') && !opts.search && !opts.id) {
      if (/^(TSK-|P-|LOG-)/i.test(arg)) {
        opts.id = arg;
      } else {
        opts.search = arg;
      }
    }
  }

  return opts;
}

function makeColorizer(noColor) {
  const useColor = !noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  if (!useColor) {
    return {
      bold: (s) => String(s),
      dim: (s) => String(s),
      cyan: (s) => String(s),
      green: (s) => String(s),
      yellow: (s) => String(s),
    };
  }
  return {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  };
}

function formatDetailLines(item, lang, c) {
  const lines = [];
  lines.push(`${c.bold(item.code)} ${c.bold(item.title)}`);
  lines.push(`  Kind: ${item.kind} | Status: ${item.statusLabel || item.status} | Meta: ${item.meta || '-'}`);
  if (item.kind === 'task') {
    if (item.purpose) lines.push(`  Purpose : ${item.purpose}`);
    if (item.owner) lines.push(`  Owner   : ${item.owner}`);
    if (item.commitSha) lines.push(`  Commit  : ${item.commitSha}`);
    if (item.results && item.results.length > 0) {
      lines.push('  Results :');
      for (const r of item.results) lines.push(`    - ${r}`);
    }
    if (item.targets && item.targets.length > 0) {
      lines.push(`  Targets : ${item.targets.join(', ')}`);
    }
  } else if (item.kind === 'pattern') {
    if (item.category) lines.push(`  Category: ${item.category}`);
    if (item.summary) lines.push(`  Summary : ${item.summary}`);
    if (item.symptom) lines.push(`  Symptom : ${item.symptom}`);
    if (item.solution) lines.push(`  Solution: ${item.solution}`);
    lines.push(`  Views   : ${item.accessCount || 0}`);
    if (item.relatedFiles && item.relatedFiles.length > 0) {
      lines.push(`  Files   : ${item.relatedFiles.join(', ')}`);
    }
  } else if (item.kind === 'adr') {
    if (item.summary) lines.push(`  Summary : ${item.summary}`);
    if (item.relatedArea) lines.push(`  Area    : ${item.relatedArea}`);
    if (item.context) lines.push(`  Context : ${item.context}`);
    if (item.decision) lines.push(`  Decision: ${item.decision}`);
    if (item.impact) lines.push(`  Impact  : ${item.impact}`);
  }
  return lines;
}

/**
 * Renders static text or JSON output for the requested view options and returns an exit code.
 */
function renderStaticView(rootDir, opts, { lang, tr } = {}) {
  const effLang = resolveLanguage(rootDir, lang);
  const translator = tr || createTranslator(effLang);
  const c = makeColorizer(opts.noColor);

  const overview = getViewerOverview(rootDir, { lang: effLang });

  if (opts.id) {
    const item = getViewerItemDetail(rootDir, { idOrCode: opts.id, lang: effLang });
    if (!item) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: translator('dbCli.notFound', { id: opts.id }) }, null, 2));
      } else {
        console.error(translator('dbCli.notFound', { id: opts.id }));
      }
      return 1;
    }
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, overview, item }, null, 2));
      return 0;
    }
    console.log(formatDetailLines(item, effLang, c).join('\n'));
    return 0;
  }

  let result;
  if (opts.search) {
    const kind = opts.tab === 'archive' ? 'archive' : 'all';
    result = searchViewerItems(rootDir, {
      query: opts.search,
      kind,
      limit: opts.limit,
      lang: effLang,
    });
  } else {
    result = listViewerItems(rootDir, {
      tab: opts.tab,
      status: opts.status,
      limit: opts.limit,
      lang: effLang,
    });
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          overview,
          mode: opts.search ? 'search' : 'list',
          ...result,
        },
        null,
        2
      )
    );
    return 0;
  }

  const sizeText = overview.provider === 'sqlite' ? ` (${formatBytes(overview.dbSizeBytes)})` : '';
  const ret = overview.retention || {};
  console.log(
    c.bold(
      `[ACM View] provider=${overview.provider}${sizeText} | tasks=${overview.counts.tasks.visible} (active=${overview.counts.tasks.active}, ready=${overview.counts.tasks.ready}) | patterns=${overview.counts.patterns.total} | adrs=${overview.counts.adrs.total} | archive=${overview.counts.archive}`
    )
  );
  console.log(
    c.dim(
      `  Retention: doneTaskFtsDays=${ret.doneTaskFtsDays}, doneTaskProjectionLimit=${ret.doneTaskProjectionLimit}, syncLogMaxRows=${ret.syncLogMaxRows}`
    )
  );
  console.log('');

  if (opts.search) {
    console.log(c.cyan(`Search "${opts.search}" (${result.items.length}/${result.total}):`));
  } else {
    console.log(c.cyan(`Tab: ${result.tab} (status=${result.status}) - ${result.items.length}/${result.total} item(s):`));
  }

  if (result.items.length === 0) {
    console.log(`  ${translator('dbCli.noResults')}`);
    return 0;
  }

  for (const item of result.items) {
    const codeCol = c.cyan(String(item.code || '').padEnd(11));
    const statusCol = `[${item.statusLabel || item.status || ''}]`.padEnd(15);
    const metaCol = c.dim(String(item.meta || ''));
    console.log(`  ${codeCol} ${statusCol} ${item.title} ${metaCol}`);
  }
  return 0;
}

async function runInteractiveTui(rootDir, opts, { lang, tr }) {
  const { intro, select, text, confirm, note, outro, isCancel } = require('@clack/prompts');
  const effLang = resolveLanguage(rootDir, lang);
  const isKo = effLang === 'ko';
  let currentTab = ALLOWED_VIEWER_TABS.includes(String(opts.tab).toLowerCase())
    ? String(opts.tab).toLowerCase()
    : 'tasks';

  intro(isKo ? 'ACM 터미널 뷰어 (대화형)' : 'ACM Terminal Viewer (Interactive)');

  while (true) {
    const overview = getViewerOverview(rootDir, { lang: effLang });
    const menuOptions = [
      { value: 'browse', label: isKo ? `목록 조회 (${currentTab})` : `Browse (${currentTab})` },
      { value: 'tab', label: isKo ? '탭 전환 (Tasks / Patterns / ADRs / Archive)' : 'Switch Tab' },
      { value: 'search', label: isKo ? '키워드 검색' : 'Search' },
    ];
    if (!opts.readOnly) {
      menuOptions.push(
        { value: 'create', label: isKo ? '새 태스크 등록' : 'Create Task' },
        { value: 'status', label: isKo ? '태스크 상태 변경' : 'Update Task Status' },
        { value: 'compact', label: isKo ? 'DB 정리 미리보기 (Compact)' : 'Compact Preview (Dry-Run)' }
      );
    }
    menuOptions.push({ value: 'exit', label: isKo ? '종료' : 'Exit' });

    const action = await select({
      message: isKo
        ? `[${overview.provider}] 활성=${overview.counts.tasks.active}, 패턴=${overview.counts.patterns.total}, ADR=${overview.counts.adrs.total}, 아카이브=${overview.counts.archive}`
        : `[${overview.provider}] active=${overview.counts.tasks.active}, patterns=${overview.counts.patterns.total}, adrs=${overview.counts.adrs.total}, archive=${overview.counts.archive}`,
      options: menuOptions,
    });

    if (isCancel(action) || action === 'exit') {
      outro(isKo ? '뷰어를 종료합니다.' : 'Closed ACM viewer.');
      return 0;
    }

    if (action === 'tab') {
      const nextTab = await select({
        message: isKo ? '표시할 탭을 선택하세요' : 'Select tab',
        options: ALLOWED_VIEWER_TABS.map((tb) => ({ value: tb, label: tb })),
      });
      if (!isCancel(nextTab)) currentTab = nextTab;
      continue;
    }

    if (action === 'browse') {
      const listRes = listViewerItems(rootDir, { tab: currentTab, status: 'all', limit: 100, lang: effLang });
      if (listRes.items.length === 0) {
        note(tr('dbCli.noResults'), currentTab);
        continue;
      }
      const pickedCode = await select({
        message: isKo ? `${currentTab} 항목 선택 (${listRes.items.length}건)` : `Select item from ${currentTab}`,
        options: [
          ...listRes.items.map((it) => ({
            value: it.code,
            label: `${it.code} [${it.statusLabel || it.status}] ${it.title}`,
          })),
          { value: '__back__', label: isKo ? '← 뒤로' : '← Back' },
        ],
      });
      if (!isCancel(pickedCode) && pickedCode !== '__back__') {
        const detail = getViewerItemDetail(rootDir, { idOrCode: pickedCode, lang: effLang });
        if (detail) {
          note(formatDetailLines(detail, effLang, makeColorizer(true)).join('\n'), detail.code);
        }
      }
      continue;
    }

    if (action === 'search') {
      const q = await text({
        message: isKo ? '검색어 입력' : 'Enter search query',
        placeholder: 'commit, TSK-, pattern...',
      });
      if (isCancel(q) || !String(q || '').trim()) continue;
      const searchRes = searchViewerItems(rootDir, { query: String(q), kind: 'all', limit: 30, lang: effLang });
      if (searchRes.items.length === 0) {
        note(tr('dbCli.noResults'), String(q));
        continue;
      }
      const picked = await select({
        message: isKo ? `검색 결과 ${searchRes.items.length}건` : `${searchRes.items.length} search hit(s)`,
        options: [
          ...searchRes.items.map((it) => ({
            value: it.code,
            label: `${it.code} (${it.kind}) ${it.title}`,
          })),
          { value: '__back__', label: isKo ? '← 뒤로' : '← Back' },
        ],
      });
      if (!isCancel(picked) && picked !== '__back__') {
        const detail = getViewerItemDetail(rootDir, { idOrCode: picked, lang: effLang });
        if (detail) note(formatDetailLines(detail, effLang, makeColorizer(true)).join('\n'), detail.code);
      }
      continue;
    }

    if (action === 'create' && !opts.readOnly) {
      const title = await text({ message: isKo ? '새 태스크 제목' : 'New task title' });
      if (isCancel(title) || !String(title || '').trim()) continue;
      const purpose = await text({ message: isKo ? '목적 (선택)' : 'Purpose (optional)' });
      if (isCancel(purpose)) continue;
      try {
        const saved = upsertViewerTask(
          rootDir,
          { title: String(title), purpose: String(purpose || ''), status: 'todo' },
          { lang: effLang }
        );
        note(`${saved.task.code}: ${saved.task.title} [${saved.task.statusLabel}]`, isKo ? '등록 완료' : 'Created');
      } catch (err) {
        note(err.message, 'Error');
      }
      continue;
    }

    if (action === 'status' && !opts.readOnly) {
      const activeList = listViewerItems(rootDir, { tab: 'tasks', status: 'active', limit: 50, lang: effLang });
      if (activeList.items.length === 0) {
        note(tr('dbCli.noResults'), 'Tasks');
        continue;
      }
      const code = await select({
        message: isKo ? '상태를 변경할 태스크 선택' : 'Select task to update',
        options: activeList.items.map((it) => ({
          value: it.code,
          label: `${it.code} [${it.statusLabel}] ${it.title}`,
        })),
      });
      if (isCancel(code)) continue;
      const nextStatus = await select({
        message: isKo ? '새 상태 선택 (done은 Git 커밋으로만 전환 가능)' : 'Select next status (done requires Git commit)',
        options: WRITABLE_TASK_STATUSES.map((st) => ({ value: st, label: st })),
      });
      if (isCancel(nextStatus)) continue;
      try {
        const updated = upsertViewerTask(rootDir, { idOrCode: code, status: nextStatus }, { lang: effLang });
        note(`${updated.task.code} -> ${updated.task.statusLabel}`, isKo ? '상태 변경' : 'Updated');
      } catch (err) {
        note(err.message, 'Error');
      }
      continue;
    }

    if (action === 'compact' && !opts.readOnly) {
      const dry = runViewerCompact(rootDir, { dryRun: true }, { lang: effLang });
      const r = dry.result;
      note(
        `archivedTasks=${r.archivedTasksCount}, syncLogs=${r.prunedSyncLogs}, dbSize=${formatBytes(r.sizeBeforeBytes)}`,
        'Compact Dry-Run'
      );
      if (!r.skipped && (r.archivedTasksCount > 0 || r.prunedSyncLogs > 0)) {
        const ok = await confirm({
          message: isKo ? '실제 DB 정리를 실행하시겠습니까?' : 'Execute compact now?',
          initialValue: false,
        });
        if (!isCancel(ok) && ok) {
          const execRes = runViewerCompact(rootDir, { dryRun: false }, { lang: effLang });
          note(
            `archived=${execRes.result.archivedTasksCount}, reclaimed=${formatBytes(execRes.result.bytesReclaimed)}`,
            'Compact Done'
          );
        }
      }
    }
  }
}

/**
 * CLI entrypoint for `acm view`.
 */
async function runCliViewer(argv = process.argv.slice(2), rootDirOverride = null) {
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

  const opts = parseViewArgs(argv);
  if (opts.help) {
    console.log(tr('viewer.viewHelp'));
    return 0;
  }

  const normTab = String(opts.tab || 'tasks').trim().toLowerCase();
  if (!ALLOWED_VIEWER_TABS.includes(normTab)) {
    console.error(tr('viewer.invalidTab', { tab: opts.tab }));
    return 1;
  }
  opts.tab = normTab;

  const normStatus = String(opts.status || 'all').trim().toLowerCase();
  if (normTab === 'tasks' && !ALLOWED_TASK_FILTERS.includes(normStatus)) {
    console.error(tr('viewer.invalidStatus', { status: opts.status }));
    return 1;
  }
  opts.status = normStatus;

  if (opts.interactive) {
    if (!isInteractiveTerminal()) {
      if (!opts.json) {
        console.log(tr('viewer.nonTtyFallback'));
      }
      return renderStaticView(rootDir, opts, { lang, tr });
    }
    return runInteractiveTui(rootDir, opts, { lang, tr });
  }

  return renderStaticView(rootDir, opts, { lang, tr });
}

if (require.main === module) {
  runCliViewer(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[Error] ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseViewArgs,
  formatBytes,
  isInteractiveTerminal,
  renderStaticView,
  runCliViewer,
};

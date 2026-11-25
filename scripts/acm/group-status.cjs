/**
 * scripts/acm/group-status.cjs
 *
 * Agent Context Memory task-centric change classifier, atomic commit runner,
 * and automatic task-completed archive engine.
 *
 * [Source Priority]
 * 1st: .agents/acm/task/task.md (or legacy .agents/task/task.md) ([Ready] first, then [In Progress] active tasks)
 * 2nd: Smart auxiliary buckets for remaining unmapped files (rules, memory, scripts, ui, core, misc)
 *
 * [CLI Options]
 *   node scripts/acm/group-status.cjs                      : Interactive task selection & commit prompt
 *   node scripts/acm/group-status.cjs --dry-run            : Preview groupings and commit messages without committing
 *   node scripts/acm/group-status.cjs --compact            : Compact 1-line summary (low-token agent view)
 *   node scripts/acm/group-status.cjs --commit=<num|TSK-X> : Commit a specific group or TSK ID and auto-archive
 *   node scripts/acm/group-status.cjs --all                : Sequentially commit all [Ready] tasks and auto-archive
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { loadConfig } = require('./storage/config.cjs');
const { createMemoryStore } = require('./storage/memory-store.cjs');
const { resolveTaskFiles, resolveMemoryFiles } = require('./storage/markdown-bridge.cjs');
const {
  TASK_ID_REGEX_SOURCE,
  PATTERN_ID_REGEX_SOURCE,
  ADR_ID_REGEX_SOURCE,
  parseCode,
  normalizeCodeInput,
  normalizeTaskStatus,
  toDisplayStatus,
} = require('./storage/id-utils.cjs');
const { parseLangFlag, resolveLanguage, createTranslator } = require('./i18n.cjs');

const BULLET_TASK_HEADER_RE = new RegExp(
  `^-\\s*\\[([^\\]]*)\\]\\s*\\*\\*(?:(${TASK_ID_REGEX_SOURCE})[\\.:]\\s*)(.+?)\\*\\*`,
  'i'
);
const NUMBERED_SECTION_RE =
  /^#{2,4}\s*[0-9]+[\.:]\s*(?:Active\s*Tasks?|Notes?|Rules?|Overview|활성\s*(?:작업|태스크)|참고|규칙|개요)/i;
const MD_PREFIXED_TASK_HEADER_RE = /^#{2,4}\s*(TSK-[A-Z0-9]+)[\.:]\s*(.+)$/i;
const MD_NUMERIC_TASK_HEADER_RE = /^#{3,4}\s*([0-9]+)[\.:]\s*(.+)$/i;
const ADR_DETAIL_HEADER_RE = new RegExp(
  `^(?:(${ADR_ID_REGEX_SOURCE})\\]\\s*\\[)?([0-9]{4}-[0-9]{2}-[0-9]{2})\\]\\s*(.+)$`,
  'i'
);
const PATTERN_INDEX_ROW_RE = new RegExp(
  `^\\|\\s*(?:\\*\\*)?(${PATTERN_ID_REGEX_SOURCE})(?:\\*\\*)?\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|]+)\\|`,
  'i'
);
const PATTERN_SHARD_HEADER_RE = new RegExp(`^#\\s*\\[(${PATTERN_ID_REGEX_SOURCE})\\]\\s*(.+)$`, 'im');

const ROOT_DIR = process.env.ACM_ROOT_DIR ? path.resolve(process.env.ACM_ROOT_DIR) : path.resolve(__dirname, '..', '..');
const ACTIVE_LANG = resolveLanguage(ROOT_DIR, parseLangFlag(process.argv.slice(2)).lang);
const tr = createTranslator(ACTIVE_LANG);

const {
  taskFile: TASK_FILE,
  completedFile: TASK_COMPLETED_FILE,
} = resolveTaskFiles(ROOT_DIR);
const {
  changelogFile: CHANGELOG_FILE,
  patternsIndexFile: PATTERNS_INDEX_FILE,
  patternsDir: PATTERNS_DIR,
} = resolveMemoryFiles(ROOT_DIR);

/**
 * 1. Parses Git working tree changes. Returns null when outside a Git repo or Git is unavailable.
 */
function getGitStatus() {
  try {
    const raw = execSync('git --no-pager status --porcelain=v1 -uall', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!raw.trim()) return [];

    const list = [];
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length >= 3);

    for (const line of lines) {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3).trim();

      if (rawPath.includes(' -> ')) {
        const parts = rawPath.split(' -> ').map((p) => p.replace(/^"|"$/g, '').trim());
        const oldFile = parts[0].replace(/\\/g, '/');
        const newFile = parts[1].replace(/\\/g, '/');
        list.push({
          code: code.trim(),
          rawCode: code,
          file: newFile,
          oldFile,
          isRename: true,
        });
      } else {
        const file = rawPath.replace(/^"|"$/g, '').trim().replace(/\\/g, '/');
        list.push({
          code: code.trim(),
          rawCode: code,
          file,
          isRename: false,
        });
      }
    }
    return list;
  } catch (_) {
    // Graceful fallback when Git is unavailable or directory is not a repository
    return null;
  }
}

/**
 * 2. Parses .agents/task/task.md (supports English/Korean bullet & heading formats, skips codeblocks and TSK-SAMPLE).
 */
function parseTaskMd() {
  if (!fs.existsSync(TASK_FILE)) return [];
  try {
    const content = fs.readFileSync(TASK_FILE, 'utf-8');
    const tasks = [];
    const lines = content.split(/\r?\n/);

    let currentTask = null;
    let inTargetSection = false;
    let inDetailSection = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Ignore sample blocks inside Markdown fenced codeblocks
      if (/^\s*(?:>\s*)?```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const bulletHeaderMatch = line.match(BULLET_TASK_HEADER_RE);
      const isNumberedSectionTitle = NUMBERED_SECTION_RE.test(line);
      const mdHeaderMatch =
        !bulletHeaderMatch && !isNumberedSectionTitle
          ? line.match(MD_PREFIXED_TASK_HEADER_RE) || line.match(MD_NUMERIC_TASK_HEADER_RE)
          : null;

      if (!bulletHeaderMatch && !mdHeaderMatch && /^(?:##\s|###\s|---)/.test(line)) {
        if (currentTask) {
          tasks.push(currentTask);
          currentTask = null;
        }
        inTargetSection = false;
        inDetailSection = false;
        continue;
      }

      if (bulletHeaderMatch || mdHeaderMatch) {
        if (currentTask) tasks.push(currentTask);
        inTargetSection = false;
        inDetailSection = false;

        const rawStatus = bulletHeaderMatch ? bulletHeaderMatch[1].trim() : '';
        const rawId = (bulletHeaderMatch ? bulletHeaderMatch[2] : mdHeaderMatch[1]).trim();
        const parsed = parseCode(rawId, 'TSK');
        if (!parsed) {
          currentTask = null;
          continue;
        }

        const tskId = parsed.code;
        let fullTitle = (bulletHeaderMatch ? bulletHeaderMatch[3] : mdHeaderMatch[2]).trim();

        let statusRaw = rawStatus;
        const statusMatch = fullTitle.match(/\[(.*?)\]$/);
        if (statusMatch) {
          statusRaw = statusMatch[1].trim();
          fullTitle = fullTitle.replace(/\[(.*?)\]$/, '').trim();
        }
        const canonicalStatus = normalizeTaskStatus(statusRaw);

        currentTask = {
          source: 'task',
          id: `task-${tskId}`,
          taskNum: parsed.num !== null ? String(parsed.num) : '',
          tskId,
          title: `[${tskId}] ${fullTitle}`,
          rawTitle: fullTitle,
          canonicalStatus,
          status: toDisplayStatus(canonicalStatus, ACTIVE_LANG),
          purpose: '',
          details: [],
          targetPatterns: [],
        };
        continue;
      }

      if (!currentTask) continue;

      const statusPropMatch = line.match(/^\s*-\s*\*\*(?:Status|상태)\*\*:\s*\[?([^\]\r\n]+)\]?/i);
      if (statusPropMatch) {
        const parsed = statusPropMatch[1].trim();
        if (parsed) {
          currentTask.canonicalStatus = normalizeTaskStatus(parsed);
          currentTask.status = toDisplayStatus(currentTask.canonicalStatus, ACTIVE_LANG);
        }
        continue;
      }

      const purposeMatch = line.match(/^\s*-\s*\*\*(?:Purpose|Goal|Background|목적|배경)\*\*:\s*(.+)$/i);
      if (purposeMatch) {
        inTargetSection = false;
        inDetailSection = false;
        currentTask.purpose = purposeMatch[1].trim();
        continue;
      }

      const resultMatch = line.match(
        /^\s*-\s*\*\*(?:Results?|Summary|Changes|Details|수행\s*결과|작업\s*(?:요약|내용)|수정\s*(?:내역|내용)|세부\s*(?:내용|작업))\*\*:\s*(.*)$/i
      );
      if (resultMatch) {
        inTargetSection = false;
        inDetailSection = true;
        const inlineDetail = resultMatch[1].replace(/\*\*/g, '').trim();
        if (inlineDetail.length > 3 && currentTask.details.length < 10) {
          currentTask.details.push(inlineDetail);
        }
        continue;
      }

      const targetMatch = line.match(
        /^\s*-\s*\*\*(?:Targets?|Files?|Scope|Changed\s*Files?|Related\s*Files?|Target\s*(?:Files?|Area)|(?:대상|관련|수정|변경)\s*(?:영역|파일|목록)?)\*\*:\s*(.*)$/i
      );
      if (targetMatch) {
        inTargetSection = true;
        inDetailSection = false;
        const rawTargets = targetMatch[1].trim();
        if (rawTargets) {
          const backtickMatches = rawTargets.match(/`([^`]+)`/g);
          if (backtickMatches) {
            currentTask.targetPatterns.push(
              ...backtickMatches.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/'))
            );
          } else {
            currentTask.targetPatterns.push(
              ...rawTargets.split(',').map((tItem) => tItem.trim().replace(/\\/g, '/')).filter(Boolean)
            );
          }
        }
        continue;
      }

      // Reset nested section flags on other metadata keys (e.g. Registered, Priority)
      if (/^\s*-\s*\*\*[^*]+\*\*:/.test(line)) {
        inTargetSection = false;
        inDetailSection = false;
        continue;
      }

      if (inTargetSection) {
        const backtickMatches = line.match(/`([^`]+)`/g);
        if (backtickMatches) {
          currentTask.targetPatterns.push(
            ...backtickMatches.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/'))
          );
          continue;
        }
        const subTargetMatch = line.match(/^\s{2,}-\s*`?([^`\r\n]+)`?/);
        if (subTargetMatch) {
          currentTask.targetPatterns.push(subTargetMatch[1].trim().replace(/\\/g, '/'));
          continue;
        }
      }

      const detailMatch = inDetailSection
        ? line.match(/^\s{2,}-\s*(.+)$/)
        : line.match(/^\s{4,}-\s*(.+)$/);
      if (detailMatch && !/\*\*(?:Target|Purpose|Goal|Background|Related|대상|관련|목적)/i.test(line)) {
        const detailText = detailMatch[1].replace(/\*\*/g, '').trim();
        if (detailText.length > 3 && currentTask.details.length < 10) {
          currentTask.details.push(detailText);
        }
      }
    }

    if (currentTask) tasks.push(currentTask);
    return tasks;
  } catch (err) {
    console.warn(tr('groupStatus.taskParseWarn'), err.message);
    return [];
  }
}

/**
 * 3. Parses .agents/memory/project-changelog.md (excludes LOG-00 sample).
 */
function parseChangelog() {
  if (!fs.existsSync(CHANGELOG_FILE)) return [];
  try {
    const content = fs.readFileSync(CHANGELOG_FILE, 'utf-8');
    const sections = [];
    const dateBlocks = content.split(/^###\s*\[/m).slice(1);

    for (const block of dateBlocks) {
      const firstLineEnd = block.indexOf('\n');
      const headerLine = (firstLineEnd !== -1 ? block.slice(0, firstLineEnd) : block).trim();
      const headerMatch = headerLine.match(ADR_DETAIL_HEADER_RE);
      if (!headerMatch) continue;

      let logId = '';
      if (headerMatch[1]) {
        const parsedLog = parseCode(headerMatch[1], 'LOG');
        if (!parsedLog) continue;
        logId = parsedLog.code;
      }
      const date = headerMatch[2];
      const title = headerMatch[3].trim();

      if (/sample|양식\s*샘플|commit/i.test(title)) continue;

      const blockTime = new Date(date).getTime();
      const diffDays = (Date.now() - blockTime) / (1000 * 60 * 60 * 24);
      if (!isNaN(diffDays) && diffDays > 14) continue;

      const body = firstLineEnd !== -1 ? block.slice(firstLineEnd) : '';

      const backticks = body.match(/`([^`]+)`/g) || [];
      const targetPatterns = [];
      for (const b of backticks) {
        const clean = b.replace(/`/g, '').trim().replace(/\\/g, '/');
        if (
          clean.includes('/') ||
          clean.endsWith('.js') ||
          clean.endsWith('.cjs') ||
          clean.endsWith('.jsx') ||
          clean.endsWith('.ts') ||
          clean.endsWith('.tsx') ||
          clean.endsWith('.css') ||
          clean.endsWith('.md')
        ) {
          targetPatterns.push(clean);
        }
      }

      const purposeMatch = body.match(/-\s*\*\*([^*]+)\*\*:\s*([^\n]+)/);
      const purpose = purposeMatch
        ? tr('groupStatus.changelogPurposeFallback', { key: purposeMatch[1], val: purposeMatch[2] })
        : '';

      sections.push({
        source: 'changelog',
        id: logId ? `changelog-${logId}` : `changelog-${date}`,
        logId,
        date,
        title: logId ? `[${logId}] ${title}` : title,
        status: tr('groupStatus.memoryStatus', { id: logId || date }),
        purpose,
        details: [],
        targetPatterns: Array.from(new Set(targetPatterns)),
      });
    }
    return sections;
  } catch (_) {
    return [];
  }
}

let _cachedPatterns = null;

/**
 * 4. Parses .agents/memory/patterns/*.md sharded patterns (excludes P-00 sample).
 */
function parseLearnedPatterns() {
  if (_cachedPatterns) {
    return _cachedPatterns;
  }

  const patterns = [];
  if (!fs.existsSync(PATTERNS_DIR)) return patterns;

  try {
    const indexMetaMap = new Map();
    if (fs.existsSync(PATTERNS_INDEX_FILE)) {
      const indexContent = fs.readFileSync(PATTERNS_INDEX_FILE, 'utf-8');
      const lines = indexContent.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(PATTERN_INDEX_ROW_RE);
        if (match) {
          const parsed = parseCode(match[1], 'P');
          if (!parsed) continue;
          const id = parsed.code;
          const category = match[2].trim();
          const summary = match[3].trim();
          const linkCol = match[4].trim();
          const linkMatch = linkCol.match(/\(([^)]+)\)/);
          const rawPath = linkMatch ? linkMatch[1] : linkCol;
          const fileName = path.basename(rawPath);
          indexMetaMap.set(fileName, { id, category, summary });
        }
      }
    }

    const files = fs
      .readdirSync(PATTERNS_DIR)
      .filter((f) => f.endsWith('.md') && !/^P-00\b/i.test(f) && !/sample/i.test(f));

    for (const file of files) {
      const filePath = path.join(PATTERNS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const meta = indexMetaMap.get(file);
      let id = meta ? meta.id : null;
      let category = meta ? meta.category : null;

      if (!id || !category) {
        const headerMatch = content.match(PATTERN_SHARD_HEADER_RE);
        if (!headerMatch) continue;
        const parsed = parseCode(headerMatch[1], 'P');
        if (!parsed) continue;
        id = parsed.code;
        category = headerMatch[2].trim();
      }

      const dateMatch = content.match(/\*\*(?:Date|Registered|일자|등록일)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const date = dateMatch ? dateMatch[1] : '';

      const causeMatch = content.match(
        /\*\*(?:Symptom(?:\s*&\s*Root\s*Cause)?|Root\s*Cause|Cause|증상\s*및\s*원인)\*\*:\s*([^\r\n]+)/i
      );
      const cause = causeMatch ? causeMatch[1].trim() : '';

      const patternMatch = content.match(
        /\*\*(?:Solution(?:\s*Pattern)?|Resolution|해결\s*패턴)\*\*:\s*([^\r\n]+)/i
      );
      const resolution = patternMatch ? patternMatch[1].trim() : '';

      const backticks = content.match(/`([^`]+)`/g) || [];
      const targetPatterns = backticks
        .map((b) => b.replace(/`/g, '').trim().replace(/\\/g, '/'))
        .filter(
          (c) =>
            c.includes('/') ||
            c.endsWith('.js') ||
            c.endsWith('.cjs') ||
            c.endsWith('.jsx') ||
            c.endsWith('.ts') ||
            c.endsWith('.tsx') ||
            c.endsWith('.css')
        );

      if (targetPatterns.length > 0) {
        patterns.push({
          source: 'pattern',
          id: `pattern-${id.toLowerCase()}`,
          category,
          date,
          title: tr('groupStatus.patternTitle', { id, category }),
          status: tr('groupStatus.memoryStatus', { id }),
          purpose: meta && meta.summary ? meta.summary : cause || resolution,
          details: resolution ? [resolution] : [],
          targetPatterns: Array.from(new Set(targetPatterns)),
        });
      }
    }

    _cachedPatterns = patterns;
  } catch (_) {
    // Return empty array on parse failure
  }

  return patterns;
}

/**
 * 5. Determines whether a file path matches a target pattern.
 */
function isFileMatch(filePath, pattern) {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normPat = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normPat) return false;

  if (normFile === normPat) return true;

  const cleanDirPat = normPat.replace(/\/$/, '');
  if (cleanDirPat && normFile.startsWith(cleanDirPat + '/')) {
    return true;
  }

  if (normPat.includes('*')) {
    const regexStr =
      '^' +
      normPat
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$';
    if (new RegExp(regexStr).test(normFile)) return true;
  }

  if (!normPat.includes('/') && path.basename(normFile) === normPat) {
    const rootEquivalentExists = fs.existsSync(path.join(ROOT_DIR, normPat));
    if (rootEquivalentExists && normFile !== normPat) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Checks whether a target pattern represents a directory.
 */
function isDirectoryPattern(pattern) {
  const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!clean) return false;
  if (clean.endsWith('/')) return true;
  try {
    const full = path.join(ROOT_DIR, clean);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * 6. Builds Conventional Commit header and body.
 */
function buildCommitMessage(task, files) {
  const title = task.title;
  let type = 'feat';
  let scope = '';

  if (/perf|optimiz|cach|speed|latency|benchmark|성능|최적화|프로파일링|캐싱|속도/i.test(title)) {
    type = 'perf';
  } else if (/fix|bug|error|issue|patch|resolve|hotfix|crash|버그|수정|오류|픽스|제거|투명화/i.test(title)) {
    type = 'fix';
  } else if (/doc|readme|guide|spec|changelog|adr|archive|문서|가이드|정합성|명세|동기화|규약|아카이브/i.test(title)) {
    type = 'docs';
  } else if (/refactor|clean|restructur|simplif|normaliz|extract|decoupl|리팩토링|정규화|정본|이원화|독립/i.test(title)) {
    type = 'refactor';
  } else if (/chore|tool|script|build|pipeline|config|ci|cd|deps|release|도구|스크립트|빌드|파이프라인|설정/i.test(title)) {
    type = 'chore';
  }

  const filePaths = files.map((f) => f.file);
  if (filePaths.some((p) => p.includes('rules/') || p.includes('GEMINI.md') || p.includes('AGENTS.md') || p.includes('README'))) {
    scope = 'rules';
  } else if (filePaths.some((p) => p.startsWith('.agents/acm/task/') || p.startsWith('.agents/task/'))) {
    scope = 'task';
  } else if (filePaths.some((p) => p.startsWith('.agents/acm/memory/') || p.startsWith('.agents/memory/'))) {
    scope = 'memory';
  } else if (filePaths.some((p) => p.includes('scripts/') || p.includes('.agents/acm/scripts/') || p.includes('.agents/scripts/'))) {
    scope = 'scripts';
  } else if (filePaths.some((p) => p.includes('docs/'))) {
    scope = 'docs';
  } else if (filePaths.some((p) => p.includes('package.json') || p.includes('tsconfig') || p.includes('.config'))) {
    scope = 'config';
  } else if (filePaths.some((p) => p.includes('ui') || p.includes('styles') || p.includes('.css'))) {
    scope = 'ui';
  } else if (filePaths.some((p) => p.includes('components/'))) {
    scope = 'components';
  }

  const prefix = scope ? `${type}(${scope})` : type;
  const taskPrefix = task.tskId ? `[${task.tskId}] ` : task.taskNum ? `[Task #${task.taskNum}] ` : '';
  const cleanTitle = (task.rawTitle || task.title || '').replace(/^\[TSK-[A-Z0-9]+\]\s*/i, '');
  const header = `${prefix}: ${taskPrefix}${cleanTitle}`;

  const bodyLines = [];
  if (task.purpose) {
    bodyLines.push(tr('groupStatus.commitBodyPurpose', { purpose: task.purpose }));
  }
  if (task.details && task.details.length > 0) {
    bodyLines.push(tr('groupStatus.commitBodyDetails'));
    task.details.slice(0, 6).forEach((d) => bodyLines.push(`  - ${d}`));
  }

  return {
    header,
    body: bodyLines.join('\n'),
    full: bodyLines.length > 0 ? `${header}\n\n${bodyLines.join('\n')}` : header,
  };
}

/**
 * Loads active tasks from SQLite DB or Markdown source based on .agents/config.json.
 */
function loadTasksFromStore() {
  const cfg = loadConfig(ROOT_DIR);
  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    const store = createMemoryStore(ROOT_DIR, { config: cfg, skipProjection: true });
    try {
      let tasks = store.listTasks({ includeDone: false });
      if (tasks.length === 0 && cfg.storage.markdownProjection !== false) {
        const mdTasks = parseTaskMd().filter((item) => item.canonicalStatus !== 'done');
        if (mdTasks.length > 0) {
          for (const item of mdTasks) {
            store.upsertTask(
              {
                code: item.tskId,
                title: item.rawTitle,
                status: item.canonicalStatus,
                purpose: item.purpose,
                results: item.details,
                targets: item.targetPatterns,
              },
              { skipValidation: true, skipProjection: true }
            );
          }
          tasks = store.listTasks({ includeDone: false });
        }
      }
      return tasks.map((task) => {
        const parsed = parseCode(task.code, 'TSK');
        const canonicalStatus = normalizeTaskStatus(task.status);
        return {
          source: 'sqlite',
          id: `task-${task.code}`,
          taskNum: parsed && parsed.num !== null ? String(parsed.num) : '',
          tskId: task.code,
          title: `[${task.code}] ${task.title}`,
          rawTitle: task.title,
          canonicalStatus,
          status: toDisplayStatus(canonicalStatus, ACTIVE_LANG),
          purpose: task.purpose || '',
          details: Array.isArray(task.results) ? task.results : [],
          targetPatterns: Array.isArray(task.targets) ? task.targets : [],
        };
      });
    } finally {
      store.close();
    }
  }
  return parseTaskMd();
}

function isTaskGroup(group) {
  return Boolean(group && (group.source === 'task.md' || group.source === 'sqlite'));
}

/**
 * 7. Classifies working tree changes into task groups and auxiliary buckets.
 */
function classifyChanges() {
  const gitFiles = getGitStatus();
  if (gitFiles === null) {
    return { groups: [], totalFiles: 0, isNonGit: true };
  }
  if (gitFiles.length === 0) return { groups: [], totalFiles: 0, isNonGit: false };

  const taskList = loadTasksFromStore();

  const assigned = new Set();
  const groups = [];

  // Phase 1: Prioritize 'ready' tasks, then 'in_progress' tasks
  const activeTasks = taskList
    .filter((item) => item.canonicalStatus === 'ready' || item.canonicalStatus === 'in_progress')
    .sort((a, b) => (a.canonicalStatus === 'ready' ? -1 : 1) - (b.canonicalStatus === 'ready' ? -1 : 1));
  const taskMatchedMap = new Map();
  activeTasks.forEach((item) => taskMatchedMap.set(item.id, []));

  // 1-1. Exact/file pattern matching first
  for (const task of activeTasks) {
    const filePatterns = task.targetPatterns.filter((p) => !isDirectoryPattern(p));
    for (const f of gitFiles) {
      if (assigned.has(f.file)) continue;
      if (filePatterns.some((pat) => isFileMatch(f.file, pat))) {
        taskMatchedMap.get(task.id).push(f);
        assigned.add(f.file);
      }
    }
  }

  // 1-2. Directory pattern matching on remaining files
  for (const task of activeTasks) {
    const dirPatterns = task.targetPatterns.filter((p) => isDirectoryPattern(p));
    for (const f of gitFiles) {
      if (assigned.has(f.file)) continue;
      if (dirPatterns.some((pat) => isFileMatch(f.file, pat))) {
        taskMatchedMap.get(task.id).push(f);
        assigned.add(f.file);
      }
    }
  }

  for (const task of activeTasks) {
    const matchedFiles = taskMatchedMap.get(task.id);
    if (matchedFiles && matchedFiles.length > 0) {
      const msg = buildCommitMessage(task, matchedFiles);
      groups.push({
        id: task.id,
        taskNum: task.taskNum,
        tskId: task.tskId,
        title: task.title,
        rawTitle: task.rawTitle,
        canonicalStatus: task.canonicalStatus,
        status: task.status,
        source: task.source === 'sqlite' ? 'sqlite' : 'task.md',
        purpose: task.purpose,
        files: matchedFiles,
        sharedOnly: false,
        message: msg,
      });
    } else if (task.canonicalStatus === 'ready' && task.targetPatterns.length > 0) {
      const allMatchingInGit = gitFiles.filter((f) =>
        task.targetPatterns.some((pat) => isFileMatch(f.file, pat))
      );
      if (allMatchingInGit.length > 0) {
        const msg = buildCommitMessage(task, allMatchingInGit);
        groups.push({
          id: task.id,
          taskNum: task.taskNum,
          tskId: task.tskId,
          title: task.title,
          rawTitle: task.rawTitle,
          canonicalStatus: task.canonicalStatus,
          status: task.status,
          source: task.source === 'sqlite' ? 'sqlite' : 'task.md',
          purpose: task.purpose,
          files: [],
          sharedFiles: allMatchingInGit,
          sharedOnly: true,
          message: msg,
        });
      }
    }
  }

  // Phase 2: Auxiliary buckets for unmapped files
  const remainingFiles = gitFiles.filter((f) => !assigned.has(f.file));
  if (remainingFiles.length > 0) {
    const subBuckets = {
      rules: {
        title: tr('groupStatus.bucketRulesTitle'),
        type: 'docs(rules)',
        purpose: tr('groupStatus.bucketRulesPurpose'),
        status: tr('groupStatus.statusAuxiliary'),
        files: [],
      },
      memory: {
        title: tr('groupStatus.bucketMemoryTitle'),
        type: 'docs(memory)',
        purpose: tr('groupStatus.bucketMemoryPurpose'),
        status: tr('groupStatus.statusAuxiliary'),
        files: [],
      },
      scripts: {
        title: tr('groupStatus.bucketScriptsTitle'),
        type: 'chore(scripts)',
        purpose: tr('groupStatus.bucketScriptsPurpose'),
        status: tr('groupStatus.statusAuxiliary'),
        files: [],
      },
      ui: {
        title: tr('groupStatus.bucketUiTitle'),
        type: 'style(ui)',
        purpose: tr('groupStatus.bucketUiPurpose'),
        status: tr('groupStatus.statusAuxiliary'),
        files: [],
      },
      core: {
        title: tr('groupStatus.bucketCoreTitle'),
        type: 'chore(core)',
        purpose: tr('groupStatus.bucketCorePurpose'),
        status: tr('groupStatus.statusAuxiliary'),
        files: [],
      },
      misc: {
        title: tr('groupStatus.bucketMiscTitle'),
        type: 'chore',
        purpose: tr('groupStatus.bucketMiscPurpose'),
        status: tr('groupStatus.statusUnregistered'),
        files: [],
      },
    };

    for (const f of remainingFiles) {
      const p = f.file;
      if (p.includes('rules/') || p.includes('GEMINI.md') || p.includes('AGENTS.md') || p.includes('README')) {
        subBuckets.rules.files.push(f);
      } else if (
        p.startsWith('.agents/acm/task/') ||
        p.startsWith('.agents/acm/memory/') ||
        p.startsWith('.agents/task/') ||
        p.startsWith('.agents/memory/')
      ) {
        subBuckets.memory.files.push(f);
      } else if (p.includes('scripts/') || p.includes('.agents/acm/scripts/') || p.includes('.agents/scripts/')) {
        subBuckets.scripts.files.push(f);
      } else if (p.includes('package.json') || p.includes('tsconfig') || p.includes('.config') || p.includes('.env')) {
        subBuckets.core.files.push(f);
      } else if (p.includes('ui') || p.includes('styles') || p.includes('.css') || p.includes('components/')) {
        subBuckets.ui.files.push(f);
      } else {
        subBuckets.misc.files.push(f);
      }
    }

    for (const [key, b] of Object.entries(subBuckets)) {
      if (b.files.length > 0) {
        const header = `${b.type}: ${b.title}`;
        const body = tr('groupStatus.commitBodyPurpose', { purpose: b.purpose });
        groups.push({
          id: `sub-${key}`,
          title: b.title,
          canonicalStatus: 'auxiliary',
          status: b.status,
          source: tr('groupStatus.sourceAuto'),
          purpose: b.purpose,
          files: b.files,
          message: {
            header,
            body,
            full: `${header}\n\n${body}`,
          },
        });
      }
    }
  }

  return { groups, totalFiles: gitFiles.length, isNonGit: false };
}

/**
 * 8-0. Returns local date string (YYYY-MM-DD).
 */
function getLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 8-1. Automatically archives a committed TSK task from task.md into task-completed.md.
 */
function autoCompleteTask(group, sha) {
  if (!group || !group.tskId || !sha) return;

  const cfg = loadConfig(ROOT_DIR);
  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    let store = null;
    try {
      store = createMemoryStore(ROOT_DIR, { config: cfg, lang: ACTIVE_LANG });
      store.completeTask(group.tskId, sha, { lang: ACTIVE_LANG });
      const projMsg =
        cfg.storage.markdownProjection !== false ? tr('groupStatus.autoCompleteSqliteProj') : '';
      console.log(tr('groupStatus.autoCompleteSqlite', { tskId: group.tskId, projMsg }));
    } catch (err) {
      console.warn(tr('groupStatus.autoCompleteSqliteWarn', { message: err.message }));
    } finally {
      if (store) store.close();
    }
    return;
  }

  if (!fs.existsSync(TASK_FILE) || !fs.existsSync(TASK_COMPLETED_FILE)) return;

  try {
    const taskRaw = fs.readFileSync(TASK_FILE, 'utf-8');
    const isKoreanTaskDoc = /최근 완료:|활성\s*(?:작업|태스크)|현재 진행 중인 활성 작업 없음/.test(taskRaw);
    const lines = taskRaw.split(/\r?\n/);

    const escapedTsk = group.tskId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const idAlt = group.taskNum ? `(?:${escapedTsk}|${group.taskNum})` : escapedTsk;
    const bulletHeaderRegex = new RegExp(
      `^-\\s*\\[[^\\]]*\\]\\s*\\*\\*${idAlt}[\\.:]\\s*(.+?)\\*\\*`,
      'i'
    );
    const mdHeaderRegex = new RegExp(
      `^#{2,4}\\s*${idAlt}[\\.:]\\s*(.+)$`,
      'i'
    );

    let inCodeBlock = false;
    let taskStartIdx = -1;
    let isMdHeaderTask = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:>\s*)?```/.test(lines[i])) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      if (bulletHeaderRegex.test(lines[i])) {
        taskStartIdx = i;
        isMdHeaderTask = false;
        break;
      }
      if (mdHeaderRegex.test(lines[i])) {
        taskStartIdx = i;
        isMdHeaderTask = true;
        break;
      }
    }
    if (taskStartIdx === -1) return;

    let subHeaderIdx = -1;
    if (!isMdHeaderTask) {
      for (let i = taskStartIdx - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('### ')) {
          subHeaderIdx = i;
        }
        break;
      }
    }

    let taskEndIdx = taskStartIdx;
    for (let i = taskStartIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(?:##\s|###\s|---|-\s*\[)/.test(l)) {
        break;
      }
      taskEndIdx = i;
    }
    while (taskEndIdx > taskStartIdx && !lines[taskEndIdx].trim()) {
      taskEndIdx--;
    }

    let hasSiblingUnderSubHeader = false;
    if (subHeaderIdx !== -1) {
      for (let i = taskEndIdx + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (/^-\s*\[/.test(trimmed)) {
          hasSiblingUnderSubHeader = true;
        }
        break;
      }
    }

    const cleanTitle = (group.rawTitle || group.title || '')
      .replace(/^\[TSK-[A-Z0-9]+\]\s*/i, '')
      .replace(/\s*\[[^\]]+\]$/, '')
      .trim();
    const subHeaderLine = subHeaderIdx !== -1 ? lines[subHeaderIdx].trim() : null;

    let taskDate = getLocalDateString();
    const bodyLines = [];
    for (let i = taskStartIdx + 1; i <= taskEndIdx; i++) {
      const regMatch = lines[i].match(
        /^\s*-\s*\*\*(?:Registered|Date|Created|등록일|일자)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i
      );
      if (regMatch) {
        taskDate = regMatch[1];
        continue;
      }
      if (/^\s*-\s*\*\*(?:Status|상태)\*\*:/i.test(lines[i])) {
        continue;
      }
      bodyLines.push(lines[i]);
    }

    const completedLines = [];
    if (subHeaderLine) completedLines.push(subHeaderLine);
    completedLines.push(`- [x] **${group.tskId}. ${cleanTitle}** (Commit: \`${sha}\`)`);
    completedLines.push(...bodyLines);
    const completedEntry = completedLines.join('\n');

    const removeFrom = subHeaderIdx !== -1 && !hasSiblingUnderSubHeader ? subHeaderIdx : taskStartIdx;
    const nextLines = [...lines.slice(0, removeFrom), ...lines.slice(taskEndIdx + 1)];

    const sec1Idx = nextLines.findIndex((l) =>
      /^##\s*(?:1\.\s*)?(?:Active\s*Tasks?|활성\s*(?:작업|태스크))/i.test(l)
    );
    let sec1EndIdx = nextLines.length;
    if (sec1Idx !== -1) {
      for (let i = sec1Idx + 1; i < nextLines.length; i++) {
        if (/^(?:##\s|---)/.test(nextLines[i])) {
          sec1EndIdx = i;
          break;
        }
      }
    }

    const remainingActiveIds = [];
    if (sec1Idx !== -1) {
      const remBulletRe = new RegExp(`^-\\s*\\[[^\\]]*\\]\\s*\\*\\*(${TASK_ID_REGEX_SOURCE})[\\.:]`, 'i');
      const remMdRe = new RegExp(`^#{2,4}\\s*(${TASK_ID_REGEX_SOURCE})[\\.:]`, 'i');
      for (let i = sec1Idx + 1; i < sec1EndIdx; i++) {
        const m = nextLines[i].match(remBulletRe) || nextLines[i].match(remMdRe);
        if (m) {
          const parsedActive = parseCode(m[1], 'TSK');
          if (parsedActive) remainingActiveIds.push(parsedActive.code);
        }
      }

      if (remainingActiveIds.length === 0) {
        nextLines.splice(
          sec1Idx + 1,
          sec1EndIdx - (sec1Idx + 1),
          isKoreanTaskDoc ? '(현재 진행 중인 활성 작업 없음)' : '(No active tasks)',
          ''
        );
      }
    }

    const committedParsed = parseCode(group.tskId, 'TSK');
    const committedNum = committedParsed && committedParsed.num ? committedParsed.num : 0;
    const resolveLatestDoneCode = (prevDoneToken) => {
      if (!committedNum) return group.tskId;
      const prevParsed = parseCode(prevDoneToken, 'TSK');
      const prevNum = prevParsed && prevParsed.num ? prevParsed.num : 0;
      return `TSK-${Math.max(prevNum, committedNum)}`;
    };
    const maxActiveNum = remainingActiveIds.reduce((acc, id) => {
      const p = parseCode(id, 'TSK');
      return Math.max(acc, p && p.num ? p.num : 0);
    }, 0);

    const updateMetaLine = (content) =>
      content
        .replace(
          /최근 완료:\s*`(TSK-[A-Z0-9]+|없음)`([^)\r\n]*?)현재 활성:\s*([^)\r\n]*?)(?:,\s*차기 예정:\s*`TSK-([0-9]+)`)?(?=\)|$|\r|\n)/i,
          (_, prevDone, mid, _activeOld, prevNext) => {
            const latestDoneCode = resolveLatestDoneCode(prevDone);
            const activeText =
              remainingActiveIds.length > 0
                ? remainingActiveIds.map((id) => `\`${id}\``).join(', ')
                : '`없음`';
            if (prevNext !== undefined && committedNum) {
              const nextNum = Math.max(parseInt(prevNext, 10) || 0, committedNum + 1, maxActiveNum + 1);
              return `최근 완료: \`${latestDoneCode}\`${mid}현재 활성: ${activeText}, 차기 예정: \`TSK-${nextNum}\``;
            }
            return `최근 완료: \`${latestDoneCode}\`${mid}현재 활성: ${activeText}`;
          }
        )
        .replace(
          /Latest Done:\s*`(TSK-[A-Z0-9]+|None)`([^)\r\n]*?)Active:\s*([^)\r\n]*?)(?:,\s*Next:\s*`TSK-([0-9]+)`)?(?=\)|$|\r|\n)/i,
          (_, prevDone, mid, _activeOld, prevNext) => {
            const latestDoneCode = resolveLatestDoneCode(prevDone);
            const activeText =
              remainingActiveIds.length > 0
                ? remainingActiveIds.map((id) => `\`${id}\``).join(', ')
                : '`None`';
            if (prevNext !== undefined && committedNum) {
              const nextNum = Math.max(parseInt(prevNext, 10) || 0, committedNum + 1, maxActiveNum + 1);
              return `Latest Done: \`${latestDoneCode}\`${mid}Active: ${activeText}, Next: \`TSK-${nextNum}\``;
            }
            return `Latest Done: \`${latestDoneCode}\`${mid}Active: ${activeText}`;
          }
        );

    const updatedTaskMd = updateMetaLine(nextLines.join('\n'));
    fs.writeFileSync(TASK_FILE, updatedTaskMd, 'utf-8');

    const completedRaw = fs.readFileSync(TASK_COMPLETED_FILE, 'utf-8');
    const isKoreanCompDoc = /이관 현황:|현재 완료 이관된 작업 없음|최근 완료:|완료 태스크 이력 보관소/.test(
      completedRaw
    );
    let compLines = completedRaw.split(/\r?\n/);

    compLines = compLines.filter(
      (l) => l.trim() !== '(현재 완료 이관된 작업 없음)' && l.trim() !== '(No completed tasks archived yet)'
    );

    let inCompCodeBlock = false;
    let firstDateSecIdx = -1;
    let usesNumberedDateHeader = false;
    for (let i = 0; i < compLines.length; i++) {
      if (/^\s*(?:>\s*)?```/.test(compLines[i])) {
        inCompCodeBlock = !inCompCodeBlock;
        continue;
      }
      if (inCompCodeBlock) continue;
      if (/^##\s+(?:[0-9]+\.\s+)?[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(compLines[i])) {
        firstDateSecIdx = i;
        usesNumberedDateHeader = /^##\s+[0-9]+\./.test(compLines[i]);
        break;
      }
    }

    const newDateHeader = usesNumberedDateHeader
      ? isKoreanCompDoc
        ? `## 0. ${taskDate} 작업`
        : `## 0. ${taskDate} Tasks`
      : `## ${taskDate}`;

    if (firstDateSecIdx !== -1) {
      const dateMatch = compLines[firstDateSecIdx].match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      const topDate = dateMatch ? dateMatch[1] : '';

      if (topDate === taskDate) {
        compLines.splice(firstDateSecIdx + 1, 0, '', completedEntry);
      } else {
        compLines.splice(
          firstDateSecIdx,
          0,
          newDateHeader,
          '',
          completedEntry,
          '',
          '---',
          ''
        );
      }
    } else {
      compLines.push('', newDateHeader, '', completedEntry, '');
    }

    const updatedCompletedMd = updateMetaLine(compLines.join('\n'));
    fs.writeFileSync(TASK_COMPLETED_FILE, updatedCompletedMd, 'utf-8');

    console.log(
      tr('groupStatus.autoCompleteMd', {
        tskId: group.tskId,
        file: path.basename(TASK_COMPLETED_FILE),
      })
    );
  } catch (err) {
    console.warn(tr('groupStatus.autoCompleteMdWarn', { message: err.message }));
  }
}

/**
 * 8-2. Commits a single task group safely and auto-archives on success.
 */
function executeCommitGroup(group) {
  let targetFiles = group.files || [];

  if (group.sharedOnly && targetFiles.length === 0) {
    const sharedList = group.sharedFiles || [];
    const currentStatus = getGitStatus() || [];
    const dirtySet = new Set(currentStatus.map((item) => item.file));
    const remainingDirty = sharedList.filter((item) => dirtySet.has(item.file));

    if (remainingDirty.length === 0) {
      let sha = '';
      try {
        sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
      } catch (_) {}
      if (!sha) {
        console.error(tr('groupStatus.sharedMissingSha', { title: group.title }));
        return false;
      }
      console.log(tr('groupStatus.sharedArchiveLog', { title: group.title, sha }));
      autoCompleteTask(group, sha);
      console.log('');
      return sha;
    }

    targetFiles = remainingDirty;
  }

  console.log(tr('groupStatus.commitExecLog', { title: group.title, count: targetFiles.length }));

  const filesToAdd = [];
  const filesToRemove = [];

  for (const f of targetFiles) {
    const fullPath = path.join(ROOT_DIR, f.file);
    const isStagedDeletion = f.rawCode ? f.rawCode[0] === 'D' : f.code === 'D';
    if (isStagedDeletion || !fs.existsSync(fullPath)) {
      filesToRemove.push(f.file);
    } else {
      filesToAdd.push(f.file);
    }

    if (f.isRename && f.oldFile && !fs.existsSync(path.join(ROOT_DIR, f.oldFile))) {
      filesToRemove.push(f.oldFile);
    }
  }

  const uniqueFilesToAdd = Array.from(new Set(filesToAdd));
  const uniqueFilesToRemove = Array.from(new Set(filesToRemove));
  const hasHead = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: ROOT_DIR, stdio: 'ignore' }).status === 0;
  const hasCachedOnlyRemoval = uniqueFilesToRemove.some((p) => fs.existsSync(path.join(ROOT_DIR, p)));

  let sha = '';

  if (hasCachedOnlyRemoval) {
    // Use temporary GIT_INDEX_FILE when untracking files that stay on disk (git rm --cached)
    let tempIndexPath = '';
    try {
      const gitDirRaw = execSync('git rev-parse --git-dir', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
      tempIndexPath = path.resolve(ROOT_DIR, gitDirRaw, 'temp-acm-commit-index');
      if (fs.existsSync(tempIndexPath)) {
        fs.unlinkSync(tempIndexPath);
      }

      const tempEnv = { ...process.env, GIT_INDEX_FILE: tempIndexPath, GIT_PAGER: 'cat', PAGER: 'cat' };
      let headFullSha = '';

      if (hasHead) {
        headFullSha = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
        const readTreeRes = spawnSync('git', ['read-tree', 'HEAD'], {
          cwd: ROOT_DIR,
          env: tempEnv,
          encoding: 'utf-8',
        });
        if (readTreeRes.status !== 0) {
          console.error(tr('groupStatus.errTempIndexInit', { detail: readTreeRes.stderr || readTreeRes.stdout }));
          return false;
        }
      }

      if (uniqueFilesToRemove.length > 0) {
        const rmRes = spawnSync('git', ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...uniqueFilesToRemove], {
          cwd: ROOT_DIR,
          env: tempEnv,
          stdio: 'inherit',
        });
        if (rmRes.status !== 0) {
          console.error(tr('groupStatus.errTempIndexRm', { title: group.title }));
          return false;
        }
      }

      if (uniqueFilesToAdd.length > 0) {
        const addRes = spawnSync('git', ['add', '--', ...uniqueFilesToAdd], {
          cwd: ROOT_DIR,
          env: tempEnv,
          stdio: 'inherit',
        });
        if (addRes.status !== 0) {
          console.error(tr('groupStatus.errTempIndexAdd', { title: group.title }));
          return false;
        }

        const checkRes = spawnSync('git', ['--no-pager', 'diff', '--cached', '--check', '--', ...uniqueFilesToAdd], {
          cwd: ROOT_DIR,
          env: tempEnv,
          encoding: 'utf-8',
        });
        const checkOut = `${checkRes.stdout || ''}${checkRes.stderr || ''}`;
        if (checkOut.includes('leftover conflict marker')) {
          console.error(tr('groupStatus.errConflictMarkers', { detail: checkOut }));
          return false;
        }
      }

      const writeTreeRes = spawnSync('git', ['write-tree'], {
        cwd: ROOT_DIR,
        env: tempEnv,
        encoding: 'utf-8',
      });
      if (writeTreeRes.status !== 0) {
        console.error(tr('groupStatus.errWriteTree', { detail: writeTreeRes.stderr || writeTreeRes.stdout }));
        return false;
      }
      const treeHash = writeTreeRes.stdout.trim();

      if (hasHead) {
        const headTreeRes = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT_DIR, encoding: 'utf-8' });
        const headTree = (headTreeRes.stdout || '').trim();
        if (headTreeRes.status === 0 && treeHash === headTree) {
          console.error(tr('groupStatus.errNoActualChanges', { title: group.title }));
          return false;
        }
      }

      const commitTreeArgs = ['commit-tree', treeHash, ...(hasHead ? ['-p', headFullSha] : []), '-F', '-'];
      const commitTreeRes = spawnSync('git', commitTreeArgs, {
        cwd: ROOT_DIR,
        env: tempEnv,
        input: group.message.full,
        encoding: 'utf-8',
      });
      if (commitTreeRes.status !== 0) {
        console.error(tr('groupStatus.errCommitTree', { detail: commitTreeRes.stderr || commitTreeRes.stdout }));
        return false;
      }
      const newCommitHash = commitTreeRes.stdout.trim();

      const updateRefRes = spawnSync('git', ['update-ref', '-m', `commit: ${group.message.header}`, 'HEAD', newCommitHash], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      });
      if (updateRefRes.status !== 0) {
        console.error(tr('groupStatus.errUpdateRef', { detail: updateRefRes.stderr || updateRefRes.stdout }));
        return false;
      }

      // Sync real .git/index for committed paths without touching other staged files
      if (uniqueFilesToRemove.length > 0) {
        spawnSync('git', ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...uniqueFilesToRemove], {
          cwd: ROOT_DIR,
          stdio: 'ignore',
        });
      }
      if (uniqueFilesToAdd.length > 0) {
        spawnSync('git', ['add', '--', ...uniqueFilesToAdd], {
          cwd: ROOT_DIR,
          stdio: 'ignore',
        });
      }

      sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
    } finally {
      if (tempIndexPath && fs.existsSync(tempIndexPath)) {
        try {
          fs.unlinkSync(tempIndexPath);
        } catch (_) {}
      }
    }
  } else {
    if (uniqueFilesToRemove.length > 0) {
      const rmRes = spawnSync('git', ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...uniqueFilesToRemove], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      if (rmRes.status !== 0) {
        console.error(tr('groupStatus.errGitRm', { title: group.title }));
        return false;
      }
    }

    if (uniqueFilesToAdd.length > 0) {
      const addRes = spawnSync('git', ['add', '--', ...uniqueFilesToAdd], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      if (addRes.status !== 0) {
        console.error(tr('groupStatus.errGitAdd', { title: group.title }));
        return false;
      }

      const checkRes = spawnSync('git', ['--no-pager', 'diff', '--cached', '--check', '--', ...uniqueFilesToAdd], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
      });
      const checkOut = `${checkRes.stdout || ''}${checkRes.stderr || ''}`;
      if (checkOut.includes('leftover conflict marker')) {
        console.error(tr('groupStatus.errConflictMarkers', { detail: checkOut }));
        return false;
      }
    }

    const trackedRemovals = hasHead
      ? uniqueFilesToRemove.filter(
          (p) => spawnSync('git', ['cat-file', '-e', `HEAD:${p}`], { cwd: ROOT_DIR, stdio: 'ignore' }).status === 0
        )
      : [];

    const commitPaths = Array.from(new Set([...uniqueFilesToAdd, ...trackedRemovals]));
    if (commitPaths.length === 0) {
      console.error(tr('groupStatus.errNoActualChanges', { title: group.title }));
      return false;
    }

    const commitRes = spawnSync('git', ['commit', '-F', '-', '--', ...commitPaths], {
      cwd: ROOT_DIR,
      input: group.message.full,
      encoding: 'utf-8',
    });

    if (commitRes.status !== 0) {
      console.error(tr('groupStatus.errGitCommit', { detail: commitRes.stderr || commitRes.stdout }));
      return false;
    }

    try {
      sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
    } catch (_) {}
  }

  console.log(tr('groupStatus.commitSuccess', { sha }));
  console.log(tr('groupStatus.commitHeader', { header: group.message.header }));

  autoCompleteTask(group, sha);
  console.log('');
  return sha;
}

/**
 * 9. Non-Git Memory Viewer report (Graceful Fallback).
 */
function reportNonGitMemoryStatus(isCompact) {
  const cfg = loadConfig(ROOT_DIR);
  let tasks;
  let changelog;
  let patterns;
  let storageLabel = '.agents/acm/task/task.md';

  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    const store = createMemoryStore(ROOT_DIR, { config: cfg, skipProjection: true });
    try {
      storageLabel = cfg.storage.dbPath || '.agents/acm/local/memory.db';
      tasks = store.listTasks({ includeDone: false }).map((task) => {
        const canonicalStatus = normalizeTaskStatus(task.status);
        return {
          title: `[${task.code}] ${task.title}`,
          canonicalStatus,
          status: toDisplayStatus(canonicalStatus, ACTIVE_LANG),
          purpose: task.purpose || '',
          targetPatterns: Array.isArray(task.targets) ? task.targets : [],
        };
      });
      changelog = store.listAdrs({ limit: 3 }).map((a) => ({
        date: a.date,
        title: `[${a.code}] ${a.title}`,
      }));
      patterns = store.listPatterns().map((p) => ({
        title: tr('groupStatus.patternTitle', { id: p.code, category: p.category || p.title }),
        purpose: p.summary || p.title,
      }));
    } finally {
      store.close();
    }
  } else {
    tasks = parseTaskMd();
    changelog = parseChangelog();
    patterns = parseLearnedPatterns();
  }

  const activeTasks = tasks.filter((item) => item.canonicalStatus !== 'done');

  if (isCompact) {
    console.log(
      tr('groupStatus.nonGitCompact', {
        activeCount: activeTasks.length,
        patternCount: patterns.length,
      })
    );
    activeTasks.forEach((item) => {
      console.log(`- [${item.status}] ${item.title}`);
    });
    return;
  }

  console.log('=======================================================');
  console.log(tr('groupStatus.nonGitHeader'));
  console.log(tr('groupStatus.nonGitSub1'));
  console.log(tr('groupStatus.nonGitSub2'));
  console.log('=======================================================\n');

  console.log(tr('groupStatus.nonGitSec1', { storageLabel, count: activeTasks.length }));
  if (activeTasks.length === 0) {
    console.log(tr('groupStatus.nonGitNoActive'));
  } else {
    activeTasks.forEach((item, idx) => {
      console.log(`    ${idx + 1}. [${item.status}] ${item.title}`);
      if (item.purpose) console.log(tr('groupStatus.nonGitPurpose', { purpose: item.purpose }));
      if (item.targetPatterns && item.targetPatterns.length > 0) {
        console.log(tr('groupStatus.nonGitTargets', { targets: item.targetPatterns.join(', ') }));
      }
    });
    console.log('');
  }

  console.log(tr('groupStatus.nonGitSec2', { count: Math.min(changelog.length, 3) }));
  if (changelog.length === 0) {
    console.log(tr('groupStatus.nonGitNoAdr'));
  } else {
    changelog.slice(0, 3).forEach((c) => {
      console.log(`    - [${c.date}] ${c.title}`);
    });
    console.log('');
  }

  console.log(tr('groupStatus.nonGitSec3', { count: patterns.length }));
  if (patterns.length === 0) {
    console.log(tr('groupStatus.nonGitNoPattern'));
  } else {
    patterns.slice(0, 5).forEach((p) => {
      console.log(`    - ${p.title}: ${p.purpose}`);
    });
    console.log('');
  }

  console.log('=======================================================');
  console.log(tr('groupStatus.nonGitFooterTitle'));
  console.log(tr('groupStatus.nonGitFooter1'));
  console.log(tr('groupStatus.nonGitFooter2'));
  console.log('=======================================================\n');
}

/**
 * 10. CLI Entry Point.
 */
function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('--status');
  const isCompact = args.includes('--compact') || args.includes('--summary');
  const isAll = args.includes('--all');
  const commitArg = args.find((a) => a.startsWith('--commit='));

  const { groups, totalFiles, isNonGit } = classifyChanges();

  if (isNonGit) {
    if (commitArg || isAll) {
      console.log(tr('groupStatus.nonGitCommitBlocked'));
      console.log(tr('groupStatus.nonGitCommitBlockedHint'));
      process.exit(0);
    }
    reportNonGitMemoryStatus(isCompact);
    process.exit(0);
  }

  if (totalFiles === 0) {
    if (isCompact) {
      console.log(tr('groupStatus.cleanCompact'));
    } else {
      console.log('=======================================================');
      console.log(tr('groupStatus.cleanBanner'));
      console.log('=======================================================');
    }
    process.exit(0);
  }

  // 1) --compact mode
  if (isCompact) {
    console.log(tr('groupStatus.compactSummary', { totalFiles, groupCount: groups.length }));
    groups.forEach((g, idx) => {
      const countLabel = g.sharedOnly
        ? tr('groupStatus.compactSharedCount', { count: g.sharedFiles.length })
        : tr('groupStatus.compactFileCount', { count: g.files.length });
      console.log(
        tr('groupStatus.compactRow', {
          idx: idx + 1,
          status: g.status,
          title: g.title,
          countLabel,
          header: g.message.header,
        })
      );
    });
    process.exit(0);
  }

  // 2) --commit=<num|TSK-XXXXXX|prefix> targeted commit
  if (commitArg) {
    const rawVal = commitArg.slice('--commit='.length).trim();
    let targetGroup = null;

    const isPureInt = /^[0-9]+$/.test(rawVal);
    const targetIdx = isPureInt ? parseInt(rawVal, 10) - 1 : -1;
    if (isPureInt && targetIdx >= 0 && targetIdx < groups.length) {
      targetGroup = groups[targetIdx];
    } else {
      const { exactCode, prefixQuery } = normalizeCodeInput(rawVal, 'TSK');
      if (exactCode) {
        targetGroup = groups.find(
          (g) => g.tskId && g.tskId.toUpperCase() === exactCode.toUpperCase()
        );
      } else if (prefixQuery) {
        const matches = groups.filter(
          (g) => g.tskId && g.tskId.toUpperCase().startsWith(prefixQuery)
        );
        if (matches.length === 1) {
          targetGroup = matches[0];
        } else if (matches.length > 1) {
          console.error(
            tr('storage.ambiguousCodePrefix', {
              id: rawVal,
              matches: matches.map((m) => m.tskId).join(', '),
            })
          );
          process.exit(1);
        }
      }
    }

    if (!targetGroup) {
      console.error(tr('groupStatus.errNoMatchingGroup', { arg: commitArg }));
      process.exit(1);
    }
    const sha = executeCommitGroup(targetGroup);
    if (!sha) process.exit(1);
    process.exit(0);
  }

  // 3) --all sequential commit for [Ready] tasks only
  if (isAll) {
    const commitReadyGroups = groups.filter((g) => isTaskGroup(g) && g.canonicalStatus === 'ready');
    const skippedGroups = groups.filter((g) => !(isTaskGroup(g) && g.canonicalStatus === 'ready'));

    if (commitReadyGroups.length === 0) {
      console.error('=======================================================');
      console.error(tr('groupStatus.errNoReadyAll'));
      console.error(tr('groupStatus.errNoReadyAllHint1'));
      console.error(tr('groupStatus.errNoReadyAllHint2'));
      console.error('=======================================================\n');
      process.exit(1);
    }

    console.log('=======================================================');
    console.log(tr('groupStatus.allStart', { count: commitReadyGroups.length }));
    console.log('=======================================================\n');

    const results = [];
    for (let i = 0; i < commitReadyGroups.length; i++) {
      const g = commitReadyGroups[i];
      const sha = executeCommitGroup(g);
      if (!sha) {
        console.error(tr('groupStatus.allStepError', { idx: i + 1 }));
        process.exit(1);
      }
      results.push({ idx: i + 1, title: g.title, sha, header: g.message.header });
    }

    console.log('=======================================================');
    console.log(tr('groupStatus.allDone', { count: results.length }));
    console.log('=======================================================');
    results.forEach((r) => {
      console.log(tr('groupStatus.allDoneRow', { idx: r.idx, sha: r.sha, header: r.header }));
    });
    if (skippedGroups.length > 0) {
      const skippedFiles = skippedGroups.flatMap((g) => g.files.map((f) => f.file));
      console.log('-------------------------------------------------------');
      console.log(tr('groupStatus.preservedTitle', { count: skippedFiles.length }));
      console.log(tr('groupStatus.preservedSubtitle'));
      skippedFiles.forEach((file) => console.log(`  - ${file}`));
    }
    console.log('=======================================================\n');
    process.exit(0);
  }

  // 4) Standard detailed report
  console.log('=======================================================');
  console.log(tr('groupStatus.reportTitle'));
  console.log(tr('groupStatus.reportPrinciple'));
  console.log('=======================================================\n');
  console.log(tr('groupStatus.reportSummary', { totalFiles, groupCount: groups.length }));

  groups.forEach((g, idx) => {
    const fileList = g.sharedOnly ? g.sharedFiles : g.files;
    const countLabel = g.sharedOnly
      ? tr('groupStatus.reportSharedCount', { count: fileList.length })
      : tr('groupStatus.reportFileCount', { count: fileList.length });
    console.log('-------------------------------------------------------');
    console.log(
      tr('groupStatus.reportGroupHeader', {
        idx: idx + 1,
        status: g.status,
        title: g.title,
        countLabel,
      })
    );
    console.log(tr('groupStatus.reportSource', { source: g.source }));
    if (g.purpose) console.log(tr('groupStatus.reportPurpose', { purpose: g.purpose }));
    console.log('-------------------------------------------------------');
    fileList.forEach((f) => {
      const renameNotice = f.isRename ? tr('groupStatus.reportRenameSuffix', { oldFile: f.oldFile }) : '';
      const prefix = g.sharedOnly ? tr('groupStatus.reportSharedTag') : f.code.padEnd(2);
      console.log(`  ${prefix} ${f.file}${renameNotice}`);
    });
    console.log(tr('groupStatus.reportCommitMsgLabel'));
    console.log(`  ${g.message.header}`);
    if (g.message.body) {
      console.log(
        g.message.body
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')
      );
    }
    console.log('');
  });

  console.log('=======================================================');
  console.log(tr('groupStatus.optionsTitle'));
  console.log(tr('groupStatus.optCommitOne'));
  console.log(tr('groupStatus.optCommitAll'));
  console.log(tr('groupStatus.optCompact'));
  console.log('=======================================================\n');

  if (isDryRun) {
    console.log(tr('groupStatus.dryRunDone'));
    process.exit(0);
  }

  if (!process.stdin.isTTY) {
    console.log(tr('groupStatus.nonInteractiveSkip1'));
    console.log(tr('groupStatus.nonInteractiveSkip2'));
    process.exit(0);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(tr('groupStatus.promptSelect'), (answer) => {
    const trimmed = answer.trim().toLowerCase();
    rl.close();
    process.stdin.pause();

    if (trimmed === 'q' || trimmed === '') {
      console.log(tr('groupStatus.promptCancelled'));
      process.exit(0);
    }

    if (trimmed === 'all') {
      const readyGroups = groups.filter((g) => isTaskGroup(g) && g.canonicalStatus === 'ready');
      if (readyGroups.length === 0) {
        console.error(tr('groupStatus.promptNoReady'));
        process.exit(1);
      }
      console.log(tr('groupStatus.promptAllStart', { count: readyGroups.length }));
      for (const g of readyGroups) {
        const sha = executeCommitGroup(g);
        if (!sha) {
          console.error(tr('groupStatus.promptAbortedError'));
          process.exit(1);
        }
      }
      process.exit(0);
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1 || num > groups.length) {
      console.error(tr('groupStatus.promptInvalidRange', { max: groups.length }));
      process.exit(1);
    }

    const sha = executeCommitGroup(groups[num - 1]);
    process.exit(sha ? 0 : 1);
  });
}

main();

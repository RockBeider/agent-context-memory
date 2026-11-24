/**
 * scripts/storage/markdown-bridge.cjs
 *
 * Bidirectional parser, converter, and projector between .agents/ Markdown
 * canonical files (English and Korean) and structured StorageProvider instances.
 */

const fs = require('fs');
const path = require('path');
const {
  TASK_ID_REGEX_SOURCE,
  PATTERN_ID_REGEX_SOURCE,
  ADR_ID_REGEX_SOURCE,
  parseCode,
  parseCodeNumber,
  compareRecordsByTimeAndCode,
  normalizeTaskStatus,
  toMarkdownCheckbox,
} = require('./id-utils.cjs');
const { resolveLanguage } = require('../i18n.cjs');

const BULLET_TASK_HEADER_RE = new RegExp(
  `^-\\s*\\[([^\\]]*)\\]\\s*\\*\\*(?:(${TASK_ID_REGEX_SOURCE})[\\.:]\\s*)(.+?)\\*\\*`,
  'i'
);
const NUMBERED_SECTION_RE =
  /^#{2,4}\s*[0-9]+[\.:]\s*(?:Active\s*Tasks?|Notes?|Rules?|Overview|활성\s*(?:작업|태스크)|참고|규칙|개요)/i;
const MD_PREFIXED_TASK_HEADER_RE = /^#{2,4}\s*(TSK-[A-Z0-9]+)[\.:]\s*(.+)$/i;
const MD_NUMERIC_TASK_HEADER_RE = /^#{3,4}\s*([0-9]+)[\.:]\s*(.+)$/i;
const COMPLETED_TASK_HEADER_RE = new RegExp(
  `^-\\s*\\[x\\]\\s*\\*\\*(?:(${TASK_ID_REGEX_SOURCE})[\\.:]\\s*)(.+?)\\*\\*(.*)$`,
  'i'
);
const PATTERN_INDEX_ROW_RE = new RegExp(
  `^\\|\\s*(?:\\*\\*)?(${PATTERN_ID_REGEX_SOURCE})(?:\\*\\*)?\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|]+)\\|`,
  'i'
);
const PATTERN_SHARD_HEADER_RE = new RegExp(`^#\\s*\\[(${PATTERN_ID_REGEX_SOURCE})\\]\\s*(.+)$`, 'im');
const ADR_INDEX_ROW_RE = new RegExp(
  `^\\|\\s*(?:\\*\\*)?(${ADR_ID_REGEX_SOURCE})(?:\\*\\*)?\\s*\\|\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|`,
  'i'
);
const ADR_DETAIL_HEADER_RE = new RegExp(
  `^(${ADR_ID_REGEX_SOURCE})\\]\\s*\\[([0-9]{4}-[0-9]{2}-[0-9]{2})\\]\\s*(.+)$`,
  'i'
);

function getLocalDateString(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveTaskFiles(rootDir) {
  const taskDir = path.join(rootDir, '.agents', 'task');
  const taskFile = path.join(taskDir, 'task.md');
  const completedHyphen = path.join(taskDir, 'task-completed.md');
  const completedUnder = path.join(taskDir, 'task_completed.md');
  const completedFile = fs.existsSync(completedHyphen)
    ? completedHyphen
    : fs.existsSync(completedUnder)
      ? completedUnder
      : completedHyphen;
  return { taskDir, taskFile, completedFile };
}

function resolveMemoryFiles(rootDir) {
  const memDir = path.join(rootDir, '.agents', 'memory');
  const changelogHyphen = path.join(memDir, 'project-changelog.md');
  const changelogUnder = path.join(memDir, 'project_changelog.md');
  const changelogFile = fs.existsSync(changelogHyphen)
    ? changelogHyphen
    : fs.existsSync(changelogUnder)
      ? changelogUnder
      : changelogHyphen;

  const indexHyphen = path.join(memDir, 'patterns-index.md');
  const indexUnder = path.join(memDir, 'patterns_index.md');
  const patternsIndexFile = fs.existsSync(indexHyphen)
    ? indexHyphen
    : fs.existsSync(indexUnder)
      ? indexUnder
      : indexHyphen;

  const patternsDir = path.join(memDir, 'patterns');
  return { memDir, changelogFile, patternsIndexFile, patternsDir };
}

/**
 * 1. Parses .agents/task/task.md (supports English/Korean bullet & heading formats, skips codeblocks and TSK-SAMPLE).
 */
function parseTaskMdFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const tasks = [];
  let currentTask = null;
  let pendingGroupName = '';
  let inTargetSection = false;
  let inDetailSection = false;
  let inCodeBlock = false;

  const flushTask = () => {
    if (currentTask) {
      tasks.push(currentTask);
      currentTask = null;
    }
    inTargetSection = false;
    inDetailSection = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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
      flushTask();
      const subHeaderMatch = line.match(/^###\s*\[([^\]]+)\]\s*$/);
      if (subHeaderMatch) {
        pendingGroupName = subHeaderMatch[1].trim();
      } else if (/^(?:##\s|---)/.test(line)) {
        pendingGroupName = '';
      }
      continue;
    }

    if (bulletHeaderMatch || mdHeaderMatch) {
      flushTask();

      const rawStatus = bulletHeaderMatch ? bulletHeaderMatch[1].trim() : '';
      const rawId = (bulletHeaderMatch ? bulletHeaderMatch[2] : mdHeaderMatch[1]).trim();
      const parsed = parseCode(rawId, 'TSK');
      if (!parsed) {
        continue;
      }

      const code = parsed.code;
      let fullTitle = (bulletHeaderMatch ? bulletHeaderMatch[3] : mdHeaderMatch[2]).trim();
      let statusRaw = rawStatus;
      const statusMatch = fullTitle.match(/\[(.*?)\]$/);
      if (statusMatch) {
        statusRaw = statusMatch[1].trim();
        fullTitle = fullTitle.replace(/\[(.*?)\]$/, '').trim();
      }

      currentTask = {
        code,
        title: fullTitle,
        status: normalizeTaskStatus(statusRaw),
        purpose: '',
        results: [],
        targets: [],
        groupName: pendingGroupName,
        registeredDate: '',
      };
      continue;
    }

    if (!currentTask) continue;

    const regMatch = line.match(
      /^\s*-\s*\*\*(?:Registered|Date|Created|등록일|일자)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    if (regMatch) {
      currentTask.registeredDate = regMatch[1];
      continue;
    }

    const statusPropMatch = line.match(/^\s*-\s*\*\*(?:Status|상태)\*\*:\s*\[?([^\]\r\n]+)\]?/i);
    if (statusPropMatch) {
      currentTask.status = normalizeTaskStatus(statusPropMatch[1].trim());
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
      if (inlineDetail.length > 0) {
        currentTask.results.push(inlineDetail);
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
          currentTask.targets.push(
            ...backtickMatches.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/'))
          );
        } else {
          currentTask.targets.push(
            ...rawTargets
              .split(',')
              .map((t) => t.trim().replace(/\\/g, '/'))
              .filter(Boolean)
          );
        }
      }
      continue;
    }

    if (/^\s*-\s*\*\*[^*]+\*\*:/.test(line)) {
      inTargetSection = false;
      inDetailSection = false;
      continue;
    }

    if (inTargetSection) {
      const backtickMatches = line.match(/`([^`]+)`/g);
      if (backtickMatches) {
        currentTask.targets.push(
          ...backtickMatches.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/'))
        );
        continue;
      }
      const subTargetMatch = line.match(/^\s{2,}-\s*`?([^`\r\n]+)`?/);
      if (subTargetMatch) {
        currentTask.targets.push(subTargetMatch[1].trim().replace(/\\/g, '/'));
        continue;
      }
    }

    const detailMatch = inDetailSection ? line.match(/^\s{2,}-\s*(.+)$/) : line.match(/^\s{4,}-\s*(.+)$/);
    if (detailMatch && !/\*\*(?:Target|Purpose|Goal|Background|Related|대상|관련|목적)/i.test(line)) {
      const detailText = detailMatch[1].trim();
      if (detailText.length > 0) {
        currentTask.results.push(detailText);
      }
    }
  }

  flushTask();
  return tasks;
}

/**
 * 2. Parses .agents/task/task-completed.md (cold archive, skips samples).
 */
function parseTaskCompletedMdFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const completed = [];
  let currentDate = '';
  let currentGroupName = '';
  let currentTask = null;
  let inTargetSection = false;
  let inDetailSection = false;
  let inCodeBlock = false;

  const flushTask = () => {
    if (currentTask) {
      completed.push(currentTask);
      currentTask = null;
    }
    inTargetSection = false;
    inDetailSection = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*(?:>\s*)?```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const dateHeaderMatch = line.match(/^##\s+(?:[0-9]+\.\s+)?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (dateHeaderMatch) {
      flushTask();
      currentDate = dateHeaderMatch[1];
      currentGroupName = '';
      continue;
    }

    const groupHeaderMatch = line.match(/^###\s*\[([^\]]+)\]\s*$/);
    if (groupHeaderMatch) {
      flushTask();
      currentGroupName = groupHeaderMatch[1].trim();
      continue;
    }

    if (/^(?:##\s|---)/.test(line)) {
      flushTask();
      continue;
    }

    const headerMatch = line.match(COMPLETED_TASK_HEADER_RE);
    if (headerMatch) {
      flushTask();
      const parsed = parseCode(headerMatch[1], 'TSK');
      if (!parsed) continue;

      const suffix = headerMatch[3] || '';
      const commitMatch = suffix.match(/\(Commit:\s*`?([^)`\s]+)`?\)/i);
      const nonGitMatch = suffix.match(/\(Completed:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const completedDate = nonGitMatch ? nonGitMatch[1] : currentDate || getLocalDateString();

      currentTask = {
        code: parsed.code,
        title: headerMatch[2].trim(),
        status: 'done',
        purpose: '',
        results: [],
        targets: [],
        groupName: currentGroupName,
        commitSha: commitMatch ? commitMatch[1].trim() : null,
        completedAt: `${completedDate}T00:00:00.000Z`,
      };
      continue;
    }

    if (!currentTask) continue;

    const purposeMatch = line.match(/^\s*-\s*\*\*(?:Purpose|Goal|Background|목적|배경)\*\*:\s*(.+)$/i);
    if (purposeMatch) {
      inTargetSection = false;
      inDetailSection = false;
      currentTask.purpose = purposeMatch[1].trim();
      continue;
    }

    const resultMatch = line.match(
      /^\s*-\s*\*\*(?:Results?|Summary|Changes|Details|수행\s*결과|작업\s*(?:요약|내용)|수정\s*(?:내역|내용))\*\*:\s*(.*)$/i
    );
    if (resultMatch) {
      inTargetSection = false;
      inDetailSection = true;
      const inlineDetail = resultMatch[1].replace(/\*\*/g, '').trim();
      if (inlineDetail) currentTask.results.push(inlineDetail);
      continue;
    }

    const targetMatch = line.match(
      /^\s*-\s*\*\*(?:Targets?|Files?|Scope|Changed\s*Files?|Related\s*Files?|Target\s*(?:Files?|Area)|(?:대상|관련|수정|변경)\s*(?:영역|파일|목록)?)\*\*:\s*(.*)$/i
    );
    if (targetMatch) {
      inTargetSection = true;
      inDetailSection = false;
      const rawTargets = targetMatch[1].trim();
      const backticks = rawTargets.match(/`([^`]+)`/g);
      if (backticks) {
        currentTask.targets.push(...backticks.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/')));
      } else if (rawTargets) {
        currentTask.targets.push(
          ...rawTargets
            .split(',')
            .map((t) => t.trim().replace(/\\/g, '/'))
            .filter(Boolean)
        );
      }
      continue;
    }

    if (/^\s*-\s*\*\*[^*]+\*\*:/.test(line)) {
      inTargetSection = false;
      inDetailSection = false;
      continue;
    }

    if (inTargetSection) {
      const backticks = line.match(/`([^`]+)`/g);
      if (backticks) {
        currentTask.targets.push(...backticks.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/')));
        continue;
      }
    }

    const detailMatch = inDetailSection ? line.match(/^\s{2,}-\s*(.+)$/) : line.match(/^\s{4,}-\s*(.+)$/);
    if (detailMatch) {
      currentTask.results.push(detailMatch[1].trim());
    }
  }

  flushTask();
  return completed;
}

/**
 * 3. Parses .agents/memory/patterns-index.md and patterns/*.md (excludes P-00 sample).
 */
function parsePatternsFromMd(rootDir) {
  const { patternsIndexFile, patternsDir } = resolveMemoryFiles(rootDir);
  const indexMetaMap = new Map();

  if (fs.existsSync(patternsIndexFile)) {
    const indexContent = fs.readFileSync(patternsIndexFile, 'utf-8');
    for (const line of indexContent.split(/\r?\n/)) {
      const match = line.match(PATTERN_INDEX_ROW_RE);
      if (!match) continue;
      const parsed = parseCode(match[1], 'P');
      if (!parsed) continue;
      const code = parsed.code;
      const linkCol = match[4].trim();
      const linkMatch = linkCol.match(/\(([^)]+)\)/);
      const rawPath = linkMatch ? linkMatch[1] : linkCol;
      indexMetaMap.set(path.basename(rawPath), {
        code,
        category: match[2].trim(),
        summary: match[3].trim(),
      });
    }
  }

  const patterns = [];
  if (!fs.existsSync(patternsDir)) return patterns;

  const files = fs
    .readdirSync(patternsDir)
    .filter((f) => f.endsWith('.md') && !/^P-00\b/i.test(f) && !/sample/i.test(f));

  for (const file of files) {
    const content = fs.readFileSync(path.join(patternsDir, file), 'utf-8');
    const meta = indexMetaMap.get(file);

    const headerMatch = content.match(PATTERN_SHARD_HEADER_RE);
    const parsed = parseCode((meta && meta.code) || (headerMatch && headerMatch[1]), 'P');
    if (!parsed) continue;

    const code = parsed.code;
    const title = headerMatch ? headerMatch[2].trim() : (meta && meta.summary) || code;
    const dateMatch = content.match(/\*\*(?:Date|Registered|일자|등록일)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    const catMatch = content.match(/\*\*(?:Category|Domain(?:\s*Category)?|도메인\s*분류)\*\*:\s*([^\r\n]+)/i);
    const symptomMatch = content.match(
      /\*\*(?:Symptom(?:\s*&\s*Root\s*Cause)?|Root\s*Cause|Cause|증상\s*및\s*원인)\*\*:\s*([^\r\n]+)/i
    );
    const solutionMatch = content.match(
      /\*\*(?:Solution(?:\s*Pattern)?|Resolution|해결\s*패턴)\*\*:\s*([^\r\n]+)/i
    );
    const filesMatch = content.match(/\*\*(?:Related\s*Files?|연관\s*파일)\*\*:\s*([^\r\n]+)/i);

    let relatedFiles = [];
    if (filesMatch) {
      const rawFiles = filesMatch[1].trim();
      if (!/^\((?:none|없음)\)$/i.test(rawFiles)) {
        const backticks = rawFiles.match(/`([^`]+)`/g);
        relatedFiles = backticks
          ? backticks.map((b) => b.replace(/`/g, '').trim().replace(/\\/g, '/'))
          : rawFiles
              .split(',')
              .map((s) => s.trim().replace(/\\/g, '/'))
              .filter(Boolean);
      }
    }

    const createdAt = dateMatch ? `${dateMatch[1]}T00:00:00.000Z` : new Date().toISOString();
    patterns.push({
      code,
      category: (meta && meta.category) || (catMatch && catMatch[1].trim()) || 'General',
      title,
      summary: (meta && meta.summary) || title,
      symptom: symptomMatch ? symptomMatch[1].trim() : '',
      solution: solutionMatch ? solutionMatch[1].trim() : '',
      relatedFiles,
      tags: [],
      fileName: file,
      createdAt,
      updatedAt: createdAt,
    });
  }

  return patterns.sort((a, b) => compareRecordsByTimeAndCode(a, b, 'P', false));
}

/**
 * 4. Parses .agents/memory/project-changelog.md (ADR Index Map + detail blocks, excludes LOG-00).
 */
function parseAdrsFromMd(rootDir) {
  const { changelogFile } = resolveMemoryFiles(rootDir);
  if (!fs.existsSync(changelogFile)) return [];

  const content = fs.readFileSync(changelogFile, 'utf-8');
  const indexMap = new Map();

  for (const line of content.split(/\r?\n/)) {
    const rowMatch = line.match(ADR_INDEX_ROW_RE);
    if (!rowMatch) continue;
    const parsed = parseCode(rowMatch[1], 'LOG');
    if (!parsed) continue;
    indexMap.set(parsed.code, {
      date: rowMatch[2].trim(),
      summary: rowMatch[3].trim(),
      relatedArea: rowMatch[4]
        .trim()
        .replace(/`/g, ''),
    });
  }

  const adrs = [];
  const blocks = content.split(/^###\s*\[/m).slice(1);
  for (const block of blocks) {
    const firstNewline = block.indexOf('\n');
    const headerLine = (firstNewline !== -1 ? block.slice(0, firstNewline) : block).trim();
    const headerMatch = headerLine.match(ADR_DETAIL_HEADER_RE);
    if (!headerMatch) continue;

    const parsed = parseCode(headerMatch[1], 'LOG');
    if (!parsed) continue;
    const code = parsed.code;
    const date = headerMatch[2].trim();
    const title = headerMatch[3].trim();
    const body = firstNewline !== -1 ? block.slice(firstNewline + 1) : '';
    const idxMeta = indexMap.get(code) || {};

    let relatedTaskCode = '';
    let branch = '';
    const relMatch = body.match(/-\s*\*\*(?:Related\s*Commit\/Branch|관련\s*커밋\/브랜치)\*\*:\s*([^\r\n]+)/i);
    if (relMatch) {
      const parts = relMatch[1].split('/').map((s) => s.replace(/`/g, '').trim());
      relatedTaskCode = parts[0] || '';
      branch = parts[1] || '';
    }

    const extractSection = (headings) => {
      const list = Array.isArray(headings) ? headings : [headings];
      for (const heading of list) {
        const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = body.match(
          new RegExp(`-\\s*\\*\\*${escaped}\\*\\*:\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n-\\s*\\*\\*|\\r?\\n---|$)`, 'i')
        );
        if (m) {
          return m[1]
            .split(/\r?\n/)
            .map((l) => l.replace(/^\s*-\s*/, '').trim())
            .filter(Boolean)
            .join('\n');
        }
      }
      return '';
    };

    const context = extractSection(['Context & Goal', 'Context', '결정 배경 및 목적']);
    const decision = extractSection(['Architectural Decisions', 'Decision', '아키텍처 결정 사항']);
    const impact = extractSection(['Expected Impact', 'Impact', '예상 효과']);

    adrs.push({
      code,
      date,
      title,
      summary: idxMeta.summary || title,
      relatedArea: idxMeta.relatedArea || '',
      relatedTaskCode,
      branch,
      context,
      decision,
      impact,
      createdAt: `${date}T00:00:00.000Z`,
      updatedAt: `${date}T00:00:00.000Z`,
    });
  }

  return adrs;
}

/**
 * 5. Imports existing Markdown canonical files (.agents/) losslessly into a MemoryStore.
 */
function importMarkdownToStore(rootDir, store) {
  const resolvedRoot = path.resolve(rootDir);
  const { taskFile, completedFile } = resolveTaskFiles(resolvedRoot);

  const activeTasks = parseTaskMdFile(taskFile);
  const completedTasks = parseTaskCompletedMdFile(completedFile);
  const patterns = parsePatternsFromMd(resolvedRoot);
  const adrs = parseAdrsFromMd(resolvedRoot);

  let tasksCount = 0;
  let completedCount = 0;
  let patternsCount = 0;
  let adrsCount = 0;

  for (const t of activeTasks) {
    store.upsertTask(t, { skipValidation: true, skipProjection: true });
    tasksCount += 1;
  }
  for (const ct of completedTasks) {
    store.upsertTask(ct, { skipValidation: true, skipProjection: true });
    completedCount += 1;
  }
  for (const p of patterns) {
    store.upsertPattern(p);
    patternsCount += 1;
  }
  for (const a of adrs) {
    store.upsertAdr(a);
    adrsCount += 1;
  }

  return {
    tasks: tasksCount,
    completedTasks: completedCount,
    patterns: patternsCount,
    adrs: adrsCount,
  };
}

/**
 * 6. Projects active/completed tasks from MemoryStore into .agents/task/task.md & task-completed.md.
 */
function projectTasksToMarkdown(rootDir, store, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const lang = resolveLanguage(resolvedRoot, options && options.lang);
  const isKo = lang === 'ko';
  const { taskDir, taskFile, completedFile } = resolveTaskFiles(resolvedRoot);
  fs.mkdirSync(taskDir, { recursive: true });

  const allTasks = store.listTasks({ includeDone: true });
  const activeTasks = allTasks.filter((t) => t.status !== 'done');
  const doneTasks = allTasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => {
      const da = (a.completedAt || a.updatedAt || '').slice(0, 10);
      const db = (b.completedAt || b.updatedAt || '').slice(0, 10);
      if (da !== db) return db.localeCompare(da);
      const ta = Date.parse(a.completedAt || a.updatedAt || '') || 0;
      const tb = Date.parse(b.completedAt || b.updatedAt || '') || 0;
      if (ta !== tb) return tb - ta;
      return compareRecordsByTimeAndCode(a, b, 'TSK', true);
    });

  const noneToken = isKo ? '`없음`' : '`None`';
  const recentDoneLabel = doneTasks.length > 0 ? `\`${doneTasks[0].code}\`` : noneToken;
  const activeLabels =
    activeTasks.length > 0 ? activeTasks.map((t) => `\`${t.code}\``).join(', ') : noneToken;

  const taskLines = isKo
    ? [
        '# Agent Context Memory Task Master (작업 단일 정본)',
        '',
        `- **식별자 규칙**: 영구 불변 6자리 단축 ID(\`TSK-XXXXXX\`, \`acm task add\` / \`acm id\` / MCP 발급, 기존 \`TSK-{N}\` 호환). (최근 완료: ${recentDoneLabel}, 현재 활성: ${activeLabels})`,
        '- **완료 보관소**: [task-completed.md](./task-completed.md)',
        '- **상태 전이**: `[ ]` -> `[진행 중]` -> `[커밋 대기]`(3요소 필수) -> `[x]`(커밋·자동 이관)',
        '',
        '---',
        '',
        '## 1. 활성 작업 목록 (Active Tasks)',
      ]
    : [
        '# Agent Context Memory Task Master (Single Source of Truth)',
        '',
        `- **ID Rule**: Immutable 6-char short ID (\`TSK-XXXXXX\`, via \`acm task add\` / \`acm id\` / MCP; legacy \`TSK-{N}\` supported). (Latest Done: ${recentDoneLabel}, Active: ${activeLabels})`,
        '- **Completed Archive**: [task-completed.md](./task-completed.md)',
        '- **Status Flow**: `[ ]` -> `[In Progress]` -> `[Ready]` (3 elements required) -> `[x]` (commit & auto-archive)',
        '',
        '---',
        '',
        '## 1. Active Tasks',
      ];

  const purposeLabel = isKo ? '목적' : 'Purpose';
  const resultsLabel = isKo ? '수행결과' : 'Results';
  const targetsLabel = isKo ? '대상영역' : 'Targets';

  if (activeTasks.length === 0) {
    taskLines.push(isKo ? '(현재 진행 중인 활성 작업 없음)' : '(No active tasks)');
  } else {
    let lastGroup = '';
    for (const t of activeTasks) {
      if (t.groupName && t.groupName !== lastGroup) {
        taskLines.push(`### [${t.groupName}]`);
        lastGroup = t.groupName;
      }
      const cb = toMarkdownCheckbox(t.status, lang);
      taskLines.push(`- [${cb}] **${t.code}. ${t.title}**`);
      if (t.purpose) {
        taskLines.push(`  - **${purposeLabel}**: ${t.purpose}`);
      }
      if (t.results && t.results.length > 0) {
        taskLines.push(`  - **${resultsLabel}**:`);
        for (const r of t.results) {
          taskLines.push(`    - ${r}`);
        }
      }
      if (t.targets && t.targets.length > 0) {
        taskLines.push(`  - **${targetsLabel}**: ${t.targets.map((p) => `\`${p}\``).join(', ')}`);
      }
    }
  }
  fs.writeFileSync(taskFile, taskLines.join('\n') + '\n', 'utf-8');

  const compLines = isKo
    ? [
        '# Agent Context Memory Task Completed Master (완료 태스크 이력 보관소)',
        '',
        '> [!NOTE]',
        '> 실제 터미널 `git commit` 완료 후 획득한 SHA 해시가 명기된 작업만 보관하는 콜드 아카이브(Cold Archive) 정본입니다.',
        '> 신규 완료 작업은 최상단 일자 섹션에 누적(Prepend)합니다.',
        '',
        `- **이관 현황**: (최근 완료: ${recentDoneLabel}, 현재 활성: ${activeLabels})`,
        '',
        '---',
      ]
    : [
        '# Agent Context Memory Task Completed Master (Cold Archive)',
        '',
        '> [!NOTE]',
        '> Cold archive storing only verified tasks with a real commit SHA obtained from `git commit`.',
        '> Newly completed tasks are prepended to the top date section.',
        '',
        `- **Archive Status**: (Latest Done: ${recentDoneLabel}, Active: ${activeLabels})`,
        '',
        '---',
      ];

  if (doneTasks.length === 0) {
    compLines.push(isKo ? '(현재 완료 이관된 작업 없음)' : '(No completed tasks archived yet)');
  } else {
    const byDate = new Map();
    for (const t of doneTasks) {
      const dateKey = (t.completedAt || t.updatedAt || getLocalDateString()).slice(0, 10);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(t);
    }

    const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
    dates.forEach((dateKey, dIdx) => {
      if (dIdx > 0) {
        compLines.push('', '---');
      }
      compLines.push('', `## ${dateKey}`);
      let lastGroup = '';
      for (const t of byDate.get(dateKey)) {
        if (t.groupName && t.groupName !== lastGroup) {
          compLines.push('', `### [${t.groupName}]`);
          lastGroup = t.groupName;
        }
        const suffix = t.commitSha
          ? `(Commit: \`${t.commitSha}\`)`
          : `(Completed: ${dateKey} / Non-Git)`;
        compLines.push(`- [x] **${t.code}. ${t.title}** ${suffix}`);
        if (t.purpose) {
          compLines.push(`  - **${purposeLabel}**: ${t.purpose}`);
        }
        if (t.results && t.results.length > 0) {
          compLines.push(`  - **${resultsLabel}**:`);
          for (const r of t.results) {
            compLines.push(`    - ${r}`);
          }
        }
        if (t.targets && t.targets.length > 0) {
          compLines.push(`  - **${targetsLabel}**: ${t.targets.map((p) => `\`${p}\``).join(', ')}`);
        }
      }
    });
  }

  fs.writeFileSync(completedFile, compLines.join('\n') + '\n', 'utf-8');
  return { taskFile, completedFile };
}

function buildPatternFileName(pattern) {
  const parsed = parseCode(pattern.code, 'P');
  const code = parsed ? parsed.code : pattern.code;
  const slug = String(pattern.title || 'pattern')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${code}-${slug || 'pattern'}.md`;
}

/**
 * 7. Exports full MemoryStore contents (Tasks + Patterns + ADRs) to standard ACM Markdown files.
 */
function exportStoreToMarkdown(rootDir, store, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const lang = resolveLanguage(resolvedRoot, options && options.lang);
  const isKo = lang === 'ko';
  const taskPaths = projectTasksToMarkdown(resolvedRoot, store, { ...options, lang });
  const { memDir, changelogFile, patternsIndexFile, patternsDir } = resolveMemoryFiles(resolvedRoot);
  fs.mkdirSync(patternsDir, { recursive: true });

  const patterns = store.listPatterns({ includeSuperseded: false });

  const indexLines = isKo
    ? [
        '# Learned Patterns Index (지식 베이스 경량 색인표)',
        '',
        '> [!IMPORTANT]',
        '> **0토큰 온디맨드 검색 원칙 (Just-In-Time Grep)**:',
        '> 1. AI 에이전트는 본 파일이나 하위 패턴 디렉터리를 무조건 전수 통조회하지 않습니다.',
        '> 2. 작업 키워드로 본 파일의 요약 열을 `grep_search`하여 매칭된 샤딩 파일(`patterns/P-XX-*.md`)만 선별 로딩합니다.',
        '> 3. 신규 솔루션 증류 시 영구 불변 단축 ID(`P-XXXXXX`, `acm pattern add` / `acm id pattern` / MCP 발급) 샤딩 파일을 생성하고, 본 인덱스에 1행을 추가합니다.',
        '',
        '| ID | 카테고리 | 핵심 요약 | 파일 링크 |',
        '| :--- | :--- | :--- | :--- |',
      ]
    : [
        '# Learned Patterns Index (Lightweight Knowledge Base Index)',
        '',
        '> [!IMPORTANT]',
        '> **Zero-Token On-Demand Search Principle (Just-In-Time Grep)**:',
        '> 1. AI agents must never eagerly read this entire file or all files under `patterns/`.',
        '> 2. Run `grep_search` on the Summary column by keyword and load ONLY matched sharded files (`patterns/P-XX-*.md`).',
        '> 3. When distilling a new reusable solution, create an immutable `P-XXXXXX` sharded file (via `acm pattern add` / `acm id pattern` / MCP) and append 1 row below.',
        '',
        '| ID | Category | Summary | File Link |',
        '| :--- | :--- | :--- | :--- |',
      ];

  const defaultCat = isKo ? '일반' : 'General';
  const emptyFilesLabel = isKo ? '(없음)' : '(None)';

  const existingFiles = fs.existsSync(patternsDir) ? fs.readdirSync(patternsDir) : [];
  for (const p of patterns) {
    const matchedExisting = existingFiles.find((f) => f.toUpperCase().startsWith(`${p.code.toUpperCase()}-`));
    const fileName = matchedExisting || buildPatternFileName(p);
    const pDate = (p.createdAt || getLocalDateString()).slice(0, 10);
    const filesStr =
      p.relatedFiles && p.relatedFiles.length > 0
        ? p.relatedFiles.map((f) => `\`${f}\``).join(', ')
        : emptyFilesLabel;

    const patLines = isKo
      ? [
          `# [${p.code}] ${p.title}`,
          '',
          `- **일자**: ${pDate}`,
          `- **도메인 분류**: ${p.category || defaultCat}`,
          `- **증상 및 원인**: ${p.symptom || p.summary || ''}`,
          `- **해결 패턴**: ${p.solution || p.summary || ''}`,
          `- **연관 파일**: ${filesStr}`,
        ]
      : [
          `# [${p.code}] ${p.title}`,
          '',
          `- **Date**: ${pDate}`,
          `- **Category**: ${p.category || defaultCat}`,
          `- **Symptom & Root Cause**: ${p.symptom || p.summary || ''}`,
          `- **Solution Pattern**: ${p.solution || p.summary || ''}`,
          `- **Related Files**: ${filesStr}`,
        ];
    fs.writeFileSync(path.join(patternsDir, fileName), patLines.join('\n') + '\n', 'utf-8');
    indexLines.push(
      `| ${p.code} | ${p.category || defaultCat} | ${p.summary || p.title} | [${fileName}](file:///./patterns/${fileName}) |`
    );
  }
  fs.writeFileSync(patternsIndexFile, indexLines.join('\n') + '\n', 'utf-8');

  const adrs = store.listAdrs();
  const adrLines = isKo
    ? [
        '# Project Changelog & Architecture Decision Records (ADR)',
        '',
        '> [!IMPORTANT]',
        '> **0토큰 온디맨드 및 색인표 우선 조회 원칙**:',
        '> 1. 본 문서는 거시 아키텍처 결정 사항(ADR) 및 시스템 주요 변경만 누적 기록합니다.',
        '> 2. 신규 결정 사항은 단축 ID(`LOG-XXXXXX`, `acm adr add` / `acm id adr` / MCP 발급)를 부여하여 **1) 상단 `ADR Index Map` 표 최상단에 1행 추가**, **2) 하단 `ADR 상세 기록` 최상단에 상세 블록 추가**를 동시 수행합니다.',
        '> 3. AI 에이전트는 평소 본 파일을 전수 조회하지 않으며, 3대 조건부 이벤트 시 **상단 색인표(1~35행)만 먼저 열람하거나 키워드로 `grep_search`한 뒤 필요한 `[LOG-XX]` 섹션만 핀포인트 조회**합니다.',
        '',
        '## 1. ADR Index Map (아키텍처 결정 경량 색인표)',
        '',
        '| ID | 일자 | 핵심 아키텍처 결정 요약 | 관련 영역 |',
        '| :--- | :--- | :--- | :--- |',
      ]
    : [
        '# Project Changelog & Architecture Decision Records (ADR)',
        '',
        '> [!IMPORTANT]',
        '> **Zero-Token On-Demand & Index-First Principle**:',
        '> 1. This document records macro Architecture Decision Records (ADRs) and major system changes only.',
        '> 2. For each new decision, assign `LOG-XXXXXX` (via `acm adr add` / `acm id adr` / MCP) and simultaneously: **1) prepend 1 row to `ADR Index Map`**, and **2) prepend a detail block under `Architecture Decision Details`**.',
        '> 3. Do not read this file routinely. Only during global infra changes, regression tracing, or large merges, slice-read lines 1-35 or `grep_search` to pinpoint `[LOG-XX]`.',
        '',
        '## 1. ADR Index Map',
        '',
        '| ID | Date | Architectural Decision Summary | Related Area |',
        '| :--- | :--- | :--- | :--- |',
      ];

  for (const a of adrs) {
    const areaCell = a.relatedArea ? a.relatedArea : '-';
    adrLines.push(`| **${a.code}** | ${a.date} | ${a.summary || a.title} | ${areaCell} |`);
  }

  adrLines.push(
    '',
    '---',
    '',
    isKo ? '## 2. ADR 상세 기록 (Architecture Decision Details)' : '## 2. Architecture Decision Details'
  );

  adrs.forEach((a, idx) => {
    if (idx > 0) adrLines.push('', '---');
    adrLines.push('', `### [${a.code}] [${a.date}] ${a.title}`, '');
    const taskPart = a.relatedTaskCode ? `\`${a.relatedTaskCode}\`` : '`init`';
    const branchPart = a.branch ? `\`${a.branch}\`` : '`main`';
    adrLines.push(
      isKo
        ? `- **관련 커밋/브랜치**: ${taskPart} / ${branchPart}`
        : `- **Related Commit/Branch**: ${taskPart} / ${branchPart}`
    );
    adrLines.push(isKo ? '- **결정 배경 및 목적**:' : '- **Context & Goal**:');
    for (const line of String(a.context || a.summary || '-').split(/\r?\n/).filter(Boolean)) {
      adrLines.push(`  - ${line}`);
    }
    adrLines.push(isKo ? '- **아키텍처 결정 사항**:' : '- **Architectural Decisions**:');
    for (const line of String(a.decision || '-').split(/\r?\n/).filter(Boolean)) {
      adrLines.push(`  - ${line}`);
    }
    adrLines.push(isKo ? '- **예상 효과**:' : '- **Expected Impact**:');
    for (const line of String(a.impact || '-').split(/\r?\n/).filter(Boolean)) {
      adrLines.push(`  - ${line}`);
    }
  });

  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(changelogFile, adrLines.join('\n') + '\n', 'utf-8');

  return {
    ...taskPaths,
    patternsIndexFile,
    changelogFile,
  };
}

module.exports = {
  resolveTaskFiles,
  resolveMemoryFiles,
  parseTaskMdFile,
  parseTaskCompletedMdFile,
  parsePatternsFromMd,
  parseAdrsFromMd,
  importMarkdownToStore,
  projectTasksToMarkdown,
  exportStoreToMarkdown,
};

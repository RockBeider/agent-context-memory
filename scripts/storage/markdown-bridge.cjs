/**
 * scripts/storage/markdown-bridge.cjs
 *
 * 기존 .agents/ Markdown 정본과 구조화 StorageProvider 간 양방향 파싱·변환·투영 브리지
 */

const fs = require('fs');
const path = require('path');
const {
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  normalizeTaskStatus,
  toMarkdownCheckbox,
} = require('./id-utils.cjs');

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
 * 1. .agents/task/task.md 파싱 (불릿형/헤더형 지원, 코드블록 및 TSK-SAMPLE 제외)
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

    const bulletHeaderMatch = line.match(
      /^-\s*\[([^\]]*)\]\s*\*\*(?:(TSK-[0-9]+|[0-9]+)[\.:]\s*)(.+?)\*\*/i
    );
    const isNumberedSectionTitle =
      /^#{2,4}\s*[0-9]+[\.:]\s*(?:활성\s*(?:작업|태스크)|Active\s*Tasks|참고|규칙|개요)/i.test(line);
    const mdHeaderMatch =
      !bulletHeaderMatch && !isNumberedSectionTitle
        ? line.match(/^#{2,4}\s*(TSK-[0-9]+)[\.:]\s*(.+)$/i) ||
          line.match(/^#{3,4}\s*([0-9]+)[\.:]\s*(.+)$/i)
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
      const parsedNum = parseCodeNumber(rawId, 'TSK');
      if (!parsedNum) {
        continue;
      }

      const code = formatTaskCode(parsedNum);
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

    const regMatch = line.match(/^\s*-\s*\*\*등록일\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (regMatch) {
      currentTask.registeredDate = regMatch[1];
      continue;
    }

    const statusPropMatch = line.match(/^\s*-\s*\*\*상태\*\*:\s*\[?([^\]\r\n]+)\]?/);
    if (statusPropMatch) {
      currentTask.status = normalizeTaskStatus(statusPropMatch[1].trim());
      continue;
    }

    const purposeMatch = line.match(/^\s*-\s*\*\*(?:목적|배경)\*\*:\s*(.+)$/);
    if (purposeMatch) {
      inTargetSection = false;
      inDetailSection = false;
      currentTask.purpose = purposeMatch[1].trim();
      continue;
    }

    const resultMatch = line.match(
      /^\s*-\s*\*\*(?:수행\s*결과|작업\s*(?:요약|내용)|수정\s*(?:내역|내용)|세부\s*(?:내용|작업))\*\*:\s*(.*)$/
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
      /^\s*-\s*\*\*(?:대상|관련|수정|변경)\s*(?:영역|파일|목록)?\*\*:\s*(.*)$/
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
    if (detailMatch && !line.includes('**대상') && !line.includes('**관련') && !line.includes('**목적**')) {
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
 * 2. .agents/task/task-completed.md 파싱 (완료 아카이브, 샘플 제외)
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

    const headerMatch = line.match(
      /^-\s*\[x\]\s*\*\*(?:(TSK-[0-9]+|[0-9]+)[\.:]\s*)(.+?)\*\*(.*)$/i
    );
    if (headerMatch) {
      flushTask();
      const parsedNum = parseCodeNumber(headerMatch[1], 'TSK');
      if (!parsedNum) continue;

      const suffix = headerMatch[3] || '';
      const commitMatch = suffix.match(/\(Commit:\s*`?([^)`\s]+)`?\)/i);
      const nonGitMatch = suffix.match(/\(Completed:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const completedDate = nonGitMatch ? nonGitMatch[1] : currentDate || getLocalDateString();

      currentTask = {
        code: formatTaskCode(parsedNum),
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

    const purposeMatch = line.match(/^\s*-\s*\*\*(?:목적|배경)\*\*:\s*(.+)$/);
    if (purposeMatch) {
      inTargetSection = false;
      inDetailSection = false;
      currentTask.purpose = purposeMatch[1].trim();
      continue;
    }

    const resultMatch = line.match(
      /^\s*-\s*\*\*(?:수행\s*결과|작업\s*(?:요약|내용)|수정\s*(?:내역|내용))\*\*:\s*(.*)$/
    );
    if (resultMatch) {
      inTargetSection = false;
      inDetailSection = true;
      const inlineDetail = resultMatch[1].replace(/\*\*/g, '').trim();
      if (inlineDetail) currentTask.results.push(inlineDetail);
      continue;
    }

    const targetMatch = line.match(/^\s*-\s*\*\*(?:대상|관련|수정|변경)\s*(?:영역|파일|목록)?\*\*:\s*(.*)$/);
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
 * 3. .agents/memory/patterns-index.md 및 patterns/*.md 파싱 (P-00 제외)
 */
function parsePatternsFromMd(rootDir) {
  const { patternsIndexFile, patternsDir } = resolveMemoryFiles(rootDir);
  const indexMetaMap = new Map();

  if (fs.existsSync(patternsIndexFile)) {
    const indexContent = fs.readFileSync(patternsIndexFile, 'utf-8');
    for (const line of indexContent.split(/\r?\n/)) {
      const match = line.match(/^\|\s*(?:\*\*)?(P-[0-9]+)(?:\*\*)?\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
      if (!match) continue;
      const num = parseCodeNumber(match[1], 'P');
      if (!num) continue;
      const code = formatPatternCode(num);
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

    const headerMatch = content.match(/^#\s*\[(P-[0-9]+)\]\s*(.+)$/m);
    const num = parseCodeNumber((meta && meta.code) || (headerMatch && headerMatch[1]), 'P');
    if (!num) continue;

    const code = formatPatternCode(num);
    const title = headerMatch ? headerMatch[2].trim() : (meta && meta.summary) || code;
    const dateMatch = content.match(/\*\*(?:일자|등록일)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    const catMatch = content.match(/\*\*도메인 분류\*\*:\s*([^\r\n]+)/);
    const symptomMatch = content.match(/\*\*증상 및 원인\*\*:\s*([^\r\n]+)/);
    const solutionMatch = content.match(/\*\*해결 패턴\*\*:\s*([^\r\n]+)/);
    const filesMatch = content.match(/\*\*연관 파일\*\*:\s*([^\r\n]+)/);

    let relatedFiles = [];
    if (filesMatch) {
      const rawFiles = filesMatch[1].trim();
      const backticks = rawFiles.match(/`([^`]+)`/g);
      relatedFiles = backticks
        ? backticks.map((b) => b.replace(/`/g, '').trim().replace(/\\/g, '/'))
        : rawFiles
            .split(',')
            .map((s) => s.trim().replace(/\\/g, '/'))
            .filter(Boolean);
    }

    const createdAt = dateMatch ? `${dateMatch[1]}T00:00:00.000Z` : new Date().toISOString();
    patterns.push({
      code,
      category: (meta && meta.category) || (catMatch && catMatch[1].trim()) || '일반',
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

  return patterns.sort((a, b) => (parseCodeNumber(a.code, 'P') || 0) - (parseCodeNumber(b.code, 'P') || 0));
}

/**
 * 4. .agents/memory/project-changelog.md 파싱 (ADR Index Map + 상세 블록, LOG-00 제외)
 */
function parseAdrsFromMd(rootDir) {
  const { changelogFile } = resolveMemoryFiles(rootDir);
  if (!fs.existsSync(changelogFile)) return [];

  const content = fs.readFileSync(changelogFile, 'utf-8');
  const indexMap = new Map();

  for (const line of content.split(/\r?\n/)) {
    const rowMatch = line.match(
      /^\|\s*(?:\*\*)?(LOG-[0-9]+)(?:\*\*)?\s*\|\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*\|\s*([^|]+)\|\s*([^|]+)\|/
    );
    if (!rowMatch) continue;
    const num = parseCodeNumber(rowMatch[1], 'LOG');
    if (!num) continue;
    indexMap.set(formatAdrCode(num), {
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
    const headerMatch = headerLine.match(/^(LOG-[0-9]+)\]\s*\[([0-9]{4}-[0-9]{2}-[0-9]{2})\]\s*(.+)$/i);
    if (!headerMatch) continue;

    const num = parseCodeNumber(headerMatch[1], 'LOG');
    if (!num) continue;
    const code = formatAdrCode(num);
    const date = headerMatch[2].trim();
    const title = headerMatch[3].trim();
    const body = firstNewline !== -1 ? block.slice(firstNewline + 1) : '';
    const idxMeta = indexMap.get(code) || {};

    let relatedTaskCode = '';
    let branch = '';
    const relMatch = body.match(/-\s*\*\*관련 커밋\/브랜치\*\*:\s*([^\r\n]+)/);
    if (relMatch) {
      const parts = relMatch[1].split('/').map((s) => s.replace(/`/g, '').trim());
      relatedTaskCode = parts[0] || '';
      branch = parts[1] || '';
    }

    const extractSection = (heading) => {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = body.match(new RegExp(`-\\s*\\*\\*${escaped}\\*\\*:\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n-\\s*\\*\\*|\\r?\\n---|$)`));
      if (!m) return '';
      return m[1]
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean)
        .join('\n');
    };

    const context = extractSection('결정 배경 및 목적');
    const decision = extractSection('아키텍처 결정 사항');
    const impact = extractSection('예상 효과');

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
 * 5. 기존 Markdown 3대 정본(.agents/)을 스토리지에 무손실 적재
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
 * 6. 스토리지 내 활성/완료 태스크를 .agents/task/task.md & task-completed.md로 투영
 */
function projectTasksToMarkdown(rootDir, store) {
  const resolvedRoot = path.resolve(rootDir);
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
      return (parseCodeNumber(b.code, 'TSK') || 0) - (parseCodeNumber(a.code, 'TSK') || 0);
    });

  const maxDoneNum = doneTasks.reduce(
    (acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0),
    0
  );
  const maxActiveNum = activeTasks.reduce(
    (acc, t) => Math.max(acc, parseCodeNumber(t.code, 'TSK') || 0),
    0
  );
  const stats = typeof store.getStats === 'function' ? store.getStats() : null;
  const seqNext = stats && stats.sequences ? stats.sequences.tsk : 1;
  const nextNum = Math.max(seqNext, maxDoneNum + 1, maxActiveNum + 1);

  const recentDoneLabel = maxDoneNum > 0 ? `\`TSK-${maxDoneNum}\`` : '`없음`';
  const activeLabels =
    activeTasks.length > 0 ? activeTasks.map((t) => `\`${t.code}\``).join(', ') : '`없음`';

  const taskLines = [
    '# Agent Context Memory Task Master (작업 단일 정본)',
    '',
    `- **식별자 규칙**: 전역 순차 자연수(\`TSK-1\`...) 불변 부여. (최근 완료: ${recentDoneLabel}, 현재 활성: ${activeLabels}, 차기 예정: \`TSK-${nextNum}\`)`,
    '- **완료 보관소**: [task-completed.md](./task-completed.md)',
    '- **상태 전이**: `[ ]` -> `[진행 중]` -> `[커밋 대기]`(3요소 필수) -> `[x]`(커밋·자동 이관)',
    '',
    '---',
    '',
    '## 1. 활성 작업 목록 (Active Tasks)',
  ];

  if (activeTasks.length === 0) {
    taskLines.push('(현재 진행 중인 활성 작업 없음)');
  } else {
    let lastGroup = '';
    for (const t of activeTasks) {
      if (t.groupName && t.groupName !== lastGroup) {
        taskLines.push(`### [${t.groupName}]`);
        lastGroup = t.groupName;
      }
      const cb = toMarkdownCheckbox(t.status);
      taskLines.push(`- [${cb}] **${t.code}. ${t.title}**`);
      if (t.purpose) {
        taskLines.push(`  - **목적**: ${t.purpose}`);
      }
      if (t.results && t.results.length > 0) {
        taskLines.push('  - **수행결과**:');
        for (const r of t.results) {
          taskLines.push(`    - ${r}`);
        }
      }
      if (t.targets && t.targets.length > 0) {
        taskLines.push(`  - **대상영역**: ${t.targets.map((p) => `\`${p}\``).join(', ')}`);
      }
    }
  }
  fs.writeFileSync(taskFile, taskLines.join('\n') + '\n', 'utf-8');

  const compLines = [
    '# Agent Context Memory Task Completed Master (완료 태스크 이력 보관소)',
    '',
    '> [!NOTE]',
    '> 실제 터미널 `git commit` 완료 후 획득한 SHA 해시가 명기된 작업만 보관하는 콜드 아카이브(Cold Archive) 정본입니다.',
    '> 신규 완료 작업은 최상단 일자 섹션에 누적(Prepend)합니다.',
    '',
    `- **이관 현황**: (최근 완료: ${recentDoneLabel}, 현재 활성: ${activeLabels}, 차기 예정: \`TSK-${nextNum}\`)`,
    '',
    '---',
  ];

  if (doneTasks.length === 0) {
    compLines.push('(현재 완료 이관된 작업 없음)');
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
          compLines.push(`  - **목적**: ${t.purpose}`);
        }
        if (t.results && t.results.length > 0) {
          compLines.push('  - **수행결과**:');
          for (const r of t.results) {
            compLines.push(`    - ${r}`);
          }
        }
        if (t.targets && t.targets.length > 0) {
          compLines.push(`  - **대상영역**: ${t.targets.map((p) => `\`${p}\``).join(', ')}`);
        }
      }
    });
  }

  fs.writeFileSync(completedFile, compLines.join('\n') + '\n', 'utf-8');
  return { taskFile, completedFile };
}

function buildPatternFileName(pattern) {
  const num = parseCodeNumber(pattern.code, 'P');
  const code = num ? formatPatternCode(num) : pattern.code;
  const slug = String(pattern.title || 'pattern')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${code}-${slug || 'pattern'}.md`;
}

/**
 * 7. 스토리지 전체(Task + Pattern + ADR)를 표준 ACM Markdown 포맷으로 내보내기
 */
function exportStoreToMarkdown(rootDir, store) {
  const resolvedRoot = path.resolve(rootDir);
  const taskPaths = projectTasksToMarkdown(resolvedRoot, store);
  const { memDir, changelogFile, patternsIndexFile, patternsDir } = resolveMemoryFiles(resolvedRoot);
  fs.mkdirSync(patternsDir, { recursive: true });

  const patterns = store.listPatterns({ includeSuperseded: false });
  const stats = typeof store.getStats === 'function' ? store.getStats() : null;
  const nextPatCode = formatPatternCode((stats && stats.sequences && stats.sequences.pat) || patterns.length + 1);

  const indexLines = [
    '# Learned Patterns Index (지식 베이스 경량 색인표)',
    '',
    '> [!IMPORTANT]',
    '> **0토큰 온디맨드 검색 원칙 (Just-In-Time Grep)**:',
    '> 1. AI 에이전트는 본 파일이나 하위 패턴 디렉터리를 무조건 전수 통조회하지 않습니다.',
    '> 2. 작업 키워드로 본 파일의 요약 열을 `grep_search`하여 매칭된 샤딩 파일(`patterns/P-XX-*.md`)만 선별 로딩합니다.',
    `> 3. 신규 솔루션 증류 시 다음 불변 번호(\`${nextPatCode}\`) 샤딩 파일을 생성하고, 본 인덱스에 1행을 추가합니다.`,
    '',
    '| ID | 카테고리 | 핵심 요약 | 파일 링크 |',
    '| :--- | :--- | :--- | :--- |',
  ];

  const existingFiles = fs.existsSync(patternsDir) ? fs.readdirSync(patternsDir) : [];
  for (const p of patterns) {
    const matchedExisting = existingFiles.find((f) => f.toUpperCase().startsWith(`${p.code.toUpperCase()}-`));
    const fileName = matchedExisting || buildPatternFileName(p);
    const pDate = (p.createdAt || getLocalDateString()).slice(0, 10);
    const filesStr =
      p.relatedFiles && p.relatedFiles.length > 0
        ? p.relatedFiles.map((f) => `\`${f}\``).join(', ')
        : '(없음)';

    const patLines = [
      `# [${p.code}] ${p.title}`,
      '',
      `- **일자**: ${pDate}`,
      `- **도메인 분류**: ${p.category || '일반'}`,
      `- **증상 및 원인**: ${p.symptom || p.summary || ''}`,
      `- **해결 패턴**: ${p.solution || p.summary || ''}`,
      `- **연관 파일**: ${filesStr}`,
    ];
    fs.writeFileSync(path.join(patternsDir, fileName), patLines.join('\n') + '\n', 'utf-8');
    indexLines.push(
      `| ${p.code} | ${p.category || '일반'} | ${p.summary || p.title} | [${fileName}](file:///./patterns/${fileName}) |`
    );
  }
  fs.writeFileSync(patternsIndexFile, indexLines.join('\n') + '\n', 'utf-8');

  const adrs = store.listAdrs();
  const adrLines = [
    '# Project Changelog & Architecture Decision Records (ADR)',
    '',
    '> [!IMPORTANT]',
    '> **0토큰 온디맨드 및 색인표 우선 조회 원칙**:',
    '> 1. 본 문서는 거시 아키텍처 결정 사항(ADR) 및 시스템 주요 변경만 누적 기록합니다.',
    '> 2. 신규 결정 사항은 `LOG-{순차증가번호}`를 채번하여 **1) 상단 `ADR Index Map` 표 최상단에 1행 추가**, **2) 하단 `ADR 상세 기록` 최상단에 상세 블록 추가**를 동시 수행합니다.',
    '> 3. AI 에이전트는 평소 본 파일을 전수 조회하지 않으며, 3대 조건부 이벤트 시 **상단 색인표(1~35행)만 먼저 열람하거나 키워드로 `grep_search`한 뒤 필요한 `[LOG-XX]` 섹션만 핀포인트 조회**합니다.',
    '',
    '## 1. ADR Index Map (아키텍처 결정 경량 색인표)',
    '',
    '| ID | 일자 | 핵심 아키텍처 결정 요약 | 관련 영역 |',
    '| :--- | :--- | :--- | :--- |',
  ];

  for (const a of adrs) {
    const areaCell = a.relatedArea ? a.relatedArea : '-';
    adrLines.push(`| **${a.code}** | ${a.date} | ${a.summary || a.title} | ${areaCell} |`);
  }

  adrLines.push('', '---', '', '## 2. ADR 상세 기록 (Architecture Decision Details)');

  adrs.forEach((a, idx) => {
    if (idx > 0) adrLines.push('', '---');
    adrLines.push('', `### [${a.code}] [${a.date}] ${a.title}`, '');
    const taskPart = a.relatedTaskCode ? `\`${a.relatedTaskCode}\`` : '`init`';
    const branchPart = a.branch ? `\`${a.branch}\`` : '`main`';
    adrLines.push(`- **관련 커밋/브랜치**: ${taskPart} / ${branchPart}`);
    adrLines.push('- **결정 배경 및 목적**:');
    for (const line of String(a.context || a.summary || '-').split(/\r?\n/).filter(Boolean)) {
      adrLines.push(`  - ${line}`);
    }
    adrLines.push('- **아키텍처 결정 사항**:');
    for (const line of String(a.decision || '-').split(/\r?\n/).filter(Boolean)) {
      adrLines.push(`  - ${line}`);
    }
    adrLines.push('- **예상 효과**:');
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

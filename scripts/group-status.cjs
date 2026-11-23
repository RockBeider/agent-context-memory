/**
 * scripts/group-status.cjs
 *
 * Agent Context Memory 작업 단위(Task-Centric) 변경사항 자동 분류, 커밋 실행 및 무인 완료 이관 도구
 *
 * [참조 우선순위 정본]
 * 1순위: .agents/task/task.md 중 [커밋 대기] 최우선, 이후 [진행 중] 활성 작업
 * 2순위: 잔여 미등록 파일 성격별(규칙, 메모리, 스크립트, UI, 코어, 미등록) 보조 그룹화
 *
 * [지원 CLI 옵션]
 *   node scripts/group-status.cjs                 : 대화형 작업 선택 및 커밋 프롬프트
 *   node scripts/group-status.cjs --dry-run       : 커밋 없이 작업별 분류 및 커밋 메시지 미리보기
 *   node scripts/group-status.cjs --compact       : 1줄 요약 출력 (LLM 에이전트 초경량 토큰용)
 *   node scripts/group-status.cjs --commit=<번호|TSK-번호> : 특정 작업 번호/TSK ID 단일 커밋 실행 및 자동 이관
 *   node scripts/group-status.cjs --all                   : '[커밋 대기]' 상태 작업을 순차 원자 커밋 및 자동 이관
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const { loadConfig } = require('./storage/config.cjs');
const { createMemoryStore } = require('./storage/memory-store.cjs');
const { parseCodeNumber, toDisplayStatus } = require('./storage/id-utils.cjs');

const ROOT_DIR = process.env.ACM_ROOT_DIR ? path.resolve(process.env.ACM_ROOT_DIR) : path.resolve(__dirname, '..');
const TASK_FILE = path.join(ROOT_DIR, '.agents', 'task', 'task.md');
const TASK_COMPLETED_FILE = fs.existsSync(path.join(ROOT_DIR, '.agents', 'task', 'task-completed.md'))
  ? path.join(ROOT_DIR, '.agents', 'task', 'task-completed.md')
  : fs.existsSync(path.join(ROOT_DIR, '.agents', 'task', 'task_completed.md'))
    ? path.join(ROOT_DIR, '.agents', 'task', 'task_completed.md')
    : path.join(ROOT_DIR, '.agents', 'task', 'task-completed.md');
const CHANGELOG_FILE = fs.existsSync(path.join(ROOT_DIR, '.agents', 'memory', 'project-changelog.md'))
  ? path.join(ROOT_DIR, '.agents', 'memory', 'project-changelog.md')
  : path.join(ROOT_DIR, '.agents', 'memory', 'project_changelog.md');
const PATTERNS_INDEX_FILE = fs.existsSync(path.join(ROOT_DIR, '.agents', 'memory', 'patterns-index.md'))
  ? path.join(ROOT_DIR, '.agents', 'memory', 'patterns-index.md')
  : path.join(ROOT_DIR, '.agents', 'memory', 'patterns_index.md');
const PATTERNS_DIR = path.join(ROOT_DIR, '.agents', 'memory', 'patterns');

/**
 * 1. Git 워킹 트리 변경 파일 파싱
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
      let rawPath = line.slice(3).trim();

      // 리네임 인덱스인 경우 분리
      if (rawPath.includes(' -> ')) {
        const parts = rawPath.split(' -> ').map((p) => p.replace(/^"|"$/g, '').trim());
        const oldFile = parts[0].replace(/\\/g, '/');
        const newFile = parts[1].replace(/\\/g, '/');
        list.push({
          code: code.trim(),
          rawCode: code,
          file: newFile,
          oldFile: oldFile,
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
  } catch (err) {
    // Git 미설치 또는 비-Git 저장소인 경우 에러 대신 null 반환 (Graceful Fallback)
    return null;
  }
}

/**
 * 2. .agents/task/task.md 파싱 (불릿 헤더 및 마크다운 H2~H4 헤더 양방향 지원, 코드블록 샘플 무시)
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

      // 마크다운 코드블록(```) 내부의 양식 샘플(TSK-SAMPLE 등)은 파싱에서 제외
      if (/^\s*(?:>\s*)?```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      // 1) 불릿 헤더 감지: - [상태] **TSK-26. 작업명** 또는 - [상태] **26. 작업명** 또는 **TSK-26: 작업명**
      const bulletHeaderMatch = line.match(/^-\s*\[([^\]]*)\]\s*\*\*(?:(TSK-[0-9]+|[0-9]+)[\.:]\s*)(.+?)\*\*/i);
      const isNumberedSectionTitle =
        /^#{2,4}\s*[0-9]+[\.:]\s*(?:활성\s*(?:작업|태스크)|Active\s*Tasks|참고|규칙|개요)/i.test(line);
      // 2) 마크다운 헤더 감지: ##~#### TSK-1. 작업명 또는 ###~#### 1. 작업명 (H2 번호 섹션 헤더 제외)
      const mdHeaderMatch =
        !bulletHeaderMatch && !isNumberedSectionTitle
          ? line.match(/^#{2,4}\s*(TSK-[0-9]+)[\.:]\s*(.+)$/i) ||
            line.match(/^#{3,4}\s*([0-9]+)[\.:]\s*(.+)$/i)
          : null;

      // 상위 섹션 구분자 감지 시 현재 태스크 블록 종료 (단, 태스크 마크다운 헤더 자체는 제외)
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
        const numOnly = rawId.replace(/[^0-9]/g, '');
        const parsedNum = parseInt(numOnly, 10);
        // TSK-0 또는 비자연수 샘플 ID는 실제 활성 태스크에서 제외
        if (!parsedNum || parsedNum <= 0) {
          currentTask = null;
          continue;
        }

        const tskId = `TSK-${parsedNum}`;
        let fullTitle = (bulletHeaderMatch ? bulletHeaderMatch[3] : mdHeaderMatch[2]).trim();

        // 상태 추출 (예: [커밋 대기], [진행 중], [보류] 등)
        let status = '진행 대기';
        if (rawStatus === 'x') {
          status = '완료';
        } else if (rawStatus) {
          status = rawStatus;
        }
        const statusMatch = fullTitle.match(/\[(.*?)\]$/);
        if (statusMatch) {
          status = statusMatch[1].trim();
          fullTitle = fullTitle.replace(/\[(.*?)\]$/, '').trim();
        }

        currentTask = {
          source: 'task',
          id: `task-${tskId}`,
          taskNum: String(parsedNum),
          tskId: tskId,
          title: `[${tskId}] ${fullTitle}`,
          rawTitle: fullTitle,
          status,
          purpose: '',
          details: [],
          targetPatterns: [],
        };
        continue;
      }

      if (!currentTask) continue;

      // 상태 추출 (헤더 하위 불릿: - **상태**: [커밋 대기] 또는 - **상태**: 진행 중)
      const statusPropMatch = line.match(/^\s*-\s*\*\*상태\*\*:\s*\[?([^\]\r\n]+)\]?/);
      if (statusPropMatch) {
        const parsed = statusPropMatch[1].trim();
        if (parsed === 'x') {
          currentTask.status = '완료';
        } else if (parsed) {
          currentTask.status = parsed;
        }
        continue;
      }

      // 목적/배경 추출
      const purposeMatch = line.match(/^\s*-\s*\*\*(?:목적|배경)\*\*:\s*(.+)$/);
      if (purposeMatch) {
        inTargetSection = false;
        inDetailSection = false;
        currentTask.purpose = purposeMatch[1].trim();
        continue;
      }

      // 수행결과/작업요약/수정내역/세부내용 인라인 및 하위 불릿 수집 확장
      const resultMatch = line.match(
        /^\s*-\s*\*\*(?:수행\s*결과|작업\s*(?:요약|내용)|수정\s*(?:내역|내용)|세부\s*(?:내용|작업))\*\*:\s*(.*)$/
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

      // 대상 영역/대상 파일/관련 파일/수정 파일 키워드 관용성 확장
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
            currentTask.targetPatterns.push(
              ...backtickMatches.map((m) => m.replace(/`/g, '').trim().replace(/\\/g, '/'))
            );
          } else {
            currentTask.targetPatterns.push(
              ...rawTargets.split(',').map((t) => t.trim().replace(/\\/g, '/')).filter(Boolean)
            );
          }
        }
        continue;
      }

      // 기타 2단 메타 키(등록일, 우선순위 등) 감지 시 하위 섹션 플래그 해제
      if (/^\s*-\s*\*\*[^*]+\*\*:/.test(line)) {
        inTargetSection = false;
        inDetailSection = false;
        continue;
      }

      // 대상 영역 하위 불릿 수집 (2칸 이상 들여쓰기 허용)
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

      // 세부 내용 불릿 수집 (inDetailSection일 때는 2칸 이상, 일반일 때는 4칸 이상 들여쓰기)
      const detailMatch = inDetailSection
        ? line.match(/^\s{2,}-\s*(.+)$/)
        : line.match(/^\s{4,}-\s*(.+)$/);
      if (detailMatch && !line.includes('**대상') && !line.includes('**관련') && !line.includes('**목적**')) {
        const detailText = detailMatch[1].replace(/\*\*/g, '').trim();
        if (detailText.length > 3 && currentTask.details.length < 10) {
          currentTask.details.push(detailText);
        }
      }
    }

    if (currentTask) tasks.push(currentTask);
    return tasks;
  } catch (err) {
    console.warn('[경고] task.md 파싱 실패:', err.message);
    return [];
  }
}

/**
 * 3. .agents/memory/project-changelog.md 파싱 (LOG-00 양식 샘플 제외)
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
      const headerMatch = headerLine.match(/^(?:(LOG-[A-Za-z0-9]+)\]\s*\[)?([0-9]{4}-[0-9]{2}-[0-9]{2})\]\s*(.+)$/);
      if (!headerMatch) continue;

      const logId = headerMatch[1] || '';
      const date = headerMatch[2];
      const title = headerMatch[3].trim();

      // 양식 샘플(LOG-00, SAMPLE) 또는 이미 커밋 해시가 부여된 과거 완료 항목은 제외
      if (logId.toUpperCase() === 'LOG-00' || /sample|양식\s*샘플|commit/i.test(title)) continue;

      // [기간 윈도우] 14일 이상 경과한 과거 changelog는 현재 변경사항 매칭 대상에서 제외
      const blockTime = new Date(date).getTime();
      const diffDays = (Date.now() - blockTime) / (1000 * 60 * 60 * 24);
      if (!isNaN(diffDays) && diffDays > 14) continue;

      const body = firstLineEnd !== -1 ? block.slice(firstLineEnd) : '';

      // 백틱 경로 수집
      const backticks = body.match(/`([^`]+)`/g) || [];
      const targetPatterns = [];
      for (const b of backticks) {
        const clean = b.replace(/`/g, '').trim().replace(/\\/g, '/');
        if (clean.includes('/') || clean.endsWith('.js') || clean.endsWith('.cjs') || clean.endsWith('.jsx') || clean.endsWith('.ts') || clean.endsWith('.tsx') || clean.endsWith('.css') || clean.endsWith('.md')) {
          targetPatterns.push(clean);
        }
      }

      // 목적 및 세부 내용 추출
      const purposeMatch = body.match(/-\s*\*\*([^*]+)\*\*:\s*([^\n]+)/);
      const purpose = purposeMatch ? `${purposeMatch[1]}: ${purposeMatch[2]}` : '';

      sections.push({
        source: 'changelog',
        id: logId ? `changelog-${logId}` : `changelog-${date}`,
        logId,
        date,
        title: logId ? `[${logId}] ${title}` : title,
        status: logId ? `메모리 (${logId})` : `메모리 (${date})`,
        purpose,
        details: [],
        targetPatterns: Array.from(new Set(targetPatterns)),
      });
    }
    return sections;
  } catch (err) {
    return [];
  }
}

// 인메모리 패턴 캐시
let _cachedPatterns = null;

/**
 * 4. .agents/memory/patterns/*.md 개별 샤딩 패턴 파싱 (캐싱, 인덱스 호환, P-00 샘플 제외)
 */
function parseLearnedPatterns() {
  if (_cachedPatterns) {
    return _cachedPatterns;
  }

  const patterns = [];
  if (!fs.existsSync(PATTERNS_DIR)) return patterns;

  try {
    // 1) patterns-index.md가 존재하면 색인표 우선 파싱 (볼드 **P-01** 및 일반 P-01 모두 허용)
    const indexMetaMap = new Map();
    if (fs.existsSync(PATTERNS_INDEX_FILE)) {
      const indexContent = fs.readFileSync(PATTERNS_INDEX_FILE, 'utf-8');
      const lines = indexContent.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\|\s*(?:\*\*)?(P-[0-9]+)(?:\*\*)?\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
        if (match) {
          const id = match[1].trim().toUpperCase();
          if (id === 'P-00' || id === 'P-0') continue;
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

    // 2) 샤딩 디렉터리 내 .md 파일 목록 파싱 (P-00 샘플 파일 제외)
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
        const headerMatch = content.match(/^#\s*\[(P-[0-9]+)\]\s*(.+)$/m);
        if (!headerMatch) continue;
        id = headerMatch[1].toUpperCase();
        if (id === 'P-00' || id === 'P-0') continue;
        category = headerMatch[2].trim();
      }

      const dateMatch = content.match(/\*\*(?:일자|등록일)\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      const date = dateMatch ? dateMatch[1] : '';

      const causeMatch = content.match(/\*\*증상 및 원인\*\*:\s*([^\r\n]+)/);
      const cause = causeMatch ? causeMatch[1].trim() : '';

      const patternMatch = content.match(/\*\*해결 패턴\*\*:\s*([^\r\n]+)/);
      const resolution = patternMatch ? patternMatch[1].trim() : '';

      const backticks = content.match(/`([^`]+)`/g) || [];
      const targetPatterns = backticks
        .map((b) => b.replace(/`/g, '').trim().replace(/\\/g, '/'))
        .filter((c) => c.includes('/') || c.endsWith('.js') || c.endsWith('.cjs') || c.endsWith('.jsx') || c.endsWith('.ts') || c.endsWith('.tsx') || c.endsWith('.css'));

      if (targetPatterns.length > 0) {
        patterns.push({
          source: 'pattern',
          id: `pattern-${id.toLowerCase()}`,
          category,
          date,
          title: `[${id}] ${category} 패턴`,
          status: `메모리 (${id})`,
          purpose: meta && meta.summary ? meta.summary : cause || resolution,
          details: resolution ? [resolution] : [],
          targetPatterns: Array.from(new Set(targetPatterns)),
        });
      }
    }

    _cachedPatterns = patterns;
  } catch (e) {
    // 파싱 실패 시 빈 배열 반환
  }

  return patterns;
}

/**
 * 5. 파일 경로가 패턴과 일치하는지 정밀 판별
 */
function isFileMatch(filePath, pattern) {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normPat = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normPat) return false;

  // 1) 정확한 완전 일치
  if (normFile === normPat) return true;

  // 2) 디렉터리 프리픽스 매칭 (슬래시 유무 모두 지원, 예: 'acm-template' 또는 'acm-template/')
  const cleanDirPat = normPat.replace(/\/$/, '');
  if (cleanDirPat && normFile.startsWith(cleanDirPat + '/')) {
    return true;
  }

  // 3) 와일드카드(*) 패턴 매칭
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

  // 4) 순수 파일명 패턴(슬래시 없음)인 경우:
  // 루트에 동명 파일이 존재하면 루트 파일만 매칭하여 하위 디렉터리 동명 파일 과잉 매칭 방지
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
 * 패턴이 디렉터리 경로인지 판별합니다.
 */
function isDirectoryPattern(pattern) {
  const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!clean) return false;
  if (clean.endsWith('/')) return true;
  try {
    const full = path.join(ROOT_DIR, clean);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 6. Conventional Commit 헤더 및 본문 구성
 */
function buildCommitMessage(task, files) {
  const title = task.title;
  let type = 'feat';
  let scope = '';

  // 타입 결정
  if (/성능|최적화|프로파일링|캐싱|속도/i.test(title)) {
    type = 'perf';
  } else if (/버그|수정|오류|픽스|제거|투명화/i.test(title)) {
    type = 'fix';
  } else if (/문서|가이드|정합성|명세|동기화|규약|아카이브/i.test(title)) {
    type = 'docs';
  } else if (/리팩토링|정규화|정본|이원화|독립/i.test(title)) {
    type = 'refactor';
  } else if (/도구|스크립트|빌드|파이프라인|설정/i.test(title)) {
    type = 'chore';
  }

  // 스코프 결정 (범용 프로젝트 경로 기준 매칭)
  const filePaths = files.map((f) => f.file);
  if (filePaths.some((p) => p.includes('rules/') || p.includes('GEMINI.md') || p.includes('AGENTS.md') || p.includes('README.md'))) {
    scope = 'rules';
  } else if (filePaths.some((p) => p.startsWith('.agents/task/'))) {
    scope = 'task';
  } else if (filePaths.some((p) => p.startsWith('.agents/memory/'))) {
    scope = 'memory';
  } else if (filePaths.some((p) => p.includes('scripts/') || p.includes('.agents/scripts/'))) {
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
  const taskPrefix = task.tskId ? `[${task.tskId}] ` : (task.taskNum ? `[Task #${task.taskNum}] ` : '');
  const cleanTitle = (task.rawTitle || task.title || '').replace(/^\[TSK-[0-9]+\]\s*/i, '');
  const header = `${prefix}: ${taskPrefix}${cleanTitle}`;

  // 본문 구성
  const bodyLines = [];
  if (task.purpose) {
    bodyLines.push(`- 목적: ${task.purpose}`);
  }
  if (task.details && task.details.length > 0) {
    bodyLines.push('- 세부 내용:');
    task.details.slice(0, 6).forEach((d) => bodyLines.push(`  - ${d}`));
  }

  return {
    header,
    body: bodyLines.join('\n'),
    full: bodyLines.length > 0 ? `${header}\n\n${bodyLines.join('\n')}` : header,
  };
}

/**
 * 스토리지 설정(.agents/config.json)에 따라 SQLite DB 또는 Markdown 정본에서 활성 태스크를 로드합니다.
 */
function loadTasksFromStore() {
  const cfg = loadConfig(ROOT_DIR);
  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    const store = createMemoryStore(ROOT_DIR, { config: cfg, skipProjection: true });
    try {
      const tasks = store.listTasks({ includeDone: false });
      return tasks.map((t) => {
        const num = parseCodeNumber(t.code, 'TSK');
        return {
          source: 'sqlite',
          id: `task-${t.code}`,
          taskNum: num !== null ? String(num) : '',
          tskId: t.code,
          title: `[${t.code}] ${t.title}`,
          rawTitle: t.title,
          status: toDisplayStatus(t.status),
          purpose: t.purpose || '',
          details: Array.isArray(t.results) ? t.results : [],
          targetPatterns: Array.isArray(t.targets) ? t.targets : [],
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
 * 7. 변경 파일들을 작업 단위로 분류 및 그룹화
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

  // [1단계] task.md 중 '커밋 대기' 최우선, 이후 '진행 중' 활성 작업 매칭
  const activeTasks = taskList
    .filter((t) => t.status === '커밋 대기' || t.status === '진행 중')
    .sort((a, b) => (a.status === '커밋 대기' ? -1 : 1) - (b.status === '커밋 대기' ? -1 : 1));
  const taskMatchedMap = new Map();
  activeTasks.forEach((t) => taskMatchedMap.set(t.id, []));

  // 1-1. 구체적 파일 패턴 우선 매칭 (단일 파일 경로 패턴)
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

  // 1-2. 잔여 파일에 대해 디렉터리 패턴 매칭 (디렉터리 경로 패턴)
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

  // 매칭된 활성 태스크 등록 (공유 파일이 선행 태스크에 귀속된 [커밋 대기] 태스크도 누락 없이 등록)
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
        status: task.status,
        source: task.source === 'sqlite' ? 'sqlite' : 'task.md',
        purpose: task.purpose,
        files: matchedFiles,
        sharedOnly: false,
        message: msg,
      });
    } else if (task.status === '커밋 대기' && task.targetPatterns.length > 0) {
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

  // [2단계] 잔여 파일 성격별 스마트 보조 그룹화 (장기기억/ADR 과거 이력 오매칭 차단)
  const remainingFiles = gitFiles.filter((f) => !assigned.has(f.file));
  if (remainingFiles.length > 0) {
    const subBuckets = {
      rules: {
        title: '프로젝트 운영 규칙 및 거버넌스 규약 갱신',
        type: 'docs(rules)',
        purpose: 'GEMINI.md, AGENTS.md, README.md 등 거버넌스 및 규칙 문서 최신화',
        status: '보조 작업',
        files: [],
      },
      memory: {
        title: '메모리 태스크 및 지식 베이스 동기화',
        type: 'docs(memory)',
        purpose: '작업 정본(task) 및 패턴/체인지로그(memory) 문서 갱신',
        status: '보조 작업',
        files: [],
      },
      scripts: {
        title: '개발 및 자동화 스크립트 도구 갱신',
        type: 'chore(scripts)',
        purpose: '빌드, 형상관리 및 워크플로우 자동화 도구 개선',
        status: '보조 작업',
        files: [],
      },
      ui: {
        title: 'UI 컴포넌트 및 스타일 레이아웃 보완',
        type: 'style(ui)',
        purpose: '디자인 토큰, 스타일시트 및 UI 컴포넌트 레이아웃 보완',
        status: '보조 작업',
        files: [],
      },
      core: {
        title: '공통 설정 및 프로젝트 인프라 갱신',
        type: 'chore(core)',
        purpose: '패키지 매니페스트 및 전역 설정 파일 갱신',
        status: '보조 작업',
        files: [],
      },
      misc: {
        title: 'task.md 미등록 워킹 트리 변경사항',
        type: 'chore',
        purpose: 'task.md에 [커밋 대기]로 등록되지 않은 변경 파일 (커밋 전 task.md 등록 권장)',
        status: '미등록 (task.md 등록 필요)',
        files: [],
      },
    };

    for (const f of remainingFiles) {
      const p = f.file;
      if (p.includes('rules/') || p.includes('GEMINI.md') || p.includes('AGENTS.md') || p.includes('README.md')) {
        subBuckets.rules.files.push(f);
      } else if (p.startsWith('.agents/task/') || p.startsWith('.agents/memory/')) {
        subBuckets.memory.files.push(f);
      } else if (p.includes('scripts/') || p.includes('.agents/scripts/')) {
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
        groups.push({
          id: `sub-${key}`,
          title: b.title,
          status: b.status,
          source: '자동 분류',
          purpose: b.purpose,
          files: b.files,
          message: {
            header,
            body: `- 목적: ${b.purpose}`,
            full: `${header}\n\n- 목적: ${b.purpose}`,
          },
        });
      }
    }
  }

  return { groups, totalFiles: gitFiles.length, isNonGit: false };
}

/**
 * 8-0. 로컬 날짜 문자열 반환 (YYYY-MM-DD)
 */
function getLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 8-1. 커밋 완료된 TSK 작업을 task.md에서 task-completed.md로 무인 자동 이관
 */
function autoCompleteTask(group, sha) {
  if (!group || !group.tskId || !sha) return;

  const cfg = loadConfig(ROOT_DIR);
  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    let store = null;
    try {
      store = createMemoryStore(ROOT_DIR, { config: cfg });
      store.completeTask(group.tskId, sha);
      const projMsg =
        cfg.storage.markdownProjection !== false ? ' 및 task-completed.md 투영' : '';
      console.log(`[자동 이관] ${group.tskId} 완료 내역이 SQLite DB${projMsg}에 자동 기록되었습니다.`);
    } catch (err) {
      console.warn(`[경고] SQLite 완료 태스크 자동 이관 중 예외 발생: ${err.message}`);
    } finally {
      if (store) store.close();
    }
    return;
  }

  if (!fs.existsSync(TASK_FILE) || !fs.existsSync(TASK_COMPLETED_FILE)) return;

  try {
    const taskRaw = fs.readFileSync(TASK_FILE, 'utf-8');
    const lines = taskRaw.split(/\r?\n/);

    const escapedTsk = group.tskId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const bulletHeaderRegex = new RegExp(
      `^-\\s*\\[[^\\]]*\\]\\s*\\*\\*(?:${escapedTsk}|${group.taskNum})[\\.:]\\s*(.+?)\\*\\*`,
      'i'
    );
    const mdHeaderRegex = new RegExp(
      `^#{2,4}\\s*(?:${escapedTsk}|${group.taskNum})[\\.:]\\s*(.+)$`,
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

    // 직전 ### [소제목] 탐색 (불릿형 태스크일 때만)
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

    // 태스크 블록 끝 인덱스 탐색
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

    // 같은 ### 소제목 아래 후속 태스크가 있는지 확인
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
      .replace(/^\[TSK-[0-9]+\]\s*/i, '')
      .replace(/\s*\[[^\]]+\]$/, '')
      .trim();
    const subHeaderLine = subHeaderIdx !== -1 ? lines[subHeaderIdx].trim() : null;

    // 등록일 추출 및 완료 블록 조립 (등록일 및 상태 라인은 완료 보관소에서 제외)
    let taskDate = getLocalDateString();
    const bodyLines = [];
    for (let i = taskStartIdx + 1; i <= taskEndIdx; i++) {
      const regMatch = lines[i].match(/^\s*-\s*\*\*등록일\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      if (regMatch) {
        taskDate = regMatch[1];
        continue;
      }
      if (/^\s*-\s*\*\*상태\*\*:/.test(lines[i])) {
        continue;
      }
      bodyLines.push(lines[i]);
    }

    const completedLines = [];
    if (subHeaderLine) completedLines.push(subHeaderLine);
    completedLines.push(`- [x] **${group.tskId}. ${cleanTitle}** (Commit: \`${sha}\`)`);
    completedLines.push(...bodyLines);
    const completedEntry = completedLines.join('\n');

    // task.md에서 완료 블록 제거
    const removeFrom = subHeaderIdx !== -1 && !hasSiblingUnderSubHeader ? subHeaderIdx : taskStartIdx;
    const nextLines = [...lines.slice(0, removeFrom), ...lines.slice(taskEndIdx + 1)];

    // ## 활성 작업/태스크 목록 섹션 내 잔여 활성 태스크 점검
    const sec1Idx = nextLines.findIndex((l) => /^##\s*(?:1\.\s*)?활성\s*(?:작업|태스크)/.test(l));
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
      for (let i = sec1Idx + 1; i < sec1EndIdx; i++) {
        const m =
          nextLines[i].match(/^-\s*\[[^\]]*\]\s*\*\*(?:(TSK-[0-9]+|[0-9]+)[\.:])/i) ||
          nextLines[i].match(/^#{2,4}\s*(?:(TSK-[0-9]+|[0-9]+)[\.:])/i);
        if (m) {
          const rawId = m[1].toUpperCase();
          remainingActiveIds.push(rawId.startsWith('TSK-') ? rawId : `TSK-${rawId}`);
        }
      }

      if (remainingActiveIds.length === 0) {
        nextLines.splice(
          sec1Idx + 1,
          sec1EndIdx - (sec1Idx + 1),
          '(현재 진행 중인 활성 작업 없음)',
          ''
        );
      }
    }

    // 메타 헤더(최근 완료 / 현재 활성 / 차기 예정) 갱신 함수
    const committedNum = parseInt(group.taskNum, 10) || 0;
    const updateMetaLine = (content) =>
      content.replace(
        /최근 완료:\s*`(?:TSK-([0-9]+)|없음)`([^)\r\n]*?)현재 활성:\s*.*?,\s*차기 예정:\s*`TSK-([0-9]+)`/,
        (_, prevDone, mid, prevNext) => {
          const latestDone = Math.max(parseInt(prevDone, 10) || 0, committedNum);
          const maxActive = remainingActiveIds.reduce(
            (acc, id) => Math.max(acc, parseInt(id.replace(/[^0-9]/g, ''), 10) || 0),
            0
          );
          const nextNum = Math.max(parseInt(prevNext, 10) || 0, latestDone + 1, maxActive + 1);
          const activeText =
            remainingActiveIds.length > 0
              ? remainingActiveIds.map((id) => `\`${id}\``).join(', ')
              : '`없음`';
          return `최근 완료: \`TSK-${latestDone}\`${mid}현재 활성: ${activeText}, 차기 예정: \`TSK-${nextNum}\``;
        }
      );

    const updatedTaskMd = updateMetaLine(nextLines.join('\n'));
    fs.writeFileSync(TASK_FILE, updatedTaskMd, 'utf-8');

    // task-completed.md 최상단 날짜 섹션에 삽입 (코드블록 내부의 샘플 헤더 무시)
    const completedRaw = fs.readFileSync(TASK_COMPLETED_FILE, 'utf-8');
    let compLines = completedRaw.split(/\r?\n/);

    // 초기 템플릿 플레이스홀더 '(현재 완료 이관된 작업 없음)' 제거
    compLines = compLines.filter((l) => l.trim() !== '(현재 완료 이관된 작업 없음)');

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

    const newDateHeader = usesNumberedDateHeader ? `## 0. ${taskDate} 작업` : `## ${taskDate}`;

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

    console.log(`[자동 이관] ${group.tskId} 완료 내역이 ${path.basename(TASK_COMPLETED_FILE)}에 자동 기록되었습니다.`);
  } catch (err) {
    console.warn(`[경고] 완료 태스크 자동 이관 중 예외 발생: ${err.message}`);
  }
}

/**
 * 8-2. 특정 그룹 커밋 실행 함수 (안전한 파일 스테이징, diff --check 검증, 분할 커밋 및 완료 이관)
 */
function executeCommitGroup(group) {
  let targetFiles = group.files || [];

  // 선행 태스크와 파일이 100% 겹쳐 공유 파일로 등록된 경우 처리
  if (group.sharedOnly && targetFiles.length === 0) {
    const sharedList = group.sharedFiles || [];
    const currentStatus = getGitStatus() || [];
    const dirtySet = new Set(currentStatus.map((item) => item.file));
    const remainingDirty = sharedList.filter((item) => dirtySet.has(item.file));

    if (remainingDirty.length === 0) {
      let sha = '';
      try {
        sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
      } catch (e) {}
      if (!sha) {
        console.error(`[오류] 공유 태스크 이관용 HEAD SHA를 확인할 수 없습니다: ${group.title}`);
        return false;
      }
      console.log(`\n>>> [공유 커밋 이관] ${group.title} (선행 커밋 SHA: ${sha})`);
      autoCompleteTask(group, sha);
      console.log('');
      return sha;
    }

    // 개별 커밋(--commit=TSK-X) 등으로 선행 태스크가 아직 커밋되지 않은 경우 직접 커밋 수행
    targetFiles = remainingDirty;
  }

  console.log(`\n>>> [커밋 실행] ${group.title} (${targetFiles.length}개 파일)`);

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
    // 디스크 파일이 남아있는 인덱스 전용 삭제(git rm --cached) 포함 시 임시 인덱스 기반 격리 커밋 수행
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
          console.error(`[오류] 임시 인덱스 초기화 실패: ${readTreeRes.stderr || readTreeRes.stdout}`);
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
          console.error(`[오류] 임시 인덱스 git rm 실패: ${group.title}`);
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
          console.error(`[오류] 임시 인덱스 git add 실패: ${group.title}`);
          return false;
        }

        const checkRes = spawnSync('git', ['--no-pager', 'diff', '--cached', '--check', '--', ...uniqueFilesToAdd], {
          cwd: ROOT_DIR,
          env: tempEnv,
          encoding: 'utf-8',
        });
        const checkOut = `${checkRes.stdout || ''}${checkRes.stderr || ''}`;
        if (checkOut.includes('leftover conflict marker')) {
          console.error(`[오류] 미해소 충돌 마커(<<<<<<<) 감지:\n${checkOut}`);
          return false;
        }
      }

      const writeTreeRes = spawnSync('git', ['write-tree'], {
        cwd: ROOT_DIR,
        env: tempEnv,
        encoding: 'utf-8',
      });
      if (writeTreeRes.status !== 0) {
        console.error(`[오류] git write-tree 실패: ${writeTreeRes.stderr || writeTreeRes.stdout}`);
        return false;
      }
      const treeHash = writeTreeRes.stdout.trim();

      if (hasHead) {
        const headTreeRes = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT_DIR, encoding: 'utf-8' });
        const headTree = (headTreeRes.stdout || '').trim();
        if (headTreeRes.status === 0 && treeHash === headTree) {
          console.error(`[오류] 커밋할 실제 변경 경로가 없습니다: ${group.title}`);
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
        console.error(`[오류] git commit-tree 실패:\n${commitTreeRes.stderr || commitTreeRes.stdout}`);
        return false;
      }
      const newCommitHash = commitTreeRes.stdout.trim();

      const updateRefRes = spawnSync('git', ['update-ref', '-m', `commit: ${group.message.header}`, 'HEAD', newCommitHash], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      });
      if (updateRefRes.status !== 0) {
        console.error(`[오류] git update-ref 실패:\n${updateRefRes.stderr || updateRefRes.stdout}`);
        return false;
      }

      // 실제 인덱스(.git/index)에도 방금 커밋한 항목만 정합화하여 타 그룹 staged 상태 보존
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
    // 1) 삭제된 파일 스테이징
    if (uniqueFilesToRemove.length > 0) {
      const rmRes = spawnSync('git', ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...uniqueFilesToRemove], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      if (rmRes.status !== 0) {
        console.error(`[오류] git rm 실패: ${group.title}`);
        return false;
      }
    }

    // 2) 신규/수정 파일 스테이징
    if (uniqueFilesToAdd.length > 0) {
      const addRes = spawnSync('git', ['add', '--', ...uniqueFilesToAdd], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
      if (addRes.status !== 0) {
        console.error(`[오류] git add 실패: ${group.title}`);
        return false;
      }

      // 2-1) 스테이징된 파일 충돌 마커(<<<<<<<) 내장 검사 (git --no-pager diff --cached --check)
      const checkRes = spawnSync('git', ['--no-pager', 'diff', '--cached', '--check', '--', ...uniqueFilesToAdd], {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
        env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
      });
      const checkOut = `${checkRes.stdout || ''}${checkRes.stderr || ''}`;
      if (checkOut.includes('leftover conflict marker')) {
        console.error(`[오류] 미해소 충돌 마커(<<<<<<<) 감지:\n${checkOut}`);
        return false;
      }
    }

    // HEAD에 실제 존재하는 삭제 대상만 커밋 pathspec에 포함 (AD 등 미추적 삭제 에러 방지)
    const trackedRemovals = hasHead
      ? uniqueFilesToRemove.filter(
          (p) => spawnSync('git', ['cat-file', '-e', `HEAD:${p}`], { cwd: ROOT_DIR, stdio: 'ignore' }).status === 0
        )
      : [];

    const commitPaths = Array.from(new Set([...uniqueFilesToAdd, ...trackedRemovals]));
    if (commitPaths.length === 0) {
      console.error(`[오류] 커밋할 실제 변경 경로가 없습니다: ${group.title}`);
      return false;
    }

    // 3) git commit 실행 (해당 그룹 경로만 격리 커밋 및 stdin 기반 줄바꿈/한글 100% 무결 보존)
    const commitRes = spawnSync('git', ['commit', '-F', '-', '--', ...commitPaths], {
      cwd: ROOT_DIR,
      input: group.message.full,
      encoding: 'utf-8',
    });

    if (commitRes.status !== 0) {
      console.error(`[오류] git commit 실패:\n${commitRes.stderr || commitRes.stdout}`);
      return false;
    }

    // 4) 생성된 Commit SHA 조회
    try {
      sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
    } catch (e) {}
  }

  console.log(`[성공] 커밋 완료! (SHA: ${sha})`);
  console.log(`       헤더: ${group.message.header}`);

  // 5) task.md -> task-completed.md 원스톱 자동 완료 이관
  autoCompleteTask(group, sha);
  console.log('');
  return sha;
}

/**
 * 9. 비-Git 환경 메모리 상태 리포트 (Graceful Fallback 뷰어)
 */
function reportNonGitMemoryStatus(isCompact) {
  const cfg = loadConfig(ROOT_DIR);
  let tasks;
  let changelog;
  let patterns;
  let storageLabel = '.agents/task/task.md';

  if (cfg.storage && cfg.storage.provider === 'sqlite') {
    const store = createMemoryStore(ROOT_DIR, { config: cfg, skipProjection: true });
    try {
      storageLabel = cfg.storage.dbPath || '.agents/local/memory.db';
      tasks = store.listTasks({ includeDone: false }).map((t) => ({
        title: `[${t.code}] ${t.title}`,
        status: toDisplayStatus(t.status),
        purpose: t.purpose || '',
        targetPatterns: Array.isArray(t.targets) ? t.targets : [],
      }));
      changelog = store.listAdrs({ limit: 3 }).map((a) => ({
        date: a.date,
        title: `[${a.code}] ${a.title}`,
      }));
      patterns = store.listPatterns().map((p) => ({
        title: `[${p.code}] ${p.category || p.title} 패턴`,
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

  const activeTasks = tasks.filter((t) => t.status !== '완료');

  if (isCompact) {
    console.log(`[비-Git 환경] Git 변경 감지 비활성화 | 활성 태스크: ${activeTasks.length}건 | 누적 패턴: ${patterns.length}건`);
    activeTasks.forEach((t) => {
      console.log(`- [${t.status}] ${t.title}`);
    });
    return;
  }

  console.log('=======================================================');
  console.log('  Agent Context Memory 메모리 상태 점검 (비-Git 모드)');
  console.log('  [안내] Git 저장소가 아니거나 Git이 비활성화된 환경입니다.');
  console.log('         (파일 변경 감지 및 자동 커밋 비활성화, 메모리 뷰어 가동)');
  console.log('=======================================================\n');

  console.log(`[1] 작업 기억 정본 (${storageLabel}) - 활성 작업 ${activeTasks.length}건:`);
  if (activeTasks.length === 0) {
    console.log('    (현재 진행 중인 활성 태스크가 없습니다.)\n');
  } else {
    activeTasks.forEach((t, idx) => {
      console.log(`    ${idx + 1}. [${t.status}] ${t.title}`);
      if (t.purpose) console.log(`       목적: ${t.purpose}`);
      if (t.targetPatterns && t.targetPatterns.length > 0) {
        console.log(`       대상 영역: ${t.targetPatterns.join(', ')}`);
      }
    });
    console.log('');
  }

  console.log(`[2] 변경 이력 메모리 (project-changelog.md) - 최근 ${Math.min(changelog.length, 3)}건:`);
  if (changelog.length === 0) {
    console.log('    (기록된 최근 체인지로그가 없습니다.)\n');
  } else {
    changelog.slice(0, 3).forEach((c) => {
      console.log(`    - [${c.date}] ${c.title}`);
    });
    console.log('');
  }

  console.log(`[3] 축적된 설계 패턴 및 해결책 (patterns/) - 총 ${patterns.length}건:`);
  if (patterns.length === 0) {
    console.log('    (기록된 해결 패턴이 없습니다.)\n');
  } else {
    patterns.slice(0, 5).forEach((p) => {
      console.log(`    - ${p.title}: ${p.purpose}`);
    });
    console.log('');
  }

  console.log('=======================================================');
  console.log('  [비-Git 환경 작업 완료 안내]');
  console.log('  - 태스크 완료 시 사용자에게 검증 결과 보고 후 이관 여부를 확인받고,');
  console.log('    task-completed.md 로 이관하십시오.');
  console.log('=======================================================\n');
}

/**
 * 10. CLI 실행 엔트리포인트
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
      console.log('[안내] Git 환경이 아니므로 Git 커밋을 실행할 수 없습니다.');
      console.log('       작업 완료 후 사용자 확인을 득하여 task-completed.md로 이관하십시오.');
      process.exit(0);
    }
    reportNonGitMemoryStatus(isCompact);
    process.exit(0);
  }

  if (totalFiles === 0) {
    if (isCompact) {
      console.log('[CLEAN] 커밋할 변경사항 없음 (워킹 트리 깨끗함)');
    } else {
      console.log('=======================================================');
      console.log('  [안내] 현재 워킹 트리가 깨끗합니다. (커밋할 파일 없음)');
      console.log('=======================================================');
    }
    process.exit(0);
  }

  // 1) --compact 모드 (LLM 에이전트 초경량 토큰용)
  if (isCompact) {
    console.log(`[작업 단위 커밋 현황] 총 ${totalFiles}개 파일 / ${groups.length}개 작업`);
    groups.forEach((g, idx) => {
      const countLabel = g.sharedOnly
        ? `${g.sharedFiles.length}개 공유 파일`
        : `${g.files.length}개 파일`;
      console.log(`[작업 ${idx + 1}] ${g.status} | ${g.title} (${countLabel}) -> ${g.message.header}`);
    });
    process.exit(0);
  }

  // 2) --commit=<번호|TSK-XX> 지정 커밋 실행
  if (commitArg) {
    const rawVal = commitArg.split('=')[1].trim();
    let targetGroup = null;

    // A) 1부터 시작하는 그룹 순번 매칭 (예: --commit=1)
    const targetIdx = parseInt(rawVal, 10) - 1;
    if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < groups.length && !rawVal.toUpperCase().startsWith('TSK-')) {
      targetGroup = groups[targetIdx];
    } else {
      // B) TSK-XX 또는 taskNum 매칭 (예: --commit=TSK-26 또는 --commit=26)
      const normalizedTsk = rawVal.toUpperCase().startsWith('TSK-') ? rawVal.toUpperCase() : `TSK-${rawVal}`;
      targetGroup = groups.find((g) => g.tskId === normalizedTsk || g.taskNum === rawVal);
    }

    if (!targetGroup) {
      console.error(`[오류] 일치하는 작업 그룹을 찾을 수 없습니다: ${commitArg}`);
      process.exit(1);
    }
    const sha = executeCommitGroup(targetGroup);
    if (!sha) process.exit(1);
    process.exit(0);
  }

  // 3) --all 실행 시 '[커밋 대기]' 상태 태스크만 안전하게 순차 원자 커밋
  if (isAll) {
    const commitReadyGroups = groups.filter((g) => isTaskGroup(g) && g.status === '커밋 대기');
    const skippedGroups = groups.filter((g) => !(isTaskGroup(g) && g.status === '커밋 대기'));

    if (commitReadyGroups.length === 0) {
      console.error('=======================================================');
      console.error('  [중단] 현재 task.md에 "[커밋 대기]" 상태로 매칭된 작업이 없습니다.');
      console.error('         커밋할 작업을 task.md에 "[커밋 대기] TSK-X" 양식');
      console.error('         (목적 / 수행결과 / 대상영역)으로 먼저 기록한 뒤 실행하세요.');
      console.error('=======================================================\n');
      process.exit(1);
    }

    console.log('=======================================================');
    console.log(`  [커밋 대기 작업 순차 원자 커밋 시작] 총 ${commitReadyGroups.length}개 작업`);
    console.log('=======================================================\n');

    const results = [];
    for (let i = 0; i < commitReadyGroups.length; i++) {
      const g = commitReadyGroups[i];
      const sha = executeCommitGroup(g);
      if (!sha) {
        console.error(`\n[중단] 작업 ${i + 1} 커밋 중 오류가 발생하여 후속 작업을 중단합니다.`);
        process.exit(1);
      }
      results.push({ idx: i + 1, title: g.title, sha, header: g.message.header });
    }

    console.log('=======================================================');
    console.log(`  [완료] 총 ${results.length}개 작업의 개별 원자 커밋이 완료되었습니다.`);
    console.log('=======================================================');
    results.forEach((r) => {
      console.log(`- [작업 ${r.idx}] (SHA: ${r.sha}) ${r.header}`);
    });
    if (skippedGroups.length > 0) {
      const skippedFiles = skippedGroups.flatMap((g) => g.files.map((f) => f.file));
      console.log('-------------------------------------------------------');
      console.log(`[보존 안내] '[커밋 대기]' 태스크에 매핑되지 않은 파일 ${skippedFiles.length}건은`);
      console.log(`            오커밋 방지를 위해 워킹 트리에 안전하게 보존되었습니다:`);
      skippedFiles.forEach((file) => console.log(`  - ${file}`));
    }
    console.log('=======================================================\n');
    process.exit(0);
  }

  // 4) 표준 리포트 출력
  console.log('=======================================================');
  console.log('  Agent Context Memory 작업 단위(Task-Centric) 커밋 도구');
  console.log('  [대원칙] task.md 및 memory 문서를 기반으로 작업별 원자 커밋!');
  console.log('=======================================================\n');
  console.log(`[안내] 총 ${totalFiles}개 파일이 ${groups.length}개 작업 단위로 분류되었습니다:\n`);

  groups.forEach((g, idx) => {
    const fileList = g.sharedOnly ? g.sharedFiles : g.files;
    const countLabel = g.sharedOnly
      ? `선행 태스크와 ${fileList.length}개 파일 공유 - 커밋 시 직전 SHA로 자동 이관`
      : `${fileList.length}개 파일`;
    console.log(`-------------------------------------------------------`);
    console.log(`[작업 ${idx + 1}] [${g.status}] ${g.title} (${countLabel})`);
    console.log(`  출처: ${g.source}`);
    if (g.purpose) console.log(`  목적: ${g.purpose}`);
    console.log(`-------------------------------------------------------`);
    fileList.forEach((f) => {
      const renameNotice = f.isRename ? ` (이전: ${f.oldFile})` : '';
      const prefix = g.sharedOnly ? '[공유]' : f.code.padEnd(2);
      console.log(`  ${prefix} ${f.file}${renameNotice}`);
    });
    console.log(`\n  [자동 생성 커밋 메시지]:`);
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
  console.log('  [실행 옵션 안내]');
  console.log('  - 특정 작업만 커밋 : node scripts/group-status.cjs --commit=<작업번호>');
  console.log('  - 전체 순차 커밋   : node scripts/group-status.cjs --all');
  console.log('  - 에이전트 요약    : node scripts/group-status.cjs --compact');
  console.log('=======================================================\n');

  if (isDryRun) {
    console.log('[드라이런 완료] 커밋을 실행하지 않고 종료합니다.');
    process.exit(0);
  }

  // 5) 비대화형 환경(에이전트, CI 파이프라인 등) 감지 시 리포트 출력 후 즉시 정상 종료
  if (!process.stdin.isTTY) {
    console.log('[비대화형 세션] 대화형 프롬프트를 건너뛰고 정상 종료합니다.');
    console.log('               커밋 실행 시 --commit=<번호> 또는 --all 옵션을 사용하세요.\n');
    process.exit(0);
  }

  // 6) 터미널 대화형 입력 프롬프트 (TTY 환경)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('[선택] 커밋할 작업 번호를 입력하세요 (예: 1 또는 2, 전체는 all, 종료는 q): ', (answer) => {
    const trimmed = answer.trim().toLowerCase();
    rl.close();
    process.stdin.pause();

    if (trimmed === 'q' || trimmed === '') {
      console.log('[종료] 커밋 작업을 취소했습니다.');
      process.exit(0);
    }

    if (trimmed === 'all') {
      const readyGroups = groups.filter((g) => isTaskGroup(g) && g.status === '커밋 대기');
      if (readyGroups.length === 0) {
        console.error('\n[중단] task.md에 "[커밋 대기]" 상태로 매칭된 작업이 없습니다.');
        process.exit(1);
      }
      console.log(`\n[커밋 대기 작업 순차 원자 커밋 실행] 총 ${readyGroups.length}개 작업`);
      for (const g of readyGroups) {
        const sha = executeCommitGroup(g);
        if (!sha) {
          console.error('[오류 발생으로 중단됨]');
          process.exit(1);
        }
      }
      process.exit(0);
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1 || num > groups.length) {
      console.error(`[오류] 1부터 ${groups.length} 사이의 숫자를 입력해주세요.`);
      process.exit(1);
    }

    const sha = executeCommitGroup(groups[num - 1]);
    process.exit(sha ? 0 : 1);
  });
}

main();

/**
 * scripts/group-status.cjs
 *
 * Context Memorial 작업 단위(Task-Centric) 변경사항 자동 분류 및 커밋 실행 도구
 *
 * [참조 우선순위 정본]
 * 1순위: .agents/task/task.md 중 [커밋 대기] 및 [진행 중] 활성 작업
 * 2순위: .agents/memory/project_changelog.md (최근 날짜별 아키텍처/기능 변경 작업)
 * 3순위: .agents/memory/patterns/ (최신 설계 패턴 및 트러블슈팅 샤딩 정본)
 * 4순위: 잔여 파일 성격별(전역 인프라, UI/컴포넌트, 문서/규약, 도구 스크립트) 보조 그룹화
 *
 * [지원 CLI 옵션]
 *   node scripts/group-status.cjs                 : 대화형 작업 선택 및 커밋 프롬프트
 *   node scripts/group-status.cjs --dry-run       : 커밋 없이 작업별 분류 및 커밋 메시지 미리보기
 *   node scripts/group-status.cjs --compact       : 1줄 요약 출력 (LLM 에이전트 초경량 토큰용)
 *   node scripts/group-status.cjs --commit=<번호|TSK-번호> : 특정 작업 번호/TSK ID 단일 커밋 실행
 *   node scripts/group-status.cjs --all                   : 모든 작업을 순차적으로 개별 원자 커밋
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const ROOT_DIR = path.resolve(__dirname, '..');
const TASK_FILE = path.join(ROOT_DIR, '.agents', 'task', 'task.md');
const CHANGELOG_FILE = path.join(ROOT_DIR, '.agents', 'memory', 'project_changelog.md');
const PATTERNS_INDEX_FILE = path.join(ROOT_DIR, '.agents', 'memory', 'patterns_index.md');
const PATTERNS_DIR = path.join(ROOT_DIR, '.agents', 'memory', 'patterns');

/**
 * 1. Git 워킹 트리 변경 파일 파싱
 */
function getGitStatus() {
  try {
    const raw = execSync('git --no-pager status --porcelain=v1', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
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
          file: newFile,
          oldFile: oldFile,
          isRename: true,
        });
      } else {
        const file = rawPath.replace(/^"|"$/g, '').trim().replace(/\\/g, '/');
        list.push({
          code: code.trim(),
          file,
          isRename: false,
        });
      }
    }
    return list;
  } catch (err) {
    console.error('[오류] git status 실행 실패:', err.message);
    process.exit(1);
  }
}

/**
 * 2. .agents/task/task.md 파싱 (불릿 헤더 및 마크다운 H2~H4 헤더 양방향 지원)
 */
function parseTaskMd() {
  if (!fs.existsSync(TASK_FILE)) return [];
  try {
    const content = fs.readFileSync(TASK_FILE, 'utf-8');
    const tasks = [];
    const lines = content.split(/\r?\n/);

    let currentTask = null;
    let inTargetSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1) 불릿 헤더 감지: - [상태] **TSK-26. 작업명** 또는 - [상태] **26. 작업명**
      const bulletHeaderMatch = line.match(/^-\s*\[([^\]]*)\]\s*\*\*(?:(TSK-[0-9]+|[0-9]+)\.\s*)(.+?)\*\*/i);
      // 2) 마크다운 헤더 감지: ### TSK-1. 작업명 또는 ### 1. 작업명 (## ~ #### 허용)
      const mdHeaderMatch = !bulletHeaderMatch ? line.match(/^#{2,4}\s*(?:(TSK-[0-9]+|[0-9]+)\.\s*)(.+)$/i) : null;

      if (bulletHeaderMatch || mdHeaderMatch) {
        if (currentTask) tasks.push(currentTask);
        inTargetSection = false;

        const rawStatus = bulletHeaderMatch ? bulletHeaderMatch[1].trim() : '';
        const rawId = (bulletHeaderMatch ? bulletHeaderMatch[2] : mdHeaderMatch[1]).trim();
        const tskId = rawId.toUpperCase().startsWith('TSK-') ? rawId.toUpperCase() : `TSK-${rawId}`;
        const numOnly = rawId.replace(/[^0-9]/g, '');
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
          taskNum: numOnly,
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

      if (!currentTask) continue;

      // 목적 추출
      const purposeMatch = line.match(/^\s*-\s*\*\*목적\*\*:\s*(.+)$/);
      if (purposeMatch) {
        inTargetSection = false;
        currentTask.purpose = purposeMatch[1].trim();
        continue;
      }

      // 대상 영역 추출 (인라인 또는 하위 불릿 시작)
      const targetMatch = line.match(/^\s*-\s*\*\*대상\s*영역\*\*:\s*(.*)$/);
      if (targetMatch) {
        inTargetSection = true;
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

      // 대상 영역 하위 불릿 수집
      if (inTargetSection) {
        const subTargetMatch = line.match(/^\s{4,}-\s*`?([^`\r\n]+)`?/);
        if (subTargetMatch) {
          currentTask.targetPatterns.push(subTargetMatch[1].trim().replace(/\\/g, '/'));
          continue;
        } else if (line.match(/^\s*-\s*\*\*/)) {
          inTargetSection = false;
        }
      }

      // 세부 내용 불릿 수집
      const detailMatch = line.match(/^\s{4,}-\s*(.+)$/);
      if (detailMatch && !line.includes('**대상 영역**') && !line.includes('**목적**')) {
        const detailText = detailMatch[1].replace(/\*\*/g, '').trim();
        if (detailText.length > 5 && currentTask.details.length < 5) {
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
 * 3. .agents/memory/project_changelog.md 파싱
 */
function parseChangelog() {
  if (!fs.existsSync(CHANGELOG_FILE)) return [];
  try {
    const content = fs.readFileSync(CHANGELOG_FILE, 'utf-8');
    const sections = [];
    const dateBlocks = content.split(/^###\s*\[/m).slice(1);

    for (const block of dateBlocks) {
      const firstLineEnd = block.indexOf('\n');
      const headerLine = block.slice(0, firstLineEnd).trim();
      const headerMatch = headerLine.match(/^(?:(LOG-[A-Za-z0-9]+)\]\s*\[)?([0-9]{4}-[0-9]{2}-[0-9]{2})\]\s*(.+)$/);
      if (!headerMatch) continue;

      const logId = headerMatch[1] || '';
      const date = headerMatch[2];
      const title = headerMatch[3].trim();
      // 이미 커밋 해시가 부여된 과거 완료 항목은 변경사항 매칭 대상에서 제외
      if (/commit/i.test(title)) continue;

      // [기간 윈도우] 14일 이상 경과한 과거 changelog는 현재 변경사항 매칭 대상에서 제외
      const blockTime = new Date(date).getTime();
      const diffDays = (Date.now() - blockTime) / (1000 * 60 * 60 * 24);
      if (!isNaN(diffDays) && diffDays > 14) continue;

      const body = block.slice(firstLineEnd);

      // 백틱 경로 수집
      const backticks = body.match(/`([^`]+)`/g) || [];
      const targetPatterns = [];
      for (const b of backticks) {
        const clean = b.replace(/`/g, '').trim().replace(/\\/g, '/');
        if (clean.includes('/') || clean.endsWith('.js') || clean.endsWith('.jsx') || clean.endsWith('.css')) {
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
 * 4. .agents/memory/patterns/*.md 개별 샤딩 패턴 파싱 (캐싱 및 인덱스 기반 고속 파싱)
 */
function parseLearnedPatterns() {
  if (_cachedPatterns) {
    return _cachedPatterns;
  }

  const patterns = [];
  if (!fs.existsSync(PATTERNS_DIR)) return patterns;

  try {
    // 1) patterns_index.md가 존재하면 색인표 우선 파싱 (메타데이터 고속 확보)
    const indexMetaMap = new Map();
    if (fs.existsSync(PATTERNS_INDEX_FILE)) {
      const indexContent = fs.readFileSync(PATTERNS_INDEX_FILE, 'utf-8');
      const lines = indexContent.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\|\s*(P-[0-9]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
        if (match) {
          const id = match[1].trim();
          const category = match[2].trim();
          const summary = match[3].trim();
          const relPath = match[4].trim();
          const fileName = path.basename(relPath);
          indexMetaMap.set(fileName, { id, category, summary });
        }
      }
    }

    // 2) 샤딩 디렉터리 내 .md 파일 목록 파싱
    const files = fs.readdirSync(PATTERNS_DIR).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(PATTERNS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const meta = indexMetaMap.get(file);
      let id = meta ? meta.id : null;
      let category = meta ? meta.category : null;

      if (!id || !category) {
        const headerMatch = content.match(/^#\s*\[(P-[0-9]+)\]\s*(.+)$/m);
        if (!headerMatch) continue;
        id = headerMatch[1];
        category = headerMatch[2].trim();
      }

      const dateMatch = content.match(/\*\*일자\*\*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
      const date = dateMatch ? dateMatch[1] : '';

      const causeMatch = content.match(/\*\*증상 및 원인\*\*:\s*([^\r\n]+)/);
      const cause = causeMatch ? causeMatch[1].trim() : '';

      const patternMatch = content.match(/\*\*해결 패턴\*\*:\s*([^\r\n]+)/);
      const resolution = patternMatch ? patternMatch[1].trim() : '';

      const backticks = content.match(/`([^`]+)`/g) || [];
      const targetPatterns = backticks
        .map((b) => b.replace(/`/g, '').trim().replace(/\\/g, '/'))
        .filter((c) => c.includes('/') || c.endsWith('.js') || c.endsWith('.jsx') || c.endsWith('.css'));

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
  const normFile = filePath.replace(/\\/g, '/');
  const normPat = pattern.replace(/\\/g, '/');

  // 1) 정확한 완전 일치
  if (normFile === normPat) return true;

  // 2) 패턴이 명시적 디렉터리인 경우 (슬래시로 끝남, 예: 'src/pages/guide/')
  if (normPat.endsWith('/')) {
    return normFile.startsWith(normPat);
  }

  // 3) 패턴이 디렉터리 경로를 포함하고 확장자가 있는 경우 (단일 파일 정밀 매칭)
  if (normPat.includes('/') && normPat.includes('.')) {
    return normFile === normPat;
  }

  // 4) 패턴이 순수 파일명인 경우 (예: 'Component.jsx')
  if (!normPat.includes('/') && path.basename(normFile) === normPat) {
    return true;
  }

  return false;
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
    task.details.slice(0, 4).forEach((d) => bodyLines.push(`  - ${d}`));
  }

  return {
    header,
    body: bodyLines.join('\n'),
    full: bodyLines.length > 0 ? `${header}\n\n${bodyLines.join('\n')}` : header,
  };
}

/**
 * 7. 변경 파일들을 작업 단위로 분류 및 그룹화
 */
function classifyChanges() {
  const gitFiles = getGitStatus();
  if (gitFiles.length === 0) return { groups: [], totalFiles: 0 };

  const taskList = parseTaskMd();
  const changelogList = parseChangelog();

  const assigned = new Set();
  const groups = [];

  // [1단계] task.md 중 '커밋 대기' 및 '진행 중' 활성 작업만 1순위 매칭!
  const activeTasks = taskList.filter((t) => t.status === '커밋 대기' || t.status === '진행 중');
  const taskMatchedMap = new Map();
  activeTasks.forEach((t) => taskMatchedMap.set(t.id, []));

  // 1-1. 구체적 파일 패턴 우선 매칭 (단일 파일 경로 패턴)
  for (const task of activeTasks) {
    const filePatterns = task.targetPatterns.filter((p) => !p.endsWith('/'));
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
    const dirPatterns = task.targetPatterns.filter((p) => p.endsWith('/'));
    for (const f of gitFiles) {
      if (assigned.has(f.file)) continue;
      if (dirPatterns.some((pat) => isFileMatch(f.file, pat))) {
        taskMatchedMap.get(task.id).push(f);
        assigned.add(f.file);
      }
    }
  }

  // 매칭된 활성 태스크 등록
  for (const task of activeTasks) {
    const matchedFiles = taskMatchedMap.get(task.id);
    if (matchedFiles && matchedFiles.length > 0) {
      const msg = buildCommitMessage(task, matchedFiles);
      groups.push({
        id: task.id,
        taskNum: task.taskNum,
        tskId: task.tskId,
        title: task.title,
        status: task.status,
        source: 'task.md',
        purpose: task.purpose,
        files: matchedFiles,
        message: msg,
      });
    }
  }

  // [2단계] memory/project_changelog.md 최신순 매칭
  for (const sec of changelogList) {
    if (sec.targetPatterns.length === 0) continue;
    const matchedFiles = [];

    for (const f of gitFiles) {
      if (assigned.has(f.file)) continue;
      const hit = sec.targetPatterns.some((pat) => isFileMatch(f.file, pat));
      if (hit) {
        matchedFiles.push(f);
      }
    }

    if (matchedFiles.length > 0) {
      matchedFiles.forEach((f) => assigned.add(f.file));
      const msg = buildCommitMessage(sec, matchedFiles);
      groups.push({
        id: sec.id,
        title: sec.title,
        status: sec.status,
        source: 'project_changelog.md',
        purpose: sec.purpose,
        files: matchedFiles,
        message: msg,
      });
    }
  }

  // [3단계] memory/patterns/ 최신순 매칭 (지연 로딩: 잔여 미할당 파일이 있을 때만 파싱)
  if (assigned.size < gitFiles.length) {
    const patternsList = parseLearnedPatterns();
    for (const pat of patternsList) {
      if (pat.targetPatterns.length === 0) continue;
      const matchedFiles = [];

      for (const f of gitFiles) {
        if (assigned.has(f.file)) continue;
        const hit = pat.targetPatterns.some((p) => isFileMatch(f.file, p));
        if (hit) {
          matchedFiles.push(f);
        }
      }

      if (matchedFiles.length > 0) {
        matchedFiles.forEach((f) => assigned.add(f.file));
        const msg = buildCommitMessage(pat, matchedFiles);
        groups.push({
          id: pat.id,
          title: pat.title,
          status: pat.status,
          source: 'patterns/',
          purpose: pat.purpose,
          files: matchedFiles,
          message: msg,
        });
      }
    }
  }

  // [4단계] 잔여 파일 성격별 스마트 보조 그룹화
  const remainingFiles = gitFiles.filter((f) => !assigned.has(f.file));
  if (remainingFiles.length > 0) {
    const subBuckets = {
      rules: {
        title: '프로젝트 운영 규칙 및 거버넌스 규약 갱신',
        type: 'docs(rules)',
        purpose: 'GEMINI.md, AGENTS.md, README.md 등 거버넌스 및 규칙 문서 최신화',
        files: [],
      },
      memory: {
        title: '메모리얼 태스크 및 지식 베이스 동기화',
        type: 'docs(memory)',
        purpose: '작업 정본(task) 및 패턴/체인지로그(memory) 문서 갱신',
        files: [],
      },
      scripts: {
        title: '개발 및 자동화 스크립트 도구 갱신',
        type: 'chore(scripts)',
        purpose: '빌드, 형상관리 및 워크플로우 자동화 도구 개선',
        files: [],
      },
      ui: {
        title: 'UI 컴포넌트 및 스타일 레이아웃 보완',
        type: 'style(ui)',
        purpose: '디자인 토큰, 스타일시트 및 UI 컴포넌트 레이아웃 보완',
        files: [],
      },
      core: {
        title: '공통 설정 및 프로젝트 인프라 갱신',
        type: 'chore(core)',
        purpose: '패키지 매니페스트 및 전역 설정 파일 갱신',
        files: [],
      },
      misc: {
        title: '기타 보조 유지보수 및 파일 갱신',
        type: 'chore',
        purpose: '기타 개발 환경 및 보조 파일 갱신',
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
          status: '보조 작업',
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

  return { groups, totalFiles: gitFiles.length };
}

/**
 * 8. 특정 그룹 커밋 실행 함수 (안전한 파일 스테이징 및 분할 커밋)
 */
function executeCommitGroup(group) {
  console.log(`\n>>> [커밋 실행] ${group.title} (${group.files.length}개 파일)`);

  const filesToAdd = [];
  const filesToRemove = [];

  for (const f of group.files) {
    const fullPath = path.join(ROOT_DIR, f.file);
    if (fs.existsSync(fullPath)) {
      filesToAdd.push(f.file);
    } else {
      filesToRemove.push(f.file);
    }
  }

  // 1) 삭제된 파일 스테이징
  if (filesToRemove.length > 0) {
    const rmRes = spawnSync('git', ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...filesToRemove], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    if (rmRes.status !== 0) {
      console.error(`[오류] git rm 실패: ${group.title}`);
      return false;
    }
  }

  // 2) 신규/수정 파일 스테이징
  if (filesToAdd.length > 0) {
    const addRes = spawnSync('git', ['add', '--', ...filesToAdd], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    if (addRes.status !== 0) {
      console.error(`[오류] git add 실패: ${group.title}`);
      return false;
    }
  }

  // 3) git commit 실행 (stdin 기반 줄바꿈/한글 100% 무결 보존)
  const commitRes = spawnSync('git', ['commit', '-F', '-'], {
    cwd: ROOT_DIR,
    input: group.message.full,
    encoding: 'utf-8',
  });

  if (commitRes.status !== 0) {
    console.error(`[오류] git commit 실패:\n${commitRes.stderr || commitRes.stdout}`);
    return false;
  }

  // 4) 생성된 Commit SHA 조회
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
  } catch (e) {}

  console.log(`[성공] 커밋 완료! (SHA: ${sha})`);
  console.log(`       헤더: ${group.message.header}\n`);
  return sha;
}

/**
 * 9. CLI 실행 엔트리포인트
 */
function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('--status');
  const isCompact = args.includes('--compact') || args.includes('--summary');
  const isAll = args.includes('--all');
  const commitArg = args.find((a) => a.startsWith('--commit='));

  const { groups, totalFiles } = classifyChanges();

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
      console.log(`[작업 ${idx + 1}] ${g.status} | ${g.title} (${g.files.length}개 파일) -> ${g.message.header}`);
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

  // 3) --all 전체 순차 원자 커밋 실행
  if (isAll) {
    console.log('=======================================================');
    console.log(`  [전체 작업 순차 원자 커밋 시작] 총 ${groups.length}개 작업`);
    console.log('=======================================================\n');

    const results = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
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
    console.log('=======================================================\n');
    process.exit(0);
  }

  // 4) 표준 리포트 출력
  console.log('=======================================================');
  console.log('  Context Memorial 작업 단위(Task-Centric) 커밋 도구');
  console.log('  [대원칙] task.md 및 memory 문서를 기반으로 작업별 원자 커밋!');
  console.log('=======================================================\n');
  console.log(`[안내] 총 ${totalFiles}개 파일이 ${groups.length}개 작업 단위로 분류되었습니다:\n`);

  groups.forEach((g, idx) => {
    console.log(`-------------------------------------------------------`);
    console.log(`[작업 ${idx + 1}] [${g.status}] ${g.title} (${g.files.length}개 파일)`);
    console.log(`  출처: ${g.source}`);
    if (g.purpose) console.log(`  목적: ${g.purpose}`);
    console.log(`-------------------------------------------------------`);
    g.files.forEach((f) => {
      const renameNotice = f.isRename ? ` (이전: ${f.oldFile})` : '';
      console.log(`  ${f.code.padEnd(2)} ${f.file}${renameNotice}`);
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
      console.log('\n[전체 순차 커밋 실행]');
      for (const g of groups) {
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

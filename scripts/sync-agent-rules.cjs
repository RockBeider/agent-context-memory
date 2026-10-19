/**
 * scripts/sync-agent-rules.cjs
 *
 * 다양한 AI 코딩 에이전트(Claude Code, Gemini, Cursor, Windsurf 등)의
 * 규칙 파일(CLAUDE.md, GEMINI.md, AGENTS.md, .cursorrules 등)을 자동 스캔하고,
 * 부재 시 사용자 입력을 제안받아 Context Memorial 거버넌스 룰을 안전하게 주입/동기화하는 모듈
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PRESET_RULE_FILES = [
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  '.cursorrules',
  '.windsurfrules',
];

const START_MARKER = '<!-- CMS_GOVERNANCE_START -->';
const END_MARKER = '<!-- CMS_GOVERNANCE_END -->';

const GOVERNANCE_SNIPPET = `${START_MARKER}
# Context Memorial Guardrails
1. [정본] 작업 착수/완료는 반드시 \`.agents/task/task.md\`에만 기록 (\`TSK-X\` 영구 불변 채번, 5KB 상한).
2. [커밋] 일괄 스테이징(\`git add .\`) 절대 금지. 커밋은 반드시 \`node scripts/group-status.cjs\` 실행.
3. [지식] \`patterns/\` 전수 통조회 금지. \`patterns_index.md\` 요약열만 \`grep_search\`로 핀포인트 로딩.
4. [이관] 실제 Git 커밋 SHA 해시 확보 전 \`task_completed.md\` 조기 이관 절대 금지 (\`Commit: abc1234\` 필수).
5. [격리] 멀티 에이전트 동시 작업 시 \`task.md\`에 담당자 명기 및 파일 대상 영역 중첩 금지 (충돌 시 직렬화).
* 상세 규격 필요 시: [rules/MEMORIAL_GOVERNANCE.md](rules/MEMORIAL_GOVERNANCE.md) 참조.
${END_MARKER}`;


/**
 * 대상 디렉터리에서 사전 정의된 에이전트 규칙 파일들을 자동 스캔합니다.
 * @param {string} targetDir
 * @returns {string[]} 감지된 상대 파일 경로 목록
 */
function scanPresetRules(targetDir) {
  const detected = [];
  for (const file of PRESET_RULE_FILES) {
    const fullPath = path.join(targetDir, file);
    if (fs.existsSync(fullPath)) {
      detected.push(file);
    }
  }
  return detected;
}

/**
 * 지정된 파일에 거버넌스 마커 블록을 멱등하게 주입하거나 신규 생성합니다.
 * @param {string} filePath 파일의 절대 경로
 * @returns {{ file: string, created: boolean, updated: boolean }}
 */
function injectRuleToFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, GOVERNANCE_SNIPPET + '\n', 'utf-8');
    return { file: filePath, created: true, updated: false };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex !== -1 && endIndex !== -1) {
    // 기존 마커 블록 갱신
    const before = content.slice(0, startIndex).trimEnd();
    const after = content.slice(endIndex + END_MARKER.length).trimStart();
    const newContent = (before ? before + '\n\n' : '') + GOVERNANCE_SNIPPET + (after ? '\n\n' + after : '') + '\n';
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { file: filePath, created: false, updated: true };
  }

  // 마커가 없으면 기존 내용 보존하며 최상단에 주입
  const newContent = GOVERNANCE_SNIPPET + '\n\n---\n\n' + content.trimStart();
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { file: filePath, created: false, updated: true };
}

/**
 * 프리셋 미감지 시 사용자에게 규칙 파일명을 대화형으로 질의합니다.
 * @returns {Promise<string[]>}
 */
function promptCustomRuleFile() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n  [안내] 대상 프로젝트에서 기존 AI 에이전트 규칙 파일이 감지되지 않았습니다.');
    console.log('  대표 에이전트 예시: Claude(CLAUDE.md), Gemini(GEMINI.md), Cursor(.cursorrules), 표준(AGENTS.md)');
    rl.question('  -> 사용할 규칙 파일명을 입력하세요 (기본값: AGENTS.md, 쉼표 구분 다중 지정 가능): ', (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        return resolve(['AGENTS.md']);
      }
      const files = trimmed
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      resolve(files.length > 0 ? files : ['AGENTS.md']);
    });
  });
}

/**
 * 설치 대상 프로젝트의 타깃 규칙 파일 목록을 결정합니다.
 * 1. CLI 명시 옵션(--rule-file) 확인
 * 2. 프리셋 자동 스캔 (Scan First)
 * 3. 미감지 시 사용자 입력 제안 (Fallback Prompt)
 *
 * @param {string} targetDir
 * @param {object} options
 * @returns {Promise<string[]>} 결정된 타깃 규칙 파일명 목록
 */
async function resolveTargetRuleFiles(targetDir, options = {}) {
  let targetFiles = [];

  // 1단계: 명시적 CLI 인자 확인
  if (options.ruleFile) {
    if (Array.isArray(options.ruleFile)) {
      targetFiles = options.ruleFile;
    } else if (typeof options.ruleFile === 'string') {
      targetFiles = options.ruleFile
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    }
  }

  // 2단계: 미지정 시 프리셋 자동 스캔 우선 실행
  if (targetFiles.length === 0) {
    const scanned = scanPresetRules(targetDir);
    if (scanned.length > 0) {
      console.log(`  [자동 스캔] 기존 AI 에이전트 규칙 파일 ${scanned.length}건 감지: ${scanned.join(', ')}`);
      targetFiles = scanned;
    }
  }

  // 3단계: 여전히 없으면 사용자 입력 제안
  if (targetFiles.length === 0) {
    const isInteractive = process.stdin.isTTY && !options.nonInteractive;
    if (isInteractive) {
      targetFiles = await promptCustomRuleFile();
    } else {
      console.log('  [자동 폴백] 감지된 규칙 파일이 없어 표준 정본 AGENTS.md로 자동 설정합니다.');
      targetFiles = ['AGENTS.md'];
    }
  }

  return targetFiles;
}

/**
 * 결정된 타깃 파일들에 거버넌스 룰을 안전하게 주입하거나 신규 생성합니다.
 * @param {string} targetDir
 * @param {string[]} targetFiles
 * @returns {{ files: string[], actions: Array<{ file: string, created: boolean, updated: boolean }> }}
 */
function applyGovernanceRules(targetDir, targetFiles) {
  const actions = [];
  for (const relFile of targetFiles) {
    const fullPath = path.resolve(targetDir, relFile);
    const result = injectRuleToFile(fullPath);
    actions.push(result);
    const relResult = path.relative(targetDir, fullPath);
    if (result.created) {
      console.log(`  [규칙 생성] ${relResult} (Context Memorial 거버넌스 주입)`);
    } else {
      console.log(`  [규칙 동기화] ${relResult} (기존 내용 보존 및 거버넌스 갱신)`);
    }
  }
  return { files: targetFiles, actions };
}

/**
 * 통합 동기화 진입점
 */
async function syncAgentRules(targetDir, options = {}) {
  const targetFiles = await resolveTargetRuleFiles(targetDir, options);
  return applyGovernanceRules(targetDir, targetFiles);
}

module.exports = {
  PRESET_RULE_FILES,
  START_MARKER,
  END_MARKER,
  GOVERNANCE_SNIPPET,
  scanPresetRules,
  injectRuleToFile,
  promptCustomRuleFile,
  resolveTargetRuleFiles,
  applyGovernanceRules,
  syncAgentRules,
};

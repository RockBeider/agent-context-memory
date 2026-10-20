/**
 * scripts/sync-agent-rules.cjs
 *
 * 다양한 AI 코딩 에이전트(Claude Code, Gemini, Cursor, Windsurf 등)의
 * 규칙 파일(CLAUDE.md, GEMINI.md, AGENTS.md, .cursorrules 등)을 자동 스캔하고,
 * 부재 시 사용자 입력을 제안받아 Context Memorial 거버넌스 룰을 안전하게 주입/동기화하거나
 * 삭제(Uninstall) 시 내용 변조 감지(Drift Detection)를 거쳐 안전하게 절삭하는 모듈
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CMS_MANIFEST, getFullGovernanceSnippet } = require('./cms-manifest.cjs');

const PRESET_RULE_FILES = [
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  '.cursorrules',
  '.windsurfrules',
];

const START_MARKER = CMS_MANIFEST.governanceRules.startMarker;
const END_MARKER = CMS_MANIFEST.governanceRules.endMarker;
const EXPECTED_BODY = CMS_MANIFEST.governanceRules.expectedBody;
const GOVERNANCE_SNIPPET = getFullGovernanceSnippet();

/**
 * 줄바꿈 및 공백 차이를 배제하고 텍스트를 정규화합니다.
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

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
 * 파일 내 거버넌스 마커 내부 텍스트의 변조/수정(Drift) 여부를 전수 검사합니다.
 * @param {string} filePath
 * @returns {{ status: 'NOT_EXISTS' | 'NOT_FOUND' | 'EXACT_MATCH' | 'MODIFIED', actualBody?: string, expectedBody: string }}
 */
function checkRuleContentDrift(filePath) {
  if (!fs.existsSync(filePath)) {
    return { status: 'NOT_EXISTS', expectedBody: EXPECTED_BODY };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { status: 'NOT_FOUND', expectedBody: EXPECTED_BODY };
  }

  const actualRaw = content.slice(startIndex + START_MARKER.length, endIndex);
  const normalizedActual = normalizeText(actualRaw);
  const normalizedExpected = normalizeText(EXPECTED_BODY);

  if (normalizedActual === normalizedExpected) {
    return { status: 'EXACT_MATCH', actualBody: actualRaw, expectedBody: EXPECTED_BODY };
  }

  return { status: 'MODIFIED', actualBody: actualRaw, expectedBody: EXPECTED_BODY };
}

/**
 * 대화형으로 사용자에게 삭제 여부를 질의합니다.
 */
function promptConfirm(questionText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(questionText, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/**
 * 파일에서 거버넌스 룰 블록을 안전하게 절삭/제거합니다.
 * @param {string} filePath
 * @param {object} options { force: boolean, isInteractive: boolean }
 * @returns {Promise<{ file: string, status: 'SKIPPED' | 'PRESERVED' | 'CLEANED' | 'REMOVED_FILE', detail?: string }>}
 */
async function removeRuleFromFile(filePath, options = {}) {
  const force = Boolean(options.force);
  const isInteractive = typeof options.isInteractive === 'boolean'
    ? options.isInteractive
    : Boolean(process.stdin.isTTY);

  if (!fs.existsSync(filePath)) {
    return { file: filePath, status: 'SKIPPED', detail: '파일이 존재하지 않음' };
  }

  const driftResult = checkRuleContentDrift(filePath);

  if (driftResult.status === 'NOT_FOUND') {
    return { file: filePath, status: 'SKIPPED', detail: 'CMS 거버넌스 마커 미존재' };
  }

  // 내용이 원본과 다르게 수정되어 있는 경우 안전 확인 분기
  if (driftResult.status === 'MODIFIED' && !force) {
    const relName = path.basename(filePath);
    console.log(`\n  [경고] "${relName}" 내 CMS 거버넌스 블록 내용이 원본과 다르게 수정되어 있습니다.`);
    if (isInteractive) {
      const confirmed = await promptConfirm(`  -> 변경된 거버넌스 블록을 그래도 삭제하시겠습니까? (y/N): `);
      if (!confirmed) {
        console.log(`  [보존] 사용자 확인에 따라 "${relName}" 내 수정된 거버넌스 블록을 보존합니다.`);
        return { file: filePath, status: 'PRESERVED', detail: '사용자가 삭제 거부함' };
      }
    } else {
      console.log(`  [보존] 비대화형 세션에서 수정된 거버넌스 블록이 감지되어 안전하게 보존합니다. (강제 삭제: --force)`);
      return { file: filePath, status: 'PRESERVED', detail: '비대화형 세션 안전 보존' };
    }
  }

  // 마커 블록 절삭 실행
  const content = fs.readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  let before = content.slice(0, startIndex);
  let after = content.slice(endIndex + END_MARKER.length);

  // 주입 시 추가되었던 구분선(---) 및 연속 공백 정리
  after = after.replace(/^\s*---\s*(\r?\n)?/, '');
  before = before.replace(/(\r?\n)?\s*---\s*$/, '');

  const remaining = (before.trimEnd() + (after.trim() ? '\n\n' + after.trimStart() : '')).trim();

  // 절삭 후 파일 내용이 완전히 비어있으면 파일 자체 삭제
  if (!remaining) {
    fs.unlinkSync(filePath);
    return { file: filePath, status: 'REMOVED_FILE', detail: '거버넌스 외 내용이 없어 파일 삭제됨' };
  }

  // 타 내용(사용자 프롬프트)이 남아있으면 마커만 제거 후 보존
  fs.writeFileSync(filePath, remaining + '\n', 'utf-8');
  return { file: filePath, status: 'CLEANED', detail: '거버넌스 블록 제거 및 사용자 내용 보존' };
}

/**
 * 프리셋 미감지 시 사용자에게 규칙 파일명을 대화형으로 질의합니다.
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
 */
async function resolveTargetRuleFiles(targetDir, options = {}) {
  let targetFiles = [];

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

  if (targetFiles.length === 0) {
    const scanned = scanPresetRules(targetDir);
    if (scanned.length > 0) {
      console.log(`  [자동 스캔] 기존 AI 에이전트 규칙 파일 ${scanned.length}건 감지: ${scanned.join(', ')}`);
      targetFiles = scanned;
    }
  }

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
 * 대상 프로젝트의 규칙 파일들에서 거버넌스 룰을 안전하게 절삭합니다.
 */
async function removeGovernanceRules(targetDir, targetFiles = [], options = {}) {
  const candidates = targetFiles.length > 0 ? targetFiles : PRESET_RULE_FILES;
  const results = [];

  for (const relFile of candidates) {
    const fullPath = path.resolve(targetDir, relFile);
    if (!fs.existsSync(fullPath)) continue;

    const res = await removeRuleFromFile(fullPath, options);
    results.push(res);
    const relResult = path.relative(targetDir, fullPath);

    if (res.status === 'REMOVED_FILE') {
      console.log(`  [규칙 파일 삭제] ${relResult} (거버넌스 제거 후 빈 파일 정리)`);
    } else if (res.status === 'CLEANED') {
      console.log(`  [규칙 블록 절삭] ${relResult} (거버넌스 제거 및 사용자 프롬프트 보존)`);
    } else if (res.status === 'PRESERVED') {
      console.log(`  [규칙 보존] ${relResult} (${res.detail})`);
    }
  }

  return results;
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
  EXPECTED_BODY,
  GOVERNANCE_SNIPPET,
  normalizeText,
  scanPresetRules,
  injectRuleToFile,
  checkRuleContentDrift,
  removeRuleFromFile,
  removeGovernanceRules,
  promptCustomRuleFile,
  resolveTargetRuleFiles,
  applyGovernanceRules,
  syncAgentRules,
};

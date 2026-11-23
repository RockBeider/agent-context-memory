/**
 * scripts/storage/id-utils.cjs
 *
 * Agent Context Memory(ACM) 식별자(ULID / 순차 코드) 및 태스크 상태 양방향 변환 유틸리티
 */

const crypto = require('crypto');

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_TIME_LEN = 10;
const ULID_RAND_LEN = 16;

let lastUlidTime = -1;
let lastUlidRandDigits = null;

/**
 * 단조 증가 ULID(26자 Crockford Base32)를 생성합니다.
 * 동일 밀리초 내 연속 호출 시에도 사전식 정렬 순서가 깨지지 않도록 하위 랜덤 비트를 +1 증가시킵니다.
 *
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
function generateUlid(nowMs = Date.now()) {
  let timestamp = Math.max(0, Math.floor(Number.isFinite(nowMs) ? nowMs : Date.now()));
  let randDigits;

  if (timestamp <= lastUlidTime && lastUlidRandDigits) {
    timestamp = lastUlidTime;
    randDigits = lastUlidRandDigits.slice();
    let carry = 1;
    for (let i = ULID_RAND_LEN - 1; i >= 0 && carry > 0; i--) {
      const next = randDigits[i] + carry;
      if (next >= 32) {
        randDigits[i] = 0;
        carry = 1;
      } else {
        randDigits[i] = next;
        carry = 0;
      }
    }
    if (carry > 0) {
      timestamp = lastUlidTime + 1;
      randDigits = generateRandomBase32Digits();
    }
  } else {
    randDigits = generateRandomBase32Digits();
  }

  lastUlidTime = timestamp;
  lastUlidRandDigits = randDigits.slice();

  const timeChars = new Array(ULID_TIME_LEN);
  let t = timestamp;
  for (let i = ULID_TIME_LEN - 1; i >= 0; i--) {
    timeChars[i] = CROCKFORD_BASE32[t % 32];
    t = Math.floor(t / 32);
  }

  const randChars = randDigits.map((d) => CROCKFORD_BASE32[d]);
  return timeChars.join('') + randChars.join('');
}

/**
 * 균등 분포 5비트 Base32 숫자 16개를 생성합니다.
 */
function generateRandomBase32Digits() {
  const bytes = crypto.randomBytes(ULID_RAND_LEN);
  const digits = new Array(ULID_RAND_LEN);
  for (let i = 0; i < ULID_RAND_LEN; i++) {
    digits[i] = bytes[i] & 31;
  }
  return digits;
}

/**
 * 자연수 번호를 태스크 코드(TSK-X)로 포맷팅합니다.
 */
function formatTaskCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`유효하지 않은 태스크 번호입니다: ${num}`);
  }
  return `TSK-${n}`;
}

/**
 * 자연수 번호를 패턴 코드(P-XX)로 포맷팅합니다.
 */
function formatPatternCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`유효하지 않은 패턴 번호입니다: ${num}`);
  }
  return `P-${String(n).padStart(2, '0')}`;
}

/**
 * 자연수 번호를 ADR 코드(LOG-XX)로 포맷팅합니다.
 */
function formatAdrCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`유효하지 않은 ADR 번호입니다: ${num}`);
  }
  return `LOG-${String(n).padStart(2, '0')}`;
}

/**
 * 식별 코드(예: TSK-18, P-02, LOG-03)에서 자연수 번호를 추출합니다.
 * TSK-SAMPLE, P-00, LOG-00 등 양식 샘플이거나 0 이하인 경우 null을 반환합니다.
 *
 * @param {string|number} code
 * @param {string} [prefix]
 * @returns {number|null}
 */
function parseCodeNumber(code, prefix = '') {
  if (code === null || code === undefined) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized || normalized.includes('SAMPLE')) return null;

  const escapedPrefix = prefix ? String(prefix).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const regex = escapedPrefix
    ? new RegExp(`^(?:${escapedPrefix}-)?([0-9]+)$`)
    : /^(?:[A-Z]+-)?([0-9]+)$/;
  const match = normalized.match(regex);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

const VALID_CANONICAL_STATUSES = new Set(['todo', 'in_progress', 'ready', 'done', 'paused']);

/**
 * 한글/영문/체크박스 상태 표기를 정규 상태 코드로 변환합니다.
 * 반환값: 'todo' | 'in_progress' | 'ready' | 'done' | 'paused'
 */
function normalizeTaskStatus(raw) {
  if (raw === null || raw === undefined) return 'todo';
  const trimmed = String(raw).trim();
  if (!trimmed) return 'todo';

  const lower = trimmed.toLowerCase();
  if (VALID_CANONICAL_STATUSES.has(lower)) return lower;

  if (lower === 'x' || lower === 'done' || lower === 'completed' || trimmed === '완료') {
    return 'done';
  }
  if (lower === 'ready' || trimmed === '커밋 대기' || trimmed === '검증 완료') {
    return 'ready';
  }
  if (
    lower === 'in_progress' ||
    lower === 'in-progress' ||
    lower === 'working' ||
    trimmed === '진행 중' ||
    trimmed === '진행중' ||
    trimmed.startsWith('진행 중')
  ) {
    return 'in_progress';
  }
  if (lower === 'paused' || lower === 'blocked' || trimmed === '보류') {
    return 'paused';
  }
  if (lower === 'todo' || lower === 'pending' || trimmed === '진행 대기' || trimmed === '대기') {
    return 'todo';
  }
  return 'todo';
}

/**
 * 정규 상태 코드를 ACM 표준 한국어 표시 상태로 변환합니다.
 */
function toDisplayStatus(canonical) {
  const norm = normalizeTaskStatus(canonical);
  switch (norm) {
    case 'in_progress':
      return '진행 중';
    case 'ready':
      return '커밋 대기';
    case 'done':
      return '완료';
    case 'paused':
      return '보류';
    case 'todo':
    default:
      return '진행 대기';
  }
}

/**
 * 정규 상태 코드를 task.md 체크박스(`[...]`) 내부 표기로 변환합니다.
 */
function toMarkdownCheckbox(canonical) {
  const norm = normalizeTaskStatus(canonical);
  switch (norm) {
    case 'in_progress':
      return '진행 중';
    case 'ready':
      return '커밋 대기';
    case 'done':
      return 'x';
    case 'paused':
      return '보류';
    case 'todo':
    default:
      return ' ';
  }
}

module.exports = {
  CROCKFORD_BASE32,
  generateUlid,
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  normalizeTaskStatus,
  toDisplayStatus,
  toMarkdownCheckbox,
};

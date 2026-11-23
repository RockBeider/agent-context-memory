/**
 * scripts/storage/id-utils.cjs
 *
 * Agent Context Memory (ACM) identifier (ULID / sequential code) and
 * bidirectional task status normalization utilities.
 */

const crypto = require('crypto');
const { t, normalizeLanguage, DEFAULT_LANGUAGE } = require('../i18n.cjs');

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_TIME_LEN = 10;
const ULID_RAND_LEN = 16;

let lastUlidTime = -1;
let lastUlidRandDigits = null;

/**
 * Generates a monotonically increasing 26-character Crockford Base32 ULID.
 * Increments the lower random digits within the same millisecond to preserve lexical sort order.
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
  let tVal = timestamp;
  for (let i = ULID_TIME_LEN - 1; i >= 0; i--) {
    timeChars[i] = CROCKFORD_BASE32[tVal % 32];
    tVal = Math.floor(tVal / 32);
  }

  const randChars = randDigits.map((d) => CROCKFORD_BASE32[d]);
  return timeChars.join('') + randChars.join('');
}

/**
 * Generates 16 uniformly distributed 5-bit Base32 digits.
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
 * Formats a positive integer into a task code (TSK-X).
 */
function formatTaskCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(t('storage.invalidTaskNumber', { num }));
  }
  return `TSK-${n}`;
}

/**
 * Formats a positive integer into a pattern code (P-XX).
 */
function formatPatternCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(t('storage.invalidPatternNumber', { num }));
  }
  return `P-${String(n).padStart(2, '0')}`;
}

/**
 * Formats a positive integer into an ADR code (LOG-XX).
 */
function formatAdrCode(num) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(t('storage.invalidAdrNumber', { num }));
  }
  return `LOG-${String(n).padStart(2, '0')}`;
}

/**
 * Extracts the positive integer from an ACM code (e.g. TSK-18, P-02, LOG-03).
 * Returns null for format samples (TSK-SAMPLE, P-00, LOG-00) or non-positive numbers.
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
 * Normalizes English, Korean, or Markdown checkbox status labels to canonical status codes.
 * Returns: 'todo' | 'in_progress' | 'ready' | 'done' | 'paused'
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
  if (
    lower === 'ready' ||
    lower === 'commit ready' ||
    lower === 'ready to commit' ||
    lower === 'ready-to-commit' ||
    lower === 'commit-ready' ||
    trimmed === '커밋 대기' ||
    trimmed === '검증 완료'
  ) {
    return 'ready';
  }
  if (
    lower === 'in_progress' ||
    lower === 'in-progress' ||
    lower === 'in progress' ||
    lower === 'working' ||
    lower.startsWith('in progress') ||
    lower.startsWith('in_progress') ||
    lower.startsWith('in-progress') ||
    trimmed === '진행 중' ||
    trimmed === '진행중' ||
    trimmed.startsWith('진행 중') ||
    trimmed.startsWith('진행중')
  ) {
    return 'in_progress';
  }
  if (lower === 'paused' || lower === 'blocked' || lower === 'on hold' || trimmed === '보류') {
    return 'paused';
  }
  if (lower === 'todo' || lower === 'pending' || trimmed === '진행 대기' || trimmed === '대기') {
    return 'todo';
  }
  return 'todo';
}

/**
 * Converts a canonical status code into a localized display status label.
 */
function toDisplayStatus(canonical, lang = DEFAULT_LANGUAGE) {
  const norm = normalizeTaskStatus(canonical);
  const normLang = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  if (normLang === 'ko') {
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
  switch (norm) {
    case 'in_progress':
      return 'In Progress';
    case 'ready':
      return 'Ready';
    case 'done':
      return 'Done';
    case 'paused':
      return 'Paused';
    case 'todo':
    default:
      return 'Todo';
  }
}

/**
 * Converts a canonical status code into a task.md Markdown checkbox token ([...]).
 */
function toMarkdownCheckbox(canonical, lang = DEFAULT_LANGUAGE) {
  const norm = normalizeTaskStatus(canonical);
  const normLang = normalizeLanguage(lang) || DEFAULT_LANGUAGE;
  if (normLang === 'ko') {
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
  switch (norm) {
    case 'in_progress':
      return 'In Progress';
    case 'ready':
      return 'Ready';
    case 'done':
      return 'x';
    case 'paused':
      return 'Paused';
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

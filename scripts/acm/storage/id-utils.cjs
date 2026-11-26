/**
 * scripts/storage/id-utils.cjs
 *
 * Agent Context Memory (ACM) identifier (ULID / sequential code) and
 * bidirectional task status normalization utilities.
 */

const crypto = require('crypto');
const { t, normalizeLanguage, DEFAULT_LANGUAGE } = require('../i18n.cjs');

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ';
const SHORT_ID_LENGTH = 6;
const ULID_TIME_LEN = 10;
const ULID_RAND_LEN = 16;

const TASK_ID_REGEX_SOURCE = 'TSK-[A-Z0-9]+|[0-9]+';
const PATTERN_ID_REGEX_SOURCE = 'P-[A-Z0-9]+';
const ADR_ID_REGEX_SOURCE = 'LOG-[A-Z0-9]+';

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

const SHORT_ID_SUFFIX_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;
const SHORT_ID_PREFIX_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{2,4}$/;

/**
 * Normalizes entity prefix aliases (task/pattern/adr) to canonical TSK/P/LOG.
 */
function normalizeCodePrefix(prefix) {
  const p = String(prefix || '').trim().toUpperCase();
  if (p === 'TSK' || p === 'TASK') return 'TSK';
  if (p === 'P' || p === 'PAT' || p === 'PATTERN') return 'P';
  if (p === 'LOG' || p === 'ADR') return 'LOG';
  return p;
}

/**
 * Generates an unbiased Crockford Base32 short token starting with an alpha character.
 *
 * @param {number} [length=SHORT_ID_LENGTH]
 * @returns {string}
 */
function generateShortToken(length = SHORT_ID_LENGTH) {
  const len = Math.max(1, Math.floor(Number(length) || SHORT_ID_LENGTH));
  const alphaLen = CROCKFORD_ALPHA.length;
  const maxUnbiased = Math.floor(256 / alphaLen) * alphaLen;

  let firstChar = '';
  while (!firstChar) {
    const buf = crypto.randomBytes(16);
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] < maxUnbiased) {
        firstChar = CROCKFORD_ALPHA[buf[i] % alphaLen];
        break;
      }
    }
  }

  if (len === 1) return firstChar;

  const restBytes = crypto.randomBytes(len - 1);
  let rest = '';
  for (let i = 0; i < len - 1; i++) {
    rest += CROCKFORD_BASE32[restBytes[i] & 31];
  }
  return firstChar + rest;
}

/**
 * Generates a prefixed short-id code (e.g. TSK-K7M29A, P-M3N8Q2, LOG-R9A4C1).
 */
function generateShortCode(prefix) {
  const norm = normalizeCodePrefix(prefix);
  if (norm !== 'TSK' && norm !== 'P' && norm !== 'LOG') {
    throw new Error(`Invalid ACM code prefix: ${prefix}`);
  }
  return `${norm}-${generateShortToken(SHORT_ID_LENGTH)}`;
}

function generateTaskCode() {
  return generateShortCode('TSK');
}

function generatePatternCode() {
  return generateShortCode('P');
}

function generateAdrCode() {
  return generateShortCode('LOG');
}

/**
 * Returns true if the input represents a non-real sample or zero placeholder code.
 */
function isSampleCode(raw) {
  if (raw === null || raw === undefined) return false;
  const normalized = String(raw).trim().toUpperCase();
  if (!normalized) return false;
  if (normalized.includes('SAMPLE')) return true;
  return /^(?:(?:TSK|P|LOG)-)?0+$/.test(normalized);
}

/**
 * Validates whether a suffix matches the 6-character alpha-first short-id format.
 */
function isShortIdSuffix(suffix) {
  if (suffix === null || suffix === undefined) return false;
  return SHORT_ID_SUFFIX_RE.test(String(suffix).trim().toUpperCase());
}

function formatSequentialByPrefix(prefix, num) {
  if (prefix === 'TSK') return formatTaskCode(num);
  if (prefix === 'P') return formatPatternCode(num);
  if (prefix === 'LOG') return formatAdrCode(num);
  return `${prefix}-${num}`;
}

/**
 * Parses both legacy sequential codes (TSK-18, P-02, LOG-03) and new short-id codes (TSK-K7M29A).
 * Returns null for template samples (TSK-SAMPLE, P-00, LOG-00) or invalid codes.
 *
 * @param {string|number} raw
 * @param {string} [expectedPrefix='']
 * @returns {{prefix: string, kind: 'sequential'|'short', num: number|null, suffix: string, code: string}|null}
 */
function parseCode(raw, expectedPrefix = '') {
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).trim().toUpperCase();
  if (!normalized || isSampleCode(normalized)) return null;

  const expPrefix = expectedPrefix ? normalizeCodePrefix(expectedPrefix) : '';
  const prefixedMatch = normalized.match(/^(TSK|P|LOG)-([A-Z0-9]+)$/);

  let prefix = '';
  let suffix = '';

  if (prefixedMatch) {
    prefix = prefixedMatch[1];
    suffix = prefixedMatch[2];
    if (expPrefix && prefix !== expPrefix) return null;
  } else if (expPrefix && /^[A-Z0-9]+$/.test(normalized)) {
    prefix = expPrefix;
    suffix = normalized;
  } else {
    return null;
  }

  if (/^[0-9]+$/.test(suffix)) {
    const num = parseInt(suffix, 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    return {
      prefix,
      kind: 'sequential',
      num,
      suffix,
      code: formatSequentialByPrefix(prefix, num),
    };
  }

  if (isShortIdSuffix(suffix)) {
    return {
      prefix,
      kind: 'short',
      num: null,
      suffix,
      code: `${prefix}-${suffix}`,
    };
  }

  return null;
}

/**
 * Normalizes a lookup input into either an exact canonical code or a 3-5 char short-id prefix query.
 */
function normalizeCodeInput(raw, prefix) {
  const expPrefix = normalizeCodePrefix(prefix);
  const parsed = parseCode(raw, expPrefix);
  if (parsed) {
    return {
      exactCode: parsed.code,
      prefixQuery: null,
      parsed,
    };
  }

  if (raw === null || raw === undefined || !expPrefix) {
    return { exactCode: null, prefixQuery: null, parsed: null };
  }

  const upper = String(raw).trim().toUpperCase();
  if (!upper || isSampleCode(upper)) {
    return { exactCode: null, prefixQuery: null, parsed: null };
  }

  let candidate = upper;
  const prefixed = upper.match(/^(TSK|P|LOG)-(.+)$/);
  if (prefixed) {
    if (prefixed[1] !== expPrefix) {
      return { exactCode: null, prefixQuery: null, parsed: null };
    }
    candidate = prefixed[2];
  } else if (/^[A-Z]+-/.test(upper)) {
    return { exactCode: null, prefixQuery: null, parsed: null };
  }

  if (SHORT_ID_PREFIX_RE.test(candidate)) {
    return {
      exactCode: null,
      prefixQuery: `${expPrefix}-${candidate}`,
      parsed: null,
    };
  }

  return { exactCode: null, prefixQuery: null, parsed: null };
}

/**
 * Sorts mixed legacy sequential and short-id records consistently by createdAt, legacy number, then UID/code.
 */
function compareRecordsByTimeAndCode(a, b, prefix = '', desc = false) {
  const dir = desc ? -1 : 1;
  const ta = Date.parse((a && a.createdAt) || '') || 0;
  const tb = Date.parse((b && b.createdAt) || '') || 0;
  if (ta !== tb) return (ta - tb) * dir;

  const na = parseCodeNumber(a && a.code, prefix);
  const nb = parseCodeNumber(b && b.code, prefix);
  if (na !== null && nb !== null && na !== nb) {
    return (na - nb) * dir;
  }

  const ua = String((a && (a.uid || a.code)) || '');
  const ub = String((b && (b.uid || b.code)) || '');
  return ua.localeCompare(ub) * dir;
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

  const unwrapped = trimmed.replace(/^\[(.*)\]$/, '$1').trim();
  const stripped = unwrapped.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!stripped) return 'todo';

  const lower = stripped.toLowerCase();
  if (VALID_CANONICAL_STATUSES.has(lower)) return lower;

  if (lower === 'x' || lower === 'done' || lower === 'completed' || stripped === '완료') {
    return 'done';
  }
  if (
    lower === 'ready' ||
    lower === 'commit ready' ||
    lower === 'ready to commit' ||
    lower === 'ready-to-commit' ||
    lower === 'commit-ready' ||
    stripped === '커밋 대기' ||
    stripped === '검증 완료'
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
    stripped === '진행 중' ||
    stripped === '진행중' ||
    stripped.startsWith('진행 중') ||
    stripped.startsWith('진행중')
  ) {
    return 'in_progress';
  }
  if (lower === 'paused' || lower === 'blocked' || lower === 'on hold' || stripped === '보류') {
    return 'paused';
  }
  if (lower === 'todo' || lower === 'pending' || stripped === '진행 대기' || stripped === '대기') {
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
  CROCKFORD_ALPHA,
  SHORT_ID_LENGTH,
  TASK_ID_REGEX_SOURCE,
  PATTERN_ID_REGEX_SOURCE,
  ADR_ID_REGEX_SOURCE,
  generateUlid,
  generateShortToken,
  generateShortCode,
  generateTaskCode,
  generatePatternCode,
  generateAdrCode,
  formatTaskCode,
  formatPatternCode,
  formatAdrCode,
  parseCodeNumber,
  isSampleCode,
  isShortIdSuffix,
  parseCode,
  normalizeCodeInput,
  compareRecordsByTimeAndCode,
  normalizeTaskStatus,
  toDisplayStatus,
  toMarkdownCheckbox,
};

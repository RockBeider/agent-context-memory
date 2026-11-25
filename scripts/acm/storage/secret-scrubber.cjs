/**
 * scripts/storage/secret-scrubber.cjs
 *
 * Outbound Secret Scrubber for shared memory sync (Git orphan branch, remote DB, etc.).
 * Redacts API keys, tokens, private keys, and credentials idempotently before persistence.
 */

const SECRET_RULES = [
  {
    type: 'PRIVATE_KEY',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => '[REDACTED:PRIVATE_KEY]',
  },
  {
    type: 'AWS_ACCESS_KEY',
    regex: /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/g,
    replace: () => '[REDACTED:AWS_ACCESS_KEY]',
  },
  {
    type: 'GITHUB_TOKEN',
    regex: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,
    replace: () => '[REDACTED:GITHUB_TOKEN]',
  },
  {
    type: 'ANTHROPIC_KEY',
    regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    replace: () => '[REDACTED:ANTHROPIC_KEY]',
  },
  {
    type: 'OPENAI_KEY',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: () => '[REDACTED:OPENAI_KEY]',
  },
  {
    type: 'GOOGLE_API_KEY',
    regex: /\bAIza[0-9A-Za-z_-]{32,48}\b/g,
    replace: () => '[REDACTED:GOOGLE_API_KEY]',
  },
  {
    type: 'SLACK_TOKEN',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    replace: () => '[REDACTED:SLACK_TOKEN]',
  },
  {
    type: 'DB_URI_CREDENTIAL',
    regex: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/g,
    replace: (match, prefix, pass, at) => {
      if (pass.startsWith('[REDACTED:')) return null;
      return `${prefix}[REDACTED:DB_URI_CREDENTIAL]${at}`;
    },
  },
  {
    type: 'BEARER_TOKEN',
    regex: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi,
    replace: (match, prefix, token) => {
      if (token.startsWith('[REDACTED:')) return null;
      return `${prefix}[REDACTED:BEARER_TOKEN]`;
    },
  },
  {
    type: 'GENERIC_SECRET_ASSIGN',
    regex: /\b([A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|AGENTMEMORY_SECRET|ACM_REMOTE_TOKEN|DB_PASSWORD|CLIENT_SECRET|PRIVATE_KEY|PASSWORD)\s*[:=]\s*["']?)([^\s"'`,;}\]]{8,})(["']?)/gi,
    replace: (match, prefix, value, suffix) => {
      if (value.startsWith('[REDACTED:')) return null;
      return `${prefix}[REDACTED:GENERIC_SECRET_ASSIGN]${suffix}`;
    },
  },
];

const IMMUTABLE_KEYS = new Set([
  'uid',
  'code',
  'supersedesUid',
  'createdAt',
  'updatedAt',
  'completedAt',
  'deletedAt',
  'commitSha',
  'date',
  'scope',
  'provenance',
  'status',
]);

/**
 * Redacts known secret patterns from a single string idempotently.
 *
 * @param {string} text
 * @returns {{ text: string, redactedCount: number, types: string[] }}
 */
function scrubText(text) {
  if (typeof text !== 'string' || !text) {
    return { text: text || '', redactedCount: 0, types: [] };
  }

  let out = text;
  let redactedCount = 0;
  const typesSet = new Set();

  for (const rule of SECRET_RULES) {
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, (...args) => {
      const replacement = rule.replace(...args);
      if (replacement === null || replacement === args[0]) {
        return args[0];
      }
      redactedCount += 1;
      typesSet.add(rule.type);
      return replacement;
    });
  }

  return {
    text: out,
    redactedCount,
    types: Array.from(typesSet),
  };
}

function scrubNode(value, typesSet, keyName = '') {
  if (typeof value === 'string') {
    if (keyName && IMMUTABLE_KEYS.has(keyName)) {
      return { value, count: 0 };
    }
    const res = scrubText(value);
    res.types.forEach((tp) => typesSet.add(tp));
    return { value: res.text, count: res.redactedCount };
  }

  if (Array.isArray(value)) {
    let total = 0;
    const nextArr = value.map((item) => {
      const sub = scrubNode(item, typesSet, '');
      total += sub.count;
      return sub.value;
    });
    return { value: nextArr, count: total };
  }

  if (value && typeof value === 'object') {
    let total = 0;
    const nextObj = {};
    for (const [k, v] of Object.entries(value)) {
      if (IMMUTABLE_KEYS.has(k)) {
        nextObj[k] = v;
      } else {
        const sub = scrubNode(v, typesSet, k);
        total += sub.count;
        nextObj[k] = sub.value;
      }
    }
    return { value: nextObj, count: total };
  }

  return { value, count: 0 };
}

/**
 * Deep-clones and scrubs all mutable string fields in a record object.
 *
 * @param {object} record
 * @returns {{ record: object, redactedCount: number, types: string[] }}
 */
function scrubRecord(record) {
  if (!record || typeof record !== 'object') {
    return { record, redactedCount: 0, types: [] };
  }
  const typesSet = new Set();
  const res = scrubNode(record, typesSet, '');
  return {
    record: res.value,
    redactedCount: res.count,
    types: Array.from(typesSet),
  };
}

/**
 * Scrubs an array of records and aggregates redaction statistics.
 *
 * @param {object[]} records
 * @returns {{ records: object[], redactedCount: number, types: string[] }}
 */
function scrubRecords(records = []) {
  const typesSet = new Set();
  let redactedCount = 0;
  const cleaned = (Array.isArray(records) ? records : []).map((rec) => {
    const res = scrubRecord(rec);
    redactedCount += res.redactedCount;
    res.types.forEach((tp) => typesSet.add(tp));
    return res.record;
  });
  return {
    records: cleaned,
    redactedCount,
    types: Array.from(typesSet),
  };
}

module.exports = {
  SECRET_RULES,
  IMMUTABLE_KEYS,
  scrubText,
  scrubRecord,
  scrubRecords,
};

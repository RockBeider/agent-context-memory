#!/usr/bin/env node
/**
 * @file acm-token-monitor.cjs
 * @description Antigravity PreInvocation hook script.
 *              Measures session transcript (transcript.jsonl) file size with zero model tokens
 *              and injects proactive threshold alerts (deduplicated via MD5 state cache).
 *              Self-contained with zero external imports to guarantee crash-free hook execution.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MESSAGES = {
  en: {
    alert: (sizeKB, estTokens) =>
      `[Context Saturation Alert] Session log reached ~${sizeKB}KB (~${estTokens.toLocaleString()} tokens). Wrapping up the current task, updating task.md, and starting a new session is strongly recommended.`,
    warn: (sizeKB) =>
      `[Context Notice] Session log reached ~${sizeKB}KB. Avoid full-file reads and stick to sliced reads (lines 1-35) where possible.`,
  },
  ko: {
    alert: (sizeKB, estTokens) =>
      `[컨텍스트 포화 경고] 세션 누적 로그가 약 ${sizeKB}KB (약 ${estTokens.toLocaleString()} 토큰)에 도달했습니다. 현재 작업 일단락 후 /태스크(task.md) 정리 및 새 세션 분리를 강력히 권장합니다.`,
    warn: (sizeKB) =>
      `[컨텍스트 주의] 세션 누적 로그가 약 ${sizeKB}KB에 진입했습니다. 파일 전체 읽기를 지양하고 상위 30~40라인 슬라이스 조회를 유지하십시오.`,
  },
};

function normalizeLang(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'ko' || s.startsWith('ko-') || s === 'korean') return 'ko';
  if (s === 'en' || s.startsWith('en-') || s === 'english') return 'en';
  return null;
}

function resolveHookLanguage() {
  const fromEnv = normalizeLang(process.env.ACM_LANG);
  if (fromEnv) return fromEnv;

  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    path.join(workspaceRoot, '.agents', 'acm', 'config.json'),
    path.join(workspaceRoot, '.agents', 'acm', 'meta.json'),
    path.join(workspaceRoot, '.agents', 'config.json'),
    path.join(workspaceRoot, '.agents', '.acm-meta.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const lang = normalizeLang(data && data.language);
        if (lang) return lang;
      }
    } catch (_) {}
  }
  return 'en';
}

function getStateFilePath(transcriptPath) {
  const hash = crypto.createHash('md5').update(transcriptPath).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `acm_token_monitor_${hash}.json`);
}

function getPreviousAlertLevel(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      return data.level || 'none';
    }
  } catch (_) {}
  return 'none';
}

function saveAlertLevel(stateFile, level) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ level, updatedAt: Date.now() }), 'utf-8');
  } catch (_) {}
}

function main() {
  let rawInput = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    rawInput += chunk;
  });

  process.stdin.on('end', () => {
    try {
      if (!rawInput.trim()) {
        console.log(JSON.stringify({}));
        return;
      }

      const payload = JSON.parse(rawInput);
      const transcriptPath = payload.transcriptPath;

      if (!transcriptPath || !fs.existsSync(transcriptPath)) {
        console.log(JSON.stringify({}));
        return;
      }

      const stats = fs.statSync(transcriptPath);
      const sizeKB = Math.round(stats.size / 1024);
      const stateFile = getStateFilePath(transcriptPath);
      const previousLevel = getPreviousAlertLevel(stateFile);

      // Evaluate threshold tier
      let currentLevel = 'none';
      if (sizeKB >= 500) {
        currentLevel = 'alert';
      } else if (sizeKB >= 200) {
        currentLevel = 'warn';
      }

      // Suppress duplicate alerts when tier has not changed
      if (currentLevel === previousLevel) {
        console.log(JSON.stringify({}));
        return;
      }

      saveAlertLevel(stateFile, currentLevel);

      const lang = resolveHookLanguage();
      const msgMap = MESSAGES[lang] || MESSAGES.en;

      if (currentLevel === 'alert') {
        const estTokens = Math.round((sizeKB / 4.5) * 1000);
        console.log(
          JSON.stringify({
            injectSteps: [
              {
                ephemeralMessage: msgMap.alert(sizeKB, estTokens),
              },
            ],
          })
        );
        return;
      }

      if (currentLevel === 'warn') {
        console.log(
          JSON.stringify({
            injectSteps: [
              {
                ephemeralMessage: msgMap.warn(sizeKB),
              },
            ],
          })
        );
        return;
      }

      console.log(JSON.stringify({}));
    } catch (_) {
      // Output empty JSON so hook errors never interrupt the agent loop
      console.log(JSON.stringify({}));
    }
  });
}

main();

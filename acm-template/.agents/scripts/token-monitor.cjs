#!/usr/bin/env node
/**
 * @file token-monitor.cjs
 * @description Antigravity PreInvocation 훅 스크립트.
 *              세션 트랜스크립트(transcript.jsonl) 파일 크기를 0 토큰(순수 OS 프로세스)으로 측정하여
 *              컨텍스트 팽창 시 선제 알림을 주입합니다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getStateFilePath(transcriptPath) {
  const hash = crypto.createHash('md5').update(transcriptPath).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `agy_token_monitor_${hash}.json`);
}

function getPreviousAlertLevel(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      return data.level || 'none';
    }
  } catch {}
  return 'none';
}

function saveAlertLevel(stateFile, level) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ level, updatedAt: Date.now() }), 'utf-8');
  } catch {}
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

      // 단계별 임계치 판정
      let currentLevel = 'none';
      if (sizeKB >= 500) {
        currentLevel = 'alert';
      } else if (sizeKB >= 200) {
        currentLevel = 'warn';
      }

      // 이전 경고 레벨과 동일하면 중복 알림 주입 억제 (노이즈 방지)
      if (currentLevel === previousLevel) {
        console.log(JSON.stringify({}));
        return;
      }

      // 상태 저장
      saveAlertLevel(stateFile, currentLevel);

      // 500KB 초과: 세션 분리 및 압축 강력 권고
      if (currentLevel === 'alert') {
        const estTokens = Math.round((sizeKB / 4.5) * 1000);
        console.log(
          JSON.stringify({
            injectSteps: [
              {
                ephemeralMessage: `[컨텍스트 포화 경고] 세션 누적 로그가 약 ${sizeKB}KB (약 ${estTokens.toLocaleString()} 토큰)에 도달했습니다. 현재 작업 일단락 후 task.md 정리 및 새 세션 분리를 강력히 권장합니다.`,
              },
            ],
          })
        );
        return;
      }

      // 200KB ~ 500KB: 주의 단계 (슬라이스 조회 권장)
      if (currentLevel === 'warn') {
        console.log(
          JSON.stringify({
            injectSteps: [
              {
                ephemeralMessage: `[컨텍스트 주의] 세션 누적 로그가 약 ${sizeKB}KB에 진입했습니다. 파일 전체 읽기를 지양하고 상위 30~40라인 슬라이스 조회를 유지하십시오.`,
              },
            ],
          })
        );
        return;
      }

      // 200KB 미만: 정상 통과
      console.log(JSON.stringify({}));
    } catch (e) {
      // 훅 내부 오류 발생 시에도 에이전트 루프가 중단되지 않도록 빈 객체 출력
      console.log(JSON.stringify({}));
    }
  });
}

main();

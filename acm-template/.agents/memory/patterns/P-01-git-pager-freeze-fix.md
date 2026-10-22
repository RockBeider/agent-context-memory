# [P-01] 대화형 Pager로 인한 Git CLI 프로세스 프리징 방지

- **식별자**: P-01
- **분류**: Git / 도구 환경
- **등록일**: 2026-10-19
- **관련 파일**: `scripts/group-status.cjs`, `scripts/smart-pull.cjs`

---

## 1. 증상 (Symptom)
- 에이전트 또는 자동화 스크립트가 `git diff`, `git log`, `git status` 등의 터미널 명령어를 실행했을 때, 결과 출력이 끝나지 않고 터미널 프로세스가 무한 대기(Timeout 또는 Freeze)에 빠짐.

## 2. 원인 (Root Cause)
- Git의 기본 환경설정에서 긴 출력이 발생할 경우 터미널 Pager(예: `less`, `more`)를 구동하여 사용자 키 입력을 대기함. 비대화형(Headless) 에이전트 런타임 환경에서는 키 입력을 전달할 수 없어 데드락 발생.

## 3. 해결책 (Solution)
- 모든 Git CLI 실행 시 환경 변수 `GIT_PAGER=cat` 및 `PAGER=cat`을 강제 설정하거나, `--no-pager` 플래그를 필수 적용함.

```javascript
// Node.js child_process 실행 시 안전 패턴 예시
const { execSync } = require('child_process');

const output = execSync('git --no-pager status --porcelain=v1', {
  cwd: process.cwd(),
  encoding: 'utf-8',
  env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' }
});
```

## 4. 검증 및 회귀 방지
- 터미널 출력량이 수백 줄 이상인 `git diff` 상황에서도 프로세스가 즉시 반환되는지 확인 완료.

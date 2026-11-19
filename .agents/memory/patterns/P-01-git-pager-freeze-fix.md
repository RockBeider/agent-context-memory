# [P-01] 대화형 Pager로 인한 Git CLI 프로세스 프리징 방지

- **일자**: 2026-10-19
- **도메인 분류**: Git / 도구 환경
- **증상 및 원인**: 비대화형 에이전트 환경에서 `git diff`, `git log` 등 긴 출력 발생 시 기본 터미널 Pager(`less`, `more`)가 키 입력을 무한 대기하여 프로세스 데드락 발생.
- **해결 패턴**: 모든 Git CLI 및 `child_process` 실행 시 환경 변수 `GIT_PAGER: 'cat'`, `PAGER: 'cat'`을 주입하고 `git --no-pager` 플래그를 강제 적용.
- **연관 파일**: `scripts/group-status.cjs`, `scripts/smart-pull.cjs`, `scripts/audit-push.cjs`

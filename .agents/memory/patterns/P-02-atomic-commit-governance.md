# [P-02] 작업 단위(Task-Centric) 원자적 커밋 거버넌스 및 자동 분류

- **일자**: 2026-10-19
- **도메인 분류**: 형상 관리 거버넌스
- **증상 및 원인**: 다중 기능 수정 시 `git add .` 일괄 스테이징으로 무관한 변경이 단일 커밋에 혼재되어 원자적 롤백과 히스토리 추적이 불가능해짐.
- **해결 패턴**: `task.md`에 `[커밋 대기]` 상태와 3요소(`목적`, `수행결과`, `대상영역`)를 명시하고 `node scripts/group-status.cjs --all`을 통해 태스크 단위로 분할 스테이징·커밋 및 `task-completed.md` 자동 이관 수행.
- **연관 파일**: `scripts/group-status.cjs`, `.agents/task/task.md`, `.agents/task/task-completed.md`

<!-- ACM_GOVERNANCE_START -->
# Context Memory Guardrails
1. [정본] 작업 착수/완료는 반드시 `.agents/task/task.md`에만 기록 (`TSK-X` 영구 불변 채번, 5KB 상한).
2. [커밋] 일괄 스테이징(`git add .`) 절대 금지. 커밋은 반드시 `node scripts/group-status.cjs` 실행.
3. [지식] `patterns/` 전수 통조회 금지. `patterns-index.md` 요약열만 `grep_search`로 핀포인트 로딩.
4. [이관] Git 환경은 커밋 SHA(`Commit: abc1234`) 확보 전 이관 금지. 비-Git 환경은 수동 이관 허용 및 사용자 승인 확인 후 이관 (`(Completed: YYYY-MM-DD / Non-Git)`).
5. [격리] 멀티 에이전트 동시 작업 시 `task.md`에 담당자 명기 및 파일 대상 영역 중첩 금지 (충돌 시 직렬화).
6. [규칙] 프로젝트 전용 규칙은 루트 `AGENTS.md`의 `# Project Execution Rules` 하위에만 추가 (`rules/MEMORY_GOVERNANCE.md`에는 ACM 자체 거버넌스만 작성).
7. [격리] 배포 템플릿인 `acm-template/` 하위 파일(규칙/스크립트 등)은 명시적 지시 없이 임의/연계 수정 절대 금지.
* 상세 규격 필요 시: [rules/MEMORY_GOVERNANCE.md](rules/MEMORY_GOVERNANCE.md) 참조.
<!-- ACM_GOVERNANCE_END -->

---

# Project Execution Rules
<!-- 프로젝트 고유 실행 규칙, 코딩 표준, 비즈니스 가이드라인은 본 영역 하위에 작성합니다. -->

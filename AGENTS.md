<!-- ACM_GOVERNANCE_START -->
# Context Memory Guardrails
1. [정본] 작업 착수/완료는 반드시 `.agents/task/task.md`에만 기록 (`TSK-X` 영구 불변 채번, 5KB 상한).
2. [커밋] 일괄 스테이징(`git add .`) 절대 금지. 커밋은 반드시 `node scripts/group-status.cjs` 실행.
3. [지식] `patterns/` 전수 통조회 금지. `patterns-index.md` 요약열만 `grep_search`로 핀포인트 로딩.
4. [이관] Git 환경은 커밋 SHA(`Commit: abc1234`) 확보 전 이관 금지. 비-Git 환경은 수동 이관 허용 및 사용자 승인 확인 후 이관 (`(Completed: YYYY-MM-DD / Non-Git)`).
5. [격리] 멀티 에이전트 동시 작업 시 `task.md`에 담당자 명기 및 파일 대상 영역 중첩 금지 (충돌 시 직렬화).
* 상세 규격 필요 시: [rules/MEMORY_GOVERNANCE.md](rules/MEMORY_GOVERNANCE.md) 참조.
<!-- ACM_GOVERNANCE_END -->

---

# Project Execution Rules

## 1. 단계별 승인 게이트 (Phase/Task Gate Protocol)
- 계획서(`implementation_plan.md`)가 단계(Phases) 형태로 분할되어 진행되는 경우, 특정 단계가 완료된 후 임의로 다음 단계를 연속하여 진행하지 않는다.
- 각 단계 종료 시마다 검증 결과를 사용자에게 보고하고, 다음 단계 진행 여부(승인)를 확인받은 후에만 후속 작업에 착수한다.

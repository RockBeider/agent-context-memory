<!-- CMS_GOVERNANCE_START -->
# Context Memorial Guardrails
1. [정본] 작업 착수/완료는 반드시 `.agents/task/task.md`에만 기록 (`TSK-X` 영구 불변 채번, 5KB 상한).
2. [커밋] 일괄 스테이징(`git add .`) 절대 금지. 커밋은 반드시 `node scripts/group-status.cjs` 실행.
3. [지식] `patterns/` 전수 통조회 금지. `patterns_index.md` 요약열만 `grep_search`로 핀포인트 로딩.
4. [이관] 실제 Git 커밋 SHA 해시 확보 전 `task_completed.md` 조기 이관 절대 금지 (`Commit: abc1234` 필수).
5. [격리] 멀티 에이전트 동시 작업 시 `task.md`에 담당자 명기 및 파일 대상 영역 중첩 금지 (충돌 시 직렬화).
* 상세 규격 필요 시: [rules/MEMORIAL_GOVERNANCE.md](rules/MEMORIAL_GOVERNANCE.md) 참조.
<!-- CMS_GOVERNANCE_END -->

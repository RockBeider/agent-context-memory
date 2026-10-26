# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. Git 환경은 커밋 SHA 획득 전, 비-Git 환경은 사용자 승인 확인 전 task-completed.md로의 조기 이관을 금지합니다.

---

## 활성 태스크 목록

### TSK-13. ACM 거버넌스 규칙 및 템플릿 수정 방지 가드레일 추가
- **상태**: [커밋 대기]
- **담당**: Agent
- **대상 영역**: `rules/MEMORY_GOVERNANCE.md`, `AGENTS.md`
- **작업 내용**:
  - `rules/MEMORY_GOVERNANCE.md`에 ACM 전용 규칙 한정 및 `acm-template/` 수정 금지 가드 문구 추가
  - `AGENTS.md` Context Memory Guardrails에 규칙 분리 및 템플릿 보호 조항 추가

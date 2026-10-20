# Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task_completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

- [커밋 대기] **TSK-7. Context Memory System 명칭 리팩토링 및 CLI/템플릿 일관성 정비**
  - **담당**: Antigravity Agent
  - **목적**: 인지과학 표준 및 AI 에이전트 용어에 맞춰 Context Memory System으로 명칭 및 식별자 전면 개편
  - **대상 영역**: package.json, bin/, rules/, scripts/, cms_template/, README.md, AGENTS.md, .agents/task/
  - 세부 목표:
    1. package.json 패키지명(context-memory-system) 및 bin 갱신 (context-memory 및 하위 호환 별칭)
    2. CLI 진입점 파일 bin/context-memory.js 생성/갱신
    3. rules/MEMORIAL_GOVERNANCE.md -> rules/MEMORY_GOVERNANCE.md 리네임 및 템플릿 동기화
    4. cms-manifest.cjs 등 단일 정본 및 자동화 스크립트 경로/로그 갱신
    5. README.md, AGENTS.md 문서 내 명칭/가드레일 전면 갱신
    6. 동작 검증 및 원자적 커밋 완료


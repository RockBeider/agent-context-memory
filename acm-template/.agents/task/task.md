# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task-completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

### TSK-1. Agent Context Memory 도입 및 초기 프로젝트 형상 점검
- **상태**: [진행 중]
- **등록일**: 2026-10-19
- **우선순위**: P1 (Critical)
- **대상 영역**: `package.json`, `README.md`, `rules/MEMORY_GOVERNANCE.md`
- **목적**: 프로젝트에 3계층 인지 메모리 거버넌스를 정착시키고 초기 형상 관리 환경을 검증한다.
- **세부 작업**:
  - [ ] package.json 내 git:* 스크립트 동작 확인 (`npm run git:status`)
  - [ ] 프로젝트 룰 문서(`GEMINI.md`, `AGENTS.md`)에 거버넌스 규격 반영
  - [ ] 신규 기능 개발 태스크 발급 및 작업 단위 커밋 테스트

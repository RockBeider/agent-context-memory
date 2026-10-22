# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task-completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

### TSK-9. 프로젝트 명칭, 약어 및 하이픈 전환 리팩토링 (agent-context-memory, acm)
- **상태**: [커밋 대기]
- **등록일**: 2026-10-22
- **담당자**: Antigravity Pair Programmer
- **대상 영역**: `package.json`, `bin/`, `scripts/`, `cms_template/` -> `acm-template/`, `rules/`, `AGENTS.md`, `README.md`, `.gitignore`, `docs/`, `.agents/`
- **세부 작업**:
  - [x] 계획서 승인 획득 (`implementation_plan.md`)
  - [x] Git 추적 기반 디렉터리 및 파일 이동 (`git mv`)
  - [x] 패키지 메타데이터(`package.json`) 및 CLI 진입점(`bin/`) 갱신
  - [x] 단일 정본 매니페스트(`acm-manifest.cjs`) 및 4대 실행 엔진 갱신
  - [x] 거버넌스 규칙(`MEMORY_GOVERNANCE.md`), `AGENTS.md`, `README.md` 갱신
  - [x] 런타임 테스트 및 무결성 검증



# Context Memorial Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task_completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

### TSK-5. Git 감지 기반 .gitignore 자동 생성 및 .agent 엔트리 동기화
- **상태**: [커밋 대기]
- **등록일**: 2026-10-19
- **우선순위**: P2 (Normal)
- **대상 영역**: `scripts/install-template.cjs`, `.gitignore`, `.agents/task/task.md`
- **목적**: 템플릿 설치 시 Git 환경이 확인되면 대상 프로젝트의 .gitignore에 .agent 등록을 멱등하게 자동 추가하고, 파일 부재 시 신규 생성한다.
- **세부 작업**:
  - [x] TSK-5 작업 등록 및 요구사항 분석
  - [x] scripts/install-template.cjs 내 updateGitIgnore 모듈 구현 및 파이프라인 연동
  - [x] 프로젝트 루트 .gitignore 생성 및 표준 무시 규칙 정의
  - [x] 멱등성 및 파일 생성 단위 시뮬레이션 테스트 검증
  - [x] 작업 완료 검증 및 커밋 대기 상태 전이







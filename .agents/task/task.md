# Context Memorial Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task_completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

### TSK-6. 주입 명세(Manifest) 및 내용 대조(Drift Detection) 기반 패키지 삭제(Uninstall) 롤백 엔진 구축
- **상태**: [커밋 대기]
- **등록일**: 2026-10-20
- **우선순위**: P1 (Critical)
- **담당자**: Main Agent
- **대상 영역**: `scripts/cms-manifest.cjs`, `scripts/uninstall-template.cjs`, `scripts/install-template.cjs`, `scripts/sync-agent-rules.cjs`, `bin/context-memorial.js`, `package.json`, `README.md`, `cms_template/`, `.agents/task/task.md`
- **목적**: CMS 자산(디렉터리, 스크립트, 규칙 문서, package.json 커맨드, .gitignore, 에이전트 마커 룰)의 통합 매니페스트 구축 및 내용 변조 감지(Drift Detection) 기반의 무결한 롤백/언인스톨러 파이프라인 개발
- **세부 작업**:
  - [x] TSK-6 작업 발급 및 implementation_plan.md 승인
  - [x] scripts/cms-manifest.cjs 주입 상세 명세 모듈 구축 및 cms_template 동기화
  - [x] scripts/sync-agent-rules.cjs 내용 대조(Drift Detection) 및 안전 확인 절삭 모듈 구현
  - [x] scripts/install-template.cjs 매니페스트 참조 주입 리팩토링
  - [x] scripts/uninstall-template.cjs 5단계 롤백 엔진 구현 및 cms_template 동기화
  - [x] bin/context-memorial.js 및 package.json CLI/스크립트 연동
  - [x] README.md 설치/삭제 라이프사이클 가이드 문서화
  - [x] 가상 프로젝트 환경에서 설치/변조감지/안전삭제 롤백 통합 검증

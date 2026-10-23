# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. Git 환경은 커밋 SHA 획득 전, 비-Git 환경은 사용자 승인 확인 전 task-completed.md로의 조기 이관을 금지합니다.

---

## 활성 태스크 목록

### TSK-10. npm 패키지 배포 명세 정비 및 라이선스 법적 정본화
- **상태**: [커밋 대기]
- **등록일**: 2026-10-23
- **우선순위**: P0 (Blocker)
- **대상 영역**: `LICENSE`, `package.json`, `README.md`, `bin/`, `scripts/`, `acm-template/`, `rules/`, `tests/`, `.agents/task/task.md`
- **목적**: npm 패키지 공개 배포의 법적 필수 요건인 MIT 표준 라이선스 문서를 정본화하고 package.json 배포 명세를 표준화한다.
- **세부 작업**:
  - [x] MIT 라이선스 전문 작성 (`LICENSE` 파일 신설, Author: Rock Beider, Year: 2026)
  - [x] 라이선스 파일 인코딩(UTF-8) 및 권리 명세 검증
  - [x] package.json 메타데이터 보강 (repository, bugs, homepage, publishConfig, files)
  - [x] package.json scripts에 test 및 prepublishOnly 연동
  - [x] bin/agent-context-memory.js Git 실행 비트(+x / 100755) 갱신 및 검증
  - [x] bin/agent-context-memory.js 서브커맨드(commit, pull, resolve, audit) 프록시 및 help 갱신
  - [x] scripts 및 acm-template 내 ACM_ROOT_DIR 환경변수 기반 동적 탐색 및 폴백 연동
  - [x] scripts/check-git.cjs 환경 진단 엔진 고도화 (OS Git 및 저장소 여부 분리 진단)
  - [x] scripts/group-status.cjs 비-Git 메모리 뷰어 모드(Graceful Fallback) 탑재
  - [x] bin/agent-context-memory.js 비-Git 환경 방어 및 친절한 안내 로직 연동
  - [x] 비-Git 환경 완료 이관 규약 및 사용자 승인 게이트 표준화 (AGENTS.md, MEMORY_GOVERNANCE.md, acm-manifest.cjs)
  - [x] 비-Git 호환성 검증 테스트 스위트 작성 및 npm test 연동



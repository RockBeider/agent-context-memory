# Context Memorial Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task_completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

### TSK-1. 배포 자산 cms_template 분리 및 템플릿 인스톨러 구축
- **상태**: [커밋 대기]
- **등록일**: 2026-10-19
- **우선순위**: P1 (Critical)
- **대상 영역**: `cms_template/`, `scripts/install-template.cjs`, `package.json`, `README.md`
- **목적**: 배포용 순수 템플릿과 본 패키지 자체 개발 환경을 격리하고 템플릿 자동 설치 CLI를 구축한다.
- **세부 작업**:
  - [x] cms_template 배포 자산 디렉터리 스캐폴딩 및 클린 템플릿 정제
  - [x] scripts/install-template.cjs 설치 스크립트 구현
  - [x] 루트 task.md를 본 패키지 개발용 도그푸딩 정본으로 전환
  - [ ] package.json 스크립트 및 README.md 가이드 동기화

### TSK-2. npx CLI 실행 지원 및 독립 패키지 배포 준비
- **상태**: [ ]
- **등록일**: 2026-10-19
- **우선순위**: P2 (Normal)
- **대상 영역**: `bin/`, `package.json`
- **목적**: npx context-memorial init 형태로 실행 가능한 npm 글로벌 CLI 실행 환경을 구성한다.
- **세부 작업**:
  - [ ] package.json 내 bin 필드 정의 및 진입점 연결
  - [ ] npm 패키지 배포 파일 화이트리스트(.npmignore 또는 files 필드) 설정
  - [ ] npx 로컬 시뮬레이션 테스트 검증

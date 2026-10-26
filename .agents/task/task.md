# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. Git 환경은 커밋 SHA 획득 전, 비-Git 환경은 사용자 승인 확인 전 task-completed.md로의 조기 이관을 금지합니다.

---

## 활성 태스크 목록

### [커밋 대기] TSK-12: dist 배포 파이프라인 정제 및 불필요 스크립트 제외
- **목표**: dist 브랜치 및 배포 산출물에서 sync-dist-branch.cjs 및 불필요한 scripts(dist:*, test 등)를 제외하고 무중단 배포 정제 엔진 구축
- **담당자**: Assistant
- **범위**: `scripts/sync-dist-branch.cjs`, `.npmignore`
- **세부 작업**:
  - [x] scripts/sync-dist-branch.cjs 내 배포 제외 파일(sync-dist-branch.cjs) 필터링 및 Git Plumbing 기반 package.json 정제 로직 구현
  - [x] .npmignore 작성으로 npm 패키지 레벨 배포 제외 처리
  - [x] npm test 및 dist 브랜치 동기화 검증 (dist 트리에서 sync-dist-branch.cjs 제외 및 scripts 정제 확인 완료)


# Agent Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. Git 환경은 커밋 SHA 획득 전, 비-Git 환경은 사용자 승인 확인 전 task-completed.md로의 조기 이관을 금지합니다.

---

## 활성 태스크 목록

- [커밋 대기] **TSK-11. dist 배포 브랜치 신설 및 npm 패키지 격리 파이프라인 구축**
  - 담당: Antigravity
  - 등록일: 2026-10-26
  - 대상 영역: `scripts/sync-dist-branch.cjs`, `package.json`, `.github/workflows/release-dist.yml`, `rules/MEMORY_GOVERNANCE.md`, `acm-template/rules/MEMORY_GOVERNANCE.md`, `.agents/task/task.md`
  - 수행 계획: package.json의 files 필드 기반 배포 파일 자동 동기화 엔진 구현, GitHub Actions release-dist 워크플로우 구축, dist 브랜치 생성 및 무결성 검증, 거버넌스 규칙 문서 갱신.




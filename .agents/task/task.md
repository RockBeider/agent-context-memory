# Context Memory Task Master (작업 단일 정본)

> [!IMPORTANT]
> **거버넌스 원칙 (Rule)**:
> 1. 본 문서는 현재 활성화된 작업만을 관리하는 단일 정본(Single Source of Truth)입니다. (최대 5KB 유지)
> 2. 태스크 번호(`TSK-{자연수}`)는 영구 불변이며, 신규 발급 시 전체(완료 포함) 최대 번호 + 1을 부여합니다.
> 3. 상태 라이프사이클: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
> 4. 터미널에서 실제 Git 커밋 SHA를 획득하기 전에는 본 파일에서 `task_completed.md`로 조기 이관을 절대 금지합니다.

---

## 활성 태스크 목록

- [커밋 대기] **TSK-8. 레거시 memorial 파일 영구 삭제 및 코드/템플릿 전수 클린업**
  - **담당**: Antigravity Agent
  - **목적**: 기존 사용처가 없는 신규 시스템 특성을 반영하여 레거시 memorial 파일 및 코드/문서 내 잔여 표기를 영구 제거하고 클린한 Memory 규격으로 단일화
  - **대상 영역**: bin/, rules/, cms_template/, package.json, scripts/, README.md, .agents/
  - 세부 목표:
    1. bin/context-memorial.js, rules/MEMORIAL_GOVERNANCE.md, cms_template/rules/MEMORIAL_GOVERNANCE.md 파일 삭제
    2. package.json bin 별칭 및 cms-manifest.cjs 엔트리 제거
    3. scripts/group-status.cjs 및 cms_template 내 '메모리얼' 한글 표기 정규화
    4. cms_template/.agents/ 및 .agents/ 내 태스크/스킬/체인지로그 문서 전수 클린업
    5. README.md 내 하위 호환 별칭 설명 제거 및 단일 정본 반영
    6. 동작 검증 및 원자적 커밋 완료


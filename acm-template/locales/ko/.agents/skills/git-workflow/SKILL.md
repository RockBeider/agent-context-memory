---
name: git-workflow
description: 작업 단위(Task-Centric) 자동 분류 커밋, 지능형 3-Way 풀, 원격 배포 위생 감사 파이프라인
---

# Git Workflow Governance Skill (형상 관리 및 릴리즈 파이프라인)

본 스킬은 3계층 인지 메모리 거버넌스([MEMORY_GOVERNANCE.md](../../MEMORY_GOVERNANCE.md))를 준수하며 원격 동기화, 실무 품질 게이트, 작업 단위 원스톱 커밋 및 푸시 위생 감사를 안전하게 수행하는 표준 실행 매뉴얼입니다.

---

## 1. 표준 형상 관리 파이프라인

### 1단계: 원격 동기화 (단순 pull 및 스마트 풀)
충돌 위험도와 작업 성격에 맞추어 유연하게 동기화를 수행합니다.

1. **단순 최신화 (충돌 없는 일반 상황)**:
   ```bash
   git pull
   ```
   - 일상적인 원격 변경사항 반영은 표준 Git 명령어를 우선 사용합니다.
2. **원스톱 스마트 풀 (충돌 위험 또는 복합 브랜치 결합)**:
   ```bash
   npm run git:pull
   ```
   - `fetch`, 인메모리 3-Way 가상 사전 진단, 자동 병합, 충돌 시 하이브리드 결합까지 일괄 수행합니다 (`node scripts/smart-pull.cjs`).
3. **충돌 발생 시 전용 해소**:
   ```bash
   npm run git:resolve
   ```
   - 이미 충돌(Unmerged) 상태인 경우 하이브리드 결합 규칙으로 해소합니다 (`node scripts/smart-pull.cjs --resolve`).

---

### 2단계: 실무 최적화 품질 게이트 (영향도 기반 선별 검증)
과도한 반복 빌드로 인한 자원 낭비를 방지하고, 영향도에 따라 선별 검증합니다.

1. **상시 필수 게이트 - 충돌 마커 및 공백 결함 검증**:
   ```bash
   git --no-pager diff --check
   ```
   - 소스 내 미해결 충돌 마커(`<<<<<<<`) 및 불필요한 공백 결함 0건 상시 필수 검증.
2. **조건부 게이트 - 정적 빌드 및 테스트 무결성**:
   ```bash
   npm test
   # 또는 프로젝트 빌드 스크립트 (npm run build)
   ```
   - 코어 모듈, 공통 설정, 다수 업무 로직이 변경되어 브레이킹 체인지 위험이 있을 때만 푸시 전 수행 (단순 문서, 주석, 단일 파일 경미 수정 시 생략 가능).

---

### 3단계: 로컬 작업 단위 원스톱 커밋 (Task-Centric One-Shot Commit)
무관한 파일을 한꺼번에 묶는 임의 커밋(`git add .`)을 금지하고, **"`task.md` `[커밋 대기]` 3요소 기록 -> 사용자 명시적 커밋 승인 후 `npm run git:commit` 원스톱 실행"** 순서로 완결합니다.

1. **`task.md` `[커밋 대기]` 선행 기록 및 3요소 작성 (필수)**:
   - 커밋할 작업을 `.agents/task/task.md`에 `[커밋 대기] TSK-XXXXXX` 상태로 등록(`acm task add` / `acm id` / MCP 발급) 또는 갱신합니다.
   - `group-status.cjs`가 `task.md`의 내용을 파싱하여 커밋 메시지를 생성하고 완료 이관을 수행하므로, 아래 **3요소(목적 / 수행결과 / 대상영역)**를 빠짐없이 작성합니다:
     ```markdown
     ### [작업 소제목]
     - [커밋 대기] **TSK-XXXXXX. 핵심 작업 요약 제목**
       - **등록일**: YYYY-MM-DD
       - **목적**: 작업 배경 및 핵심 변경 목적 1줄 요약
       - **수행결과**:
         - `파일경로1`: 구체적인 로직/문서 수정 내역 요약
         - `파일경로2`: 구체적인 로직/문서 수정 내역 요약
       - **대상영역**:
         - `파일경로1`
         - `파일경로2`
     ```
2. **원스톱 작업 단위 커밋 실행 (명시적 커밋 지시 후 단 1회 호출)**:
   ```bash
   npm run git:commit
   ```
   - `npm run git:commit` (`node scripts/group-status.cjs --all`)은 `task.md`의 `[커밋 대기]` 상태인 태스크들만 선별하여 **① `git diff --cached --check` 검증 -> ② 태스크별 개별 원자 커밋 (`SHA` 획득) -> ③ `.agents/task/task-completed.md` 자동 완료 이관 및 `task.md` 정리**까지 일괄 완결합니다. (매핑되지 않은 미등록 파일은 오커밋 방지를 위해 워킹 트리에 안전하게 보존됩니다.)
   - **기타 실행 옵션**:
     - 커밋 없이 분류 및 커밋 메시지 미리보기: `npm run git:status` (`node scripts/group-status.cjs --dry-run`)
     - 초경량 1줄 요약 조회: `npm run git:summary` (`node scripts/group-status.cjs --compact`)
     - 특정 태스크만 선택 커밋: `node scripts/group-status.cjs --commit=<번호|TSK-XXXXXX|접두사>`
3. **`.agents/` 로컬 전용 문서 2차 커밋 금지 (호스트 프로젝트)**:
   - `.gitignore`에 의해 `.agents/`가 제외된 호스트 프로젝트에서는 커밋 완료 후 `.agents/` 문서를 Git에 커밋하려는 추가 명령을 실행하지 마십시오.

---

### 4단계: 원격 푸시 전 위생 감사 (Audit-Push)
원격 저장소로 `git push`하기 직전에 실행하여 임시 파일, 디버그 잔재, 미해결 충돌 마커를 최종 차단합니다.

```bash
npm run git:audit-push
```

---

## 2. 사후 검증 연계
- 커밋 및 푸시 전후의 형상 무결성을 독립 세션에서 점검하기 위해 `git-release-sentinel` 서브 에이전트를 호출하여 2차 감사를 수행할 수 있습니다.

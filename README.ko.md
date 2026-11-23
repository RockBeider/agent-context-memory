# Agent Context Memory (ACM)

[English](./README.md) | **한국어**

Production-grade Three-Tier Context Memory & Task-Centric Git Engine for AI Coding Agents.

AI 코딩 에이전트(Antigravity IDE, Claude Code, Cursor, Windsurf, Codex, Copilot 등) 환경에서 컨텍스트 윈도우 한계로 인한 기억 소실(Context Amnesia)과 대규모 일괄 커밋(`git add .`)으로 인한 형상 관리 오염을 원천 차단하는 **3계층 인지 메모리 거버넌스 시스템(Three-Tier Memory Model)**입니다.

Git 환경과의 완벽한 유기적 결합(작업 단위 원자적 분할 커밋, 커밋 직후 `task-completed.md` 무인 자동 이관, 지능형 3-Way 병합)은 물론, **Git이 없는 환경(Git 미설치 또는 비-저장소 디렉터리)에서도 크래시 없이 100% 가동되는 메모리 뷰어 및 사용자 승인 게이트(Graceful Fallback)**를 제공합니다.

---

## 1. 아키텍처 개요 및 라이프사이클

본 시스템은 인간의 인지 구조(작업 기억, 장기 기억, 콜드 아카이브)와 소프트웨어 아키텍처 의사결정(ADR)을 결합하여, AI 에이전트의 컨텍스트 소모(토큰)를 0에 가깝게 유지하면서 무손실 지식 승격과 원자적 형상 관리를 달성합니다.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        L0. 거버넌스 규격 (Rules)                          │
│     AGENTS.md (완결형 상시 가드레일) + .agents/rules/60-task-memory-adr.md │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 규격 강제
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ L1. 작업 기억 (Working Memory)   │     │L2. 장기 지식 베이스 (Knowledge)   │
│ .agents/task/task.md            │     │ .agents/memory/                 │
│ (5KB 상한, TSK-X 단일 정본)       │     │ ├─ patterns-index.md (0토큰색인) │
└────────────────┬────────────────┘     │ ├─ patterns/P-XX-*.md (샤딩패턴) │
                 │                      │ └─ project-changelog.md         │
                 │ 지식 승격/ADR         │    (상단 ADR Index Map + 상세)   │
                 ├──────────────────────┴────────────────┬────────────────┘
                 │ [커밋 대기] 3요소(목적/수행결과/대상영역) 분류
                 ▼
┌─────────────────────────────────┐
│   실행 엔진 (Runtime Engine)     │
│    scripts/group-status.cjs     │
│ (원자 커밋 + 무인 완료 자동 이관)  │
└────────────────┬────────────────┘
                 │ Git: 커밋 SHA 획득 즉시 자동 이관 / 비-Git: 사용자 승인 확인
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    L3. 콜드 아카이브 (Cold Archive)                       │
│        .agents/task/task-completed.md (완료 태스크 영구 보관소)            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 작업 라이프사이클 파이프라인

```text
                 ┌─────────────────────────────────┐
                 │      [ ] 등록 (TSK-X 채번)       │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │   [진행 중] 구현 및 단위 검증      │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │ [커밋 대기] 3요소 요약 기록 완료   │
                 │ (목적 / 수행결과 / 대상영역 백틱)   │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                          < 환경 판별 분기 >
                                  │
                ┌─────────────────┴─────────────────┐
           [Git 환경]                         [비-Git 환경]
                ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│      npm run git:commit       │   │     사용자 수동 이관 허용        │
│ (diff --check + 원자 분할 커밋 │   │  또는 완료 보고 후 승인 확인     │
│  + task-completed.md 자동이관) │   └───────────────┬───────────────┘
└───────────────┬───────────────┘                   │
         (커밋 SHA 확보)                   (사용자 승인 게이트)
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │            [x] 완료              │
                 │    (task-completed.md 이관)      │
                 └─────────────────────────────────┘
```

---

## 2. 빠른 시작 (Quick Start)

경량 대화형 CLI(`@clack/prompts`)와 **Node.js 순수 내장 모듈**(`>=22.13.0`, 내장 `node:sqlite` 지원) 기반의 실행 엔진으로 작동합니다. 별도의 2단계 과정 없이 **단 1회 명령어**로 모든 AI 코딩 에이전트 환경에 즉시 설치 및 초기화할 수 있습니다.

대화형 설치 시 **영어(English, 기본값)** 또는 **한국어(Korean)** 를 선택할 수 있으며, 비대화형/스크립트 환경에서는 `--lang=ko` / `-l ko` 옵션 또는 `ACM_LANG=ko` 환경변수로 언어를 지정할 수 있습니다. (규칙 파일 미감지 시 방향키 `↑`/`↓` 및 `Space` 키로 대상 에이전트 규칙 파일을 직관적으로 다중 선택할 수 있으며, 비대화형 환경에서는 자동으로 `en` 및 `AGENTS.md`가 선택됩니다.)

### 방법 A. npx 1단계 즉시 실행 (가장 권장하는 표준 방법)

```bash
# 대화형 실행: 언어 선택 (영어 기본값 / 한국어) 및 규칙 파일 자동 스캔·주입
npx -y agent-context-memory

# 한국어로 즉시 설치 (대화형 선택 건너뛰기)
npx -y agent-context-memory --lang=ko --non-interactive

# 특정 프로젝트 디렉터리에 즉시 설치
npx -y agent-context-memory ./my-project

# 특정 에이전트 규칙 파일 직접 지정 (쉼표 구분 다중 지정 가능)
npx -y agent-context-memory ./my-project --rule-file=CLAUDE.md

# 기존 템플릿 파일 강제 덮어쓰기 모드
npx -y agent-context-memory --force
```

### 방법 B. npm 패키지 설치와 동시에 자동 초기화 (`postinstall`)

```bash
# 패키지 설치와 동시에 호스트 프로젝트(.agents/, scripts/, 규칙 파일) 영어 기본 자동 초기화
npm install -D agent-context-memory

# 한국어 템플릿으로 자동 초기화
ACM_LANG=ko npm install -D agent-context-memory

# (선택) 자동 초기화를 건너뛰고 패키지만 설치하고자 할 경우
ACM_SKIP_POSTINSTALL=1 npm install -D agent-context-memory
```

### 방법 C. 전역 설치 (Global CLI)

```bash
npm install -g agent-context-memory

acm
acm --lang=ko
acm status
```

### 방법 D. 로컬 번들 인스톨러 직접 실행

```bash
node scripts/install-template.cjs /path/to/my-project
node scripts/install-template.cjs /path/to/my-project --lang=ko --rule-file=CLAUDE.md,GEMINI.md
```

---

## 3. 멀티 에이전트 호환성 매트릭스 (Multi-Agent Support)

`agent-context-memory`는 특정 IDE나 단일 AI 도구에 종속되지 않습니다. 프로젝트 루트의 규칙 파일을 자동 감지하여 마커 기반(`<!-- ACM_GOVERNANCE_START -->`)으로 비파괴 주입됩니다.

| AI 에이전트 환경 | 대상 규칙 파일 | 연동 방식 및 기능 지원 |
| :--- | :--- | :--- |
| **Antigravity IDE** | `AGENTS.md` / `GEMINI.md` | `.agents/` 네이티브 작업 기억, `60-task-memory-adr.md`, `hooks.json` 토큰 감시, 서브 에이전트(`git-release-sentinel`, `context-compactor`) 연동 |
| **Claude Code** | `CLAUDE.md` | 프로젝트 가드레일 자동 주입, `scripts/group-status.cjs` 원자 커밋 및 자동 이관 워크플로 |
| **Cursor** | `.cursorrules` / `.cursor/rules/*.mdc` | 3계층 메모리 규칙 주입, 5KB 상한 작업 기억 단일 정본 연동 |
| **Windsurf** | `.windsurfrules` | Cascade 엔진 가드레일 자동 반영, 작업 상태 기반 컨텍스트 정렬 |
| **Codex / Copilot** | `AGENTS.md` / `.github/copilot-instructions.md` | 프로젝트 표준 거버넌스 및 ADR Index Map 기반 히스토리 추적 |
| **OpenCode** | `AGENTS.md` | 표준 마크다운 프롬프트 인터페이스 및 0토큰 Grep 지식 탐색 |

---

## 4. 왜 Agent Context Memory인가? (Why ACM?)

### 1) 컨텍스트 고갈과 기억 소실(Context Amnesia) 해결
- **문제**: AI 에이전트는 대화가 길어지면 과거 결정 사항을 망각하고, 수만 줄의 문서를 통째로 읽어 토큰을 낭비합니다.
- **해결**: 엄격한 **5KB 상한 작업 기억(`task.md`)**, 키워드 색인표(`patterns-index.md`)를 통한 **0토큰 Grep 원칙**, `project-changelog.md` 최상단 **`ADR Index Map` 경량 색인표** 및 선택적 로컬 **`node:sqlite` + FTS5** 검색 엔진을 제공합니다.

### 2) 대규모 일괄 커밋(`git add .`) 차단 및 무인 완료 이관(`autoCompleteTask`)
- **문제**: 에이전트에게 커밋을 맡기면 변경된 수십 개의 파일을 한꺼번에 스테이징하여 롤백을 불가능하게 만들고, 커밋 후 `task.md` 정리나 완료 이관을 누락합니다.
- **해결**: `scripts/group-status.cjs` 커밋 엔진이 `task.md`의 `[커밋 대기]`/`[Ready]` 작업(`TSK-X`)만 안전하게 선별하여 **① `git diff --cached --check` 충돌 마커 검증 -> ② 작업 단위 개별 원자 커밋 -> ③ `task-completed.md` 자동 완료 이관 및 `task.md` 절삭**을 단 1회 실행으로 무인 완결합니다.

### 3) 검증 전 조기 완료 오판 방지 및 무결성 게이트 (Negative Rule & Approval Gate)
- **문제**: AI 에이전트는 코드를 작성하자마자 "작업 완료"로 표시하거나 임의로 커밋해 버리는 실수를 반복합니다.
- **해결**: 상태 라이프사이클에 `[커밋 대기]`/`[Ready]` 단계를 강제하고, 사용자의 명시적 커밋 지시 후 `npm run git:commit`을 통해 실제 커밋 SHA 해시를 획득함과 동시에 `task-completed.md`로 자동 이관합니다.

### 4) 초기 샘플 비오염 설계 (Sample-Only Isolation)
- **문제**: 보일러플레이트 템플릿에 `TSK-1`, `P-01`, `LOG-01` 같은 실제 번호 샘플이 들어 있으면 에이전트가 이를 실제 수행된 작업으로 오인하거나 채번이 밀립니다.
- **해결**: 배포 템플릿(`acm-template/`)의 모든 초기 샘플은 `TSK-SAMPLE`, `P-00`, `LOG-00` 양식 예시로 격리되어 있어, 호스트 프로젝트 설치 즉시 `TSK-1`, `P-01`, `LOG-01`부터 깨끗하게 시작할 수 있습니다.

### 5) 완전한 가역성 (100% Safe Uninstall) 및 비-Git 무장애 가동
- `scripts/acm-manifest.cjs` 단일 정본 매니페스트와 영/한 다국어 변조 감지(Drift Detection)를 통해 `npx agent-context-memory uninstall` 시 원본을 100% 복구하며, `scripts/check-git.cjs`를 통해 비-Git 환경에서도 메모리 뷰어 모드로 무장애 작동합니다.

---

## 5. 3계층 데이터 모델 상세 규격

| 계층 | 대상 경로 | 최대 용량 | 역할 및 거버넌스 규격 |
| :--- | :--- | :--- | :--- |
| **L0 (규칙 계층)** | `AGENTS.md` (상시 가드레일)<br>`.agents/rules/60-task-memory-adr.md`<br>`.agents/MEMORY_GOVERNANCE.md` | 상시 ~140토큰 | 완결형 6대 가드레일 상시 주입 및 `P-XX`/`LOG-XX`/비-Git 이관 시 조건부 세부 규격 참조 |
| **L1 (작업 기억)** | `.agents/task/task.md` | **5KB 이하** | 현재 활성화된 작업의 단일 정본. `TSK-{자연수}` 영구 불변 식별자 및 `[커밋 대기]`/`[Ready]` 3요소 기록. |
| **L2 (장기 지식)** | `.agents/memory/patterns-index.md`<br>`.agents/memory/patterns/P-XX-*.md`<br>`.agents/memory/project-changelog.md` | 샤드당 5줄 요약<br>(분산 저장) | **0토큰 Grep 원칙**: 색인표 키워드 매칭 파일만 핀포인트 조회.<br>**ADR Index Map**: 최상단 요약 테이블(1~35행) 우선 조회 후 해당 `[LOG-XX]` 섹션만 열람. |
| **L3 (콜드 아카이브)** | `.agents/task/task-completed.md`<br>`.agents/memory/archive/` | 무제한 | `npm run git:commit` 성공 시 획득한 커밋 SHA 해시와 함께 자동 이관 보관. |

---

## 6. 핵심 실행 엔진 및 명령어 가이드

### 1) CLI 명령어

```bash
# 템플릿 설치 및 프로젝트 초기화 (기본값: 영어, --lang=ko 로 한국어 설치)
npx agent-context-memory init [경로] [옵션]

# 작업 단위 상태 점검 (Git 환경: 파일 변경 감지 / 비-Git 환경: 3계층 메모리 뷰어)
npx agent-context-memory status
npx agent-context-memory status --compact

# '[Ready]' / '[커밋 대기]' 작업 순차 원자 커밋 및 task-completed.md 자동 이관
npx agent-context-memory commit
npx agent-context-memory commit --commit=TSK-1

# 원격 브랜치 변경사항 지능형 3-Way 병합 (Git 환경 전용)
npx agent-context-memory pull
npx agent-context-memory resolve

# 원격 브랜치 푸시 전 위생 및 정적 감사
npx agent-context-memory audit

# 현재 환경의 Git 설치 유무 및 대상 디렉터리 저장소 여부 정밀 진단
npx agent-context-memory check-git

# ACM 자산 안전 롤백 및 제거 (시뮬레이션: --dry-run)
npx agent-context-memory uninstall [경로] [옵션]
```

### 2) 작업 단위 Git 자동화 스크립트 (`package.json`)

```bash
npm run git:status      # 작업별 파일 분류 및 자동 생성 커밋 메시지 미리보기 (--dry-run)
npm run git:summary     # 에이전트 초경량 토큰용 1줄 요약 조회 (--compact)
npm run git:commit      # 완료 대기 작업을 순차 원자 커밋 및 task-completed.md로 자동 이관 (--all)
npm run git:pull        # 원격 브랜치 변경사항 지능형 풀 (3-Way 병합)
npm run git:resolve     # 3-Way 충돌 해결 마커 점검 및 하이브리드 해소
npm run git:audit-push  # 원격 푸시 전 임시 파일, 디버그 코드, 미해결 충돌 마커 정적 감사
```

---

## 7. 저장소 구조: 배포 자산과 개발 환경의 분리

```text
agent-context-memory/
├── acm-template/       # [배포 자산] 신규 프로젝트에 주입될 클린 보일러플레이트 (영어 기본 정본)
│   ├── .agents/        # 비오염 샘플(TSK-SAMPLE, P-00, LOG-00), 거버넌스, 룰, 에이전트, 스킬, 훅
│   ├── locales/ko/     # --lang=ko 또는 대화형 한국어 선택 시 적용되는 한국어 템플릿 오버레이
│   └── scripts/        # 실행 엔진, i18n 카탈로그, SQLite/Markdown 스토리지 프로바이더
├── .agents/            # [자체 개발] 본 패키지 자체의 실시간 작업 기억 및 거버넌스 (Dogfooding)
├── bin/                # 통합 CLI 진입점 (agent-context-memory.js)
├── scripts/            # 인스톨러, 언인스톨러, 매니페스트, i18n, 실행 엔진, 스토리지 계층
├── tests/              # Git, 비-Git, i18n, SQLite E2E 자동화 검증 스위트
├── README.md           # 영문 README (기본)
├── README.ko.md        # 국문 README
└── LICENSE             # MIT License
```

---

## 8. 기존 방식과의 비교 (Comparison)

| 비교 항목 | 기존 일반 방식 | Agent Context Memory (ACM) |
| :--- | :--- | :--- |
| **메모리 유지** | 대화 세션 종료 시 모든 컨텍스트 소실 | 3계층 모델을 통해 파일 시스템 및 SQLite에 무손실 보존 |
| **토큰 소모량** | 매 턴마다 수천 줄의 가이드 문서 전체 주입 | 완결형 마이크로 가드레일 및 색인표(`patterns-index`, `ADR Index Map`) 기반 0토큰 핀포인트 로딩 |
| **작업 추적 및 이관** | 에이전트 임의 판단으로 완료 선언 또는 이관 누락 | `npm run git:commit` 실행 시 커밋 SHA 확보와 동시에 `task-completed.md` 무인 자동 이관 |
| **Git 커밋 품질** | `git add .`로 수십 개 파일 혼합 일괄 커밋 | `[Ready]` / `[커밋 대기]` 상태 태스크(`TSK-X`)만 선별하여 파일 자동 분할 원자 커밋 (`diff --check` 내장) |
| **환경 유연성** | Git 미설치/비저장소 시 스크립트 크래시 발생 | 2단계 진단 엔진으로 비-Git 자동 감지, 메모리 뷰어 및 사용자 승인 게이트 가동 (Graceful Fallback) |
| **안전 롤백** | 설치 후 파일 삭제 시 프로젝트 파손 위험 | 매니페스트 기반 선별 제거 및 영/한 변조 감지(Drift Detection) 복원 |

---

## 9. 라이선스 및 기여 (License)

본 프로젝트는 [MIT License](LICENSE) 하에 오픈소스로 제공됩니다. 자유롭게 개인 또는 기업 프로젝트에 도입하고 확장할 수 있습니다.

- Author: Rock Beider
- Repository: [https://github.com/rockbeider/agent-context-memory](https://github.com/rockbeider/agent-context-memory)

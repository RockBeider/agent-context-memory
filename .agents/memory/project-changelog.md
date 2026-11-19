# Project Changelog & Architecture Decision Records (ADR)

> [!IMPORTANT]
> **0토큰 온디맨드 및 색인표 우선 조회 원칙**:
> 1. 본 문서는 거시 아키텍처 결정 사항(ADR) 및 시스템 주요 변경만 누적 기록합니다.
> 2. 신규 결정 사항은 `LOG-{순차증가번호}`를 채번하여 **1) 상단 `ADR Index Map` 표 최상단에 1행 추가**, **2) 하단 `ADR 상세 기록` 최상단에 상세 블록 추가**를 동시 수행합니다.
> 3. AI 에이전트는 평소 본 파일을 전수 조회하지 않으며, 3대 조건부 이벤트(공통 모듈 변경, 대규모 머지, 설정 수정) 시 **상단 색인표(1~35행)만 먼저 열람하거나 키워드로 `grep_search`한 뒤 필요한 `[LOG-XX]` 섹션만 핀포인트 조회**합니다.

## 1. ADR Index Map (아키텍처 결정 경량 색인표)

| ID | 일자 | 핵심 아키텍처 결정 요약 | 관련 영역 |
| :--- | :--- | :--- | :--- |
| **LOG-02** | 2026-11-09 | 실전 고도화 기능(무인 완료 이관, `[커밋 대기]` 안전 게이트, ADR Index Map, 범용 릴리스 센티넬, 비오염 샘플) 통합 | `scripts/group-status.cjs`, `.agents/`, `acm-template/` |
| **LOG-01** | 2026-10-19 | 3계층 컨텍스트 메모리 시스템(L1 활성 태스크, L2 지식 샤딩, L3 콜드 아카이브) 및 작업 단위 커밋 엔진 도입 | `AGENTS.md`, `scripts/group-status.cjs`, `.agents/` |

---

## 2. ADR 상세 기록 (Architecture Decision Details)

### [LOG-02] [2026-11-09] 실전 고도화 기능 이식, ADR Index Map 도입 및 배포 템플릿 비오염 샘플 체계 확립

- **관련 커밋/브랜치**: `TSK-14` / `main`
- **결정 배경 및 목적**:
  - 실전 프로젝트(`gcd_front_new`) 운영을 통해 검증된 무인 태스크 이관 및 안전 커밋 게이트를 ACM 코어 및 `acm-template/`에 통합하고, 초기 템플릿 샘플을 실제 작업으로 오인하는 문제를 원천 차단함.
- **아키텍처 결정 사항**:
  - `group-status.cjs`에 `autoCompleteTask()` 자동 이관 엔진, `--all` 실행 시 `[커밋 대기]` 전용 필터링, 커밋 직전 `git diff --cached --check` 공백/충돌 마커 사전 검사를 통합함.
  - `project-changelog.md` 상단에 `ADR Index Map` 마크다운 요약 테이블을 도입하여 장기 프로젝트에서도 35줄 이내에 전체 ADR 이력을 조망하고 핀포인트 열람하도록 개선함.
  - `AGENTS.md` 상시 주입 블록을 완결형으로 강화하고 `.agents/rules/60-task-memory-adr.md` 및 범용 `.agents/agents/git-release-sentinel.md`를 신설함.
  - `acm-template/` 초기 샘플에서 실제 채번(`TSK-1`, `P-01`, `LOG-01`)을 제거하고 `TSK-SAMPLE`, `P-00`, `LOG-00` 양식 샘플로 비오염화함.
- **예상 효과**:
  - 커밋과 동시에 `task.md` 절삭 및 `task-completed.md` 이관이 무인 완결되어 수동 누락 및 로컬 문서 2차 수정 오염이 0건으로 감소하며, 호스트 프로젝트 온보딩 즉시 `TSK-1`, `P-01`, `LOG-01`부터 깨끗하게 채번 시작 가능.

---

### [LOG-01] [2026-10-19] 3계층 컨텍스트 메모리 시스템 도입

- **관련 커밋/브랜치**: `init` / `main`
- **결정 배경 및 목적**:
  - 장기 프로젝트 진행 시 AI 에이전트의 컨텍스트 윈도우 초과 및 정보 소실 문제를 해결하기 위해 3계층 메모리 모델을 정립함.
- **아키텍처 결정 사항**:
  - L1(단일 활성 태스크: `task.md`), L2(지식 베이스 색인 및 샤딩: `patterns-index.md`, `patterns/`), L3(완료 아카이브: `task-completed.md`) 계층 분리.
  - `group-status.cjs` 커밋 엔진을 도입하여 태스크 정본 기반의 원자적 커밋 자동화 확립.
- **예상 효과**:
  - 에이전트의 세션 시작 시 컨텍스트 토큰 소모를 0에 가깝게 억제하고 지식 검색 효율 극대화.

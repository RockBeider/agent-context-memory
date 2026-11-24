---
trigger: model_decision
description: 신규 재사용 솔루션을 지식 베이스(P-XX)로 사후 증류하거나, 거시 아키텍처 변경 결정(ADR, LOG-XX)을 project-changelog.md에 열람 및 기록할 때 적용
---

## 1. 지식 베이스 사후 증류 (.agents/memory/patterns/)
- 확정된 재사용 솔루션에 한해 영구 불변 단축 ID 샤딩 파일(`.agents/memory/patterns/P-XXXXXX-*.md`, `acm pattern add` / `acm id pattern` / MCP 발급; `P-00`은 양식 샘플이며 기존 `P-XX` 파일도 호환됨)을 5~6줄 고밀도 요약 포맷(`**일자**:`, `**도메인 분류**:`, `**증상 및 원인**:`, `**해결 패턴**:`, `**연관 파일**:`)으로 신설하고 `patterns-index.md`에 요약 1행을 추가한다.
- `.agents/config.json`이 `sqlite` 모드일 때는 `acm pattern add` / `acm search` 또는 MCP 도구(`acm_pattern_save`, `acm_pattern_get`, `acm_search`)를 통해 `supersedes` 버전 체인과 함께 기록·조회한다.

## 2. 거시 아키텍처 결정 기록 (.agents/memory/project-changelog.md)
- **열람**: 3대 조건부 이벤트(1. 전역 인프라/설정 수정, 2. 회귀 결함 역추적, 3. 원격 대규모 머지 직후) 발생 시에만 최상단 `ADR Index Map`(1~35라인)을 슬라이스 조회(`StartLine: 1, EndLine: 35`)하거나 키워드로 `grep_search`하여 대상 `LOG-*`를 특정한 뒤 해당 상세 블록만 핀포인트 열람한다. `sqlite` 모드에서는 `acm adr list` / `acm search --kind=adr` 또는 `acm_search`를 우선 활용한다.
- **기록**: 거시 아키텍처 변경(ADR) 발생 시에만 `ADR Index Map` 최상단에 요약 1행을 추가하고, 상세 섹션 최상단에 누적 기록(`### [LOG-XXXXXX] [YYYY-MM-DD] 제목`, `acm adr add` / `acm id adr` / MCP로 발급; `LOG-00`은 양식 샘플)한다. 일반 기능 개발이나 단순 버그 수정의 changelog 기록은 전면 금지하며 `task` 계층으로 일원화한다. `sqlite` 모드에서는 `acm adr add` 또는 `acm_adr_add`로도 기록할 수 있다.

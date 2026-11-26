# Agent Context Memory Governance Rules (표준 거버넌스 규격)

> 본 문서는 3계층 인지 메모리 시스템(Three-Tier Memory Model)의 런타임 표준 가드레일 규격입니다.

---

## 1. 3대 정본 및 고유 식별자 규격
1. **작업 기억 (L1)**: `.agents/acm/task/task.md`
   - 단일 활성 작업 정본 (Single Source of Truth), 상시 **5KB 이하** 유지 (단, 사용자의 커밋 승인을 대기 중인 복수의 `[커밋 대기]` 태스크 누적으로 인한 일시적 5KB 초과는 예외로 허용하며 커밋 직후 자동 이관으로 해소).
   - 식별자: 영구 불변 6자리 단축 ID(`TSK-XXXXXX`, 영문자 시작 Crockford Base32, `acm` / `npm run acm --` / `node scripts/acm/acm-db-cli.cjs` `task add` / `id` 또는 MCP 발급; 기존 `TSK-{N}` 호환). 임의 수기 채번을 금지하며 초기 샘플 `TSK-SAMPLE`은 파싱·실행에서 제외한다.
   - 서식 지원: 불릿형(`- [상태] **TSK-XXXXXX. 작업명**`) 또는 블록형(`### TSK-XXXXXX. 작업명` 하위 `- **상태**: [상태]`).
2. **장기 지식 (L2)**: `.agents/acm/memory/patterns-index.md` / `patterns/`
   - 패턴 식별자: `P-XXXXXX` (`acm pattern add` / `acm id pattern` / MCP 발급; 기존 `P-{NN}` 호환; `P-00` 샘플 제외).
   - `patterns/` 하위에 5~6줄 고밀도 요약 샤딩 파일(`patterns/P-XXXXXX-*.md` 또는 기존 `P-XX-*.md`)로 보관하며, `patterns-index.md`에는 1행 요약 메타데이터만 등록.
3. **거시 ADR 로그 (L2)**: `.agents/acm/memory/project-changelog.md`
   - 아키텍처 식별자: `LOG-XXXXXX` (`acm adr add` / `acm id adr` / MCP 발급; 기존 `LOG-{NN}` 호환; `LOG-00` 샘플 제외).
   - 최상단 `## 1. ADR Index Map` 요약 색인표와 하단 `## 2. ADR 상세 기록`(`### [LOG-XXXXXX]` Prepend) 2단 구조로 운용.
4. **콜드 아카이브 (L3)**: `.agents/acm/task/task-completed.md`
   - Git 커밋 SHA 해시(Git 환경) 또는 사용자 승인 완료 표기(비-Git 환경)를 확보한 완료 태스크 영구 보관소.

---

## 2. 작업 수명주기, 실행 게이트 및 Git 원자 커밋 거버넌스
1. **상태 라이프사이클**: `[ ]` (대기) -> `[진행 중]` -> `[커밋 대기]` (검증 완료) -> `[x]` (커밋 완료).
2. **커밋 대기 3요소 의무 기재**:
   - 경미한 수정을 포함한 모든 커밋 전 반드시 `task.md`에서 해당 태스크를 `[커밋 대기] TSK-XXXXXX` 상태로 갱신하며, 커밋 메시지와 완료 아카이브에 즉시 활용될 수 있도록 아래 3요소를 빠짐없이 기재한다:
     - `- **목적**:` 작업 배경 및 핵심 변경 목적 1줄 요약
     - `- **수행결과**:` 핵심 파일별 구체적인 로직/스타일 수정 내역 하위 불릿 (5줄 이내 요약)
     - `- **대상영역**:` 변경된 모든 파일 또는 디렉터리 경로 목록
3. **작업 실행 게이트 (Execution Gate)**:
   - **단일 태스크 원스톱 일괄 실행**: 단일 태스크(`TSK-X`) 내 세부 작업은 계획서 최초 승인 1회 하에 중간 승인 없이 연속 실행·검증 완료 후 `walkthrough.md`로 보고한다.
   - **다중 페이즈 게이트**: 계획서에 복수의 독립 `TSK`로 분할 정의된 대규모 프로젝트에 한해 각 Phase 종료 시 검증 보고 및 사용자 승인 후 차기 Phase로 착수한다.
   - **태스크 전용 명령어 (`/태스크`, `/task`)**: `/태스크`, `/task` 프리픽스는 `task.md` 문서의 조회·추가·수정·상태 갱신 시에만 탐색 및 계획서 작성을 생략하고 직결 처리하며, 실제 소스 코드 구현이 수반되는 작업은 표준 실행 게이트를 따른다.
4. **명시적 커밋 승인 게이트 (Commit Gate) 및 자동 이관**:
   - **명시적 승인 후 커밋 (Commit on Explicit Approval ONLY)**: 계획서 승인만으로 Git 커밋을 자동 실행하지 않는다. 구현·검증 완료 후 `task.md`를 `[커밋 대기]`로 갱신하고 보고한 뒤, **사용자의 명시적 커밋 지시("커밋해", "반영해" 등)가 있을 때만** `npm run acm:commit`(`node scripts/acm/group-status.cjs --all`)을 단 1회 실행한다.
   - **Git 환경 원스톱 커밋 및 자동 이관**: `group-status.cjs --all`은 `[커밋 대기]` 상태인 태스크만 선별하여 ① `git diff --cached --check` 검증 -> ② 태스크별 개별 원자 커밋(SHA 획득) -> ③ `task-completed.md` 최상단 날짜 섹션 자동 완료 이관 및 `task.md` 정리까지 일괄 완결한다. (매핑되지 않은 미등록 파일은 워킹 트리에 안전 보존됨)
   - **비-Git 환경 수동/승인 이관**: 비-Git 환경에서는 에이전트가 사용자에게 검증 결과 보고 후 완료 이관 승인을 확인받은 뒤 `(Completed: YYYY-MM-DD / Non-Git)` 표기로 이관한다.
   - **`.agents/` 로컬 전용 비추적 엄수**: 호스트 프로젝트에서 `.agents/` ACM 문서는 `.gitignore` 대상 로컬 전용 파일이므로 별도 Git 2차 커밋을 시도하지 않는다.

---

## 3. 0토큰 온디맨드 검색 원칙 (Just-In-Time Grep)
1. **전수 통조회 100% 금지**: 세션 시작 시 `patterns/` 하위 파일이나 전체 히스토리 문서를 통째로 읽는 행위 엄격 금지.
2. **색인표 정밀 Grep**: 작업 키워드로 `patterns-index.md` 요약열만 `grep_search`하고, 매칭된 특정 샤딩 파일(`patterns/P-*-*.md`)만 핀포인트 로딩 (미매칭 시 즉시 종료, `P-00` 샘플 제외).
3. **바이패스 프리픽스**: 사용자 프롬프트에 `/스킵`, `/태스크`, `/task` 프리픽스가 있거나 단순 질의 시 지식 검색 생략.
4. **사후 증류**: 검증 완료된 범용 재사용 솔루션에 한해 신규 단축 ID(`P-XXXXXX`) 샤딩 파일 신설 및 `patterns-index.md` 1행 등록 (`.agents/rules/acm-task-memory-adr.md` 준수).

---

## 4. 거시 아키텍처 ADR 색인 기반 조건부 열람 원칙
1. **평소 조회 금지**: 통상 작업 시 `project-changelog.md`를 조회하지 않음 (0토큰 유지).
2. **3대 조건부 이벤트 시 최상단 `ADR Index Map` 조회**:
   - 1) 전역 인프라/설정 수정
   - 2) 회귀 결함 역추적
   - 3) 원격 대규모 머지 직후
   - 위 조건 발생 시에만 `project-changelog.md` 최상단 `ADR Index Map`(1~35라인)을 슬라이스 조회하거나 키워드로 `grep_search`하여 관련 `LOG-*`를 특정한 뒤, 해당 상세 블록만 핀포인트 열람.
3. **ADR 기록**: 거시 아키텍처 변경 시 `ADR Index Map` 최상단에 요약 1행을 추가하고 상세 섹션 최상단에 `### [LOG-XXXXXX] [YYYY-MM-DD] 제목` 블록을 Prepend 기록.

---

## 5. 멀티 에이전트 동시성 및 작업 영역 격리 거버넌스
1. **작업 배타적 점유**: 복수 에이전트 환경에서 태스크 착수 시 담당자 명기(`- [진행 중 (Agent: ID)]`), 타 에이전트가 진행 중인 태스크 간섭 금지.
2. **대상 영역 상호 배타성 (Path Isolation)**: 병렬 실행 태스크 간 `대상영역` 파일 경로 중첩 엄격 금지 (공통 파일 수정 필요 시 직렬 수행).
3. **원자적 단축 ID 발급**: `TSK-XXXXXX`, `P-XXXXXX`, `LOG-XXXXXX`는 수기로 임의 문자열을 생성하지 말고 `acm` CLI(`id`, `task add`, `pattern add`, `adr add`) 또는 MCP 도구를 통해 발급한다.
4. **Git 조작 직렬화**: `.git/index.lock` 충돌 차단을 위해 스테이징 및 커밋 조작은 직렬 수행.

---

## 6. 저장소 모드, DB CLI, Git Orphan 동기화 및 MCP 서버
1. **로컬 우선 SQLite 기본값(순수 DB 정본) 및 레거시 폴백**:
   - Node.js >= 22.13.0 환경에서 `acm init`은 `.agents/acm/config.json`을 `sqlite` 모드(`.agents/acm/local/memory.db`, `.gitignore` 보호) 및 `storage.markdownProjection: false` 기본값으로 초기화합니다. 신규 `sqlite` 설치 시 빈 `.agents/acm/task/` 및 `.agents/acm/memory/` Markdown 스캐폴딩 생성을 생략하여 SQLite DB와 FTS5 BM25 인덱스를 유일한 단일 정본으로 유지합니다(기존 Markdown 자산이 존재하는 프로젝트에서는 무손실 자동 이관 유지).
   - Markdown 출력이 필요할 때는 `acm export --format=md`로 온디맨드 내보내기를 실행하거나, `--markdown-projection` / `acm config set storage.markdownProjection true`로 상시 태스크 투영을 명시적으로 활성화합니다.
   - 구버전 Node.js 또는 레거시 워크플로에서는 `--storage=markdown` 모드로 무장애 폴백하며, 추후 온라인/클라우드 저장소는 `registerProvider()` 확장 슬롯을 통해 선택 연동됩니다.
2. **구조화 CLI 및 무의존성 Stdio MCP 접근**:
   - `sqlite` 모드에서는 Markdown 파일 수기 편집 대신 `--json` / `--stdin`을 지원하는 `acm` DB CLI(PATH 미등록 시 `npm run acm -- <cmd>` 또는 `node scripts/acm/acm-db-cli.cjs <cmd>`: `id`, `task`, `pattern`, `adr`, `search`, `compact`, `config`, `stats`, `migrate`, `export`, `import`) 또는 순수 JSON-RPC 2.0 stdio MCP 서버(`acm mcp`, `npm run acm:mcp`, `node scripts/acm/mcp-server.cjs --print-config`)를 통해 메모리를 조회·갱신합니다.
   - 노출된 10개 MCP 도구: `acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`, `acm_compact`.
3. **Git Orphan 브랜치 협업 (`acm sync`)**:
   - 공유 패턴·ADR·완료 태스크는 순수 Git Plumbing(`GIT_INDEX_FILE`)과 결정적 JSONL, LWW/비충돌 단축 ID 해소 병합을 통해 코드 브랜치를 오염시키지 않고 전용 orphan 브랜치(`acm-memory`)로 동기화됩니다.
   - 원격 전송 전 내장 Secret Scrubber가 민감 토큰을 자동 마스킹하며, `audit-push` 게이트는 `.agents/acm/local/*.db*` 및 WAL/SHM 파일의 코드 브랜치 유출을 원천 차단합니다.

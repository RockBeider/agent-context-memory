# Agent Context Memory (ACM)

[English](./README.md) | **한국어**

AI 코딩 에이전트(Antigravity IDE, Claude Code, Cursor, Windsurf, Codex, Copilot, OpenCode 등)를 위한 **가벼운 로컬 메모리 & 작업 단위 Git 도구**입니다.

별도의 서버나 복잡한 설정 없이 바로 쓸 수 있어 **1인 개발자와 소규모 팀에 잘 맞습니다.** 새 채팅을 열 때마다 긴 대화 내용이나 문서를 통째로 다시 설명할 필요 없이, 진행 중인 작업·재사용 팁·설계 이유(ADR)만 골라서 불러옵니다. 덕분에 **토큰은 아끼면서 이전 세션의 맥락을 자연스럽게 이어갈 수 있습니다.**

코드 정리도 함께 돕습니다. AI가 `git add .`로 관련 없는 파일까지 한꺼번에 커밋하는 실수를 막아주고, 작업 단위로 깔끔하게 커밋한 뒤 완료 기록까지 자동으로 옮겨줍니다. Git이 없는 폴더에서도 오류 없이 메모리 도구로 그대로 사용할 수 있습니다.

---

## 1. 어떻게 동작하나요?

ACM은 사람이 기억을 다루는 방식처럼 정보를 3단계(지금 하는 일, 오래 기억할 지식, 끝난 일 기록)로 나누어 저장합니다. 평소에는 꼭 필요한 규칙만 가볍게 읽고, 과거 지식이나 기록은 필요할 때만 찾아보기 때문에 토큰 낭비가 적습니다.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        L0. 기본 규칙 (Rules)                             │
│  AGENTS.md (핵심 규칙 6가지) + .agents/rules/acm-task-memory-adr.md      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 규칙 적용
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ L1. 지금 하는 일 (작업 기억)      │     │ L2. 오래 기억할 지식 (장기 기억)  │
│ .agents/acm/task/task.md        │     │ .agents/acm/memory/             │
│ (5KB 제한, 진행 중 작업 관리)     │     │ ├─ patterns-index.md (키워드표) │
└────────────────┬────────────────┘     │ ├─ patterns/P-XX-*.md (해결법)  │
                 │                      │ └─ project-changelog.md         │
                 │ 패턴/ADR 정리         │    (상단 요약표 + 상세 기록)     │
                 ├──────────────────────┴────────────────┬────────────────┘
                 │ [커밋 대기] 목적 / 결과 / 변경 파일 기록 완료
                 ▼
┌─────────────────────────────────┐
│        실행 엔진 (CLI)           │
│ scripts/acm/group-status.cjs    │
│ (작업별 커밋 + 완료 목록 이동)    │
└────────────────┬────────────────┘
                 │ Git: 커밋 직후 자동 이동 / 비-Git: 사용자 확인 후 이동
                 ▼
┌─────────────────────────────────┐
│                      L3. 끝난 일 기록 (아카이브)                          │
│        .agents/acm/task/task-completed.md (완료된 작업 보관)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 작업이 진행되는 흐름

```text
                 ┌─────────────────────────────────┐
                 │     [ ] 할 일 등록 (TSK-X)       │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │    [진행 중] 개발 및 테스트       │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │  [커밋 대기] 3가지 핵심 정리     │
                 │  (목적 / 결과 / 변경된 파일)     │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                          < Git 사용 여부 >
                                  │
                ┌─────────────────┴─────────────────┐
             [Git 있음]                         [Git 없음]
                ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│      npm run acm:commit       │   │     작업 결과 확인 보고        │
│ (충돌 점검 + 작업별 분리 커밋   │   │    & 사용자 확인 후 이동       │
│  + 완료 목록으로 자동 이동)    │   └───────────────┬───────────────┘
└───────────────┬───────────────┘                   │
         (커밋 해시 기록)                     (사용자 확인)
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │           [x] 완료              │
                 │   (task-completed.md에 보관)    │
                 └─────────────────────────────────┘
```

---

## 2. 빠른 시작 (Quick Start)

Node.js(`>=22.13.0`, 내장 `node:sqlite` 사용)만 있으면 **명령어 한 줄**로 바로 시작할 수 있습니다.

설치할 때 아래 두 가지를 고를 수 있습니다.
- **언어**: 영어(기본) 또는 한국어 (`--lang=ko`, `-l ko`, `ACM_LANG=ko`)
- **저장 방식**: **로컬 SQLite DB (권장)**(`--storage=sqlite`) 또는 **Markdown 파일 전용**(`--storage=markdown`)

이미 `.agents/acm/`(또는 예전 `.agents/`)에 Markdown 기록이 있다면 설치할 때 자동으로 `.agents/acm/local/memory.db`로 불러옵니다. 프로젝트에 에이전트 규칙 파일이 아직 없다면 방향키와 `Space`로 원하는 파일들을 한꺼번에 고를 수 있습니다. (비대화형 설치 시 기본값은 `en`, `sqlite`, `AGENTS.md`입니다.)

### 방법 A. `npx`로 바로 설치하기 (권장)

```bash
# 대화형 설치: 언어, 저장 방식(SQLite 권장), 에이전트 규칙 파일 선택
npx -y agent-context-memory

# 비대화형 / AI 에이전트 / CI 환경 설치 (프롬프트 멈춤 방지, 백업 복원 프롬프트 건너뛰기)
npx -y agent-context-memory init --non-interactive --no-restore-backup
npx -y agent-context-memory init --lang=ko --storage=sqlite --non-interactive --no-restore-backup
# 또는 환경변수로 비대화형 강제 (CI=true 도 자동 감지)
ACM_NON_INTERACTIVE=1 npx -y agent-context-memory init --lang=ko

# SQLite를 쓰면서 task.md 파일도 함께 최신 상태로 유지하기 (기본: 끔)
npx -y agent-context-memory init --markdown-projection

# 예전처럼 Markdown 파일만으로 사용하기
npx -y agent-context-memory init --storage=markdown

# 다른 폴더에 설치하기
npx -y agent-context-memory ./my-project

# 특정 규칙 파일만 골라서 적용하기 (쉼표로 여러 개 지정 가능)
npx -y agent-context-memory ./my-project --rule-file=CLAUDE.md

# 기존 ACM 템플릿 파일을 새 버전으로 덮어쓰기
npx -y agent-context-memory --force
```

### 방법 B. `npm install`로 프로젝트에 추가하기 (`postinstall`)

개발 의존성으로 설치하면 프로젝트에 필요한 파일이 자동으로 세팅됩니다.

```bash
# 영어 기본 설정으로 자동 초기화
npm install -D agent-context-memory

# 한국어 설정으로 자동 초기화
ACM_LANG=ko npm install -D agent-context-memory

# 자동 초기화를 건너뛰고 패키지만 설치하기
ACM_SKIP_POSTINSTALL=1 npm install -D agent-context-memory
```

### 방법 C. 전역 명령어(`acm`)로 설치하기

```bash
npm install -g agent-context-memory

acm
acm --lang=ko
acm status
```

### 방법 D. 로컬 스크립트로 직접 설치하기

```bash
node scripts/acm/install-template.cjs /path/to/my-project
node scripts/acm/install-template.cjs /path/to/my-project --lang=ko --rule-file=CLAUDE.md,GEMINI.md
```

---

## 3. 지원하는 AI 코딩 도구

특정 IDE나 AI 도구에 묶이지 않습니다. 프로젝트 루트의 규칙 파일을 찾아 전용 구간(`<!-- ACM_GOVERNANCE_START -->`)만 안전하게 추가하므로 기존에 적어둔 규칙을 해치지 않습니다.

| AI 코딩 도구 | 대상 규칙 파일 | 지원하는 연동 기능 |
| :--- | :--- | :--- |
| **Antigravity IDE** | `AGENTS.md` / `GEMINI.md` | `.agents/acm/` 작업 메모리, 세부 규칙(`acm-task-memory-adr.md`), `hooks.json`(`acm-token-monitor`), 전용 서브 에이전트(`acm-git-release-sentinel`, `acm-context-compactor`) |
| **Claude Code** | `CLAUDE.md` | 핵심 규칙 자동 추가, `scripts/acm/group-status.cjs` 기반 작업별 커밋 및 완료 자동 이동 |
| **Cursor** | `.cursorrules` / `.cursor/rules/*.mdc` | 3단계 메모리 규칙 적용, 5KB 제한 작업 기억 연동 |
| **Windsurf** | `.windsurfrules` | Cascade용 작업 규칙 반영, 작업 상태 기반 맥락 유지 |
| **Codex / Copilot** | `AGENTS.md` / `.github/copilot-instructions.md` | 표준 규칙 적용 및 `ADR Index Map` 기반 설계 이력 조회 |
| **OpenCode** | `AGENTS.md` | 마크다운 규칙 연동 및 키워드 기반 경량 지식 검색 |

---

## 4. ACM을 쓰면 좋은 이유

### 1) 토큰은 아끼고, 세션은 자연스럽게 이어갑니다
- **기존의 불편함**: 대화가 길어지거나 새 세션을 열면 AI가 이전 결정 사항을 까먹습니다. 반대로 문서 전체를 매번 읽히면 토큰이 금방 소진됩니다.
- **ACM의 해결 방식**: 현재 작업 파일(`task.md`)은 **5KB 이하**로 가볍게 유지합니다. 과거 해결법(`patterns-index.md`)과 설계 기록(`project-changelog.md` 상단 35줄 `ADR Index Map`)은 먼저 목차만 훑거나 로컬 **`node:sqlite` + FTS5 검색**(`scripts/acm/storage/`)으로 필요한 부분만 콕 집어 불러옵니다.

### 2) `git add .` 대신 작업 단위로 깔끔하게 커밋합니다
- **기존의 불편함**: AI에게 커밋을 맡기면 `git add .`로 여러 작업의 파일을 한꺼번에 묶어버려 되돌리기 어렵고, 커밋 후 할 일 목록 정리도 자주 빼먹습니다.
- **ACM의 해결 방식**: `scripts/acm/group-status.cjs`가 `[커밋 대기]`/`[Ready]` 상태의 작업(`TSK-X`)만 골라냅니다. `git diff --cached --check`로 충돌 흔적이 없는지 확인한 뒤, **작업별로 나누어 커밋하고 완료 기록(`task-completed.md`) 이동까지 한 번에 끝냅니다.**

### 3) 테스트도 안 했는데 "완료"라고 하는 실수를 막습니다
- **기존의 불편함**: AI는 코드를 짜자마자 확인 없이 완료 처리하거나 사용자 허락 없이 커밋해 버리곤 합니다.
- **ACM의 해결 방식**: 작업이 끝나면 바로 완료하지 않고 `[커밋 대기]`/`[Ready]` 단계에 머물며 **목적·결과·변경 파일** 3가지를 정리합니다. 사용자가 명시적으로 커밋을 지시해 `npm run acm:commit`을 실행해야 실제 커밋 해시와 함께 완료 목록으로 넘어갑니다.

### 4) 예시와 실제 작업을 헷갈리지 않고, ID도 겹치지 않습니다
- **기존의 불편함**: `TSK-1`, `P-01` 같은 순차 번호는 여러 PC나 브랜치, 병렬 에이전트에서 작업할 때 번호가 쉽게 겹칩니다. 템플릿에 들어 있던 예시 번호를 AI가 실제 할 일로 착각하기도 합니다.
- **ACM의 해결 방식**: 템플릿 예시는 파서가 무시하는 `TSK-SAMPLE`, `P-00`, `LOG-00`으로 구분합니다. 새로 만드는 항목은 별도 설정 없이 **겹치지 않는 6자리 짧은 ID**(`TSK-K7M29A`, `P-M3N8Q2`, `LOG-R9A4C1`)가 붙습니다. 앞 3~5글자(`K7M2`)만 입력해도 찾을 수 있고, 예전 숫자 ID(`TSK-1`, `P-01`, `LOG-01`)도 그대로 호환됩니다.

### 5) 기존 설정을 건드리지 않고 깔끔하게 지울 수 있습니다
- 설치할 때 ACM이 만든 파일 목록을 `.agents/acm/meta.json`(v2)과 `scripts/acm/acm-manifest.cjs`에 기록해 둡니다.
- 나중에 `npx agent-context-memory uninstall`을 실행하면 먼저 백업 여부와 저장 위치(`Local` `.acm-backup-*.zip` 기본값, `--backup-format=zip|tar.gz|dir`, 또는 격리 Git 브랜치 `acm-backups` 선택 `--backup-target=local|git|both`)를 선택한 뒤, 원래 있던 `.agents/`, `scripts/`, 커스텀 훅은 그대로 두고 ACM 파일만 깔끔하게 지워줍니다. 재설치(`init`) 시에는 로컬과 Git의 기존 백업을 자동 인식해 복원(`--restore-backup`)하거나 새로 시작할 수 있으며, Git이 없는 폴더에서도 메모리 뷰어 모드로 문제없이 동작합니다.

---

## 5. 3단계 메모리 구조와 로컬 SQLite

ACM은 기본값으로 프로젝트 안의 `.agents/acm/local/memory.db`(**로컬 SQLite + FTS5 검색**, `.agents/acm/config.json` 설정, `.gitignore`로 코드 브랜치와 분리) 하나만 기준 저장소로 씁니다.

기본 설정(`storage.markdownProjection: false`)에서는 Markdown 파일을 동시에 중복 저장하지 않으므로, DB와 파일 내용이 서로 달라지는 문제가 생기지 않습니다. Markdown 파일로 보고 싶을 때는 `acm export --format=md`로 언제든 꺼내 볼 수 있고, 파일도 항상 같이 갱신하고 싶다면 `--markdown-projection` 또는 `acm config set storage.markdownProjection true`를 켜면 됩니다. (예전 `--storage=markdown` 방식과 `registerProvider()` 확장 구조도 계속 지원합니다.)

| 단계 | Markdown 경로 | SQLite 테이블 | 역할 |
| :--- | :--- | :--- | :--- |
| **L0 (기본 규칙)** | `AGENTS.md` (핵심 규칙)<br>`.agents/rules/acm-task-memory-adr.md`<br>`.agents/acm/ACM_GOVERNANCE.md` | `.agents/acm/config.json` | 항상 읽는 핵심 규칙 6가지. 자세한 규칙이나 저장소 사양은 필요할 때만 읽습니다. |
| **L1 (지금 하는 일)** | `.agents/acm/task/task.md` (**5KB 이하**) | `tasks` + `memory_fts` | 현재 진행 중이거나 커밋 대기 중인 작업 목록(`TSK-XXXXXX` / 기존 `TSK-{N}`). 에이전트 중복 작업 방지(Lease 잠금)와 커밋 전 3요소 점검을 담당합니다. |
| **L2 (오래 기억할 지식)** | `.agents/acm/memory/patterns-index.md`<br>`.agents/acm/memory/patterns/P-XX-*.md`<br>`.agents/acm/memory/project-changelog.md` | `patterns` + `adrs` + FTS5 BM25 | 자주 쓰는 해결 패턴과 주요 설계 결정(ADR). `acm search`나 MCP로 토큰 예산에 맞춰 필요한 항목만 바로 찾아오고, 수정 이력(`supersedes`)도 연결합니다. |
| **L3 (끝난 일 기록)** | `.agents/acm/task/task-completed.md`<br>`.agents/acm/memory/archive/` | `tasks (status='done')` + `sync_log` | `npm run acm:commit`으로 커밋을 마친 작업의 해시(SHA)와 공유 브랜치 동기화 이력을 보관합니다. |

---

## 6. 자주 쓰는 명령어와 MCP 연동

### 1) 기본 및 Git 작업 명령어

```bash
# 설치 및 초기 설정 (언어, SQLite/Markdown 선택)
npx agent-context-memory init [경로] [옵션]

# 작업별 변경 파일 미리보기 (Git이 없으면 3단계 메모리 요약 표시)
npx agent-context-memory status
npx agent-context-memory status --compact

# [Ready] / [커밋 대기] 작업을 하나씩 깔끔하게 커밋하고 완료 목록으로 이동
npx agent-context-memory commit
npx agent-context-memory commit --commit=K7M2   # 순번, 전체 ID, 앞 3~5글자 모두 가능

# 원격 변경 사항을 안전하게 합치기 (3-Way 병합, Git 전용)
npx agent-context-memory pull
npx agent-context-memory resolve

# 푸시 전 점검 (임시 파일, 로컬 *.db / *.db-wal / *.db-shm 유출, 충돌 흔적 차단)
npx agent-context-memory audit

# Git 설치 여부와 현재 폴더의 저장소 상태 확인
npx agent-context-memory check-git

# ACM 파일만 안전하게 백업 후 제거 (미리보기: --dry-run)
npx agent-context-memory uninstall [경로] [옵션]
# AI 에이전트 / CI 환경 권장 (프롬프트 생략, 기본 백업 및 수정된 규칙 블록 안전 보존)
npx -y agent-context-memory uninstall --non-interactive --backup-target=local
```

### 2) 로컬 DB 관리 및 소규모 팀 동기화 (`acm`)

모든 DB 명령어는 `--json` 출력과 `--stdin` JSON 입력을 지원해 스크립트나 AI 에이전트가 따옴표 오류 없이 안정적으로 호출할 수 있습니다.

```bash
# Markdown을 직접 고칠 때 겹치지 않는 6자리 ID 발급하기
npx agent-context-memory id task
npx agent-context-memory id pattern --count=3

# 작업, 패턴, ADR 등록 및 토큰 예산에 맞춘 빠른 검색
npx agent-context-memory task list
npx agent-context-memory task add "OAuth 인증 구현" --status=in_progress --owner=agent-1
npx agent-context-memory task show K7M2
npx agent-context-memory search "원자 커밋" --kind=all --budget=1500
npx agent-context-memory pattern add "Git Pager 프리징 해결" --supersedes=P-M3N8Q2
npx agent-context-memory adr add "로컬 SQLite 도입" --task=TSK-K7M29A --area="scripts/acm/storage/"

# 저장 방식 전환, Markdown 내보내기, JSON 백업/복원
npx agent-context-memory migrate --to=sqlite
npx agent-context-memory export --format=md --out=.agents/acm/exported-md
npx agent-context-memory export --format=json --out=.agents/acm/backup.json
npx agent-context-memory import .agents/acm/backup.json --strategy=merge

# 오래된 기록 정리, 설정 확인/변경, 통계 보기
npx agent-context-memory compact
npx agent-context-memory config show
npx agent-context-memory config set storage.markdownProjection true
npx agent-context-memory stats

# 로컬 뷰어 (터미널 텍스트/TUI, 일회성 브라우저 UI, 오프라인 HTML 스냅샷)
npx agent-context-memory view --tab=tasks
npx agent-context-memory ui
npx agent-context-memory export --format=html --out=.agents/acm/viewer-snapshot.html

# 별도 Git 브랜치('acm-memory')로 패턴·ADR·완료 기록을 팀원이나 다른 PC와 공유
# 작업 브랜치를 건드리지 않고(GIT_INDEX_FILE) 병합하며, 비밀키/토큰이 나가지 않게 자동 필터링
npx agent-context-memory sync --status
npx agent-context-memory sync --pull
npx agent-context-memory sync --push --dry-run
npx agent-context-memory sync
```

### 3) 별도 서버 없이 바로 쓰는 MCP 연동 (`acm mcp`)

외부 패키지나 백그라운드 서버 없이 Node.js 표준 입출력(stdio JSON-RPC 2.0)으로 12개의 도구(`acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`, `acm_compact`, `ui://acm/viewer.html` 기반 IDE 사이드 패널 `acm_viewer`, 앱 전용 `acm_viewer_data`)를 바로 연결할 수 있습니다.

```bash
# Antigravity, Claude Code, Cursor 등에 바로 붙여넣을 MCP 설정 출력
npx agent-context-memory mcp --print-config

# MCP 서버 직접 실행
npx agent-context-memory mcp
```

설정 예시 (`acm mcp --print-config` 출력):

```json
{
  "mcpServers": {
    "agent-context-memory": {
      "command": "npx",
      "args": ["-y", "agent-context-memory", "mcp"],
      "env": {
        "ACM_ROOT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

### 4) `package.json`에 추가되는 단축 스크립트

```bash
npm run acm:status      # 작업별 파일 묶음과 커밋 메시지 미리보기 (--dry-run)
npm run acm:summary     # AI 에이전트가 토큰을 아끼기 위해 읽는 1줄 요약 (--compact)
npm run acm:commit      # 커밋 대기 작업을 차례로 커밋하고 완료 목록으로 이동 (--all)
npm run acm:pull        # 원격 변경 사항 안전하게 가져오기 (3-Way 병합)
npm run acm:resolve     # 충돌 해결 확인 및 마무리 점검
npm run acm:audit-push  # 푸시 전 임시 파일, DB 파일, 충돌 마커 점검
```

---

## 7. 프로젝트 폴더 구조

```text
agent-context-memory/
├── acm-template/           # 다른 프로젝트에 설치할 깨끗한 템플릿 (영어 기본)
│   ├── .agents/            # 예시 샘플(TSK-SAMPLE, P-00, LOG-00), acm/ 공간, 규칙·에이전트·스킬·훅
│   └── locales/ko/         # --lang=ko 또는 한국어 선택 시 덮어씌우는 한국어 템플릿
├── .agents/                # 이 저장소 자체에서 사용하는 ACM 작업 공간
├── bin/                    # CLI 진입점 (agent-context-memory.js)
├── scripts/acm/            # 실행 스크립트, 설치/제거기, 다국어, DB CLI, MCP, 스토리지 모듈
│   ├── i18n.cjs            # 외부 패키지 없는 영/한 메시지 처리기
│   ├── locales/            # en.cjs(기본) 및 ko.cjs 문구 파일
│   ├── acm-db-cli.cjs      # DB CLI (task, pattern, adr, search, migrate, export, import, sync)
│   ├── mcp-server.cjs      # stdio JSON-RPC 2.0 MCP 서버
│   └── storage/            # MemoryStore, node:sqlite FTS5, Markdown 연동, Git 동기화, 비밀정보 필터
├── tests/                  # Git, 비-Git, SQLite, DB CLI, 동기화, MCP 자동 테스트
├── README.md               # 영문 안내서 (기본)
├── README.ko.md            # 국문 안내서
└── LICENSE                 # MIT 라이선스
```

---

## 8. 기존 방식과 무엇이 다른가요?

| 비교 항목 | 기존 방식 | Agent Context Memory (ACM) |
| :--- | :--- | :--- |
| **세션 연결** | 채팅을 새로 열면 맥락이 끊김 | 진행 작업·패턴·설계 이유를 로컬 파일과 SQLite에 정리해 다음 세션으로 이어짐 |
| **토큰 사용량** | 매번 긴 문서나 대화 전체를 다시 읽힘 | 짧은 핵심 규칙 + 목차/검색으로 꼭 필요한 내용만 골라 불러옴 |
| **작업 정리** | 커밋 후 할 일 목록 정리를 자주 깜빡함 | `npm run acm:commit` 한 번으로 커밋 해시 기록과 완료 이동을 자동 처리 |
| **커밋 깔끔함** | `git add .`로 여러 작업 파일이 뒤섞임 | `[Ready]` / `[커밋 대기]` 작업(`TSK-X`)만 골라 충돌 점검 후 작업별로 분리 커밋 |
| **Git 없는 폴더** | Git 기반 스크립트가 오류를 내며 멈춤 | 비-Git 환경을 자동 감지해 메모리 뷰어와 사용자 확인 흐름으로 정상 동작 |
| **안전한 제거** | 직접 지우다 기존 규칙까지 날릴 위험 | 설치 기록을 바탕으로 백업 후 ACM 파일만 정확히 골라 제거 |

---

## 9. 라이선스

[MIT License](LICENSE)로 공개되어 있습니다. 개인 프로젝트나 팀 프로젝트 어디서든 자유롭게 사용하고 수정할 수 있습니다.

- Author: Rock Beider
- Repository: [https://github.com/rockbeider/agent-context-memory](https://github.com/rockbeider/agent-context-memory)

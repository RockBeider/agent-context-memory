# Agent Context Memory (ACM)

**English** | [한국어](./README.ko.md)

Production-grade Three-Tier Context Memory & Task-Centric Git Engine for AI Coding Agents.

**Agent Context Memory (ACM)** is a **Three-Tier Cognitive Memory Governance System** for AI coding agents (Antigravity IDE, Claude Code, Cursor, Windsurf, Codex, Copilot, OpenCode, etc.) that prevents context amnesia caused by context window limits and stops repository pollution from indiscriminate bulk commits (`git add .`).

It integrates natively with Git (task-centric atomic commits, automated archiving to `task-completed.md`, and precision 3-Way hybrid merges) while providing a **graceful non-Git fallback** (3-tier Memory Viewer and user confirmation gate) so it runs without crashing even when Git is absent or uninitialized.

---

## 1. Architecture Overview & Task Lifecycle

ACM maps human cognitive memory tiers (Working Memory, Long-Term Memory, Cold Archive) onto Architecture Decision Records (ADRs) to keep baseline context token consumption near zero while achieving lossless knowledge distillation and atomic version control.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        L0. Governance Guardrails                        │
│     AGENTS.md (Self-Contained Rules) + .agents/rules/60-task-memory-adr.md │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ enforces
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ L1. Working Memory              │     │ L2. Long-Term Knowledge Base    │
│ .agents/task/task.md            │     │ .agents/memory/                 │
│ (5KB cap, TSK-X single source)  │     │ ├─ patterns-index.md (0-token)  │
└────────────────┬────────────────┘     │ ├─ patterns/P-XX-*.md (sharded) │
                 │                      │ └─ project-changelog.md         │
                 │ Distill / ADR        │    (Top ADR Index Map + Details)│
                 ├──────────────────────┴────────────────┬────────────────┘
                 │ [Ready] 3 Elements (Purpose / Results / Targets)
                 ▼
┌─────────────────────────────────┐
│        Runtime Engine           │
│     scripts/group-status.cjs    │
│ (Atomic Commit + Auto-Archive)  │
└────────────────┬────────────────┘
                 │ Git: auto-archive on SHA / Non-Git: user approval
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         L3. Cold Archive                                │
│         .agents/task/task-completed.md (Verified Task History)          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Task Lifecycle Pipeline

```text
                 ┌─────────────────────────────────┐
                 │     [ ] Registered (TSK-X)      │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │  [In Progress] Dev & Unit Test  │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │ [Ready] 3 Elements Documented   │
                 │ (Purpose / Results / Targets)   │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                         < Environment Check >
                                  │
                ┌─────────────────┴─────────────────┐
             [Git]                              [Non-Git]
                ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│      npm run git:commit       │   │   User Verification Report    │
│ (diff --check + atomic commit │   │  & Manual Archive Approval    │
│  + auto-archive on SHA)       │   └───────────────┬───────────────┘
└───────────────┬───────────────┘                   │
         (Commit SHA)                        (User Approval)
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │          [x] Completed          │
                 │  (Archived in task-completed.md)│
                 └─────────────────────────────────┘
```

---

## 2. Quick Start

Powered by a lightweight interactive CLI (`@clack/prompts`) and a **zero-dependency Node.js runtime engine** (`>=22.13.0` for built-in `node:sqlite`). Install and initialize ACM in any repository with a **single command**.

During interactive installation, ACM prompts you to choose **English (Default)** or **한국어 (Korean)** (`--lang=en|ko` or `ACM_LANG` for non-interactive/scripted installs) and your primary **storage backend**: **Local SQLite DB (Recommended)** on Node.js `>= 22.13.0` (`--storage=sqlite`) or **Legacy Markdown Files** (`--storage=markdown`). Existing Markdown records in `.agents/` are automatically imported into `.agents/local/memory.db` on init. When no existing agent rule file is detected, you can multi-select rule files using arrow keys and `Space` (non-interactive mode defaults to `en`, `sqlite`, and `AGENTS.md`).

### Option A. One-Shot `npx` Execution (Recommended)

Run directly inside any new or existing project directory—no `init` subcommand required:

```bash
# Interactive setup: select language (English default / Korean), storage, & rule files
npx -y agent-context-memory

# Install non-interactively in English (default, SQLite) or Korean
npx -y agent-context-memory --non-interactive
npx -y agent-context-memory --lang=ko --storage=sqlite --non-interactive

# Use Legacy Markdown-only mode instead of SQLite
npx -y agent-context-memory init --storage=markdown

# Install into a specific project directory
npx -y agent-context-memory ./my-project

# Target specific agent rule file(s) (comma-separated)
npx -y agent-context-memory ./my-project --rule-file=CLAUDE.md,AGENTS.md

# Force overwrite existing template files
npx -y agent-context-memory --force
```

### Option B. Automatic Initialization via `npm install` (`postinstall`)

Installing as a dev dependency automatically runs the `postinstall` hook in your host project (defaults to English; set `ACM_LANG=ko` to initialize in Korean):

```bash
# Auto-initialize .agents/, scripts/, and rule file on install
npm install -D agent-context-memory

# Initialize in Korean during npm install
ACM_LANG=ko npm install -D agent-context-memory

# Opt out of automatic initialization
ACM_SKIP_POSTINSTALL=1 npm install -D agent-context-memory
```

### Option C. Global CLI

```bash
npm install -g agent-context-memory

acm
acm --lang=ko
acm status
```

### Option D. Local Bundle Installer

```bash
node scripts/install-template.cjs /path/to/my-project
node scripts/install-template.cjs /path/to/my-project --lang=ko --rule-file=CLAUDE.md,GEMINI.md
```

---

## 3. Multi-Agent Support Matrix

ACM is IDE- and vendor-agnostic. It scans root agent rule files and injects a non-destructive marker block (`<!-- ACM_GOVERNANCE_START -->`).

| AI Coding Agent | Target Rule File(s) | Integration & Capabilities |
| :--- | :--- | :--- |
| **Antigravity IDE** | `AGENTS.md` / `GEMINI.md` | Native `.agents/` working memory, `60-task-memory-adr.md`, `hooks.json` token monitor, subagents (`git-release-sentinel`, `context-compactor`) |
| **Claude Code** | `CLAUDE.md` | Auto-injected execution guardrails, `scripts/group-status.cjs` atomic commits and auto-archiving |
| **Cursor** | `.cursorrules` / `.cursor/rules/*.mdc` | Three-tier memory rules and 5KB-capped working memory single source of truth |
| **Windsurf** | `.windsurfrules` | Cascade guardrails and task-state context alignment |
| **Codex / Copilot** | `AGENTS.md` / `.github/copilot-instructions.md` | Standard governance rules and `ADR Index Map` history lookup |
| **OpenCode** | `AGENTS.md` | Standard Markdown prompt contract and zero-token Grep search |

---

## 4. Why Agent Context Memory?

### 1) Eliminates Context Amnesia & Token Waste
- **Problem**: Long sessions cause agents to forget prior decisions or waste thousands of tokens eagerly reading entire documentation files.
- **Solution**: Enforces a strict **5KB working memory cap (`task.md`)**, **zero-token Grep lookup** via `patterns-index.md`, and a compact **35-line `ADR Index Map`** at the top of `project-changelog.md`—plus an optional local **`node:sqlite` + FTS5 (BM25)** backend (`scripts/storage/`) for sub-millisecond indexed search.

### 2) Blocks Bulk Commits (`git add .`) & Automates Archiving
- **Problem**: Letting agents run `git add .` mixes unrelated files into one commit and leaves `task.md` out of sync.
- **Solution**: `scripts/group-status.cjs` isolates `[Ready]` tasks (`TSK-X`), checks `git diff --cached --check`, executes per-task atomic commits, and immediately archives completed items with their commit SHA into `task-completed.md`.

### 3) Prevents Premature Completion & Enforces Commit Gates
- **Problem**: Agents frequently declare tasks "done" or commit immediately after writing code without verification or user consent.
- **Solution**: Requires the `[Ready]` state with all 3 elements (`Purpose`, `Results`, `Targets`) and waits for explicit user commit instruction (`commit` / `apply`) before executing `npm run git:commit`.

### 4) Sample-Only Isolation & Collision-Free Short IDs (`short-id`)
- **Problem**: Sequential numbering (`TSK-1`, `P-01`, `LOG-01`) causes ID collisions across developers, worktrees, and parallel agents—and pre-filled numbered examples trick agents into treating boilerplate as real work.
- **Solution**: All template examples use `TSK-SAMPLE`, `P-00`, and `LOG-00` (ignored by parsers), while all new records issue immutable 6-char Crockford Base32 short IDs (`TSK-K7M29A`, `P-M3N8Q2`, `LOG-R9A4C1`) with zero configuration, prefix lookup (`K7M2`), and 100% backward compatibility for existing legacy sequential IDs.

### 5) 100% Reversible Uninstall & Non-Git Support
- Backed by `scripts/acm-manifest.cjs` and Drift Detection across both English and Korean canonical rules, `npx agent-context-memory uninstall` safely restores rule files and removes ACM assets. Non-Git projects fall back cleanly to the Memory Viewer mode.

---

## 5. Three-Tier Data Model & Local-First SQLite Storage

ACM runs **Local-First SQLite (`node:sqlite` + FTS5 BM25)** at `.agents/local/memory.db` (configured in `.agents/config.json`, ignored from code branches via `.gitignore`) with automatic Markdown projections to `.agents/task/`, plus a pluggable `MemoryStore` registry (`registerProvider()`) ready for optional future online/cloud adapters:

| Tier | Markdown View / Canonical Path | SQLite & Search Storage | Governance & Purpose |
| :--- | :--- | :--- | :--- |
| **L0 (Rules)** | `AGENTS.md` (guardrails)<br>`.agents/rules/60-task-memory-adr.md`<br>`.agents/MEMORY_GOVERNANCE.md` | `.agents/config.json` | 6 strict core guardrails always injected; detailed ADR/pattern/storage specs loaded on demand. |
| **L1 (Working Memory)** | `.agents/task/task.md` (**<= 5KB**) | `tasks` table + `memory_fts` | Single source of truth for active tasks (`TSK-XXXXXX` / legacy `TSK-{N}`), lease locks, and `[Ready]` 3-element validation. |
| **L2 (Long-Term Memory)** | `.agents/memory/patterns-index.md`<br>`.agents/memory/patterns/P-XX-*.md`<br>`.agents/memory/project-changelog.md` | `patterns` + `adrs` tables + FTS5 BM25 | **Zero-Token Lookup**: instant FTS5 BM25 / token-budget search (`acm search` / MCP) + `supersedes` versioning + Grep index fallback. |
| **L3 (Cold Archive)** | `.agents/task/task-completed.md`<br>`.agents/memory/archive/` | `tasks (status='done')` + `sync_log` | Permanent history of committed tasks with verified commit SHAs and orphan-branch sync records. |

---

## 6. CLI, Git Orphan Sync & MCP Reference

### 1) Core & Task-Centric Git CLI Commands

```bash
# Install templates & initialize (EN/KO prompt, SQLite/Markdown backend)
npx agent-context-memory init [path] [options]

# Inspect task-centric Git status (or Memory Viewer in non-Git environments)
npx agent-context-memory status
npx agent-context-memory status --compact

# Commit all [Ready] tasks atomically and auto-archive to SQLite & task-completed.md
npx agent-context-memory commit
npx agent-context-memory commit --commit=K7M2   # supports group index, exact ID, or 3-5 char prefix

# Smart 3-Way pull & hybrid conflict resolution (Git only)
npx agent-context-memory pull
npx agent-context-memory resolve

# Pre-push hygiene & local SQLite leak audit (blocks *.db / *.db-wal / *.db-shm)
npx agent-context-memory audit

# Diagnose Git availability and repository status
npx agent-context-memory check-git

# Safely roll back and remove ACM assets (--dry-run supported)
npx agent-context-memory uninstall [path] [options]
```

### 2) Local DB CLI & Team Git Orphan Sync (`acm`)

All DB subcommands support `--json` output and `--stdin` JSON input for zero-quoting script/agent reliability:

```bash
# Issue collision-free 6-char short IDs for manual Markdown edits
npx agent-context-memory id task
npx agent-context-memory id pattern --count=3

# Tasks, patterns, ADRs, and full-text BM25 search with token budget packing
npx agent-context-memory task list
npx agent-context-memory task add "Implement OAuth" --status=in_progress --owner=agent-1
npx agent-context-memory task show K7M2
npx agent-context-memory search "atomic commit" --kind=all --budget=1500
npx agent-context-memory pattern add "Git Pager Fix" --supersedes=P-M3N8Q2
npx agent-context-memory adr add "Adopt Local SQLite" --task=TSK-K7M29A --area="scripts/storage/"

# Switch backends & snapshot portability
npx agent-context-memory migrate --to=sqlite
npx agent-context-memory export --format=json --out=.agents/backup.json
npx agent-context-memory import .agents/backup.json --strategy=merge

# Sync shared memories (patterns, ADRs, done tasks) via Git orphan branch 'acm-memory'
# Runs pure Git Plumbing (GIT_INDEX_FILE), LWW/code-collision merge, & outbound Secret Scrubber
npx agent-context-memory sync --status
npx agent-context-memory sync --pull
npx agent-context-memory sync --push --dry-run
npx agent-context-memory sync
```

### 3) Daemonless Stdio MCP Server (`acm mcp`)

Expose 9 structured tools (`acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`) over newline-delimited JSON-RPC 2.0 on stdio with zero external dependencies:

```bash
# Print ready-to-paste MCP client JSON configs (Antigravity, Claude Code, Cursor, etc.)
npx agent-context-memory mcp --print-config

# Start stdio MCP server directly
npx agent-context-memory mcp
```

Example `mcpServers` snippet (generated by `acm mcp --print-config`):

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

### 4) Injected `package.json` Scripts

```bash
npm run git:status      # Preview task groupings & commit messages (--dry-run)
npm run git:summary     # Ultra-compact 1-line summary for AI agents (--compact)
npm run git:commit      # Commit all [Ready] tasks & auto-archive (--all)
npm run git:pull        # Pre-check + smart 3-Way remote merge
npm run git:resolve     # Finish conflict resolution & run quality gates
npm run git:audit-push  # Pre-push hygiene audit
```

---

## 7. Repository Structure

```text
agent-context-memory/
├── acm-template/               # Distributable clean boilerplate (English default)
│   ├── .agents/                # Non-polluted samples (TSK-SAMPLE, P-00, LOG-00), rules, agents, skills, hooks
│   └── locales/ko/             # Korean (.md) template overlay selected via --lang=ko or interactive prompt
├── .agents/                    # Dogfooding workspace for developing ACM itself
├── bin/                        # Unified CLI entry point (agent-context-memory.js)
├── scripts/                    # Canonical runtime engines, installer/uninstaller, manifest, i18n, CLI, MCP, storage
│   ├── i18n.cjs                # Zero-dependency EN/KO i18n resolver
│   ├── locales/                # en.cjs (default) and ko.cjs message catalogs
│   ├── acm-db-cli.cjs          # MemoryStore CLI (task, pattern, adr, search, migrate, export, import, sync)
│   ├── mcp-server.cjs          # Zero-dependency stdio JSON-RPC 2.0 MCP server
│   └── storage/                # MemoryStore, node:sqlite FTS5, Markdown bridge, Git orphan sync, Secret Scrubber
├── tests/                      # Git E2E, Non-Git, SQLite, DB CLI, Git orphan sync, and MCP server tests
├── README.md                   # English documentation (default)
├── README.ko.md                # Korean documentation
└── LICENSE                     # MIT License
```

---

## 8. Comparison

| Feature | Conventional Workflow | Agent Context Memory (ACM) |
| :--- | :--- | :--- |
| **Memory Persistence** | Context lost when chat session ends | Lossless persistence across L1/L2/L3 files and optional SQLite FTS5 |
| **Token Overhead** | Re-reads thousands of lines every turn | Micro-guardrails + index tables (`patterns-index`, `ADR Index Map`) |
| **Task Tracking & Archiving** | Manual updates often skipped by agents | Auto-archives to `task-completed.md` with commit SHA on `npm run git:commit` |
| **Commit Hygiene** | `git add .` bundles unrelated changes | Isolates `[Ready]` tasks (`TSK-X`) with built-in `diff --check` |
| **Non-Git Resilience** | Scripts crash outside Git repositories | Graceful fallback to 3-tier Memory Viewer and user confirmation gate |
| **Safe Uninstallation** | Manual cleanup risks deleting user rules | Manifest-driven rollback with EN/KO drift detection |

---

## 9. License

Provided under the [MIT License](LICENSE).

- Author: Rock Beider
- Repository: [https://github.com/rockbeider/agent-context-memory](https://github.com/rockbeider/agent-context-memory)

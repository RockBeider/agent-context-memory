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

During interactive installation, ACM prompts you to choose **English (Default)** or **한국어 (Korean)** (`--lang=en|ko` or `ACM_LANG` for non-interactive/scripted installs). When no existing agent rule file is detected, you can multi-select rule files using arrow keys and `Space` (non-interactive mode defaults to `en` and `AGENTS.md`).

### Option A. One-Shot `npx` Execution (Recommended)

Run directly inside any new or existing project directory—no `init` subcommand required:

```bash
# Interactive setup: select language (English default / Korean) & rule files
npx -y agent-context-memory

# Install non-interactively in English (default) or Korean
npx -y agent-context-memory --non-interactive
npx -y agent-context-memory --lang=ko --non-interactive

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

### 4) Sample-Only Isolation (Zero Boilerplate Pollution)
- **Problem**: Template files pre-filled with `TSK-1`, `P-01`, or `LOG-01` trick agents into treating samples as real work.
- **Solution**: All template examples use `TSK-SAMPLE`, `P-00`, and `LOG-00`, ignored by parsers so every project starts cleanly at `TSK-1`, `P-01`, and `LOG-01`.

### 5) 100% Reversible Uninstall & Non-Git Support
- Backed by `scripts/acm-manifest.cjs` and Drift Detection across both English and Korean canonical rules, `npx agent-context-memory uninstall` safely restores rule files and removes ACM assets. Non-Git projects fall back cleanly to the Memory Viewer mode.

---

## 5. Three-Tier Data Model Specification

| Tier | Path | Cap | Governance & Purpose |
| :--- | :--- | :--- | :--- |
| **L0 (Rules)** | `AGENTS.md` (guardrails)<br>`.agents/rules/60-task-memory-adr.md`<br>`.agents/MEMORY_GOVERNANCE.md` | ~140 tokens always-on | 6 strict core guardrails always injected; detailed ADR/pattern/non-Git specs loaded on demand. |
| **L1 (Working Memory)** | `.agents/task/task.md` | **<= 5KB** | Single source of truth for active tasks. Immutable `TSK-{N}` IDs and `[Ready]` 3-element format. |
| **L2 (Long-Term Memory)** | `.agents/memory/patterns-index.md`<br>`.agents/memory/patterns/P-XX-*.md`<br>`.agents/memory/project-changelog.md` | ~5 lines/shard | **Zero-Token Grep**: search index tables first and read only matched `P-XX` or `[LOG-XX]` blocks. |
| **L3 (Cold Archive)** | `.agents/task/task-completed.md`<br>`.agents/memory/archive/` | Unlimited | Permanent history of committed tasks with verified commit SHAs (or Non-Git approval timestamps). |

---

## 6. CLI & npm Scripts Reference

### 1) CLI Commands

```bash
# Install templates & initialize (interactive EN/KO prompt or --lang=en|ko)
npx agent-context-memory init [path] [options]

# Inspect task-centric Git status (or Memory Viewer in non-Git environments)
npx agent-context-memory status
npx agent-context-memory status --compact

# Commit all [Ready] tasks atomically and auto-archive to task-completed.md
npx agent-context-memory commit
npx agent-context-memory commit --commit=TSK-1

# Smart 3-Way pull & hybrid conflict resolution (Git only)
npx agent-context-memory pull
npx agent-context-memory resolve

# Pre-push static & temporary-file hygiene audit
npx agent-context-memory audit

# Diagnose Git availability and repository status
npx agent-context-memory check-git

# Safely roll back and remove ACM assets (--dry-run supported)
npx agent-context-memory uninstall [path] [options]
```

### 2) Injected `package.json` Scripts

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
├── acm-template/           # Distributable clean boilerplate (English default)
│   ├── .agents/            # Non-polluted samples (TSK-SAMPLE, P-00, LOG-00), rules, agents, skills, hooks
│   ├── locales/ko/         # Korean (.md) template overlay selected via --lang=ko or interactive prompt
│   └── scripts/            # Runtime engines, i18n catalogs, and SQLite/Markdown storage providers
├── .agents/                # Dogfooding workspace for developing ACM itself
├── bin/                    # Unified CLI entry point (agent-context-memory.js)
├── scripts/                # Installer, uninstaller, manifest, i18n, runtime engines, storage providers
│   ├── i18n.cjs            # Zero-dependency EN/KO i18n resolver
│   ├── locales/            # en.cjs (default) and ko.cjs message catalogs
│   └── storage/            # MemoryStore abstraction, node:sqlite FTS5 engine, Markdown bridge
├── tests/                  # Git E2E, Non-Git compatibility, i18n, and SQLite test suites
├── README.md               # English documentation (default)
├── README.ko.md            # Korean documentation
└── LICENSE                 # MIT License
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

# Agent Context Memory (ACM)

**English** | [한국어](./README.ko.md)

A **lightweight, local-first memory & task-based Git tool** for AI coding agents (Antigravity IDE, Claude Code, Cursor, Windsurf, Codex, Copilot, OpenCode, and more).

Because it needs no external server or complex setup, **Agent Context Memory (ACM)** is a great fit for **solo developers and small teams**. Instead of pasting long chat logs or entire docs into every new chat, it pulls in only your active tasks, reusable tips, and key design decisions (ADRs). You **keep token usage low while carrying context smoothly across sessions**.

It also keeps your Git history clean. Rather than letting an AI bundle unrelated changes with `git add .`, ACM commits work one task at a time and moves finished tasks to your archive automatically. If a folder does not use Git, it still works cleanly as a local memory manager without crashing.

---

## 1. How It Works

ACM organizes project context into three simple layers—what you are doing now, what you want to remember, and what you already finished. Your agent reads only a tiny set of core rules upfront and looks up past notes on demand, keeping token usage small.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          L0. Core Rules                                 │
│    AGENTS.md (6 core guardrails) + .agents/rules/acm-task-memory-adr.md │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ guides
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ L1. Working Memory              │     │ L2. Long-Term Knowledge         │
│ .agents/acm/task/task.md        │     │ .agents/acm/memory/             │
│ (5KB cap, active tasks)         │     │ ├─ patterns-index.md (keywords) │
└────────────────┬────────────────┘     │ ├─ patterns/P-XX-*.md (fixes)   │
                 │                      │ └─ project-changelog.md         │
                 │ Save patterns / ADRs │    (Top index map + details)    │
                 ├──────────────────────┴────────────────┬────────────────┘
                 │ [Ready] Purpose / Results / Targets documented
                 ▼
┌─────────────────────────────────┐
│          CLI Engine             │
│  scripts/acm/group-status.cjs   │
│ (Task commits + auto-archive)   │
└────────────────┬────────────────┘
                 │ Git: auto-archive on commit / Non-Git: user approval
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         L3. Completed Archive                           │
│        .agents/acm/task/task-completed.md (Finished task history)       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Task Flow

```text
                 ┌─────────────────────────────────┐
                 │     [ ] Registered (TSK-X)      │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │   [In Progress] Build & Test    │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │   [Ready] Summary Recorded      │
                 │  (Purpose / Results / Targets)  │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                          < Git Available? >
                                  │
                ┌─────────────────┴─────────────────┐
              [Yes]                               [No]
                ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│      npm run acm:commit       │   │     Report Results to User    │
│ (conflict check + task commit │   │     & Archive After Approval  │
│  + auto-archive with SHA)     │   └───────────────┬───────────────┘
└───────────────┬───────────────┘                   │
          (Commit SHA)                       (User Approval)
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │          [x] Completed          │
                 │  (Saved in task-completed.md)   │
                 └─────────────────────────────────┘
```

---

## 2. Quick Start

All you need is Node.js (`>=22.13.0` for built-in `node:sqlite`). Set up ACM in any project with a **single command**.

During setup, you pick two things:
- **Language**: English (default) or Korean (`--lang=en|ko` or `ACM_LANG`)
- **Storage**: **Local SQLite DB (Recommended)** (`--storage=sqlite`) or **Markdown Files Only** (`--storage=markdown`)

If your project already has Markdown records in `.agents/acm/` (or legacy `.agents/`), ACM imports them into `.agents/acm/local/memory.db` automatically. When no agent rule file is found yet, you can select one or more using the arrow keys and `Space` (non-interactive installs default to `en`, `sqlite`, and `AGENTS.md`).

### Option A. Run with `npx` (Recommended)

```bash
# Interactive setup: choose language, storage (SQLite recommended), and rule files
npx -y agent-context-memory

# Non-interactive / AI agent / CI setup (no prompts, preserves existing backups without blocking)
npx -y agent-context-memory init --non-interactive --no-restore-backup
npx -y agent-context-memory init --lang=ko --storage=sqlite --non-interactive --no-restore-backup
# Or set ACM_NON_INTERACTIVE=1 (CI=true is also auto-detected)
ACM_NON_INTERACTIVE=1 npx -y agent-context-memory init --lang=ko

# Use SQLite while also keeping .agents/acm/task/*.md synced (off by default)
npx -y agent-context-memory init --markdown-projection

# Use Markdown-only mode instead of SQLite
npx -y agent-context-memory init --storage=markdown

# Install into a specific folder
npx -y agent-context-memory ./my-project

# Target specific rule file(s) (comma-separated)
npx -y agent-context-memory ./my-project --rule-file=CLAUDE.md,AGENTS.md

# Overwrite existing ACM template files with the latest version
npx -y agent-context-memory --force
```

### Option B. Install with `npm install` (`postinstall`)

Adding ACM as a dev dependency sets up your project automatically during install:

```bash
# Auto-initialize with English defaults
npm install -D agent-context-memory

# Auto-initialize in Korean
ACM_LANG=ko npm install -D agent-context-memory

# Install the package without running auto-setup
ACM_SKIP_POSTINSTALL=1 npm install -D agent-context-memory
```

### Option C. Global CLI

```bash
npm install -g agent-context-memory

acm
acm --lang=ko
acm status
```

### Option D. Local Installer Script

```bash
node scripts/acm/install-template.cjs /path/to/my-project
node scripts/acm/install-template.cjs /path/to/my-project --lang=ko --rule-file=CLAUDE.md,GEMINI.md
```

---

## 3. Supported AI Coding Tools

ACM works with any IDE or agent. It finds your root rule files and inserts its own marked block (`<!-- ACM_GOVERNANCE_START -->`) without touching your existing instructions.

| AI Coding Tool | Target Rule File(s) | What Gets Connected |
| :--- | :--- | :--- |
| **Antigravity IDE** | `AGENTS.md` / `GEMINI.md` | `.agents/acm/` workspace, `acm-task-memory-adr.md`, `hooks.json` (`acm-token-monitor`), subagents (`acm-git-release-sentinel`, `acm-context-compactor`) |
| **Claude Code** | `CLAUDE.md` | Core rules injected automatically, plus `scripts/acm/group-status.cjs` for task-based commits and archiving |
| **Cursor** | `.cursorrules` / `.cursor/rules/*.mdc` | Three-tier memory rules and 5KB-capped active task tracking |
| **Windsurf** | `.windsurfrules` | Cascade guardrails and task-state context alignment |
| **Codex / Copilot** | `AGENTS.md` / `.github/copilot-instructions.md` | Standard memory rules and quick `ADR Index Map` history lookup |
| **OpenCode** | `AGENTS.md` | Markdown rule contract and lightweight keyword search |

---

## 4. Why Use ACM?

### 1) Save Tokens While Bridging Sessions
- **The pain**: In long chats or fresh sessions, AI agents forget earlier decisions. Feeding them entire doc folders every turn burns through tokens fast.
- **How ACM helps**: Active work in `task.md` stays **under 5KB**. Past fixes (`patterns-index.md`) and design notes (a 35-line `ADR Index Map` at the top of `project-changelog.md`) are looked up on demand—or searched instantly with local **`node:sqlite` + FTS5** (`scripts/acm/storage/`) so only relevant snippets enter the prompt.

### 2) Clean Per-Task Commits Instead of `git add .`
- **The pain**: Letting an agent run `git add .` mixes unrelated edits into one messy commit and often leaves task lists out of date.
- **How ACM helps**: `scripts/acm/group-status.cjs` picks up only `[Ready]` tasks (`TSK-X`), checks for conflict markers via `git diff --cached --check`, commits each task separately, and moves completed items with their commit SHA into `task-completed.md` in one step.

### 3) No More Premature "Done" or Unasked Commits
- **The pain**: Agents often mark work complete right after editing code—before testing or getting your go-ahead to commit.
- **How ACM helps**: Finished work pauses in `[Ready]` with three quick notes (**Purpose**, **Results**, **Targets**). Nothing gets committed or archived until you explicitly ask to commit and run `npm run acm:commit`.

### 4) Clear Sample Separation & Collision-Free Short IDs
- **The pain**: Numbered IDs (`TSK-1`, `P-01`, `LOG-01`) collide easily across machines, worktrees, or parallel agents—and numbered examples in templates can trick agents into treating samples as real tasks.
- **How ACM helps**: Template examples use `TSK-SAMPLE`, `P-00`, and `LOG-00` (ignored by parsers). Every new record automatically gets a collision-free 6-character short ID (`TSK-K7M29A`, `P-M3N8Q2`, `LOG-R9A4C1`). You can look up items with just the first 3–5 characters (`K7M2`), and older numbered IDs still work as-is.

### 5) Safe Uninstall & Non-Git Support
- ACM tracks everything it installs in `.agents/acm/meta.json` (v2) and `scripts/acm/acm-manifest.cjs`.
- Running `npx agent-context-memory uninstall` lets you choose whether to back up `.agents/acm` and where to store it (`Local` `.acm-backup-*.zip` by default, `--backup-format=zip|tar.gz|dir`, or isolated Git orphan branch `acm-backups` via `--backup-target=local|git|both`), then removes only ACM files while leaving your own `.agents/`, `scripts/`, and custom hooks untouched. On re-install, `init` automatically detects local and Git backups so you can restore (`--restore-backup`) or start fresh. Outside Git repositories, `scripts/acm/check-git.cjs` switches cleanly to Memory Viewer mode.

---

## 5. Three-Tier Memory & Local SQLite

By default, ACM stores everything in a single local database at `.agents/acm/local/memory.db` (**`node:sqlite` + FTS5 BM25**, configured in `.agents/acm/config.json` and kept out of code branches via `.gitignore`).

Because `storage.markdownProjection` is `false` by default, ACM avoids writing duplicate Markdown files that could drift out of sync with SQLite. Whenever you want readable Markdown files, run `acm export --format=md`, or turn on live file syncing with `--markdown-projection` / `acm config set storage.markdownProjection true`. Legacy Markdown-only mode (`--storage=markdown`) and custom adapters (`registerProvider()`) remain supported.

| Tier | Markdown Path | SQLite Table | What It Holds |
| :--- | :--- | :--- | :--- |
| **L0 (Core Rules)** | `AGENTS.md` (guardrails)<br>`.agents/rules/acm-task-memory-adr.md`<br>`.agents/acm/ACM_GOVERNANCE.md` | `.agents/acm/config.json` | 6 short rules always loaded; full specs are read only when needed. |
| **L1 (Working Memory)** | `.agents/acm/task/task.md` (**<= 5KB**) | `tasks` + `memory_fts` | Active and `[Ready]` tasks (`TSK-XXXXXX` or legacy `TSK-{N}`), agent lease locks, and pre-commit checks. |
| **L2 (Long-Term Knowledge)** | `.agents/acm/memory/patterns-index.md`<br>`.agents/acm/memory/patterns/P-XX-*.md`<br>`.agents/acm/memory/project-changelog.md` | `patterns` + `adrs` + FTS5 BM25 | Reusable fixes and architecture decisions (ADRs). Searchable within a token budget via `acm search` or MCP, with `supersedes` version links. |
| **L3 (Archive)** | `.agents/acm/task/task-completed.md`<br>`.agents/acm/memory/archive/` | `tasks (status='done')` + `sync_log` | Completed tasks with their verified commit SHAs and shared-branch sync history. |

---

## 6. CLI Commands, Sync & MCP

### 1) Core & Git Commands

```bash
# Install templates and initialize (choose language and SQLite/Markdown)
npx agent-context-memory init [path] [options]

# Preview task file groupings (or view your 3-tier memory outside Git)
npx agent-context-memory status
npx agent-context-memory status --compact

# Commit all [Ready] tasks one by one and archive them automatically
npx agent-context-memory commit
npx agent-context-memory commit --commit=K7M2   # supports index, full ID, or 3-5 char prefix

# Safely pull and merge remote changes (3-Way merge, Git only)
npx agent-context-memory pull
npx agent-context-memory resolve

# Check before pushing (blocks temp files, local *.db / *.db-wal / *.db-shm leaks, conflict markers)
npx agent-context-memory audit

# Check whether Git is installed and initialized in the current folder
npx agent-context-memory check-git

# Back up and safely remove ACM files (--dry-run supported)
npx agent-context-memory uninstall [path] [options]
# Recommended for AI agents / CI (skips prompts, keeps default backup & modified rule blocks)
npx -y agent-context-memory uninstall --non-interactive --backup-target=local
```

### 2) Local DB & Small-Team Sync (`acm`)

All DB commands accept `--stdin` JSON input and return `--json` output, making them reliable for scripts and agents without shell quoting headaches:

```bash
# Generate collision-free 6-char IDs for manual Markdown edits
npx agent-context-memory id task
npx agent-context-memory id pattern --count=3

# Manage tasks, patterns, ADRs, and token-budgeted search
npx agent-context-memory task list
npx agent-context-memory task add "Implement OAuth" --status=in_progress --owner=agent-1
npx agent-context-memory task show K7M2
npx agent-context-memory search "atomic commit" --kind=all --budget=1500
npx agent-context-memory pattern add "Git Pager Fix" --supersedes=P-M3N8Q2
npx agent-context-memory adr add "Adopt Local SQLite" --task=TSK-K7M29A --area="scripts/acm/storage/"

# Switch storage modes, export Markdown, or back up / restore JSON
npx agent-context-memory migrate --to=sqlite
npx agent-context-memory export --format=md --out=.agents/acm/exported-md
npx agent-context-memory export --format=json --out=.agents/acm/backup.json
npx agent-context-memory import .agents/acm/backup.json --strategy=merge

# Clean up old records, inspect config, and view stats
npx agent-context-memory compact
npx agent-context-memory config show
npx agent-context-memory config set storage.markdownProjection true
npx agent-context-memory stats

# Local Viewer (terminal text/TUI, one-shot browser UI, and offline HTML snapshot)
npx agent-context-memory view --tab=tasks
npx agent-context-memory ui
npx agent-context-memory export --format=html --out=.agents/acm/viewer-snapshot.html

# Share patterns, ADRs, and done tasks across machines or teammates via orphan branch 'acm-memory'
# Uses isolated Git plumbing (GIT_INDEX_FILE) so your working branch stays clean, with automatic secret scrubbing
npx agent-context-memory sync --status
npx agent-context-memory sync --pull
npx agent-context-memory sync --push --dry-run
npx agent-context-memory sync
```

### 3) Zero-Setup Stdio MCP Server (`acm mcp`)

Expose 12 structured tools (`acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`, `acm_compact`, `acm_viewer` IDE side-pane UI via `ui://acm/viewer.html`, and app-only `acm_viewer_data`) over standard stdio JSON-RPC 2.0—no background daemon or extra packages needed:

```bash
# Print ready-to-paste MCP config JSON for Antigravity, Claude Code, Cursor, etc.
npx agent-context-memory mcp --print-config

# Run the stdio MCP server directly
npx agent-context-memory mcp
```

Example `mcpServers` snippet (from `acm mcp --print-config`):

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

### 4) Shortcut Scripts Added to `package.json`

```bash
npm run acm:status      # Preview task groupings & commit messages (--dry-run)
npm run acm:summary     # One-line summary to save agent tokens (--compact)
npm run acm:commit      # Commit all [Ready] tasks & archive them (--all)
npm run acm:pull        # Safe remote pull with 3-Way merge
npm run acm:resolve     # Verify conflict resolution & run checks
npm run acm:audit-push  # Pre-push check for temp files, DB leaks, and conflict markers
```

---

## 7. Repository Structure

```text
agent-context-memory/
├── acm-template/               # Clean starter template installed into target projects (English default)
│   ├── .agents/                # Safe samples (TSK-SAMPLE, P-00, LOG-00), acm/ folder, rules/agents/skills, hooks
│   └── locales/ko/             # Korean template overlay applied when --lang=ko is chosen
├── .agents/                    # ACM's own local workspace for developing this repo
├── bin/                        # CLI entry point (agent-context-memory.js)
├── scripts/acm/                # Runtime scripts, installer/uninstaller, i18n, DB CLI, MCP server, storage
│   ├── i18n.cjs                # Zero-dependency EN/KO message resolver
│   ├── locales/                # en.cjs (default) and ko.cjs message catalogs
│   ├── acm-db-cli.cjs          # DB CLI (task, pattern, adr, search, migrate, export, import, sync)
│   ├── mcp-server.cjs          # Stdio JSON-RPC 2.0 MCP server
│   └── storage/                # MemoryStore, node:sqlite FTS5, Markdown bridge, Git sync, secret scrubber
├── tests/                      # Automated tests for Git, Non-Git, SQLite, CLI, sync, and MCP
├── README.md                   # English guide (default)
├── README.ko.md                # Korean guide
└── LICENSE                     # MIT License
```

---

## 8. Before vs. After ACM

| Area | Typical Workflow | With Agent Context Memory (ACM) |
| :--- | :--- | :--- |
| **Across Sessions** | Context disappears when a chat ends | Tasks, patterns, and ADRs stay saved locally and carry into the next session |
| **Token Usage** | Re-reads long docs or chat logs every turn | Tiny core rules + index/search load only what is needed |
| **Task Tracking** | Agents forget to update or archive task lists | `npm run acm:commit` commits and archives finished tasks with commit SHAs automatically |
| **Commit Hygiene** | `git add .` mixes unrelated files together | Commits only `[Ready]` tasks (`TSK-X`) separately after checking for conflict markers |
| **Non-Git Folders** | Git-only scripts crash | Auto-detects non-Git folders and switches to Memory Viewer with user approval |
| **Safe Removal** | Manual cleanup can break your own rules | Manifest-tracked uninstall backs up data and removes only ACM files |

---

## 9. License

Released under the [MIT License](LICENSE). Free to use and adapt in personal or team projects.

- Author: Rock Beider
- Repository: [https://github.com/rockbeider/agent-context-memory](https://github.com/rockbeider/agent-context-memory)

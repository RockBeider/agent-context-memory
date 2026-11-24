# Agent Context Memory Governance Rules (Canonical Spec)

> Runtime standard guardrails for the Three-Tier Cognitive Memory Model.

---

## 1. Three Canonical Stores & Immutable IDs
1. **Working Memory (L1)**: `.agents/task/task.md`
   - Single Source of Truth for active tasks, kept at **<= 5KB** (temporary overflow is allowed only while multiple `[Ready]` tasks await commit approval, resolved automatically upon commit).
   - ID format: `TSK-XXXXXX` (immutable 6-char Crockford Base32 starting with an alpha char, issued via `acm task add` / `acm id` / MCP; legacy `TSK-{N}` supported). Never invent random IDs manually; exclude `TSK-SAMPLE` from parsing and execution.
   - Supported formats: bullet style (`- [Status] **TSK-XXXXXX. Title**`) or heading style (`### TSK-XXXXXX. Title` with `- **Status**: [Status]`).
2. **Long-Term Knowledge (L2)**: `.agents/memory/patterns-index.md` / `patterns/`
   - Pattern ID: `P-XXXXXX` (issued via `acm pattern add` / `acm id pattern` / MCP; legacy `P-{NN}` supported; exclude `P-00` sample).
   - Store concise 5-6 line summaries in `patterns/P-XXXXXX-*.md` (or legacy `patterns/P-XX-*.md`) and register a 1-row index entry in `patterns-index.md`.
3. **Macro ADR Log (L2)**: `.agents/memory/project-changelog.md`
   - ADR ID: `LOG-XXXXXX` (issued via `acm adr add` / `acm id adr` / MCP; legacy `LOG-{NN}` supported; exclude `LOG-00` sample).
   - Dual structure: top `## 1. ADR Index Map` summary table + bottom `## 2. Architecture Decision Details` (`### [LOG-XXXXXX]` prepended).
4. **Cold Archive (L3)**: `.agents/task/task-completed.md`
   - Permanent store for completed tasks with verified Git commit SHAs (or Non-Git user approval timestamps).

---

## 2. Task Lifecycle, Execution Gate & Atomic Git Governance
1. **Status Lifecycle**: `[ ]` (Todo) -> `[In Progress]` -> `[Ready]` (verified) -> `[x]` (committed).
2. **Required 3 Elements for `[Ready]`**:
   - Before any commit (including minor edits), update the task in `task.md` to `[Ready] TSK-XXXXXX` with all 3 elements so `group-status.cjs` can generate commit messages and archive automatically:
     - `- **Purpose**:` One-line summary of background and goal
     - `- **Results**:` File-by-file change bullets (<= 5 lines)
     - `- **Targets**:` All modified file or directory paths (in backticks)
3. **Execution Gate**:
   - **Single-Task One-Stop Execution**: Execute all sub-steps within a single `TSK-X` under its initial plan approval without intermediate pauses, verify, and report via `walkthrough.md`.
   - **Multi-Phase Gate**: Only multi-`TSK` plans require per-phase verification reports and approval between phases.
   - **Task-Only Command (`/task`, `/태스크`)**: Skip codebase exploration and formal plans ONLY when viewing, adding, or updating `task.md`; code implementation follows the standard execution gate.
4. **Explicit Commit Approval Gate & Auto-Archiving**:
   - **Commit on Explicit Approval ONLY**: Plan approval does NOT authorize Git commits. After updating `task.md` to `[Ready]` and reporting verification, run `npm run git:commit` (`node scripts/group-status.cjs --all`) ONCE **only upon explicit user commit instruction** (e.g. "commit", "apply").
   - **Git One-Stop Commit & Archive**: `group-status.cjs --all` filters `[Ready]` tasks only, runs `git diff --cached --check`, creates per-task atomic commits (obtaining SHAs), and auto-archives into `task-completed.md` while cleaning `task.md`. Unmapped working tree files are safely preserved.
   - **Non-Git Manual Approval Archive**: In non-Git environments, report verification results to the user, obtain confirmation, and archive with `(Completed: YYYY-MM-DD / Non-Git)`.
   - **Strict `.agents/` Local Isolation**: In host projects, `.agents/` is local-only via `.gitignore`; never attempt a secondary Git commit for `.agents/` files.

---

## 3. Zero-Token On-Demand Search (Just-In-Time Grep)
1. **No Eager Full Reads**: Never read all files under `patterns/` or full history files at session start.
2. **Targeted Index Grep**: Use `grep_search` on the Summary column of `patterns-index.md` by keyword and load ONLY matched `patterns/P-*-*.md` shards (skip `P-00`).
3. **Bypass Prefixes**: Skip knowledge search on `/skip`, `/task`, `/태스크`, or pure Q&A.
4. **Post-Verification Distillation**: Distill confirmed reusable solutions into a new `P-XXXXXX` file and add 1 row to `patterns-index.md` per [.agents/rules/60-task-memory-adr.md](.agents/rules/60-task-memory-adr.md).

---

## 4. Conditional Index-First ADR Reads
1. **No Routine Reads**: Do not read `project-changelog.md` during normal feature tasks (keep at 0 tokens).
2. **3 Conditional Triggers**:
   - 1) Global infrastructure or config modifications
   - 2) Regression root-cause tracing
   - 3) Immediately after major remote merges
   - Only on these triggers, slice-read the top `ADR Index Map` (lines 1-35) or `grep_search` to pinpoint the relevant `LOG-*`, then read that section only.
3. **Recording ADRs**: On macro architectural decisions, prepend 1 summary row to `ADR Index Map` and prepend `### [LOG-XXXXXX] [YYYY-MM-DD] Title` under details.

---

## 5. Multi-Agent Concurrency & Path Isolation
1. **Exclusive Task Ownership**: In multi-agent workflows, annotate owner (`- [In Progress (Agent: ID)]`) and never interfere with tasks owned by another agent.
2. **Disjoint Target Paths**: Parallel tasks must NEVER share overlapping `Targets` paths (serialize tasks touching shared files).
3. **Atomic Short-ID Issuance**: Always issue `TSK-XXXXXX`, `P-XXXXXX`, or `LOG-XXXXXX` via `acm` CLI (`id`, `task add`, `pattern add`, `adr add`) or MCP tools (`crypto.randomBytes`) rather than inventing random strings manually.
4. **Serialized Git Operations**: Execute staging and commits sequentially to prevent `.git/index.lock` collisions.

---

## 6. Storage Modes, DB CLI, Git Orphan Sync & MCP Server
1. **Local-First SQLite Default & Legacy Fallback**:
   - On Node.js >= 22.13.0, `acm init` defaults `.agents/config.json` to `sqlite` (`.agents/local/memory.db`, `.gitignore`d) with built-in FTS5 BM25 indexing and automatic Markdown projection (`.agents/task/task.md`, `.agents/task/task-completed.md`).
   - Legacy projects or older Node.js runtimes operate transparently in `markdown` mode (`--storage=markdown`), and future remote/cloud backends plug into `registerProvider()`.
2. **Structured CLI & Daemonless Stdio MCP Access**:
   - Use `acm` DB subcommands (`id`, `task`, `pattern`, `adr`, `search`, `migrate`, `export`, `import`) with `--json` / `--stdin`, or run the zero-dependency JSON-RPC 2.0 stdio MCP server (`acm mcp`, `acm mcp --print-config`).
   - Exposed MCP tools: `acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`.
3. **Git Orphan Branch Collaboration (`acm sync`)**:
   - Shared patterns, ADRs, and archived tasks sync across clones via a dedicated orphan branch (`acm-memory`) using pure Git Plumbing (`GIT_INDEX_FILE`), deterministic JSONL, and structural LWW / fallback short-id collision resolution without touching code branches.
   - Outbound payloads pass through the built-in Secret Scrubber (`--no-scrub` to inspect raw overrides), and `audit-push` blocks accidental commits of `.agents/local/*.db*` / WAL / SHM files.

# Project Changelog & Architecture Decision Records (ADR)

> [!IMPORTANT]
> **Zero-Token On-Demand & Index-First Principle**:
> 1. This document records macro Architecture Decision Records (ADRs) and major system changes only.
> 2. For each new decision, assign `LOG-XXXXXX` (via `npm run acm -- adr add` / `id adr` / MCP) and simultaneously: **1) prepend 1 row to `ADR Index Map`**, and **2) prepend a detail block under `Architecture Decision Details`**.
> 3. Do not read this file routinely. Only during global infra changes, regression tracing, or large merges, slice-read lines 1-35 (`ADR Index Map`) or `grep_search` to pinpoint `[LOG-XX]`.

## 1. ADR Index Map

| ID | Date | Architectural Decision Summary | Related Area |
| :--- | :--- | :--- | :--- |
| **LOG-MJWB4R** | 2026-11-23 | Unify solo/team identifiers into immutable 6-char Crockford Base32 `short-id` (`TSK-XXXXXX`, `P-XXXXXX`, `LOG-XXXXXX`), `acm id` CLI, unambiguous prefix lookup, and explicit-only author metadata with full legacy sequential compatibility | `scripts/storage/`, `scripts/group-status.cjs`, `scripts/acm-db-cli.cjs`, `scripts/mcp-server.cjs`, `.agents/`, `acm-template/` |
| **LOG-04** | 2026-11-23 | Adopt Local-First SQLite (`node:sqlite` + FTS5) storage engine, DB CLI, Git orphan branch (`acm-memory`) sync with Secret Scrubber, and zero-dependency stdio MCP server | `bin/`, `scripts/storage/`, `scripts/acm-db-cli.cjs`, `scripts/mcp-server.cjs`, `.agents/` |
| **LOG-03** | 2026-11-23 | Switch ACM default language to English (`en`) with install-time EN/KO i18n, Korean template overlay, and bilingual parsers | `bin/`, `scripts/`, `acm-template/`, `README*.md` |
| **LOG-02** | 2026-11-09 | Integrate auto-archiving (`autoCompleteTask`), `[Ready]` safety gate, `ADR Index Map`, universal release sentinel, and clean sample isolation | `scripts/group-status.cjs`, `.agents/`, `acm-template/` |
| **LOG-01** | 2026-10-19 | Introduce Three-Tier Context Memory architecture (L1 working tasks, L2 sharded knowledge, L3 cold archive) and task-centric commit engine | `AGENTS.md`, `scripts/group-status.cjs`, `.agents/` |

---

## 2. Architecture Decision Details

### [LOG-MJWB4R] [2026-11-23] Unified Collision-Free Short-ID Architecture & Explicit-Only Author Separation

- **Related Commit/Branch**: `TSK-F6W4AT` / `main`
- **Context & Goal**:
  - Eliminate sequential ID collisions across multi-developer teams, multi-PC setups, Git worktrees, and concurrent AI agents—plus permanent Git commit vs. DB archive mismatches caused by post-hoc renumbering—without introducing solo/team mode switches or configuration prompts.
- **Architectural Decisions**:
  - Standardized all newly issued IDs on 6-character Crockford Base32 `short-id` tokens starting with an alpha character (`TSK-XXXXXX`, `P-XXXXXX`, `LOG-XXXXXX`; $22 \times 32^5$ space) in `scripts/storage/id-utils.cjs` using unbiased `crypto.randomBytes()`, cleanly separating new codes from legacy numeric IDs and template samples (`TSK-SAMPLE`, `P-00`, `LOG-00`).
  - Added 3-tier lookup (`uid` -> exact normalized code -> unambiguous 3-5 char prefix with ambiguity guard) and chronological `createdAt` + legacy tiebreak sorting across `SqliteProvider`, `MarkdownProvider`, and `group-status.cjs --commit=<target>`.
  - Added `acm id [task|pattern|adr] [--count=N]` for manual Markdown workflows and switched `git-orphan-sync.cjs` fallback collision resolution to issue non-colliding `short-id` values.
  - Separated author metadata from IDs and avoided auto-injecting `git user.name`: `tasks.owner` stays explicit-only (`""` default), and `patterns.author` / `adrs.author` resolve only from explicit input, `ACM_AUTHOR`, or optional `.agents/config.json` `author`.
- **Expected Impact**:
  - Zero-config collision-free IDs across all local and collaborative workflows, permanent Git commit/DB parity, and 100% lossless backward compatibility for existing sequential IDs (`TSK-1..24`, `P-01..02`, `LOG-01..04`).

---

### [LOG-04] [2026-11-23] Local-First SQLite Storage, Git Orphan Sync & Zero-Dependency Stdio MCP Architecture

- **Related Commit/Branch**: `TSK-18, TSK-21, TSK-22, TSK-23` / `main`
- **Context & Goal**:
  - Upgrade ACM from Markdown-only persistence to a queryable, concurrent Local-First SQLite storage engine (`node:sqlite` + FTS5 BM25) with pluggable online adapter readiness, seamless Git team collaboration without polluting code branches, and a zero-dependency stdio MCP interface alongside structured DB CLI commands.
- **Architectural Decisions**:
  - Built a unified `MemoryStore` registry (`scripts/storage/memory-store.cjs`, `config.cjs`, `sqlite-provider.cjs`, `markdown-provider.cjs`, `markdown-bridge.cjs`) targeting Node.js `>=22.13.0` (`node:sqlite` + WAL + FTS5 BM25 + token budget packing), keeping Markdown projection synchronized and preserving `--storage=markdown` fallback plus `registerProvider()` for future remote backends.
  - Added unified DB CLI commands (`scripts/acm-db-cli.cjs`: `task`, `pattern`, `adr`, `search`, `migrate`, `export`, `import`, `sync`) with `--json`/`--stdin` support and interactive/non-interactive installer storage selection + automatic Markdown migration (`scripts/install-template.cjs`).
  - Implemented Git orphan branch (`acm-memory`) synchronization (`scripts/storage/git-orphan-sync.cjs`) using pure Git Plumbing (`GIT_INDEX_FILE`), deterministic JSONL snapshots, structural LWW + code-collision renumbering merges, an outbound Secret Scrubber (`secret-scrubber.cjs`), and `.db*` leak detection in `audit-push.cjs`.
  - Added a daemonless newline-delimited JSON-RPC 2.0 stdio MCP server (`scripts/mcp-server.cjs`, `acm mcp`, `acm mcp --print-config`) exposing 9 tools (`acm_status`, `acm_search`, `acm_task_list`, `acm_task_upsert`, `acm_task_complete`, `acm_pattern_save`, `acm_pattern_get`, `acm_adr_add`, `acm_sync`) with strict per-call connection closing.
- **Expected Impact**:
  - Sub-millisecond BM25 search, token-budgeted context packing, leak-safe team memory synchronization on Git orphan branches, and first-class IDE/agent integration via both CLI and MCP with zero new runtime dependencies.

---

### [LOG-03] [2026-11-23] English Default Conversion & Install-Time EN/KO i18n Architecture

- **Related Commit/Branch**: `TSK-19` / `main`
- **Context & Goal**:
  - Standardize ACM's primary runtime, governance templates, documentation, and CLI outputs on English (`en`) for global open-source distribution and lower prompt token overhead, while preserving first-class Korean (`ko`) support selectable during installation.
- **Architectural Decisions**:
  - Built a zero-dependency CJS i18n core (`scripts/i18n.cjs`) with separated `scripts/locales/en.cjs` and `scripts/locales/ko.cjs` catalogs resolved via `--lang`/`-l`, `ACM_LANG`, `.agents/config.json`, or `.agents/.acm-meta.json` (defaulting to `'en'`).
  - Adopted an English-canonical `acm-template/.agents/` structure paired with a Korean `.md`-only overlay (`acm-template/locales/ko/`), avoiding duplicate script maintenance while keeping host installs free of unused locale folders.
  - Decoupled core parsers (`group-status.cjs`, `markdown-bridge.cjs`, `id-utils.cjs`, `smart-pull.cjs`) from localized literals using canonical task statuses and bilingual regexes, and extended Drift Detection (`acm-manifest.cjs`, `sync-agent-rules.cjs`) to verify both `en` and `ko` rule blocks.
- **Expected Impact**:
  - Reduces baseline governance prompt token usage, simplifies global adoption, and guarantees full backward compatibility with existing Korean ACM projects.

---

### [LOG-02] [2026-11-09] Production Hardening, ADR Index Map & Unpolluted Template Samples

- **Related Commit/Branch**: `TSK-14` / `main`
- **Context & Goal**:
  - Upstream field-tested features (unattended task archiving and safe commit gates) into ACM core and `acm-template/`, and stop agents from treating initial template boilerplate as real work.
- **Architectural Decisions**:
  - Integrated `autoCompleteTask()`, `[Ready]`-only `--all` filtering, and pre-commit `git diff --cached --check` verification into `group-status.cjs`.
  - Added the top `ADR Index Map` table to `project-changelog.md` so agents can scan architecture history within 35 lines.
  - Strengthened the self-contained `AGENTS.md` injection block and added `.agents/rules/60-task-memory-adr.md` and `.agents/agents/git-release-sentinel.md`.
  - Replaced `TSK-1`, `P-01`, `LOG-01` boilerplate in `acm-template/` with non-polluted `TSK-SAMPLE`, `P-00`, `LOG-00` sample formats.
- **Expected Impact**:
  - Eliminates manual task archival drift, prevents secondary local `.agents/` commits, and lets host projects start cleanly at `TSK-1`, `P-01`, `LOG-01`.

---

### [LOG-01] [2026-10-19] Three-Tier Context Memory System Introduction

- **Related Commit/Branch**: `init` / `main`
- **Context & Goal**:
  - Solve context window overflow and amnesia in long-running AI-assisted projects via a structured 3-tier memory model.
- **Architectural Decisions**:
  - Separated L1 (active task `task.md`), L2 (indexed sharded knowledge `patterns-index.md` / `patterns/`), and L3 (cold archive `task-completed.md`).
  - Introduced `group-status.cjs` to enforce task-driven atomic commits.
- **Expected Impact**:
  - Keeps baseline session token overhead near zero while maximizing precision retrieval efficiency.

# Project Changelog & Architecture Decision Records (ADR)

> [!IMPORTANT]
> **Zero-Token On-Demand & Index-First Principle**:
> 1. This document records macro Architecture Decision Records (ADRs) and major system changes only.
> 2. For each new decision, assign `LOG-{N}` and simultaneously: **1) prepend 1 row to `ADR Index Map`**, and **2) prepend a detail block under `Architecture Decision Details`**.
> 3. Do not read this file routinely. Only during global infra changes, regression tracing, or large merges, slice-read lines 1-35 (`ADR Index Map`) or `grep_search` to pinpoint `[LOG-XX]`.

## 1. ADR Index Map

| ID | Date | Architectural Decision Summary | Related Area |
| :--- | :--- | :--- | :--- |
| **LOG-03** | 2026-11-23 | Switch ACM default language to English (`en`) with install-time EN/KO i18n, Korean template overlay, and bilingual parsers | `bin/`, `scripts/`, `acm-template/`, `README*.md` |
| **LOG-02** | 2026-11-09 | Integrate auto-archiving (`autoCompleteTask`), `[Ready]` safety gate, `ADR Index Map`, universal release sentinel, and clean sample isolation | `scripts/group-status.cjs`, `.agents/`, `acm-template/` |
| **LOG-01** | 2026-10-19 | Introduce Three-Tier Context Memory architecture (L1 working tasks, L2 sharded knowledge, L3 cold archive) and task-centric commit engine | `AGENTS.md`, `scripts/group-status.cjs`, `.agents/` |

---

## 2. Architecture Decision Details

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

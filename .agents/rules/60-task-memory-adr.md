---
trigger: model_decision
description: Apply when distilling a new reusable solution into the knowledge base (P-XX) or reading/recording macro Architecture Decision Records (ADR, LOG-XX) in project-changelog.md
---

## 1. Post-Task Knowledge Distillation (.agents/memory/patterns/)
- For confirmed reusable solutions only, create an immutable sharded file (`.agents/memory/patterns/P-XXXXXX-*.md`, issued via `acm pattern add` / `acm id pattern` / MCP; `P-00` is a format sample and legacy `P-XX` files remain valid) using the 5-line compact format (`**Date**:`, `**Category**:`, `**Symptom & Root Cause**:`, `**Solution Pattern**:`, `**Related Files**:`) and append 1 summary row to `patterns-index.md`.
- In `sqlite` mode (`.agents/config.json`), record and query patterns via `acm pattern add` / `acm search` or MCP tools (`acm_pattern_save`, `acm_pattern_get`, `acm_search`) with `supersedes` version chaining.

## 2. Macro Architecture Decision Records (.agents/memory/project-changelog.md)
- **Reading**: Only on 3 conditional events (1. global infrastructure/config changes, 2. regression tracing, 3. immediately after large remote merges), slice-read the top `ADR Index Map` (`StartLine: 1, EndLine: 35`) or `grep_search` by keyword to pinpoint `LOG-*`, then read only that detail block. In `sqlite` mode, prefer `acm adr list` / `acm search --kind=adr` or `acm_search`.
- **Writing**: Only on macro architectural changes (ADRs), prepend 1 summary row to `ADR Index Map` and prepend a detail block (`### [LOG-XXXXXX] [YYYY-MM-DD] Title`, issuing `LOG-XXXXXX` via `acm adr add` / `acm id adr` / MCP; `LOG-00` is a format sample only) at the top of the detail section. Never log routine feature work or minor bug fixes here; keep those in the `task` tier. In `sqlite` mode, you may also record via `acm adr add` or `acm_adr_add`.

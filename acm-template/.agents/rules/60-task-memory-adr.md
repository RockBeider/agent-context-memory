---
trigger: model_decision
description: Apply when distilling a new reusable solution into the knowledge base (P-XX) or reading/recording macro Architecture Decision Records (ADR, LOG-XX) in project-changelog.md
---

## 1. Post-Task Knowledge Distillation (.agents/memory/patterns/)
- For confirmed reusable solutions only, create the next immutable sharded file (`.agents/memory/patterns/P-XX-*.md`, starting at `P-01`; `P-00` is a format sample) using the 5-line compact format (`**Date**:`, `**Category**:`, `**Symptom & Root Cause**:`, `**Solution Pattern**:`, `**Related Files**:`) and append 1 summary row to `patterns-index.md`.
- In `sqlite` mode (`.agents/config.json`), record and query patterns via `acm pattern add` / `acm search` or MCP tools (`acm_pattern_save`, `acm_pattern_get`, `acm_search`) with `supersedes` version chaining.

## 2. Macro Architecture Decision Records (.agents/memory/project-changelog.md)
- **Reading**: Only on 3 conditional events (1. global infrastructure/config changes, 2. regression tracing, 3. immediately after large remote merges), slice-read the top `ADR Index Map` (`StartLine: 1, EndLine: 35`) or `grep_search` by keyword to pinpoint `LOG-XX`, then read only that detail block. In `sqlite` mode, prefer `acm adr list` / `acm search --kind=adr` or `acm_search`.
- **Writing**: Only on macro architectural changes (ADRs), prepend 1 summary row to `ADR Index Map` and prepend a detail block (`### [LOG-XX] [YYYY-MM-DD] Title (Task: \`TSK-X\`)`, issuing `prev_top + 1`, starting at `LOG-01`) at the top of the detail section. Never log routine feature work or minor bug fixes here; keep those in the `task` tier. In `sqlite` mode, you may also record via `acm adr add` or `acm_adr_add`.

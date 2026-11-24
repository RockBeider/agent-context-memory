---
name: context-compactor
description: Subagent responsible for archiving completed task.md items into task-completed.md by date and auditing patterns-index.md and project-changelog.md (including ADR Index Map) after milestones to minimize baseline session token injection.
kind: local
model: inherit
subagent: true
mainAgent: true
commandExecutionPolicy: request-review
---

# Context Compactor Instructions

You are the dedicated context compaction and memory hygiene subagent for a project using the Three-Tier Cognitive Memory Model.
When invoked after completing a milestone, trim bloat from active tasks and canonical stores (`TSK-X`, `P-XX`, `LOG-XX`) so subsequent sessions reduce baseline prompt overhead by 85%+.

---

## 1. Compaction & Hygiene Criteria (Core Tasks)

### A. Active Task File Hygiene (`.agents/task/task.md`)
1. **Detect Unarchived Completed Tasks & Verify SHAs**:
   - Find any tasks manually marked `[x]` inside `task.md` that have not yet been archived (never alter the `TSK-SAMPLE` codeblock example).
   - Verify each has a real Git commit SHA (e.g. `Commit: \`8f765f1\``); cross-check `git --no-pager log -n 5` if missing.
2. **Archive to Cold Storage (`task-completed.md`)**:
   - Preserve immutable `TSK-XXXXXX` (or legacy `TSK-{N}`) IDs and prepend archived blocks under the matching top date section in `.agents/task/task-completed.md`.
   - Sync the top metadata line (`Latest Done`, `Active`) to match the updated state.
3. **Maintain Lightweight Working Memory**:
   - Keep ONLY Todo (`[ ]`), `[In Progress]`, and `[Ready]` items in `task.md` under the **5KB cap** (temporary overflow allowed only for queued `[Ready]` tasks).

### B. Knowledge Base Shards & Index Hygiene (`.agents/memory/`)
1. **Verify Shard Integrity & 5-Line Format**:
   - Ensure 1:1 parity between `patterns-index.md` table rows and `.agents/memory/patterns/P-*-*.md` files (`P-00` sample may remain untouched or be cleaned up once real patterns exist).
   - Check that each shard follows the 5-line format (`Date`, `Category`, `Symptom & Root Cause`, `Solution Pattern`, `Related Files`).
2. **Archive Obsolete Patterns**:
   - Move retired patterns caused by framework/architecture replacements into `archive/` and remove them from the active index.

### C. Project Changelog Hygiene (`.agents/memory/project-changelog.md`)
1. **Bidirectional `ADR Index Map` & `[LOG-XX]` Parity**:
   - Verify rows in `## 1. ADR Index Map` match `### [LOG-XX]` blocks in `## 2. Architecture Decision Details` 1:1 in reverse chronological order.
2. **Archive Aged Detail Blocks**:
   - When the file grows large, keep `ADR Index Map` intact and split older bottom detail blocks into `archive/changelog_YYYY.md` so lines 1-35 always cover recent ADRs.

---

## 2. Execution Workflow
1. Inspect sizes and structural consistency of `task.md`, `patterns-index.md`, and `project-changelog.md`.
2. Select items to archive/compact and apply edits cleanly.
3. Report bytes saved and updated memory metrics.

---

## 3. Output Format
```markdown
### Context Compactor Report

- **task.md Cleanup**: [N completed task(s) -> archived to task-completed.md (current size: X.X KB)]
- **Knowledge Base (patterns)**: [N total sharded pattern(s), 100% index parity]
- **project-changelog.md Check**: [ADR Index Map & latest LOG-XX verified / size X.X KB]
- **Token Savings**: [~N bytes reduced / context headroom improved by +X%]
```

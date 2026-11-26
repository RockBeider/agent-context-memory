---
name: acm-git-workflow
description: Task-centric auto-classified atomic commit, intelligent 3-Way pull, and pre-push hygiene audit pipeline
---

# Git Workflow Governance Skill

Standard operational manual for executing remote sync, adaptive quality gates, task-centric one-shot atomic commits, and pre-push hygiene audits in compliance with [ACM_GOVERNANCE.md](../../acm/ACM_GOVERNANCE.md).

---

## 1. Standard VCS Pipeline

### Step 1: Remote Sync (`git pull` & `smart-pull`)
Choose the sync strategy matching conflict risk:

1. **Routine Conflict-Free Pull**:
   ```bash
   git pull
   ```
   - Use standard Git commands when no divergence or conflict risk exists.
2. **One-Shot Smart Pull (Divergent Branches / Conflict Risk)**:
   ```bash
   npm run acm:pull
   ```
   - Runs `fetch`, in-memory 3-Way virtual merge diagnosis, merge, precision hybrid conflict resolution, and 3 quality gates (`node scripts/acm/smart-pull.cjs`).
3. **Standalone Conflict Resolution**:
   ```bash
   npm run acm:resolve
   ```
   - Resolves an already-conflicted working tree using hybrid rules and finishes the merge commit (`node scripts/acm/smart-pull.cjs --resolve`).

---

### Step 2: Adaptive Quality Gates (Impact-Scoped Verification)
Verify proportional to change impact:

1. **Always-On Gate — Conflict Markers & Whitespace**:
   ```bash
   git --no-pager diff --check
   ```
   - Always confirm 0 leftover conflict markers (`<<<<<<<`) or trailing whitespace issues.
2. **Conditional Gate — Tests & Build Integrity**:
   ```bash
   npm test
   # or project build script (npm run build)
   ```
   - Run before push whenever core modules, shared configs, or cross-cutting logic changed (skip for minor doc/comment edits).

---

### Step 3: Task-Centric One-Shot Commit
Never run bulk `git add .` across unrelated files. Follow **"Document `[Ready]` + 3 elements -> Run `npm run acm:commit` ONCE after explicit user approval"**:

1. **Record `[Ready]` with 3 Required Elements**:
   - In **`sqlite` mode** (`markdownProjection: false` default): register or update the task via `npm run acm -- task add` / `npm run acm -- task update --stdin` (or `acm` / `node scripts/acm/acm-db-cli.cjs` / MCP `acm_task_upsert`) with `status: "ready"` and all 3 elements (`purpose`, `results`, `targets`) directly in `.agents/acm/local/memory.db` (do not hand-create `task.md`).
   - In **`markdown` mode** (or when `markdownProjection: true`): register or update the task in `.agents/acm/task/task.md` (via `npm run acm -- task add` / `npm run acm -- id` / `node scripts/acm/acm-db-cli.cjs` / MCP) with status `[Ready]` and all 3 elements (`Purpose`, `Results`, `Targets`) so `group-status.cjs` can build the commit message and auto-archive:
     ```markdown
     ### [Task Group Title]
     - [Ready] **TSK-XXXXXX. Concise task summary title**
       - **Registered**: YYYY-MM-DD
       - **Purpose**: One-line summary of background and goal
       - **Results**:
         - `path/to/file1`: summary of logic or doc changes
         - `path/to/file2`: summary of logic or doc changes
       - **Targets**:
         - `path/to/file1`
         - `path/to/file2`
     ```
2. **Execute One-Shot Task Commit (ONLY after explicit user commit approval)**:
   ```bash
   npm run acm:commit
   ```
   - `npm run acm:commit` (`node scripts/acm/group-status.cjs --all`) selects `[Ready]` tasks only, checks `git diff --cached --check`, commits each task atomically (capturing its SHA), and marks the task `done` with its SHA in SQLite (or archives to `.agents/acm/task/task-completed.md` in `markdown` mode / when `markdownProjection: true`). Unmapped files stay untouched in the working tree.
   - **Additional CLI Options**:
     - Preview groupings & commit messages without committing: `npm run acm:status` (`node scripts/acm/group-status.cjs --dry-run`)
     - Compact 1-line summary for low-token checks: `npm run acm:summary` (`node scripts/acm/group-status.cjs --compact`)
     - Commit a single task only: `node scripts/acm/group-status.cjs --commit=<num|TSK-XXXXXX|prefix>`
3. **Never Attempt Secondary `.agents/` Commits (Host Projects)**:
   - In host projects where `.agents/` ACM assets are excluded via `.gitignore`, never attempt follow-up Git commits for them.

---

### Step 4: Pre-Push Hygiene Audit (`audit-push`)
Run immediately before `git push` to catch temporary artifacts, one-off scripts, or conflict markers:

```bash
npm run acm:audit-push
```

---

## 2. Post-Verification Subagent
- Invoke the `acm-git-release-sentinel` subagent for independent release verification before or after committing and pushing.
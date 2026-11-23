---
name: git-workflow
description: Task-centric auto-classified atomic commit, intelligent 3-Way pull, and pre-push hygiene audit pipeline
---

# Git Workflow Governance Skill

Standard operational manual for executing remote sync, adaptive quality gates, task-centric one-shot atomic commits, and pre-push hygiene audits in compliance with [MEMORY_GOVERNANCE.md](../../MEMORY_GOVERNANCE.md).

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
   npm run git:pull
   ```
   - Runs `fetch`, in-memory 3-Way virtual merge diagnosis, merge, precision hybrid conflict resolution, and 3 quality gates (`node scripts/smart-pull.cjs`).
3. **Standalone Conflict Resolution**:
   ```bash
   npm run git:resolve
   ```
   - Resolves an already-conflicted working tree using hybrid rules and finishes the merge commit (`node scripts/smart-pull.cjs --resolve`).

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
Never run bulk `git add .` across unrelated files. Follow **"Document `[Ready]` + 3 elements in `task.md` -> Run `npm run git:commit` ONCE after explicit user approval"**:

1. **Update `task.md` to `[Ready]` with 3 Required Elements**:
   - Register or update the task in `.agents/task/task.md` with status `[Ready]` and all 3 elements (`Purpose`, `Results`, `Targets`) so `group-status.cjs` can build the commit message and auto-archive:
     ```markdown
     ### [Task Group Title]
     - [Ready] **TSK-X. Concise task summary title**
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
   npm run git:commit
   ```
   - `npm run git:commit` (`node scripts/group-status.cjs --all`) selects `[Ready]` tasks only, checks `git diff --cached --check`, commits each task atomically (capturing its SHA), and auto-archives to `.agents/task/task-completed.md` while trimming `task.md`. Unmapped files stay untouched in the working tree.
   - **Additional CLI Options**:
     - Preview groupings & commit messages without committing: `npm run git:status` (`node scripts/group-status.cjs --dry-run`)
     - Compact 1-line summary for low-token checks: `npm run git:summary` (`node scripts/group-status.cjs --compact`)
     - Commit a single task only: `node scripts/group-status.cjs --commit=<num|TSK-X>`
3. **Never Attempt Secondary `.agents/` Commits (Host Projects)**:
   - In host projects where `.agents/` is excluded via `.gitignore`, never attempt follow-up Git commits for `.agents/` files.

---

### Step 4: Pre-Push Hygiene Audit (`audit-push`)
Run immediately before `git push` to catch temporary artifacts, one-off scripts, or conflict markers:

```bash
npm run git:audit-push
```

---

## 2. Post-Verification Subagent
- Invoke the `git-release-sentinel` subagent for independent release verification before or after committing and pushing.

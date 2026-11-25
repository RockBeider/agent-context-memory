# [P-02] Task-Centric Atomic Commit Governance & Auto-Classification

- **Date**: 2026-10-19
- **Category**: VCS Governance
- **Symptom & Root Cause**: Running bulk `git add .` across multi-feature changes mixes unrelated files into one commit, breaking atomic rollbacks and historical traceability.
- **Solution Pattern**: Record `[Ready]` status and all 3 elements (`Purpose`, `Results`, `Targets`) in `task.md`, then run `node scripts/group-status.cjs --all` to isolate staging/commits per task and auto-archive into `task-completed.md`.
- **Related Files**: `scripts/group-status.cjs`, `.agents/task/task.md`, `.agents/task/task-completed.md`

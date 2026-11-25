# [P-01] Prevent Git CLI Process Freezes Caused by Interactive Pagers

- **Date**: 2026-10-19
- **Category**: Git / Tooling
- **Symptom & Root Cause**: In non-interactive agent shells, long `git diff` or `git log` output triggers an interactive pager (`less`, `more`) that waits indefinitely for keyboard input, deadlocking the subprocess.
- **Solution Pattern**: Inject `GIT_PAGER: 'cat'` and `PAGER: 'cat'` into every `child_process` environment and pass the `git --no-pager` flag.
- **Related Files**: `scripts/group-status.cjs`, `scripts/smart-pull.cjs`, `scripts/audit-push.cjs`

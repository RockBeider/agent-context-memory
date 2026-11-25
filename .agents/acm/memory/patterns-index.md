# Learned Patterns Index (Lightweight Knowledge Base Index)

> [!IMPORTANT]
> **Zero-Token On-Demand Search Principle (Just-In-Time Grep)**:
> 1. AI agents must never eagerly read this entire file or all files under `patterns/`.
> 2. Run `grep_search` on the Summary column by keyword and load ONLY matched sharded files (`patterns/P-XX-*.md`).
> 3. When distilling a new reusable solution, create the next immutable `P-03` sharded file and append 1 row below.

| ID | Category | Summary | File Link |
| :--- | :--- | :--- | :--- |
| P-01 | Git/Tooling | Prevent Git CLI process freezes from interactive pagers (`PAGER=cat`) | [P-01-git-pager-freeze-fix.md](file:///./patterns/P-01-git-pager-freeze-fix.md) |
| P-02 | VCS Governance | Task-centric atomic commit governance and automated file classification | [P-02-atomic-commit-governance.md](file:///./patterns/P-02-atomic-commit-governance.md) |

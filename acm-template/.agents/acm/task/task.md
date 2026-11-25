# Agent Context Memory Task Master (Single Source of Truth)

> [!IMPORTANT]
> **Governance Rules**:
> 1. This document is the Single Source of Truth for active tasks only (keep `<= 5KB`; Latest Done: `None`, Active: `None`).
> 2. Task IDs (`TSK-XXXXXX`) are immutable 6-char Crockford Base32 short IDs issued via `acm task add`, `acm id`, or MCP (legacy `TSK-{N}` supported).
> 3. Status lifecycle: `[ ]` (Todo) -> `[In Progress]` -> `[Ready]` (verified) -> `[x]` (auto-archived to `task-completed.md` on `npm run acm:commit`).
> 4. When transitioning to `[Ready]`, record **Purpose**, **Results**, and **Targets** (all modified paths in backticks) so `group-status.cjs` generates commit messages and archives automatically.

> [!NOTE]
> **Sample Format (NOT a real task)**:
> Keep this example untouched or remove only when desired. Register real tasks under `## Active Tasks` using `TSK-XXXXXX` short IDs (`acm task add` / `acm id` / MCP).
> ```markdown
> ### [Feature or Work Group]
> - [Ready] **TSK-SAMPLE. (Sample Example) Concise task title here**
>   - **Purpose**: One-line summary of background and goal.
>   - **Results**:
>     - `src/example.js`: Summary of core logic and function changes
>   - **Targets**: `src/example.js`, `README.md`
> ```

---

## Active Tasks
(No active tasks)

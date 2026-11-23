# Project Changelog & Architecture Decision Records (ADR)

> [!IMPORTANT]
> **Zero-Token On-Demand & Index-First Principle**:
> 1. This document records macro Architecture Decision Records (ADRs) and major system changes only.
> 2. Start real decisions at `LOG-01` and simultaneously: **1) prepend 1 row above the sample in `ADR Index Map`**, and **2) prepend a detail block under `Architecture Decision Details`** (`LOG-00` is a format sample only).
> 3. Do not read this file routinely. Only during global infra changes, regression tracing, or large merges, slice-read lines 1-35 or `grep_search` to pinpoint `[LOG-XX]`.

## 1. ADR Index Map

| ID | Date | Architectural Decision Summary | Related Area |
| :--- | :--- | :--- | :--- |
| **LOG-00** | YYYY-MM-DD | [Sample Format] One-line architectural decision summary (start real logs at `LOG-01`) | `AGENTS.md`, `src/` |

---

## 2. Architecture Decision Details

### [LOG-00] [YYYY-MM-DD] (Sample Format - NOT a real ADR) Architecture Decision Title

- **Related Commit/Branch**: (e.g. `init / main` or `TSK-1`)
- **Context & Goal**:
  - (Describe background and motivation for global config or core architecture changes)
- **Architectural Decisions**:
  - (Describe chosen architecture, directory boundaries, or state management rules)
- **Expected Impact**:
  - (Describe maintainability, token reduction, or performance impact)

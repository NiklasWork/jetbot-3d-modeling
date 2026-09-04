---
key: branch-guard
value: strict
---

only when state/profile.md configures a code-root: at session start confirm its checked-out branch with `truss status`; if it differs from the `branch:` declared in state/current.md — STOP and do not edit code or docs until the human resolves it; if no `branch:` is declared while a code-root checkout exists — STOP and ask the human to declare it; keep current.md `branch:` in sync with the branch you work on

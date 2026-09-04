---
current: kickoff
---

> Source of truth for phase definitions. `truss render` reads this file and writes the phase block in AGENTS.md.
> `current:` is the only human-reserved line; advancing it (a phase change) is human-only — see AGENTS.md §4 (phase exit procedure).
> Grammar: inside a `## <phase-id>` section every line is `key: value`; a wrapped value continues on an indented line. Free text is not allowed there — it would be read into the preceding key and rendered into every session boot.
> This file ships with ONE real phase. The kickoff interview replaces it with the lifecycle this project actually needs; agents keep maintaining that plan as requirements change (D-NNN + tell the human + `truss render`; hard limits in AGENTS.md §5).

## kickoff

label: Kickoff
purpose: turn the raw idea into a working course record — vision, profile, and the phase plan this project actually needs.
behavior: interviewing — ask before assuming; write what the next session must know, nothing speculative.
allowed: VISION.md, state/profile.md, the tailored phase list, first decisions and domain notes.
forbidden: production work before the phase plan exists; inventing facts the human never stated; leaving the seeded phase list in place as if it were the plan.
read: state/profile.md
exit: section: VISION.md#Problem; phase plan tailored to this project and recorded as a D-entry (human); human sign-off (human)

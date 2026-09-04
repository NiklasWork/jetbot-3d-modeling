# Open Decisions

> Briefings for undecided questions that block or shape work — including a challenge to a recorded decision (AGENTS.md §3).
> On decision → `D-NNN` in state/decisions/ with `Closes: OD-NNN`, then remove the entry here; no "DECIDED" tombstones. Empty is the correct state of a project with nothing undecided — never delete this file.
> `OD-NNN` sequential, never reused: the next free number is one above the highest `OD-NNN` here **or** in a `Closes:` line under state/decisions/.
> The entry shape below is a machine contract — `doctor`'s SY-03 parses the option lines, so keep it. Full grammar: docs/conventions.md.

<!-- Entry template — an OD is a briefing the human can decide from without reconstructing your analysis.

## OD-NNN — [question title]

Opened: YYYY-MM-DD
Context: [why this matters now, and what it blocks]
Options:
- A: [short label] — [what choosing it means] +[upside] / –[downside]
- B: [short label] (recommended) — [what choosing it means] +[upside] / –[downside]
- C: [short label] — [what choosing it means] +[upside] / –[downside]
- …: so viele, wie die Frage wirklich hat — zwei sind das Minimum, nicht die Form
Trade-offs: [cross-cutting: cost, reversibility — only what the option lines don't carry]
Leaning: [which option and why, one line · or "none" plus what input would decide it]
Needed from human: [the decision or input you need]

Option lines are keyed (A:/B:/C:/…), label before the ` — `, then upside after `+` and
downside after `–`, separated by ` / `. Es gibt keine Obergrenze: liste jede Option,
die die Frage wirklich hat — eine echte Dreier-Wahl in ein Ja/Nein zu pressen
verdeckt genau die Möglichkeit, die der Mensch gewählt hätte. Mark at most one
option `(recommended)`, and only if `Leaning:` agrees. Keep the label short — it is
the click target. -->

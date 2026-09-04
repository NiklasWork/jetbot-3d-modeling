# Schema — entry classes

> Load when: writing your first entry of a class this session, or adding a class of
> your own. This file says what an entry *is*; [conventions.md](conventions.md) says
> how to use the classes well.

**This file is parsed.** The engine reads the table below — it is where the ID
classes come from, not a copy of a list kept in code. `doctor` uses it for three
things: which `XX-NNN` tokens count as structured IDs at all (RF-02, RF-03),
which file each class belongs in, and which fields SY-03 asks for. Edit the
table and those three follow; there is no second place to change them.

What it does **not** govern: checks that carry a class's *meaning* rather than
its form still name the class — that an open decision is removed when it is
decided (SY-06), that one waiting a month is worth asking about (SY-10), that a
decision log grows expensive (SY-09). Rename `D` or `OD` and those go quiet.
The boot-cost estimate and `truss status` also still name their files.

The header row starting with `Class` is what marks this file as a Truss schema.
Without it the file is treated as someone else's `docs/schema.md` and ignored in
silence — a database or API schema under this name is not a broken Truss schema.
Rows inside a fenced code block are examples, never configuration.

## Classes

| Class | File | Form | Required | Optional |
|---|---|---|---|---|
| D | state/decisions/ | `## D-NNN — title` | Date, Decision, Rationale or Why, Consequences | Closes, Rejected, Supersedes, Superseded-by, Addresses, Challenged-by |
| OD | state/open-decisions.md | `## OD-NNN — title` | Opened, Options, Trade-offs, Leaning | Context, Needed from human |
| HT | HUMAN-TODOS.md | `- [ ] HT-NNN — description` | | |
| R | state/risks.md | `## R-NNN — title` | Severity, Status, Trigger, Mitigation | Opened, Owner |
| L | state/learnings.md | `## L-NNN — title` | Trigger, Systemic cause, Adjustment | Date, Follow-up |
| TF | state/truss-findings.md | `## TF-NNN — title` | Date, Observed, Impact, Suggestion | |

How the columns are read:

- **Class** — the ID prefix. One to four uppercase letters; the number is always
  three digits.
- **File** — where entries of the class live, as a path inside the workspace. A
  path ending in `/` is a directory holding one file per entry
  (`state/decisions/D-042.md`); such a directory does not claim a file another
  class already names.
- **Form** — `#`-headed entries are checked as headings, `-`-led entries as list
  items. `NNN` and `title`/`description` are placeholders, not literal text. The
  **heading level is part of the form**: write `### X-NNN — title` and level-3
  headings are the entries, while `##` headings in that file are sections. The
  prefix in this cell must be the same as the Class cell.
- **Required** — SY-03 warns when a field is missing. `A or B` accepts either
  name and the first is the one to write; the second is there for entries from
  before the name changed. Nothing else in the list is optional.
- A required field named `Opened` must carry a real `YYYY-MM-DD` date, and the
  lines under a required field named `Options` are parsed as a chooser
  (`- A: label — meaning +up / –down`). Both rules are keyed on the field name,
  so a class of your own using those names gets them too.
- **Optional** — documented so a reader knows the field exists; never warned
  about, in either direction.

A row the engine cannot use is **dropped, and reported** (`ST-11`): a dropped
class stops being a structured ID, so RF-02, RF-03 and SY-03 all fall silent for
it — a smaller table is a choice, a broken row is not.

An empty cell means the class has no fields of that kind. The written form of
each class — the template to copy, with what belongs in each field — is in
[conventions.md](conventions.md); a test holds the two together, so a field
cannot appear in one and be missing from the other.

## Boot and aging

What each class costs at session start, and what makes an entry leave:

- **D** — the boot loads `state/decisions-index.md` (title and status per entry),
  never the bodies. An entry leaves the boot when its file moves to
  `archive/decisions/`, and it may do that once a check, a test, a convention or
  the file structure carries its consequence. Supersede, never delete.
- **OD** — loaded when the task touches an open question. An OD is *removed* when
  it is decided; the `Closes: OD-NNN` line in the deciding D is its trace. No
  tombstones.
- **HT** — loaded whenever the human's queue matters. Settled `[x]` entries move
  to `archive/human-todos.md`; the counter continues across them.
- **R** — on demand, for risk, Go/No-Go, launch or blocker work. A closed risk
  keeps its entry with the closing note.
- **L** — on demand. A learning stays while the weakness it names can recur; the
  adjustment itself belongs where the behaviour happens, not only here.
- **TF** — on demand. Feedback about Truss itself; it goes when upstream has
  shipped or rejected it.

## Adding a class of your own

Add one row. Nothing else — no code, no fork.

```markdown
| BL | context/backlog.md | `- [ ] BL-NNN — description` | | |
```

From that moment `BL-042` is a structured ID: a reference to one that does not
exist is an RF-02 warning, defining the same one twice is an RF-03 error, and an
entry that does not match the form is an SY-03 warning. Pick a prefix no shipped
class uses and keep it short — one to four uppercase letters. The file is read
whether or not `AGENTS.md` §2 lists it; list it there anyway, or `ST-02` will
ask.

Removing a shipped row is allowed and means the same thing in reverse: those IDs
stop being structured, so nothing checks them. The class does not disappear from
`AGENTS.md` by itself — say there too that you dropped it.

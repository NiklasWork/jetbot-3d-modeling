# Conventions

> Load when: writing your first D-/HT-/R- entry this session, or creating a new file type.
> Defines ID schemes, entry grammars, and file templates.

## ID schemes

IDs are sequential integers, zero-padded to three digits. Never reused. Issued in the file they belong to.

Which classes exist, which file each lives in and which fields it owes is **not
repeated here** — it is the class table in [schema.md](schema.md), and that table
is what `doctor` reads. Add a class there and it is checked; change a field there
and SY-03 follows. This file says how to *use* the classes well.

## Entry grammars

The templates below are the written form of the classes in
[schema.md](schema.md). They and the table are held together by a test, so a
field cannot appear in one and go missing from the other.

### D-NNN — Decided decision

```markdown
## D-NNN — [short decision title]

Date: YYYY-MM-DD
Decision: [what was decided]
Rationale: [why this path]
Consequences: [what changes because of this]
Closes: [OD-MMM or omit when none]
Rejected: [not-chosen option — one-line why; only with Closes:, omit otherwise]
Supersedes: [D-MMM or omit when none]
Addresses: [L-MMM when this decision implements a learning's adjustment; omit otherwise]
Superseded-by: [D-MMM once a later decision replaces this one; omit until then]
Challenged-by: [OD-MMM while the decision is contested — the one transient field; removed when the challenge resolves]
```

One decision per entry. If the title needs an "and" or a semicolon, it is two entries —
a bundled entry cannot be revised in part later, and no field syntax repairs that.

Superseding: add a `Superseded-by: D-MMM` line under the entry and a `> Superseded by D-MMM (YYYY-MM-DD): [reason]` note below. Never delete the original entry.
When a new decision replaces only part of an older *bundled* entry, say which part in
plain text after the ID on both sides — `Supersedes: D-028 (only part 3 — parts 1, 2, 4
still hold)` — and always name what still holds, so the old entry is not misread as dead.
This is a tolerance for entries written before the one-decision rule, not a second
revision mode: new entries are small enough to supersede whole.

Each decision is its own file, `state/decisions/D-NNN.md`, holding exactly the
entry above. Keep `Decision:`/`Rationale:`/`Consequences:` to roughly one line
each; design detail belongs in the owning domain file, linked from the entry.

**Two different costs, two different moves.** The boot loads
`state/decisions-index.md`, which carries one line per decision — title and
status, nothing else. So compressing a body saves nothing at boot: it makes the
*body* cheaper to open, which is the cost a task pays when it looks a decision
up. An entry only leaves the boot when its file leaves `state/decisions/`.

- **Compress** a superseded entry, or one whose consequence is fully carried by
  a canonical file: keep heading, trace lines and `Decision:`, move the prose to
  `archive/decisions/D-NNN.md` with a pointer. The ID stays; a lookup gets
  cheaper. **The archived block must not repeat the heading**: a heading whose
  first token is the ID (`## D-NNN — …`) is a *definition*, so the same id would
  be defined twice and RF-03 fires with an error. Write `## Body of D-NNN — …`
  instead — anything where the id is not the first token after the hashes.
- **Archive whole** once acting correctly no longer requires reading the entry
  at all — because a check, a test, a convention or the file structure carries
  its consequence, and nothing still open depends on it. The file moves to
  `archive/decisions/`, the index loses its line, and a pointer in
  `archive/decisions/README.md` records the range and why. This is the only move
  that changes what the boot costs, and the `cleanup` ritual
  (`.truss/docs/rituals/cleanup.md`) proposes it — it is never automatic.

Never delete an entry either way: archived is findable, and RF-02 resolves an
archived `D-NNN` because `archive/` is indexed. If in doubt, compress rather
than archive — the cost of guessing wrong is one extra file read, but a decision
that still constrains an open choice must stay where every session sees it.
Compression keeps the trace lines with the heading — `Closes:`, `Supersedes:` /
`Superseded-by:`, `Addresses:` — and moves only prose; a link that survives one
compression but not the next is the same as no link.
doctor nudges when the file's read cost grows large (SY-09).

`Closes:` is the durable trace of a resolved open decision. Because the OD entry
is removed on decision (see below), anything that referenced the OD finds its
resolution here — never leave a "DECIDED" tombstone in open-decisions.md instead.
`Rejected:` preserves the not-chosen options in one line — without it, the OD's
alternatives survive only in git history and "why not B?" becomes unanswerable
from active context.

`Addresses:` is the same kind of trace pointing the other way: it names the
`L-NNN` whose adjustment this decision implements, so "did that learning ever
change anything?" is answerable from the decision side instead of only from the
learning's prose. It is what keeps the pair readable once the decision is
compressed or its body archived.

**Challenging a decision.** A decision binds until it is superseded, but it is
evidence, not scripture — and the agent that spots a wrong one must be able to say
so. Admission test, same shape as the HT qualifier: challenge only on (a) new
evidence the decision did not have, (b) a consequence it predicted that
demonstrably did not hold, or (c) a contradiction with another canonical file or a
later decision. A different preference, taste, "this could be cleaner", or not
knowing the reasoning are not grounds — read the `Rationale:` first.

The split is deliberate: **opening a challenge is the agent's to do, changing the
decision is not.** Open it as an `OD-NNN` that names the decision and states which
of (a)/(b)/(c) applies, and add `Challenged-by: OD-NNN` to the decision itself —
`state/decisions-index.md` carries only titles and status, and §1 opens a body
exactly when it matters — before a decision is made or proposed — so without
that line the session that is about to build on the decision reads it as
settled. Then:

- **Human agrees** → new `D-NNN` with `Supersedes:` and `Closes:`, `Superseded-by:`
  on the old entry, `Challenged-by:` removed.
- **Human disagrees** → remove the OD and the `Challenged-by:` line, and add the
  tested alternative to the upheld decision's `Rationale:` in one clause
  ("…; alternative X was tested on YYYY-MM-DD and rejected because Y"). A rejected
  challenge hardens the decision — the question is answered in active context
  instead of coming back next session.

doctor flags a `Challenged-by:` whose OD no longer exists (SY-11).

### HT-NNN — Human todo

```
- [ ] HT-NNN — [what the human needs to do] — [context or deadline if relevant]
```

Qualifier — before writing an HT, ask: could an agent do this itself, with the
tools it has, inside this workspace or the code root? If yes it is not an HT;
route it to `state/current.md` `next:` or the owning domain file. An HT is only
for what an agent cannot execute: access it does not have (accounts, consoles,
credentials, hardware, another machine), acting under the human's identity
(publishing, sending, paying, signing), a physical or legal act, or a sign-off
the protocol reserves for the human (phase exit). Convenience, taste, or "the
human should know" are not qualifiers, and neither is a task you could do but
would rather hand over. A question that needs the human's judgment is an
`OD-NNN` briefing, not an HT — an HT is an action with a doer.

Keep it one line, two at most; details live in the owning domain file or OD entry —
link, don't inline. Every HT must be executable stand-alone: either the line itself
carries everything the human needs, or it names the exact place where the
instructions live (file/section, OD-/D-id) — "update X" without saying where and
how is not an entry. Check off with `[x]` when done; never delete an open entry.
Checked-off entries are working memory, not history: once a `[x]` entry is clearly
settled (rule of thumb: the next session no longer needs it), move its line verbatim
to `archive/human-todos.md` (create on demand). IDs stay sequential and are never
reused — the counter continues across archived entries. doctor nudges when done
entries pile up (SY-07).

### OD-NNN — Open decision briefing

```markdown
## OD-NNN — [question title]

Opened: YYYY-MM-DD
Context: [why this matters now]
Options:
- A: [short label] — [what choosing it means] +[opportunity] / –[risk]
- B: [short label] (recommended) — [what choosing it means] +[opportunity] / –[risk]
- C: [short label] — [what choosing it means] +[opportunity] / –[risk]
- …: as many as the question genuinely has — two is the minimum, not the shape
Trade-offs: [cross-cutting: cost, reversibility — only what the option lines don't carry]
Leaning: [recommendation — one-line why · or: none — what input would decide it]
Needed from human: [decision/input needed]
```

An OD is a briefing, not a note-to-self: each option carries its own opportunity
and risk so the human can decide without reconstructing the analysis. Give a
`Leaning:` with its why whenever one is defensible; never fabricate confidence —
an honest `none` plus what would resolve it beats an anchored guess.

**The option lines are a machine contract.** `doctor`'s SY-03 check parses them,
so the shape is not cosmetic:

- **Keyed** — start with `A:`, `B:`, `C:`, … (or `1.`, `2.`, `3.`, …). The key anchors
  the label. Two options are the floor, not the format: list every option the
  question actually has — a real three- or four-way choice forced into a binary
  hides the option the human would have picked. Beyond four, ask whether some
  are variants of one option and say so in `Trade-offs:` instead.
- **Label before the ` — `**, and keep it short: it is the click target in the UI,
  not the argument. Everything explanatory goes after the dash.
- **`+upside / –downside` at the end** of the description, in that order,
  separated by ` / `. They are rendered as separate pro/con lines.
- **`(recommended)`** on at most one option, and only when `Leaning:` agrees — it
  renders as a badge. Omit it when you have no defensible leaning rather than
  marking one for the sake of it.

An entry without keyed, dashed option lines still displays, but as free text: the
human then re-reads your prose instead of choosing. doctor warns (SY-03).

`OD-NNN` is sequential and never reused (its own counter — the question only earns a `D-NNN` once decided). Because entries are removed on decision, the counter is not readable from this file alone: the next free number is one above the highest `OD-NNN` found here **or** in a `Closes:` line under state/decisions/. `Opened:` records when the question arose; nothing expires by the calendar, but `truss status` shows each open entry with its age and doctor asks once past 30 days whether the question still stands (SY-10). When decided: create a D-NNN in state/decisions/ with a `Closes: OD-NNN` line, update any references to the OD to point at the D-NNN, then **remove the entry here in the same change** — no "DECIDED" tombstones; the `Closes:` line is the permanent trace. doctor checks numbering via SY-03 and flags leftover decided entries via SY-06.

Removing the last entry empties this file; it does not delete it. `state/open-decisions.md` is part of the §1 load order and ships with every workspace — empty is the correct state of a project with no open questions.

### R-NNN — Risk

```markdown
## R-NNN — [risk title]

Opened: YYYY-MM-DD
Severity: low|medium|high
Status: open|mitigated|accepted|closed
Trigger: [what would make this real]
Mitigation: [what reduces likelihood or impact]
Owner: human|agent|shared
```

Use for project, launch, safety, strategy, or blocker risks. Do not turn every
minor uncertainty into an R-entry; lightweight notes can stay in the owning
domain until they affect a decision or gate.

### L-NNN — Learning (Agent System Weakness)

```markdown
## L-NNN — [short learning title]

Date: YYYY-MM-DD
Trigger: [what exposed the weakness]
Systemic cause: [why the framework allowed it]
Adjustment: [what changed in files/process/checks]
Follow-up: [optional]
```

Written when a systemic agent/framework weakness is *identified* — not only once
it is fixed. A finding you have no time for is the expensive one: unrecorded, it
gets found and investigated a second time. An entry without a fix yet carries
`Adjustment: open (as of YYYY-MM-DD) — [why not yet]` and names the next step in
`Follow-up:`; the field stays present, so the grammar check is unaffected.
Ordinary product bugs go to the repo issue tracker, a test, a local domain task,
or a domain file for project-wide planning. If a bug exposes a technical
decision, record a D-NNN; if it creates project, launch, or safety exposure,
record an R-NNN.

**The adjustment belongs where the behaviour happens, not only here.** A rule
that lives only in this file is read when someone opens this file, and nothing
makes them — so the weakness gets found a second time by the session that had no
reason to look. Put the rule where the next session must pass anyway: the check
that would catch it, the test, the convention that governs it, a comment at the
line that got it wrong. `Adjustment:` then names that place, and the entry keeps
the trace rather than the rule. A weakness with no such place — a habit, not a
rule — stays here in full; that is the exception, and it is the one case where
re-reading this file is the only mechanism there is.

When the adjustment is itself a decision, record the D-NNN with `Addresses:
L-NNN`. Without that line the pair is readable only from this side, and the link
breaks the moment the decision is compressed or archived.

### TF-NNN — Truss finding (upstream feedback)

```markdown
## TF-NNN — [short finding title]

Date: YYYY-MM-DD
Observed: [what Truss did or failed to do]
Impact: [the extra work, confusion, or breakage it causes]
Suggestion: [what Truss should change]
```

For friction caused by Truss itself during long-term use — logic errors,
unclean rules, rules that break over time, boot-context cost, awkward
workflows. Not for this project's own bugs (repo issue tracker) and not for
systemic agent weaknesses with a local fix (`L-NNN`): a finding is feedback
*upstream*, meant to be filed against the Truss repository once confirmed.
Workspaces initialised with `--findings off` have no findings channel; do not
create the file there.

## Profile

`state/profile.md` is boot context, read every session — a config sheet, not a
notebook. It is also the canonical home for the human's durable **behaviour
preferences**: when they say "remember this" and the wish is about how you work
(language, tone, how much to plan, what to ask before acting, what never to do),
write it as one imperative line under `## Style & moral` — never leave it in the
chat alone. Route the other cases by content: a fact about the project → its
domain file · a technical convention → this file · a commitment to act → the
owning task list · something the human must do → HUMAN-TODOS.md · a real
decision → `D-NNN`. Ambiguous → ask rather than guess.

The volume rules live in the file itself. Anything that needs more than a line
belongs in the file that owns the topic, linked from here.

## File templates

### On-demand state files

`state/open-decisions.md`, `state/risks.md`, `state/learnings.md`,
`state/truss-findings.md`, and
`HUMAN-TODOS.md` do not exist until their first entry (AGENTS.md §2). Create
each as `# [Title]` plus the first entry in the grammar above — no boilerplate
header comments. When the last entry leaves (decided, archived), the file may
be deleted again; the ID counters continue regardless.

### Domain file (`context/<domain>.md`)

> Domain (topic) files live under `context/` — one canonical home per topic; discovered via `state/map.md`, not individually registered in §2.

```markdown
---
focus: [the one thing this domain is currently about — one line]
next:
  - [open point, one line]
  - [open point, one line]
blockers: none
---

# [Domain name]

> Belongs here: [short positive scope]. Not here: [only ambiguous exclusions with pointer].

## Tasks

- [ ] [Small local task tied to this domain.]

[Content begins here. Omit ## Tasks when there are no local tasks.]
```

**The frontmatter is the domain's state, and it is what makes the file a domain.**
A `context/**.md` file whose frontmatter carries a non-empty `focus:` *is* a
domain — there is no registration list, no `domains:` block in
`state/current.md`, and no entry in `state/profile.md`. `truss status` scans the
files themselves and prints the register: name, focus, number of open points,
age. Generated, never stored, so it cannot drift from what the files say.
A file without frontmatter, or with an empty `focus:`, is an ordinary context
file — it is simply skipped, and that is not a finding.

`next:` and `blockers:` take one of two forms. The block above is the documented
one, because an entry may then contain a comma:

```markdown
next:
  - first point
  - second point, with a comma
```

A comma list stays valid for a one-liner: `next: first point, second point`.
Inline YAML (`next: [a, b]`) is **not** supported and will parse wrong — use one
of the two forms above. `none` or a dash means "nothing here" and counts as
empty.

The division of labour with `state/current.md`: open **points** belong to the
domain that owns them, so they live here. `state/current.md` keeps `focus:`
(project-wide), `blockers:` (across domains) and `branch:`. Its global `next:`
is required only while no domain exists; once one does, move the points into
their domains and drop it — `doctor` says so once, as info (SY-12). A
project-wide next step is `focus:`, not a second list.

Domain tasks are optional. Use them only for small tasks tied to that domain.
Project-wide planning belongs in a domain file under `context/` (loaded and
checked like any other) or the project's planning convention; human-only
tasks belong in `HUMAN-TODOS.md`; undecided questions belong in
`state/open-decisions.md`. Remove or check off completed local tasks and clean
them up promptly. Keep the first blockquote one line so `truss map` can use it.
When a domain file grows beyond ~450 lines or five distinct themes, split it
into a folder or separate domain files.


### N-1 Table Overview (Snippets)

For overviews grouping N items into 1 category (many-to-one), use this table format to compress information compactly:

```markdown
| Category / Group | Items (N) |
|---|---|
| [Category A] | - [Item 1]<br>- [Item 2]<br>- [Item 3] |
| [Category B] | - [Item 4]<br>- [Item 5] |
```

Use this whenever summarizing multiple files, phases, or items mapped to a single parent to maintain readability without deep nesting.

## Naming conventions

- Files: lowercase, hyphens, English. No spaces, no underscores, no CamelCase.
- Folders: same rules. No trailing slash in references.
- Domain files: noun or noun-phrase (e.g. `pricing.md`, `user-research.md`).
- IDs in prose: always include prefix (D-001, not just 001).

### Dot names for sub-domains

When a domain splits, write the parts as **dotted names in one flat directory** —
`context/legal.incorporation.md`, `context/legal.trademark.md` — not as
`context/legal/incorporation.md`. Both work; the dot is the convention.

Why: the dot keeps every domain file one level under `context/`, so the whole
register is one flat list, `state/map.md` groups them all under a single
`/context` heading, and a link to a domain never has to be rewritten because the
file moved a level deeper. The name still shows the hierarchy, and it reads the
same in `truss status`, in the map, and in a link. This is a naming rule only —
no code splits on the dot, and nested directories under `context/` keep working
if a project prefers them.

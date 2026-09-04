---
current: discover
profile: founders-thinking
---

> Source of truth for phase definitions. `truss render` reads this file and writes the phase block in AGENTS.md.
> `current:` is the only line a human changes here; advancing it (a phase change) is human-only — see AGENTS.md §4 (phase exit procedure).
> The definitions below are the project's phase plan — drafted at kickoff from this seed, agent-maintained: restructure with a D-NNN + tell the human + `truss render`; hard limits in AGENTS.md §5.
>
> This is a phase profile, not the active phase list. To adopt it, a human copies it
> to `state/phases.md` (set `current:` as needed) and runs `truss render`. See
> `.truss/phase-profiles/README.md`.

## discover

label: Discovery
purpose: explore the idea, map the problem space, and sketch the market and customer.
behavior: divergent — generate options, defer judgment, no premature convergence.
allowed: domain notes, market and customer research, open questions, sketches, VISION.md sections.
forbidden: code in repo/, final decisions without D-entry, spec documents, committing to a single solution.
forbidden-globs: repo/**
read: state/profile.md
exit: section: VISION.md#Problem; glob: context/market*.md; glob: context/customer*.md; pursue/park leaning noted (human)

## validate

label: Validation
purpose: test the riskiest assumptions with external evidence before shaping a concept.
behavior: empirical — seek disconfirming evidence; a failed assumption is a success.
allowed: user interviews, competitor analysis, willingness-to-pay probes, assumption logs, survey notes.
forbidden: code in repo/, treating the idea as proven, ignoring contrary signals, locking scope.
forbidden-globs: repo/**
read: state/profile.md, VISION.md
exit: glob: context/customer*.md; section: VISION.md#Principles; key assumptions tested with external evidence (human)

## concept

label: Concept
purpose: synthesize discovery and validation into a concept dossier and a pursue/park call.
behavior: convergent and honest — make the strongest case, then test it; a park is a valid outcome.
allowed: concept dossier, value proposition, assumption status, risk list, decision briefings.
forbidden: code in repo/, building or scaffolding the solution, deferring the pursue/park decision.
forbidden-globs: repo/**
read: state/profile.md, VISION.md, state/decisions-index.md
exit: glob: context/concept*.md; section: context/concept.md#Recommendation; pursue/park decision recorded as D-entry (human)

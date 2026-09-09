# Truss Findings

> Friction caused by Truss itself — logic errors, unclean rules, rules that break over time, context cost (AGENTS.md §2).
> Written when spotted, meant to be filed upstream once confirmed. Shape: docs/conventions.md.

## TF-001 — Engine changes on main without a release step are invisible to `upgrade`

Date: 2026-09-08
Observed: main of the release repo carries two engine commits after the v1.0.0-rc.3 tag (`123e6ac`, `d4b14ee`) that rewrite `.truss/checks/rf.mjs` and `.truss/lib/md.mjs`, while `VERSION` still reads `1.0.0-rc.3` and `MANIFEST.sha256` was not regenerated. `upgrade` therefore answers `Already at 1.0.0-rc.3 — nothing to do`; only `--force` performs the swap. After it, `doctor` reports `ST-09` naming the four files that no longer hash to the shipped manifest.
Impact: two costs, one root cause. An instance cannot distinguish "current" from "behind by two engine commits" — the single command built to answer that question says there is nothing to do, so the only way to find the gap is to diff the engine trees by hand. And once forced through, `ST-09` attributes the upstream manifest to a local engine adaptation: every future session reads this workspace as having modified its own engine, and the check that exists to warn before an upgrade discards real local edits is spent on a false positive. `.truss/` is agent-read-only (§2), so the workspace cannot clear it from this side.
Suggestion: make the release step, not the bare commit, the only way engine files land on main — `bin/release.mjs` bumps `VERSION` and regenerates `MANIFEST.sha256` together, so any tree carrying engine changes carries both. Failing that, have `upgrade` decide on the manifest rather than the version string: a same-version engine whose bytes differ is still an upgrade, and `--force` should not be the documented path to a published change.

## TF-002 — §2 promises a `test` script alias the shipped `package.json` does not define

Date: 2026-09-08
Observed: The AGENTS.md §2 row for `package.json` reads "metadata + `test`/`doctor` script aliases", but the baseline `package.json` defines only `doctor`. `npm test` answers `Missing script: "test"`. Our `package.json` is byte-identical to `.truss/baseline/package.json`, so this is the shipped combination, not local drift; it predates the rc.3+2 engine step.
Impact: Small but self-renewing. §2 is a boot file every session reads, so the wrong alias is the one an agent reaches for first, and the failure looks like a broken workspace rather than a wrong doc. An agent that trusts §2 may also "repair" `package.json` by adding a `test` script, which then shows up as local drift against the baseline at the next upgrade.
Suggestion: Pick one side and ship it — either drop `test` from the §2 row, or add `"test": "cd .truss && node --test"` to the baseline `package.json` — verified here: 533 tests, 0 failures. The second is the more useful reading of the row, since the engine ships its own suite and nothing else in the workspace exposes a way to run it.

## TF-003 — `skills add` vendors only `SKILL.md`, so skills that ship reference files arrive broken

Date: 2026-09-09
Observed: `truss skills add uiux` writes seven files, one `SKILL.md` per skill and nothing else. Two of the seven are routers into material that was never copied: `uiux-slides/SKILL.md` is a table pointing at `references/create.md`, `references/layout-patterns.md`, `references/html-template.md`, `references/copywriting-formulas.md`; `uiux-ui-ux-pro-max/SKILL.md` documents a workflow around `scripts/search.py` and a rule database (`references/quick-reference.md`, `references/pro-rules.md`, `ui-reasoning.csv`). None of these paths exist under `.truss/baseline/.claude/skills/`, so none can be installed. `anthropic-frontend-design` and `stop-slop`, which are self-contained by design, arrive complete.
Impact: The failure is silent and lands on the agent, not the installer. A skill's own front matter promises capability the files cannot deliver, and an agent following it either calls a script that is not there or reads a table of contents with no chapters — after having already spent the tokens to load and reason about it. Worse for judgement than for cost: the SKILL.md reads as authoritative, so an agent can carry a skill's framing while missing the substance the framing was a summary of, and never notice.
Suggestion: Vendor the whole skill directory, or refuse to. `applyTree` already copies recursively, so the gap is in what the baseline holds, not in the copier — either mirror the upstream skill folders completely, or have `skills add` check each installed `SKILL.md` for references to sibling paths and report the ones it could not satisfy. A third option, cheapest and honest: mark such skills in `truss skills list` as partial, so the choice to install a summary-only skill is made knowingly.

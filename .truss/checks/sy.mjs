// checks/sy.mjs — State-layer & entry-grammar checks (SY-01 … SY-05)
//
// SY-01  W  state/current.md missing a required key (focus/next/blockers — 'recently-done' is
//           tolerated if present but no longer required, U6/D-074/D-077: git already carries it;
//           'next' drops out of the requirement as soon as domains exist, U5 — see below)
// SY-12  I  state/current.md still carries a global next: although domains exist (U5/E6)
// SY-02  —  retired (age-based staleness; a resting project is not a broken one) — id not reused
// SY-03  W  entry grammar violated — one pass per class in docs/schema.md, plus profile.md and code-root
// SY-04  —  retired (INBOX.md removed from the baseline; id not reused)
// SY-08  W  ritual drift — state/ or context/ changed well after current.md (D-010, D-058)
// SY-09  I  reading the whole decision log would not fit beside the boot (CX-01 budget) — archive nudge
// SY-10  I  an open decision has been open ≥ 30 days — does the question still stand?
// SY-11  W  Challenged-by: names an OD that does not exist (stale challenge marker)
//
// SY-10 is NOT a revival of SY-02. SY-02 aged workspace state by the calendar and
// was retired because a resting project is not a broken one (D-029). An OD is the
// one entry type that is *waiting on a human*: there, age is the signal, not noise.
// Info severity, never a gate blocker — it asks, it does not condemn.
//
// SY-12 is the one rule holding the U5 split: open points live in the domain file
// that owns them (frontmatter `next:`), a project-wide next step is `focus:`. Two
// places answering "what is next" is the failure mode every double-list system
// dies of. It is Info, not Warning, on purpose — and not out of timidity: the
// moment someone gives their first domain file a `focus:`, every leftover global
// entry becomes a finding at once. That is a migration in flight, not a defect,
// and a Warning would turn `doctor` red in exactly the window where a green run
// is what tells you the move worked. D-081 (the adopter promise — a previously
// green instance must not go red because of a new check) settles it: Info keeps
// exit 0, and the fix: text names the move instead of the sin.
//
// SY-11 exists because RF-02 cannot cover it: since D-031 RF-02 deliberately stays
// silent for ids carrying a `Closes:` trace, which is exactly the state a resolved
// OD is in — so a forgotten `Challenged-by:` would point at a closed question with
// nothing complaining.
//
// Grammar is no longer grounded in this file: since D-079 the entry classes,
// their files, their heading or list form and their required fields come from
// docs/schema.md (lib/schema.mjs), and a workspace without one gets the copy the
// engine ships. Everything else here is still grounded in the *baseline* the
// `init` command renders, which is the canonical fresh-instance format.
// Notably current.md uses
// `key:` lines (focus:/next:/…), NOT `## Section` headings — so this module does
// not rely on parseHeadings for current.md.
//
// SY-05 nudges an overlay to declare its active branch. It is still pure: it only
// reads whether the configured code-root has `.git` (fs.access) — it never runs git. The
// live branch *comparison* (actual vs declared) is deliberately NOT here; it
// lives in `truss status` so the check engine stays hermetic.

import fs from 'node:fs/promises'
import path from 'node:path'
import { wordCount, toTokens, CONTEXT_FILES, WARN_TOKENS } from '../lib/context-budget.mjs'
import { CHECKBOX_ANY, CHECKBOX_DONE } from '../lib/md.mjs'
import { hasDomains, meaningful } from '../lib/domains.mjs'
import { DECISIONS_DIR } from '../lib/decisions-index.mjs'
import { filesForClass, fileForClass, classById } from '../lib/schema.mjs'


export const meta = [
  { id: 'SY-01', severity: 'W', title: 'current.md missing a required key' },
  { id: 'SY-03', severity: 'W', title: 'entry grammar violated', description: 'Heading or list form, and the required fields, per entry class in docs/schema.md; also profile.md sections and the code-root setting' },
  { id: 'SY-05', severity: 'W', title: 'code-root checkout present but no branch: declared in current.md' },
  { id: 'SY-06', severity: 'W', title: 'decided open-decision entry still present (tombstone)', description: 'On decision the OD entry is removed; the D-NNN Closes: line is the trace' },
  { id: 'SY-07', severity: 'I', title: 'HUMAN-TODOS.md accumulates checked-off entries', description: 'more than 5 settled [x] entries → move them to archive/human-todos.md' },
  { id: 'SY-08', severity: 'W', title: 'ritual drift — workspace state changed after current.md was last updated', description: 'mtime comparison of state/ + context/ vs current.md, with a grace window for the write-back that follows a change (D-010, D-058)' },
  { id: 'SY-09', severity: 'I', title: 'the whole decision log no longer fits beside the boot', description: `Boot (CX-01 files) + every decision body read in full exceeds ${WARN_TOKENS} token-equivalent — the read §1 requires before a decision is made or proposed. Check for entries whose consequence is carried elsewhere and can move to archive/decisions/` },
  { id: 'SY-10', severity: 'I', title: 'open decision has been waiting a long time', description: 'Opened: ≥ 30 days ago → decide it, re-brief it, or drop it; not SY-02 (that aged all state, this asks about a question waiting on a human)' },
  { id: 'SY-11', severity: 'W', title: 'Challenged-by: points at an open decision that does not exist', description: 'The challenge was resolved or removed but the marker on the decision stayed' },
  { id: 'SY-12', severity: 'I', title: 'current.md still carries a global next: although domains exist', description: 'Open points belong in the frontmatter next: of the domain file that owns them; a project-wide next step is focus: (U5)' },
]

// 'recently-done' left the required set with U6/D-074/D-077: `git log` already
// carries it, current, unmaintained, without a human keeping it in sync — see
// checks/sy.mjs header. An existing 'recently-done:' line is tolerated, not
// flagged: a key retired from the requirement must never turn an instance that
// wrote it correctly under the previous baseline from green to warning.
const CURRENT_REQUIRED_KEYS = ['focus', 'next', 'blockers']
const HT_DONE_MAX           = 5
const OD_STALE_DAYS         = 30   // set, not derived — info only; correct it at the first false alarm
// SY-08 grace window: how long state may be newer than current.md before it is
// drift rather than a work unit still in progress. Set, not derived (D-058).
const RITUAL_GRACE_MS       = 90 * 60 * 1000


/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Promise<Array>}
 */
export async function run(ctx) {
  const findings = []

  // ── SY-01: current.md required keys + staleness ────────────────────────────
  const current = ctx.files.get('state/current.md')
  // The U5 pivot, asked once for both checks below: a workspace with domains
  // keeps its open points in the domain files, so current.md owes no `next:`.
  const domainsExist = hasDomains(ctx)
  if (current) {
    const lc = current.lines.map(l => l.toLowerCase())

    const required = domainsExist
      ? CURRENT_REQUIRED_KEYS.filter(k => k !== 'next')
      : CURRENT_REQUIRED_KEYS
    const missing = required.filter(
      k => !lc.some(l => l.startsWith(`${k}:`))
    )
    if (missing.length) {
      findings.push({
        id: 'SY-01', severity: 'W',
        file: 'state/current.md',
        message: `current.md is missing required key${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        fix: `Add ${missing.map(k => `'${k}:'`).join(', ')} to state/current.md (required keys: ${required.join(', ')}).`,
      })
    }

  }

  // ── SY-08: ritual drift — state changed after current.md's last update ─────
  // D-010: drift becomes *visible* in-band; no host hooks, no enforcement.
  // Event-granular since D-058: the calendar-day comparison it replaced could
  // not fire within the day most sessions live in, so the one mechanism backing
  // the write-back rule was silent exactly when it was needed. It now compares
  // mtimes directly, with a fixed grace window (RITUAL_GRACE_MS) that absorbs
  // the normal order inside one work unit — edit a state or domain file, then
  // write current.md minutes later. Longer than that is drift, same day or not.
  // mtime-based, no git shell-out (checks stay pure file reads); a fresh clone
  // writes near-uniform mtimes, so it stays quiet too. Scope: the agent-owned
  // ritual write surfaces (state/ and context/) minus current.md itself and the
  // script-generated map.md and decisions-index.md; HUMAN-TODOS.md is excluded —
  // humans check things off at any time. Both generated files are excluded for
  // the same reason: `truss map` / `truss render` stamp them at command time,
  // which says nothing about whether the agent wrote its state back — a `render`
  // run long after the last work unit would otherwise report drift that no edit
  // to current.md could ever clear.
  if (current?.stat) {
    const stamp = (ms) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
        ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const candidates = (ctx.mdFiles || []).filter(rel =>
      (rel.startsWith('state/') || rel.startsWith('context/'))
      && rel !== 'state/current.md'
      && rel !== 'state/map.md'
      && rel !== 'state/decisions-index.md')
    let newest = null
    for (const rel of candidates) {
      try {
        const st = await fs.stat(path.join(ctx.root, rel))
        if (!newest || st.mtimeMs > newest.mtimeMs) newest = { rel, mtimeMs: st.mtimeMs }
      } catch { /* deleted between walk and stat — irrelevant */ }
    }
    const behindMs = newest ? newest.mtimeMs - current.stat.mtimeMs : 0
    if (behindMs > RITUAL_GRACE_MS) {
      const behind = behindMs >= 36 * 3600_000
        ? `${Math.round(behindMs / 86_400_000)} days`
        : `${Math.round(behindMs / 3_600_000)}h`
      findings.push({
        id: 'SY-08', severity: 'W',
        file: 'state/current.md',
        message: `workspace state changed after current.md's last update — ${newest.rel} was modified ${behind} later (${stamp(newest.mtimeMs)} vs ${stamp(current.stat.mtimeMs)}); the write-back per work unit may have been skipped`,
        fix: `Refresh state/current.md (focus / next) so it reflects the newer state — AGENTS.md §4. If it is still accurate, saving it again clears this.`,
      })
    }
  }

  // ── SY-03: entry grammars ──────────────────────────────────────────────────
  // One pass per class the schema declares (D-079). There is no per-class
  // function any more: heading form, list form, required fields and the file
  // they live in all come from docs/schema.md, so a project that adds a class
  // gets its grammar checked without touching this module.
  checkProfileGrammar(ctx.files.get('state/profile.md'), findings)
  await checkCodeRootConfig(ctx, findings)
  const classes = ctx.schema?.classes || []
  for (const cls of classes) {
    for (const file of filesForClass(ctx, cls)) checkEntryGrammar(cls, file, findings)
  }
  // Both layouts (D-087): the split bodies when they exist, the legacy single
  // file otherwise. The class-driven pass above already covers both; SY-09 and
  // SY-11 below take the same list so they cannot disagree about what the log is.
  const decisionFiles = filesForClass(ctx, classById(classes, 'D'))
  const openDecisions = fileForClass(ctx, classById(classes, 'OD'))

  // ── SY-05: code-root checkout present but branch: undeclared ───────────────
  // Pure fs read (no git): if the code root is a checkout, current.md declares the
  // branch the work belongs to so `truss status` / branch-guard can compare.
  await checkOverlayBranchDeclared(ctx, findings)

  // ── SY-06: decided OD entries left as tombstones ────────────────────────────
  checkDecidedTombstones(openDecisions, findings)

  // ── SY-07: HUMAN-TODOS.md piling up checked-off entries ─────────────────────
  checkHumanTodosDonePile(classById(classes, 'HT'), fileForClass(ctx, classById(classes, 'HT')), findings)

  // ── SY-09: decisions.md read cost growing large ──────────────────────────────
  checkDecisionsSize(ctx, decisionFiles, findings)

  // ── SY-10: open decisions that have been waiting a long time ────────────────
  checkOpenDecisionsAge(openDecisions, findings)

  // ── SY-11: stale Challenged-by: markers on decisions ────────────────────────
  for (const f of decisionFiles) {
    checkStaleChallenges(f, openDecisions, findings)
  }

  // ── SY-12: a global next: that outlived the move to domain files ────────────
  if (domainsExist) checkGlobalNextWithDomains(current, findings)

  return findings
}

// ── SY-12 — see the header note for why this is Info. `next:` in current.md is
//    written as `next: one thing` or as a key line followed by indented list
//    items, so both shapes have to be read; a lone `—`/`none` is the baseline's
//    own idiom for "nothing here" and is not an entry — judged by the same
//    `meaningful` predicate the domain definition uses. ──────────────────────────
function checkGlobalNextWithDomains(current, findings) {
  if (!current) return
  const { lines } = current

  const idx = lines.findIndex(l => /^next\s*:/i.test(l))
  if (idx === -1) return

  const entries = []
  const inline = lines[idx].slice(lines[idx].indexOf(':') + 1).trim()
  if (inline) entries.push(inline)
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^[A-Za-z_-]+\s*:/.test(line)) break   // the next top-level key ends the value
    if (/^#{1,6}\s/.test(line)) break          // …so does a heading
    const t = line.trim()
    if (!t || t.startsWith('>')) continue      // blank lines and the file's own notes
    entries.push(t.replace(/^[-*]\s*/, ''))
  }

  const real = entries.filter(e => meaningful(e))
  if (real.length === 0) return

  findings.push({
    id: 'SY-12', severity: 'I',
    file: 'state/current.md', line: idx + 1,
    message: `state/current.md still lists ${real.length} global next: entr${real.length === 1 ? 'y' : 'ies'} although the workspace has domain files`,
    fix: 'Move each entry into the frontmatter next: of the domain file it belongs to; a project-wide next step belongs in focus:. Then remove next: from state/current.md — two places answering "what is next" is how a double-list drifts apart.',
  })
}

// ── SY-10 — an OD is a question parked on a human's desk. Nothing expires by the
//    calendar (D-029 settled that), but a briefing nobody has answered in a month
//    is either still load-bearing and should be pushed, or it has quietly been
//    overtaken and should go. Info severity: the check asks, the human answers. ──
function checkOpenDecisionsAge(file, findings, now = Date.now()) {
  if (!file) return
  const { lines, relPath } = file
  const fenced = ignoredLines(lines)

  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    const m = lines[i].match(/^##\s+(OD-\d{3})\b/)
    if (!m) continue

    const opened = parseOpenedDate(entryBody(lines, i, fenced))
    if (opened == null) continue                       // missing/malformed → SY-03's job

    const days = Math.floor((now - opened) / 86_400_000)
    if (days < OD_STALE_DAYS) continue

    findings.push({
      id: 'SY-10', severity: 'I',
      file: relPath, line: i + 1,
      message: `${m[1]} has been open for ${days} days`,
      fix: `Does the question still stand? Decide it (D-NNN with 'Closes: ${m[1]}'), re-brief it if the options have moved, or remove it if events answered it — say which in state/current.md. Age alone is not a defect; an unanswered briefing usually is.`,
    })
  }
}

// ── SY-11 — `Challenged-by: OD-NNN` is the only transient field in the decision
//    grammar: set when a decision is contested, removed when the challenge
//    resolves. A marker left behind makes a settled decision read as contested in
//    boot context, which is exactly the misreading the field exists to prevent. ──
function checkStaleChallenges(decisions, openDecisions, findings) {
  if (!decisions) return

  const defined = new Set()
  if (openDecisions) {
    const odFenced = ignoredLines(openDecisions.lines)
    for (let i = 0; i < openDecisions.lines.length; i++) {
      if (odFenced.has(i)) continue
      const m = openDecisions.lines[i].match(/^##\s+(OD-\d{3})\b/)
      if (m) defined.add(m[1])
    }
  }

  const { lines } = decisions
  const fenced = ignoredLines(lines)
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    const m = lines[i].match(/^\s*Challenged-by\s*:\s*(.+)$/i)
    if (!m) continue

    for (const id of m[1].match(/OD-\d{3}/g) || []) {
      if (defined.has(id)) continue
      findings.push({
        id: 'SY-11', severity: 'W',
        file: decisions.relPath, line: i + 1,
        message: `Challenged-by: ${id} — no such entry in state/open-decisions.md`,
        fix: `If the challenge was decided, the superseding D-NNN carries 'Closes: ${id}' and this line goes. If it was rejected, this line goes and the tested alternative belongs in the decision's Rationale:. If the OD was lost, restore it. See docs/conventions.md.`,
      })
    }
  }
}

// ── SY-09 — §1 requires the whole log to be read before a decision is made or
//    proposed, and the log only grows (entries are superseded, never deleted).
//    The threshold is DERIVED, not set: it fires when that read no longer fits
//    beside the boot inside the CX-01 warn budget — i.e. when a session that has
//    to make a decision cannot afford the context the rules oblige it to load.
//
//    It used to be a flat 6000, "one third of the CX-01 warn budget". That
//    derivation died with D-087: the bodies left the boot entirely, so a third of
//    a *boot* budget no longer described anything the log costs. Keeping the
//    number would have meant a check firing against a rule nobody could name.
//    Same words × 1.5 estimate as CX-01 and `truss map`, so the numbers agree.
//    Info, never a gate blocker: a log whose entries are all still load-bearing
//    may legitimately sit above the line — the check asks for a review, it does
//    not demand deletion (deleting decisions is forbidden). ──────────────────────
function checkDecisionsSize(ctx, files, findings) {
  if (!files.length) return
  // The cost of reading the WHOLE log. Split across bodies (D-087) that is the
  // sum, not the largest file — splitting makes a lookup cheap, it does not make
  // the full read cheap, and pretending otherwise would silence the nudge
  // exactly when the log has grown enough to need it.
  const tokens = files.reduce((n, f) => n + toTokens(wordCount(f.content)), 0)
  const boot = CONTEXT_FILES.reduce(
    (n, rel) => n + toTokens(wordCount(ctx.files.get(rel)?.content ?? '')), 0)
  if (boot + tokens <= WARN_TOKENS) return

  const split = files.length > 1 || files[0].relPath !== 'state/decisions.md'
  const where = split ? `${DECISIONS_DIR}/ (${files.length} entries)` : 'state/decisions.md'
  findings.push({
    id: 'SY-09', severity: 'I',
    // The cost belongs to the log as a whole. Pointing at one body would send
    // the reader to a file where nothing is wrong.
    file: split ? `${DECISIONS_DIR}/` : files[0].relPath, line: split ? undefined : 1,
    message: `reading all of ${where} costs ≈ ${tokens} tokens; with the ${boot}-token boot that is ${boot + tokens}, over the ${WARN_TOKENS} budget a session making a decision has`,
    fix: `Review for entries that no longer need to be read (docs/conventions.md): a superseded entry shrinks to heading + supersede note; an entry whose consequence is carried by a check, a test, a convention or the file structure moves to archive/decisions/ whole, with a pointer. Never delete an entry. The \`cleanup\` ritual (.truss/docs/rituals/cleanup.md) runs this as a proposal-first pass over the whole boot context.`,
  })
}

// ── SY-06 — an OD entry that records its own decision is a tombstone: the
//    convention (docs/conventions.md) is to remove the entry when the D-NNN
//    (with `Closes: OD-NNN`) is written. Detected via a `Decided:` field in the
//    body or a DECIDED / "→ D-NNN" marker in the heading. Warning, not error:
//    old workspaces migrate at their own pace. ────────────────────────────────
function checkDecidedTombstones(file, findings) {
  if (!file) return
  const { lines, relPath } = file
  const fenced = ignoredLines(lines)

  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    const m = lines[i].match(/^##\s+(OD-\d{3})\b(.*)$/)
    if (!m) continue

    const headingDecided = /\bDECIDED\b/i.test(m[2]) || /(?:→|->)\s*D-\d{3}\b/.test(m[2])
    const body = entryBody(lines, i, fenced)
    const bodyDecided = body.some(l => /^\s*decided:\s*\S/i.test(l))

    if (headingDecided || bodyDecided) {
      findings.push({
        id: 'SY-06', severity: 'W',
        file: relPath, line: i + 1,
        message: `${m[1]} is decided but still parked here as a tombstone`,
        fix: `Ensure the resolving D-NNN carries 'Closes: ${m[1]}', point any references at that D-NNN, then delete the ${m[1]} entry. The Closes: line is the permanent trace (docs/conventions.md).`,
      })
    }
  }
}

// ── SY-07 — HUMAN-TODOS.md is working memory, not history: settled [x] entries
//    move to archive/human-todos.md (docs/protocols.md). Info-level nudge once
//    more than HT_DONE_MAX checked-off entries have piled up. ─────────────────
function checkHumanTodosDonePile(cls, file, findings) {
  if (!cls || !file) return
  // Prefix and file both come from the class, so renaming either in the schema
  // keeps this check pointed at the entries instead of switching it off.
  const doneRe = new RegExp(`^[-*]\\s+${CHECKBOX_DONE}\\s+${cls.id}-\\d{3}\\b`)
  const fenced = ignoredLines(file.lines)
  const done = []
  for (let i = 0; i < file.lines.length; i++) {
    if (fenced.has(i)) continue
    if (doneRe.test(file.lines[i].trimStart())) done.push(i + 1)
  }
  if (done.length > HT_DONE_MAX) {
    findings.push({
      id: 'SY-07', severity: 'I',
      file: file.relPath, line: done[0],
      message: `${done.length} checked-off ${cls.id} entries have piled up (> ${HT_DONE_MAX})`,
      fix: `Move settled [x] lines verbatim to archive/human-todos.md (create on demand); keep only recently checked-off entries here. The ${cls.id} counter continues across archived entries (docs/protocols.md).`,
    })
  }
}

/** SY-05 — code-root/.git exists but current.md has no non-empty `branch:` line. */
async function checkOverlayBranchDeclared(ctx, findings) {
  if (!ctx.codeRoot?.rel || ctx.codeRoot.error) return
  let isCheckout = false
  try { await fs.access(path.join(ctx.codeRoot.abs, '.git')); isCheckout = true } catch { /* no code checkout */ }
  if (!isCheckout) return

  const current = ctx.files.get('state/current.md')
  const branchLine = current?.lines?.find(l => l.toLowerCase().startsWith('branch:'))
  const declared = branchLine ? branchLine.slice(branchLine.indexOf(':') + 1).trim() : ''
  if (declared) return

  findings.push({
    id: 'SY-05', severity: 'W',
    file: 'state/current.md',
    message: `${ctx.codeRoot.rel}/ is a git checkout but no active branch is declared (branch:)`,
    fix: `Add 'branch: <name>' to state/current.md (the ${ctx.codeRoot.rel}/ branch this focus belongs to). \`truss status\` then flags a mismatch.`,
  })
}

async function checkCodeRootConfig(ctx, findings) {
  if (ctx.codeRoot?.error) {
    findings.push({
      id: 'SY-03', severity: 'W',
      file: 'state/profile.md',
      message: `invalid code-root '${ctx.codeRoot.raw}': ${ctx.codeRoot.error}`,
      fix: "Set 'code-root:' to one relative directory outside Truss-managed paths, or leave it blank.",
    })
    return
  }
  if (!ctx.codeRoot?.rel) return

  try {
    if (!(await fs.stat(ctx.codeRoot.abs)).isDirectory()) throw new Error()
  } catch {
    findings.push({
      id: 'SY-03', severity: 'W',
      file: 'state/profile.md',
      message: `configured code-root does not exist: ${ctx.codeRoot.rel}/`,
      fix: `Create ${ctx.codeRoot.rel}/, correct code-root in state/profile.md, or leave it blank.`,
    })
    return
  }

  const listed = ctx.structureTable.some(
    row => row.paths.some(item => item.replace(/\/$/, '') === ctx.codeRoot.rel),
  )
  if (!listed) {
    findings.push({
      id: 'SY-03', severity: 'W',
      file: 'AGENTS.md',
      message: `configured code-root ${ctx.codeRoot.rel}/ is missing from the §2 structure table`,
      fix: `Add '${ctx.codeRoot.rel}/ (on demand)' as a summary row in AGENTS.md §2.`,
    })
  }
}

// Indices of lines inside fenced code blocks (``` or ~~~). Entry-grammar checks
// skip these so a documented example like `## HT-009 — …` or `## D-001` shown in a
// code block is not mistaken for a real (malformed) entry. Mirrors parseIdReferences.
// Lines that look like entries but are not: fenced code blocks AND HTML comment
// blocks. The baseline state files carry their entry template in a `<!-- ... -->`
// block (the file is usually empty, so it cannot teach its grammar by example) —
// without this the template's own "## OD-NNN — [question title]" line would be
// read as a malformed entry and every fresh workspace would boot with a warning.
function ignoredLines(lines) {
  const inside = new Set()
  let fence = false
  let comment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!comment && /^\s*(```|~~~)/.test(line)) { inside.add(i); fence = !fence; continue }
    if (fence) { inside.add(i); continue }

    // A comment block only OPENS at the start of a line. Prose that mentions the
    // syntax mid-sentence ("…deckt `<!-- -->` mit ab") is not a comment, and
    // treating it as one swallowed the rest of that entry's fields.
    const opens = /^\s*<!--/.test(line)
    const closes = /-->/.test(line)
    if (comment) { inside.add(i); if (closes) comment = false; continue }
    if (opens) { inside.add(i); if (!closes) comment = true; continue }
  }
  return inside
}

function entryBody(lines, startIdx, fenced, level = 2) {
  const stop = new RegExp(`^#{1,${level}}\\s`)
  const body = []
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (stop.test(lines[j]) && !fenced.has(j)) break
    if (!fenced.has(j)) body.push(lines[j])
  }
  return body
}

function hasField(body, field) {
  const re = new RegExp(`^\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'i')
  return body.some(l => re.test(l))
}

function missingFields(body, fields) {
  return fields
    .filter(field => {
      const options = Array.isArray(field) ? field : [field]
      return !options.some(option => hasField(body, option))
    })
    .map(field => Array.isArray(field) ? field[0] : field)
}

function warnMissingFields(findings, file, line, entryId, missing) {
  if (!missing.length) return
  findings.push({
    id: 'SY-03', severity: 'W',
    file, line,
    message: `${entryId} is missing recommended field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    fix: `Add ${missing.map(f => `'${f}:'`).join(', ')} under ${entryId}. See docs/conventions.md.`,
  })
}

// ── SY-03, the whole of it: one class, one file ──────────────────────────────
// Everything class-specific — the ID prefix, whether entries are headings or
// list items, which fields are owed — arrives in `cls`, read from docs/schema.md
// (D-079). Two field names carry a rule beyond "is it there", both documented in
// that file because they are contracts a reader can see: `Opened:` must be a
// real YYYY-MM-DD date (SY-10 counts days off it), and `Options:` lines are
// parsed into a chooser (checkOptionLines). Both are keyed on the field name,
// not on a class, so a project's own class gets the same treatment.
function checkEntryGrammar(cls, file, findings) {
  if (!file) return
  const { lines, relPath } = file
  const fenced = ignoredLines(lines)
  const requires = (name) => cls.required.some(alts => alts.includes(name))

  if (cls.form === 'list') { checkListGrammar(cls, file, fenced, findings); return }

  // The class's own heading level, both for "is this line an entry slot" and for
  // what counts as a valid entry. A class written as `### X-NNN` is checked at
  // level 3; `##` headings in its file are then sections, not malformed entries.
  const hashes = '#'.repeat(cls.level)
  const slotRe = new RegExp(`^${hashes}\\s+\\S`)
  const headingRe = new RegExp(`^${hashes}\\s+(${cls.id}-\\d{3})\\b`)
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    if (!slotRe.test(lines[i])) continue           // only this class's heading level

    const m = lines[i].match(headingRe)
    if (!m) {
      findings.push({
        id: 'SY-03', severity: 'W',
        file: relPath, line: i + 1,
        message: `heading is not a numbered ${cls.id} entry — expected '${cls.formText}'`,
        fix: `Number the entry '${cls.formText}', or move this section out of ${relPath}: every '## ' heading here is read as an entry. See docs/schema.md.`,
      })
      continue
    }

    const body = entryBody(lines, i, fenced, cls.level)
    const missing = missingFields(body, cls.required)
    // `Opened:` is the one required field that must also parse: SY-10 measures
    // its age, and an unparseable date makes that check silently skip the entry.
    if (requires('Opened') && !missing.includes('Opened') && !parseOpenedDate(body)) {
      missing.unshift('Opened')
    }
    warnMissingFields(findings, relPath, i + 1, m[1], missing)
    if (requires('Options')) checkOptionLines(body, m[1], i + 1, relPath, findings)
  }
}

// ── list-form classes (HUMAN-TODOS.md, and any class a project writes that way)
// Scope is every line that names an ID of the class, not just well-formed ones —
// the point is to catch the entry that got written as prose. Quoted lines and
// comment openers are documentation about the form, not entries in it.
function checkListGrammar(cls, file, fenced, findings) {
  const { lines, relPath } = file
  const mentions = new RegExp(`\\b${cls.id}-\\d{3}\\b`)
  // The checkbox is part of the grammar only if the class writes one. Built from
  // the shared CHECKBOX_ANY fragment so this can never disagree with
  // parseIdDefinitions about what a task line looks like — D-046.
  const box = /\[\s*[ xX]\s*\]/.test(cls.formText) ? `${CHECKBOX_ANY}\\s+` : ''
  const grammar = new RegExp(`^[-*]\\s+${box}${cls.id}-\\d{3}\\s+—\\s+\\S`)

  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    if (!mentions.test(lines[i])) continue
    const t = lines[i].trimStart()
    if (t.startsWith('>') || t.startsWith('<!--')) continue
    if (grammar.test(t)) continue
    findings.push({
      id: 'SY-03', severity: 'W',
      file: relPath, line: i + 1,
      message: `${cls.id} entry does not match the list grammar '${cls.formText}'`,
      fix: `Rewrite as '${cls.formText}'${box ? " (use '[x]' when it is done; never delete)" : ''}. See docs/schema.md.`,
    })
  }
}

// ── The option lines are a machine contract: they are parsed, not just read
//    (docs/conventions.md). A line without a key or without the
//    ` — ` separator still renders, but as one undifferentiated block of text —
//    the human then re-reads the prose instead of choosing, and nothing in the
//    file says why. Warn at the point of writing instead. ───────────────────────
function checkOptionLines(body, id, entryLine, relPath, findings) {
  let inOptions = false
  for (const line of body) {
    if (/^\*{0,2}\s*options\s*:?\s*\*{0,2}\s*$/i.test(line.trim())) { inOptions = true; continue }
    if (!inOptions) continue

    const item = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)$/)
    if (!item) { if (line.trim()) inOptions = false; continue }

    const text = item[1].replace(/\*\*/g, '').trim()
    const keyed = /^(?:[A-Za-z]|\d{1,2})\s*[:.)]\s+\S/.test(text)
    const dashed = /\s+[—–]\s+\S/.test(text)
    if (keyed && dashed) continue

    findings.push({
      id: 'SY-03', severity: 'W',
      file: relPath, line: entryLine,
      message: `${id}: option line is not in chooser form${keyed ? ' (no " — " after the label)' : dashed ? ' (no A:/B: key)' : ' (no key, no " — ")'} — "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
      fix: `Write options as '- A: [short label] — [what it means] +[upside] / –[downside]'; mark at most one '(recommended)'. The shape is what makes the options choosable instead of prose. See docs/conventions.md.`,
    })
  }
}

function parseOpenedDate(body) {
  const opened = body.find(l => /^\s*opened:\s*/i.test(l))
  const m = opened?.match(/^\s*opened:\s*(\d{4})-(\d{2})-(\d{2})\s*$/i)
  if (!m) return null
  const parsed = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : parsed
}

// ── profile.md: strict headings for core config ───────────────────────────────
function checkProfileGrammar(file, findings) {
  if (!file) return
  const { lines } = file
  const REQUIRED = ['## Project', '## Tools & subscriptions', '## Style & moral']
  
  const lcLines = lines.map(l => l.trim().toLowerCase().replace(/\s+/g, ' '))
  const missing = REQUIRED.filter(
    key => !lcLines.some(l => l.startsWith(key.toLowerCase()))
  )

  if (missing.length) {
    findings.push({
      id: 'SY-03', severity: 'W',
      file: 'state/profile.md', line: 1,
      message: `profile.md is missing required section${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      fix: `Restore the missing sections: ${missing.join(', ')} (see STRUKTUR.md §11).`,
    })
  }

}

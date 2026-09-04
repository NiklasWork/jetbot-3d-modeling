// .truss/tests/checks-m5.test.mjs — SY/CX/HY checks + doctor report output (M5)
// Unit tests build a minimal ctx by hand (like workspace.test.mjs); the report
// tests drive the real CLI as a subprocess against a freshly-init'd instance.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as sy from '../checks/sy.mjs'
import * as cx from '../checks/cx.mjs'
import * as ph from '../checks/ph.mjs'
import * as rf from '../checks/rf.mjs'
import * as st from '../checks/st.mjs'
import { loadWorkspace } from '../lib/workspace.mjs'
import { parseIdDefinitions } from '../lib/md.mjs'
import { loadSchema } from '../lib/schema.mjs'
import { makeRoot, read, runChecks, ENGINE_DIR } from './helpers.mjs'
import { runInit } from '../lib/commands/init.mjs'

const execFileP = promisify(execFile)
// The entry classes every hand-built ctx below is checked against: the copy the
// engine ships, loaded the same way a workspace without its own docs/schema.md
// loads it. Tests that need a different class set pass their own `schema`.
const SCHEMA = await loadSchema(path.join(os.tmpdir(), 'truss-no-such-workspace'))

const DAY = 86_400_000
const today  = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10)
const ids = (findings, id) => findings.filter(f => f.id === id)

function file(content, ageDays = 0) {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { lines, content, stat: { mtimeMs: Date.now() - ageDays * DAY } }
}
function ctxOf(files = {}, { phases, diskPaths = [], root = '/tmp/none', schema = SCHEMA } = {}) {
  // relPath is filled in from the key: a check that attributes a finding to
  // `file.relPath` (SY-03 and SY-11 do, since the bodies moved apart in D-087)
  // would otherwise be tested against `undefined` and look fine.
  const entries = Object.entries(files).map(([rel, f]) => [rel, { relPath: rel, ...f }])
  return {
    files: new Map(entries),
    phases: phases ?? { frontmatter: {}, defs: new Map() },
    schema,
    diskPaths, root,
  }
}
const cleanCurrent = (date = today()) => `# Current

focus: shipping M5
next:
  - verify
blockers: none
recently-done:
  - built checks
`

// ── SY-01 ────────────────────────────────────────────────────────────────────
describe('SY-01 current.md', () => {
  it('is clean for a complete, fresh current.md', async () => {
    const f = await sy.run(ctxOf({ 'state/current.md': file(cleanCurrent()) }))
    assert.equal(ids(f, 'SY-01').length, 0, JSON.stringify(ids(f, 'SY-01')))
  })
  it('flags a missing required key', async () => {
    const f = await sy.run(ctxOf({ 'state/current.md': file(cleanCurrent().replace('blockers: none\n', '')) }))
    assert.equal(ids(f, 'SY-01').length, 1)
    assert.match(ids(f, 'SY-01')[0].message, /blockers/)
  })
  it('is clean without recently-done: — retired from the requirement (U6/D-074/D-077)', async () => {
    const withoutRecentlyDone = cleanCurrent().replace(/recently-done:\n(\s+- built checks\n)?/, '')
    assert.doesNotMatch(withoutRecentlyDone, /recently-done/)
    const f = await sy.run(ctxOf({ 'state/current.md': file(withoutRecentlyDone) }))
    assert.equal(ids(f, 'SY-01').length, 0, JSON.stringify(ids(f, 'SY-01')))
  })
  // A pre-existing recently-done: (the previous baseline still wrote it) must
  // not turn green into a finding either — same "is clean for a complete,
  // fresh current.md" case above already proves this, since cleanCurrent()
  // carries a recently-done: block and asserts zero SY-01 findings.

  // U5: `next:` is required only while the workspace has no domain files. The
  // presence of a domain (a context/**.md with a non-empty frontmatter focus:)
  // IS the definition — nothing registers one.
  const domainFile = (focus = 'the one thing') => file(`---\nfocus: ${focus}\n---\n\n# D\n`)
  const withoutNext = () => cleanCurrent().replace(/next:\n\s+- verify\n/, '')

  it('still requires next: while no domain file exists', async () => {
    const f = await sy.run(ctxOf({ 'state/current.md': file(withoutNext()) }))
    assert.equal(ids(f, 'SY-01').length, 1)
    assert.match(ids(f, 'SY-01')[0].message, /next/)
  })
  it('drops the next: requirement once a domain declares a focus: (U5)', async () => {
    const f = await sy.run(ctxOf({
      'state/current.md': file(withoutNext()),
      'context/pricing.md': domainFile(),
    }))
    assert.equal(ids(f, 'SY-01').length, 0, JSON.stringify(ids(f, 'SY-01')))
  })
  it('a context file without a focus: is not a domain, so next: stays required', async () => {
    const f = await sy.run(ctxOf({
      'state/current.md': file(withoutNext()),
      'context/notes.md': file('# Notes\n\nBody.\n'),
      'context/half.md': file('---\nnext:\n  - a\n---\n\n# Half\n'),
    }))
    assert.equal(ids(f, 'SY-01').length, 1)
    assert.match(ids(f, 'SY-01')[0].message, /next/)
  })
})

// ── SY-12 ────────────────────────────────────────────────────────────────────
describe('SY-12 global next: alongside domain files (U5/E6)', () => {
  const domain = file('---\nfocus: the one thing\n---\n\n# D\n')

  it('stays silent while the workspace has no domains', async () => {
    const f = await sy.run(ctxOf({ 'state/current.md': file(cleanCurrent()) }))
    assert.equal(ids(f, 'SY-12').length, 0)
  })
  it('reports — as info — a global next: that outlived the move to domains', async () => {
    const f = await sy.run(ctxOf({
      'state/current.md': file(cleanCurrent()),
      'context/pricing.md': domain,
    }))
    assert.equal(ids(f, 'SY-12').length, 1)
    assert.equal(ids(f, 'SY-12')[0].severity, 'I', 'D-081: a new check must not turn a green instance red')
    assert.match(ids(f, 'SY-12')[0].message, /1 global next: entry/)
  })
  it('reads the inline form too, and counts the entries', async () => {
    const inline = cleanCurrent().replace(/next:\n\s+- verify\n/, 'next: verify, then ship\n')
    const f = await sy.run(ctxOf({ 'state/current.md': file(inline), 'context/p.md': domain }))
    assert.equal(ids(f, 'SY-12').length, 1)
    assert.match(ids(f, 'SY-12')[0].message, /1 global next: entry/)
  })
  it('an absent or placeholder next: is nothing to move', async () => {
    const gone  = cleanCurrent().replace(/next:\n\s+- verify\n/, '')
    const dash  = cleanCurrent().replace(/next:\n\s+- verify\n/, 'next: —\n')
    const empty = cleanCurrent().replace(/next:\n\s+- verify\n/, 'next:\n')
    for (const variant of [gone, dash, empty]) {
      const f = await sy.run(ctxOf({ 'state/current.md': file(variant), 'context/p.md': domain }))
      assert.equal(ids(f, 'SY-12').length, 0, variant)
    }
  })
})

// ── SY-03 ────────────────────────────────────────────────────────────────────
describe('SY-03 entry grammar', () => {
  it('flags a D-NNN entry with incorrect heading format, passes a correct one', async () => {
    const bad  = `# Decisions\n\n## Pick a stack\n\nDecision: Node.\n`
    const good = `# Decisions\n\n## D-001 — Pick a stack\n\nDate: 2026-06-01\nDecision: Node.\nRationale: small runtime\nConsequences: use node --test\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(bad) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(good) })), 'SY-03').length, 0)
  })
  it('warns when D-NNN fields are missing, while accepting legacy Why as rationale', async () => {
    const missing = `# Decisions\n\n## D-001 — Pick a stack\n\nDate: 2026-06-01\nDecision: Node.\n`
    const legacy = `# Decisions\n\n## D-001 — Pick a stack\n\nDate: 2026-06-01\nDecision: Node.\nWhy: already installed\nConsequences: no install step\n`
    const f = ids(await sy.run(ctxOf({ 'state/decisions.md': file(missing) })), 'SY-03')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /Rationale, Consequences/)
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(legacy) })), 'SY-03').length, 0)
  })
  it('flags a malformed HT entry, ignores doc/comment lines', async () => {
    const bad  = `# Human ToDos\n\n> Format: \`- [x] HT-NNN — description\`\n\n## HT-001 — wrong form\n`
    const good = `# Human ToDos\n\n- [ ] HT-001 — sign the contract\n- [x] HT-002 — done thing\n`
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(bad) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(good) })), 'SY-03').length, 0)
  })
  it('reads an HT entry body as body, not as more entries', async () => {
    // An entry carries indented steps and labels (docs/conventions.md), and a
    // step may well name another entry. Reading those lines as entries would
    // raise a warning whose only "fix" is deleting the instruction.
    const body = '# Human ToDos\n\n- [ ] HT-001 — **rotate the key**\n\n'
      + '  1. do it before HT-002 goes out\n\n'
      + '  **Background:** HT-002 waits on this\n'
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(body) })), 'SY-03').length, 0)
    // An indented mention belonging to no entry is still prose in the entry
    // file — the malformed entry the check exists for.
    const stray = '# Human ToDos\n\n  HT-001 — written as prose, indented\n'
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(stray) })), 'SY-03').length, 1)
  })
  it('flags an OD entry missing Opened and an unnumbered entry, passes a complete one', async () => {
    const good        = `# Open Decisions\n\n## OD-001 — Should we X?\n\nOpened: 2026-06-01\nOptions:\n- A: do X — ships this week +fast / –rough edges\n- B: skip X (recommended) — wait for the rewrite +clean / –slower\nTrade-offs: x\nLeaning: B\n`
    const missingF    = `# Open Decisions\n\n## OD-001 — Should we X?\n\nLeaning: a\n`
    const unnumbered  = `# Open Decisions\n\n## Should we X?\n\nOpened: 2026-06-01\nLeaning: a\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(good) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(missingF) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(unnumbered) })), 'SY-03').length, 1)
  })
  it('warns when OD Opened is not a parseable YYYY-MM-DD date', async () => {
    const badDate = `# Open Decisions\n\n## OD-001 — Should we X?\n\nOpened: soon\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    const f = ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(badDate) })), 'SY-03')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /Opened/)
  })
  it('warns when R-NNN and L-NNN required fields are missing, and keeps empty files clean', async () => {
    const emptyRisks = `# Risks\n\n<!-- entries go here -->\n`
    const goodRisk = `# Risks\n\n## R-001 — Launch slip\n\nOpened: 2026-06-01\nSeverity: medium\nStatus: open\nTrigger: beta date moves\nMitigation: cut scope\nOwner: shared\n`
    const badRisk = `# Risks\n\n## R-001 — Launch slip\n\nSeverity: medium\n`
    const goodLearning = `# Learnings\n\n## L-001 — Context drift\n\nTrigger: missed canonical file\nSystemic cause: load rule was vague\nAdjustment: tightened routing\n`
    const badLearning = `# Learnings\n\n## L-001 — Context drift\n\nTrigger: missed canonical file\n`
    const goodFinding = `# Truss Findings\n\n## TF-001 — Init wizard too long\n\nDate: 2026-08-23\nObserved: init asks four questions\nImpact: onboarding friction\nSuggestion: collapse to one prompt\n`
    const badFinding = `# Truss Findings\n\n## TF-001 — Init wizard too long\n\nObserved: init asks four questions\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/risks.md': file(emptyRisks) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/risks.md': file(goodRisk) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/risks.md': file(badRisk) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/learnings.md': file(goodLearning) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/learnings.md': file(badLearning) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/truss-findings.md': file(goodFinding) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/truss-findings.md': file(badFinding) })), 'SY-03').length, 1)
  })
  it('ignores OD entries shown inside fenced code blocks', async () => {
    const od = '# Open Decisions\n\n```\n## OD-009 — example, no fields\n```\n\n## OD-001 — real\n\nOpened: 2026-06-01\nOptions: a\nTrade-offs: x\nLeaning: a\n'
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(od) })), 'SY-03').length, 0)
  })
  it('ignores HT / D ids shown inside fenced code blocks', async () => {
    const ht  = '# Human ToDos\n\n```\n## HT-009 — heading-form example\n```\n\n- [ ] HT-001 — real entry\n'
    const dec = '# Decisions\n\n```\n## D-009 — example, no fields\n```\n\n## D-001 — real\n\nDate: x\nDecision: x\nWhy: x\nConsequences: x\n'
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(ht) })), 'SY-03').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(dec) })), 'SY-03').length, 0)
  })
})

// ── SY-06 ────────────────────────────────────────────────────────────────────
describe('SY-06 decided OD tombstones', () => {
  it('flags a DECIDED marker in the heading and a Decided: field in the body', async () => {
    const headingTomb = `# Open Decisions\n\n## OD-001 — Pick a source — DECIDED → D-008\n\nOpened: 2026-06-01\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    const bodyTomb    = `# Open Decisions\n\n## OD-002 — Gateway mode?\n\nOpened: 2026-06-01\nDecided: 2026-06-09 → D-010\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    const arrowTomb   = `# Open Decisions\n\n## OD-003 — Account dimension? -> D-011\n\nOpened: 2026-06-01\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(headingTomb) })), 'SY-06').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(bodyTomb) })), 'SY-06').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(arrowTomb) })), 'SY-06').length, 1)
  })
  it('stays silent for genuinely open entries and fenced examples', async () => {
    const open = `# Open Decisions\n\n## OD-001 — Should we X?\n\nOpened: 2026-06-01\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    const fenced = '# Open Decisions\n\n```\n## OD-009 — example — DECIDED → D-001\n```\n\n## OD-001 — real\n\nOpened: 2026-06-01\nOptions: a\nTrade-offs: x\nLeaning: a\n'
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(open) })), 'SY-06').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(fenced) })), 'SY-06').length, 0)
  })
})

// ── SY-07 ────────────────────────────────────────────────────────────────────
describe('SY-07 checked-off HT pile-up', () => {
  const htFile = (open, done) => '# Human ToDos\n\n'
    + Array.from({ length: open }, (_, i) => `- [ ] HT-${String(i + 1).padStart(3, '0')} — open thing ${i + 1}`).join('\n')
    + (open && done ? '\n' : '')
    + Array.from({ length: done }, (_, i) => `- [x] HT-${String(open + i + 1).padStart(3, '0')} — done thing ${i + 1}`).join('\n')
    + '\n'
  it('nudges once more than 5 checked-off entries pile up', async () => {
    const f = ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(htFile(2, 6)) })), 'SY-07')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /6 checked-off/)
    assert.match(f[0].fix, /archive\/human-todos\.md/)
  })
  it('stays silent at or below the threshold and ignores fenced examples', async () => {
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(htFile(3, 5)) })), 'SY-07').length, 0)
    const fenced = '# Human ToDos\n\n```\n- [x] HT-001 — a\n- [x] HT-002 — b\n- [x] HT-003 — c\n- [x] HT-004 — d\n- [x] HT-005 — e\n- [x] HT-006 — f\n```\n\n- [ ] HT-007 — real\n'
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(fenced) })), 'SY-07').length, 0)
  })
})

// ── D-046: one checkbox syntax across modules ───────────────────────────────
// The bug this pins down: `- [X] HT-001 — …` counted as settled for SY-07 but
// was invisible to parseIdDefinitions, so RF-02 warned about an ID that was
// sitting right there — a finding with no legal way to clear it. Every module
// that reads a task line must agree on what a checkbox looks like.
describe('checkbox syntax is shared, not re-invented per module', () => {
  it('parseIdDefinitions accepts every GFM checkbox state', () => {
    const lines = [
      '- [ ] HT-001 — open',
      '- [x] HT-002 — done, lowercase',
      '- [X] HT-003 — done, uppercase',
      '* [X] HT-004 — asterisk bullet',
      '- HT-005 — no checkbox at all',
    ]
    assert.deepEqual(
      parseIdDefinitions(lines, SCHEMA.ids).map(d => d.id),
      ['HT-001', 'HT-002', 'HT-003', 'HT-004', 'HT-005'],
    )
  })

  it('SY-07 and parseIdDefinitions agree on an uppercase-X entry', async () => {
    const ht = '# Human ToDos\n\n'
      + Array.from({ length: 6 }, (_, i) => `- [X] HT-${String(i + 1).padStart(3, '0')} — done ${i + 1}`).join('\n')
      + '\n'
    // SY-07 sees six settled entries …
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(ht) })), 'SY-07').length, 1)
    // … and every one of them is a definition, so RF-02 has nothing to report.
    assert.equal(parseIdDefinitions(ht.split('\n'), SCHEMA.ids).length, 6)
  })

  it('SY-03 accepts uppercase X as valid HT grammar', async () => {
    const ht = '# Human ToDos\n\n- [X] HT-001 — done, uppercase\n'
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(ht) })), 'SY-03').length, 0)
  })

  // The contract, asserted where it matters: every consumer must read the same
  // three GFM states the same way. Source-grepping for stray regexes would be
  // the weaker test — this one fails for the reason a user would notice.
  it('all consumers treat the three GFM states alike', async () => {
    for (const box of ['[ ]', '[x]', '[X]']) {
      const ht = `# Human ToDos\n\n- ${box} HT-001 — a thing\n`
      const findings = await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(ht) }))
      assert.equal(ids(findings, 'SY-03').length, 0, `SY-03 rejects '${box}'`)
      assert.deepEqual(
        parseIdDefinitions(ht.split('\n'), SCHEMA.ids).map(d => d.id), ['HT-001'],
        `parseIdDefinitions misses '${box}' — RF-02 would warn about a defined ID`,
      )
    }
    // …and the two checked states are settled, the open one is not.
    const pile = (box) => '# Human ToDos\n\n'
      + Array.from({ length: 6 }, (_, i) => `- ${box} HT-${String(i + 1).padStart(3, '0')} — d${i}`).join('\n') + '\n'
    for (const box of ['[x]', '[X]']) {
      assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(pile(box)) })), 'SY-07').length, 1, `SY-07 misses '${box}'`)
    }
    assert.equal(ids(await sy.run(ctxOf({ 'HUMAN-TODOS.md': file(pile('[ ]')) })), 'SY-07').length, 0)
  })
})

// ── SY-09 ────────────────────────────────────────────────────────────────────
describe('SY-09 decisions.md read cost', () => {
  // words × 1.5 (lib/context-budget.mjs): 12 000 words ≈ 18 000 tokens = the whole
  // CX-01 warn budget, so any boot at all puts the pair over it.
  const decisionsOf = (words) => '# Decisions\n\n## D-001 — big\n\nDate: 2026-01-01\nDecision: x\nRationale: y\nConsequences: z\n'
    + Array(words).fill('lorem').join(' ') + '\n'
  it('nudges once the log no longer fits beside the boot', async () => {
    const f = ids(await sy.run(ctxOf({ 'state/decisions.md': file(decisionsOf(12_000)) })), 'SY-09')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'I')
    // The threshold is derived, not set: boot + full read against the CX-01 warn
    // budget. The old flat 6000 was "one third of the boot budget", a derivation
    // D-087 killed when the bodies left the boot (D-090).
    assert.match(f[0].message, /over the 18000 budget/)
    // D-087: the archive target is the directory, not a single file. This
    // assertion froze the stale path once already — keep it pointed at what
    // docs/conventions.md actually tells the agent to do.
    assert.match(f[0].fix, /archive\/decisions\//)
    assert.match(f[0].fix, /never delete/i)
  })

  it('stays quiet while the log still fits, however many entries it has', async () => {
    const bodies = {}
    for (let n = 1; n <= 60; n++) {
      const id = `D-${String(n).padStart(3, '0')}`
      bodies[`state/decisions/${id}.md`] = file(
        `## ${id} — entry ${n}\n\nDate: 2026-01-01\nDecision: d\nRationale: r\nConsequences: c\n`)
    }
    assert.equal(ids(await sy.run(ctxOf(bodies)), 'SY-09').length, 0)
  })

  it('counts the boot too, so the same log fires next to a fat AGENTS.md', async () => {
    const log = { 'state/decisions.md': file(decisionsOf(9_000)) }
    assert.equal(ids(await sy.run(ctxOf(log)), 'SY-09').length, 0)
    const withBoot = {
      ...log,
      'AGENTS.md': file(Array(4_000).fill('lorem').join(' ')),
    }
    assert.equal(ids(await sy.run(ctxOf(withBoot)), 'SY-09').length, 1)
  })

  it('attributes a grammar finding to the body that has the defect (D-087)', async () => {
    // The reason the checks loop over files at all: a finding must point at the
    // body to open, not at a log that no longer exists.
    const f = ids(await sy.run(ctxOf({
      'state/decisions/D-001.md': file('## D-001 — fine\nDate: 2026-01-01\nDecision: d\nRationale: r\nConsequences: c\n'),
      'state/decisions/D-002.md': file('## D-002 — missing fields\nDate: 2026-01-02\nDecision: d\n'),
    })), 'SY-03')
    assert.equal(f.length, 1, 'only the defective body is reported')
    assert.equal(f[0].file, 'state/decisions/D-002.md')
  })

  it('reports a stale Challenged-by: against its own body (D-087)', async () => {
    const f = ids(await sy.run(ctxOf({
      'state/decisions/D-004.md': file('## D-004 — contested\nDate: 2026-01-04\nDecision: d\nRationale: r\nConsequences: c\nChallenged-by: OD-901\n'),
      'state/open-decisions.md': file('# Open Decisions\n'),
    })), 'SY-11')
    assert.equal(f.length, 1)
    assert.equal(f[0].file, 'state/decisions/D-004.md')
    assert.match(f[0].message, /OD-901/)
  })

  it('sums the split bodies, because §1 still reads the whole log (D-087)', async () => {
    // Splitting makes ONE lookup cheap; it does not make the full read cheap.
    // Reporting only the largest body would silence the nudge exactly when the
    // log has grown enough to need it.
    const bodies = {}
    for (let n = 1; n <= 4; n++) {
      const id = `D-${String(n).padStart(3, '0')}`
      bodies[`state/decisions/${id}.md`] = file(
        `## ${id} — big ${n}\nDate: 2026-01-01\nDecision: x\nRationale: y\nConsequences: z\n`
        + Array(3200).fill('lorem').join(' ') + '\n'
      )
    }
    const f = ids(await sy.run(ctxOf(bodies)), 'SY-09')
    assert.equal(f.length, 1, 'one finding for the log, not one per body')
    assert.match(f[0].message, /state\/decisions\/ \(4 entries\)/)
    // The cost belongs to the log, so the finding must not send the reader into
    // one arbitrary body where nothing is wrong.
    assert.equal(f[0].file, 'state/decisions/')
  })
  it('stays silent below the threshold and for a missing file', async () => {
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(decisionsOf(500)) })), 'SY-09').length, 0)
    assert.equal(ids(await sy.run(ctxOf({})), 'SY-09').length, 0)
  })
})

// ── CX-01 ────────────────────────────────────────────────────────────────────
describe('CX-01 context size', () => {
  const big = (words) => '# Big\n\n' + Array(words).fill('lorem').join(' ') + '\n'
  it('is silent for a small boot context', async () => {
    const f = await cx.run(ctxOf({ 'AGENTS.md': file('# A\n\nshort'), 'VISION.md': file('# V\n\nshort') }))
    assert.equal(ids(f, 'CX-01').length, 0)
  })
  it('stays silent at a realistic project size (~9k) — bands are for bloat, not for setup', async () => {
    const f = await cx.run(ctxOf({ 'VISION.md': file(big(6000)) })) // ≈9k tokens
    assert.equal(ids(f, 'CX-01').length, 0)
  })
  it('warns past ~18k tokens and errors past ~30k', async () => {
    const w = ids(await cx.run(ctxOf({ 'VISION.md': file(big(13000)) })), 'CX-01')
    assert.equal(w.length, 1); assert.equal(w[0].severity, 'W')
    const e = ids(await cx.run(ctxOf({ 'VISION.md': file(big(21000)) })), 'CX-01')
    assert.equal(e[0].severity, 'E')
  })
  it('counts the current phase read: target', async () => {
    const phases = { frontmatter: { current: 'discover' }, defs: new Map([['discover', { read: 'big.md' }]]) }
    assert.equal(ids(await cx.run(ctxOf({ 'big.md': file(big(13000)) }, { phases })), 'CX-01').length, 1)
  })
  it('counts whitespace-separated read: targets (not just comma/semicolon)', async () => {
    const phases = { frontmatter: { current: 'discover' }, defs: new Map([['discover', { read: 'a.md b.md' }]]) }
    assert.equal(ids(await cx.run(ctxOf({ 'a.md': file(big(6500)), 'b.md': file(big(6500)) }, { phases })), 'CX-01').length, 1)
  })
})

// ── SY-10 ────────────────────────────────────────────────────────────────────
describe('SY-10 open decisions waiting a long time', () => {
  const od = (opened) => `# Open Decisions\n\n## OD-001 — Should we X?\n\nOpened: ${opened}\nOptions:\n- A: do it — now +fast / –rough\n- B: wait — later +safe / –slow\nTrade-offs: x\nLeaning: A\n`

  it('nudges once an entry has been open past the threshold', async () => {
    const f = ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(od(daysAgo(40))) })), 'SY-10')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /OD-001 has been open for 40 days/)
  })

  it('stays silent inside the threshold and for a missing file', async () => {
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(od(daysAgo(5))) })), 'SY-10').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(od(daysAgo(29))) })), 'SY-10').length, 0)
    assert.equal(ids(await sy.run(ctxOf({})), 'SY-10').length, 0)
  })

  it('leaves a missing or malformed Opened: to SY-03 rather than guessing an age', async () => {
    const noDate = `# Open Decisions\n\n## OD-001 — X?\n\nOpened: soon\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(noDate) })), 'SY-10').length, 0)
    assert.ok(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(noDate) })), 'SY-03').length > 0)
  })

  it('ignores entries inside fenced blocks and comment blocks', async () => {
    const fenced = '# Open Decisions\n\n```\n## OD-009 — example\n\nOpened: 2020-01-01\n```\n'
    const comment = '# Open Decisions\n\n<!--\n## OD-NNN — template\n\nOpened: YYYY-MM-DD\n-->\n'
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(fenced) })), 'SY-10').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(comment) })), 'SY-10').length, 0)
  })
})

// ── SY-11 ────────────────────────────────────────────────────────────────────
describe('SY-11 stale Challenged-by markers', () => {
  const decision = (extra = '') =>
    `# Decisions\n\n## D-001 — Pick a stack\n\nDate: 2026-06-01\nDecision: Node.\nRationale: small runtime\nConsequences: use node --test\n${extra}`
  const openOd = `# Open Decisions\n\n## OD-007 — Revisit the stack?\n\nOpened: ${today()}\nOptions:\n- A: keep — stay +cheap / –stale\n- B: move — switch +modern / –costly\nTrade-offs: x\nLeaning: A\n`

  it('stays silent while the challenge is open', async () => {
    const f = await sy.run(ctxOf({
      'state/decisions.md': file(decision('Challenged-by: OD-007\n')),
      'state/open-decisions.md': file(openOd),
    }))
    assert.equal(ids(f, 'SY-11').length, 0)
  })

  it('flags a marker whose OD is gone — the case RF-02 deliberately cannot see', async () => {
    const f = await sy.run(ctxOf({
      'state/decisions.md': file(decision('Challenged-by: OD-007\nCloses: OD-007\n')),
      'state/open-decisions.md': file('# Open Decisions\n'),
    }))
    assert.equal(ids(f, 'SY-11').length, 1)
    assert.match(ids(f, 'SY-11')[0].message, /OD-007/)
  })

  it('flags a marker when open-decisions.md is absent entirely', async () => {
    const f = await sy.run(ctxOf({ 'state/decisions.md': file(decision('Challenged-by: OD-007\n')) }))
    assert.equal(ids(f, 'SY-11').length, 1)
  })

  it('does not treat an inline <!-- --> in prose as a comment block', async () => {
    // Regression: a decision body that *mentions* the comment syntax mid-sentence
    // had the rest of its fields swallowed, so SY-03 reported them missing.
    const inline = `# Decisions\n\n## D-001 — Ignore comment blocks\n\nDate: 2026-06-01\nDecision: skip them.\nRationale: templates live in <!-- --> blocks.\nConsequences: none.\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(inline) })), 'SY-03').length, 0)
  })

  it('ignores markers shown inside fenced or comment blocks', async () => {
    const fenced = `# Decisions\n\n\u0060\u0060\u0060\nChallenged-by: OD-042\n\u0060\u0060\u0060\n`
    const comment = `# Decisions\n\n<!-- Challenged-by: OD-042 -->\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(fenced) })), 'SY-11').length, 0)
    assert.equal(ids(await sy.run(ctxOf({ 'state/decisions.md': file(comment) })), 'SY-11').length, 0)
  })
})

// ── SY-03: the option lines are a machine contract (chooser form) ───────────
describe('SY-03 option-line form', () => {
  const wrap = (opts) => `# Open Decisions\n\n## OD-001 — X?\n\nOpened: ${today()}\nOptions:\n${opts}Trade-offs: x\nLeaning: A\n`

  it('accepts keyed, dashed options with and without a recommendation', async () => {
    const good = wrap('- A: ship — now +fast / –rough\n- B: wait (recommended) — later +safe / –slow\n')
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(good) })), 'SY-03').length, 0)
  })

  it('warns on an option without a key or without the label separator', async () => {
    const noDash = wrap('- A: ship it right now\n')
    const noKey  = wrap('- ship it — now +fast / –rough\n')
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(noDash) })), 'SY-03').length, 1)
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(noKey) })), 'SY-03').length, 1)
  })

  it('does not treat an inline "Options: a" as an options block', async () => {
    const inline = `# Open Decisions\n\n## OD-001 — X?\n\nOpened: ${today()}\nOptions: a\nTrade-offs: x\nLeaning: a\n`
    assert.equal(ids(await sy.run(ctxOf({ 'state/open-decisions.md': file(inline) })), 'SY-03').length, 0)
  })
})

// ── doctor --html / --json, real CLI subprocess ──────────────────────────────
describe('doctor report output', () => {
  const BIN = (root) => path.join(root, '.truss', 'bin', 'truss.mjs')
  const runCli = async (root, args) => {
    try { await execFileP(process.execPath, [BIN(root), ...args], { env: { ...process.env, TRUSS_NO_GIT: '1' } }) }
    catch { /* non-zero exit (warnings/errors) still writes the report file before exiting */ }
  }

  it('writes a clean HTML report listing every check family', async () => {
    const root = await makeRoot('truss-report-')
    await runInit(root, ['--name', 'Report', '--lang', 'English'])
    await runCli(root, ['doctor', '--html'])
    const html = await read(root, '.truss/out/doctor.html')
    assert.match(html, /<title>truss doctor/)
    assert.match(html, /All checks passed/)
    for (const probe of ['ST-01', 'BL-01', 'RF-01', 'SY-01', 'PH-01', 'CX-01']) {
      assert.ok(html.includes(probe), `catalog should list ${probe}`)
    }
  })

  it('writes a JSON report whose catalog includes the M5 checks', async () => {
    const root = await makeRoot('truss-json-')
    await runInit(root, ['--name', 'Json', '--lang', 'English'])
    await runCli(root, ['doctor', '--json'])
    const json = JSON.parse(await read(root, '.truss/out/doctor.json'))
    const catalogIds = json.checks.map(c => c.id)
    for (const id of ['SY-01', 'SY-03', 'SY-09', 'CX-01']) {
      assert.ok(catalogIds.includes(id), `JSON catalog should include ${id}`)
    }
  })
})

describe('risk migration bridge', () => {
  it('loads state/risks.md when present even if an old AGENTS.md table omits it', async () => {
    const root = await makeRoot('truss-risk-bridge-')
    await runInit(root, ['--name', 'Risk Bridge', '--lang', 'English'])
    const agentsPath = path.join(root, 'AGENTS.md')
    const agents = await fs.readFile(agentsPath, 'utf8')
    await fs.writeFile(
      agentsPath,
      agents.replace(/\| state\/risks\.md \|[^\n]+\n/, '')
    )
    await fs.appendFile(
      path.join(root, 'VISION.md'),
      '\n\nThis launch depends on R-001.\n'
    )
    await fs.writeFile(
      path.join(root, 'state', 'risks.md'),
      '# Risks\n\n## R-001 — Launch slip\n\nSeverity: medium\nStatus: open\nTrigger: beta moves\nMitigation: cut scope\n'
    )
    const findings = await runChecks(root)
    assert.equal(
      findings.filter(f => f.id === 'RF-02' && /R-001/.test(f.message)).length,
      0
    )
    await fs.rm(root, { recursive: true, force: true })
  })

  describe('RF operational context coverage', () => {
    it('checks duplicate IDs, undefined learnings, and broken links in context/', async () => {
      const root = await makeRoot('truss-rf-context-')
      await runInit(root, ['--name', 'RF Context', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.appendFile(
        path.join(root, 'state', 'decisions.md'),
        '\n## D-001 — Canonical choice\n\nDate: 2026-07-15\nDecision: Use A.\nWhy: evidence.\nConsequences: proceed.\n'
      )
      await fs.writeFile(
        path.join(root, 'context', 'domain.md'),
        '# Domain\n\n## D-001 — Duplicate choice\n\nSee L-999 and [missing](missing.md).\n'
      )
      const findings = await runChecks(root)
      assert.ok(findings.some(f => f.id === 'RF-03' && /D-001/.test(f.message)))
      assert.ok(findings.some(f => f.id === 'RF-02' && /L-999/.test(f.message)))
      assert.ok(findings.some(f => f.id === 'RF-01' && f.file === 'context/domain.md'))
      await fs.rm(root, { recursive: true, force: true })
    })
  })

  describe('bundled phase fixtures', () => {
    it('parses every shipped phase seed with the same list grammar', async () => {
      // The engine ships exactly two seeds — the core `kickoff` phase and the
      // overlay `ingest → operate` pair. Both must parse clean under the
      // current phase grammar (there are no phase profiles any more).
      for (const [name, seed] of [
        ['core', path.join('baseline', 'state', 'phases.md')],
        ['overlay', path.join('baseline', 'overlay', 'phases.md')],
        // The one phase profile the engine ships (phase-profiles/README.md):
        // its forbidden-globs used to read 'repo/**; pm/**' — pm/ retired
        // (U6/D-074), so it must parse just as clean with only 'repo/**' left.
        ['founders-thinking', path.join('phase-profiles', 'founders-thinking.md')],
      ]) {
        const root = await makeRoot(`truss-seed-${name}-`)
        await runInit(root, ['--name', name, '--lang', 'English'])
        const content = await fs.readFile(path.join(ENGINE_DIR, seed), 'utf8')
        await fs.writeFile(path.join(root, 'state', 'phases.md'), content)
        const ctx = await loadWorkspace(root)
        const findings = [...await ph.run(ctx), ...await rf.run(ctx)]
        assert.equal(findings.filter(f => f.id === 'PH-01').length, 0, name)
        await fs.rm(root, { recursive: true, force: true })
      }
    })

    it('reports free text inside a phase section instead of swallowing it (D-061)', async () => {
      // The block is rendered verbatim into AGENTS.md, i.e. into every session
      // boot. A line after `behavior:` used to be appended to that value and
      // shipped silently; PH-01 now names it.
      const root = await makeRoot('truss-phase-freetext-')
      await runInit(root, ['--name', 'Freetext', '--lang', 'English'])
      const phasesPath = path.join(root, 'state', 'phases.md')
      const raw = await fs.readFile(phasesPath, 'utf8')
      await fs.writeFile(
        phasesPath,
        raw.replace(/^(behavior: .*)$/m, '$1\n\nA stray note the parser must not absorb.\n'),
      )
      const ctx = await loadWorkspace(root)
      const findings = await ph.run(ctx)
      const stray = findings.filter(f => f.id === 'PH-01' && /stray note/.test(f.message))
      assert.equal(stray.length, 1, JSON.stringify(findings))
      assert.doesNotMatch(ctx.phases.defs.get('kickoff').behavior, /stray note/)
      await fs.rm(root, { recursive: true, force: true })
    })

    it('reports a retired phase key as I, not E (U1/D-074)', async () => {
      // `prompts:` left the grammar with the prompt library. An upgraded
      // workspace still carries the line it wrote correctly under the previous
      // version, so PH-01 must hint at it — once — instead of going red.
      const root = await makeRoot('truss-phase-retired-')
      await runInit(root, ['--name', 'Retired', '--lang', 'English'])
      const phasesPath = path.join(root, 'state', 'phases.md')
      const raw = await fs.readFile(phasesPath, 'utf8')
      await fs.writeFile(
        phasesPath,
        raw.replace(/^(behavior: .*)$/m, '$1\nprompts: discover-kickoff'),
      )
      const ctx = await loadWorkspace(root)
      const findings = (await ph.run(ctx)).filter(f => f.id === 'PH-01')
      const retired = findings.filter(f => /'prompts' is retired/.test(f.message))
      // Two parsers can reject the key; exactly one of them may report it.
      assert.equal(retired.length, 1, JSON.stringify(findings))
      assert.equal(retired[0].severity, 'I', JSON.stringify(retired))
      assert.equal(findings.filter(f => f.severity === 'E').length, 0, JSON.stringify(findings))
      await fs.rm(root, { recursive: true, force: true })
    })

    it('still reports a genuinely unknown phase key as E', async () => {
      // Retired is not the same as unknown: a typo must stay an error.
      const root = await makeRoot('truss-phase-typo-')
      await runInit(root, ['--name', 'Typo', '--lang', 'English'])
      const phasesPath = path.join(root, 'state', 'phases.md')
      const raw = await fs.readFile(phasesPath, 'utf8')
      await fs.writeFile(
        phasesPath,
        raw.replace(/^(behavior: .*)$/m, '$1\nbehaviour: british spelling'),
      )
      const ctx = await loadWorkspace(root)
      const findings = (await ph.run(ctx)).filter(f => f.id === 'PH-01')
      const unknown = findings.filter(f => /unknown key 'behaviour'/.test(f.message))
      assert.equal(unknown.length, 1, JSON.stringify(findings))
      assert.equal(unknown[0].severity, 'E', JSON.stringify(unknown))
      await fs.rm(root, { recursive: true, force: true })
    })

    it('accepts the artifact produced by the official overlay onboarding ritual', async () => {
      const root = await makeRoot('truss-overlay-gate-')
      await runInit(root, ['--name', 'Overlay', '--lang', 'English', '--overlay'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'import-log.md'), '# Import log\n')
      const ctx = await loadWorkspace(root)
      ctx.gate = true
      const findings = await ph.run(ctx)
      assert.equal(
        findings.filter(f => f.id === 'PH-04' && f.severity === 'E').length,
        0,
        JSON.stringify(findings)
      )
      await fs.rm(root, { recursive: true, force: true })
    })

    it('checks a symlinked overlay checkout and honors .trussignore', async () => {
      const priorNoGit = process.env.TRUSS_NO_GIT
      delete process.env.TRUSS_NO_GIT
      const src = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-overlay-src-'))
      const root = await makeRoot('truss-overlay-symlink-')
      try {
        await execFileP('git', ['init'], { cwd: src })
        await fs.writeFile(path.join(src, 'blocked.js'), 'export const value = 1\n')
        await fs.writeFile(path.join(src, 'ignored.js'), 'export const ignored = 1\n')
        await execFileP('git', ['add', '.'], { cwd: src })
        await execFileP(
          'git',
          ['-c', 'user.name=Truss Test', '-c', 'user.email=truss@example.invalid', 'commit', '-m', 'baseline'],
          { cwd: src }
        )
        await runInit(root, ['--name', 'Overlay', '--lang', 'English', '--overlay'])
        // init no longer places the code (D-059) — the human does, with one
        // documented command. The check surface is identical either way.
        await fs.symlink(src, path.join(root, 'repo'), 'dir')
        await fs.writeFile(path.join(src, 'blocked.js'), 'export const value = 2\n')
        await fs.writeFile(path.join(src, 'ignored.js'), 'export const ignored = 2\n')
        await fs.writeFile(path.join(root, '.trussignore'), 'repo/ignored.js\n')

        const ctx = await loadWorkspace(root)
        const findings = await ph.run(ctx)
        const violation = findings.find(f => f.id === 'PH-03')
        assert.match(violation?.message || '', /repo\/blocked\.js/)
        assert.doesNotMatch(violation?.message || '', /ignored\.js/)
      } finally {
        if (priorNoGit == null) delete process.env.TRUSS_NO_GIT
        else process.env.TRUSS_NO_GIT = priorNoGit
        await fs.rm(root, { recursive: true, force: true })
        await fs.rm(src, { recursive: true, force: true })
      }
    })

    it('checks changed paths inside a custom configured code root', async () => {
      const priorNoGit = process.env.TRUSS_NO_GIT
      delete process.env.TRUSS_NO_GIT
      const root = await makeRoot('truss-code-root-phase-')
      const product = path.join(root, 'product')
      try {
        await fs.mkdir(product)
        await execFileP('git', ['init'], { cwd: product })
        await fs.writeFile(path.join(product, 'blocked.js'), 'export const value = 1\n')
        await execFileP('git', ['add', '.'], { cwd: product })
        await execFileP(
          'git',
          ['-c', 'user.name=Truss Test', '-c', 'user.email=truss@example.invalid', 'commit', '-m', 'baseline'],
          { cwd: product },
        )
        await runInit(root, [
          '--name', 'Custom', '--lang', 'English', '--overlay',
          '--code-root', 'product',
        ])
        const phasesPath = path.join(root, 'state', 'phases.md')
        const phases = await fs.readFile(phasesPath, 'utf8')
        await fs.writeFile(
          phasesPath,
          phases.replaceAll('repo/**', 'product/**'),
        )
        await fs.writeFile(path.join(product, 'blocked.js'), 'export const value = 2\n')

        const ctx = await loadWorkspace(root)
        const findings = await ph.run(ctx)
        const violation = findings.find(f => f.id === 'PH-03')
        assert.match(violation?.message || '', /product\/blocked\.js/)
      } finally {
        if (priorNoGit == null) delete process.env.TRUSS_NO_GIT
        else process.env.TRUSS_NO_GIT = priorNoGit
        await fs.rm(root, { recursive: true, force: true })
      }
    })
  })
})

// ── doctor exit codes via the real CLI (0 ok · 1 warnings · 2 errors) ─────────
describe('doctor exit codes (CLI)', () => {
  const BIN = (root) => path.join(root, '.truss', 'bin', 'truss.mjs')
  const exitCode = async (root) => {
    try {
      await execFileP(process.execPath, [BIN(root), 'doctor'], { env: { ...process.env, TRUSS_NO_GIT: '1' } })
      return 0
    } catch (e) { return e.code }
  }

  it('exits 0 on a clean instance', async () => {
    const root = await makeRoot('truss-exit0-')
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    assert.equal(await exitCode(root), 0)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('exits 1 when only warnings are present', async () => {
    const root = await makeRoot('truss-exit1-')
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    // A root domain file absent from the §2 table is a pure ST-02 warning.
    await fs.writeFile(path.join(root, 'stray.md'), '# Stray\n\n> not in the structure table.\n')
    assert.equal(await exitCode(root), 1)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('exits 0 on an instance with a leftover pm/ — retired path is I, not W (U6/D-074/D-081)', async () => {
    const root = await makeRoot('truss-exit-pm-')
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    await fs.mkdir(path.join(root, 'pm'), { recursive: true })
    // Plain text, not .md: a new markdown file always makes ST-07 (map.md
    // outdated) fire too — true before this change and orthogonal to it. Using
    // .txt isolates the one thing under test: ST-02 on pm/ itself is I, not W.
    await fs.writeFile(path.join(root, 'pm', 'notes.txt'), 'roadmap notes\n')
    assert.equal(await exitCode(root), 0)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('exits 0 with init-guard when AGENTS.md is missing', async () => {
    const root = await makeRoot('truss-initguard-')
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    await fs.rm(path.join(root, 'AGENTS.md'))   // triggers init-guard
    assert.equal(await exitCode(root), 0)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('exits 2 when errors are present in an initialised workspace', async () => {
    const root = await makeRoot('truss-exit2-')
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    // Corrupt AGENTS.md so BL checks fail — but file still exists, so no init-guard.
    const agentsMd = path.join(root, 'AGENTS.md')
    const content = await fs.readFile(agentsMd, 'utf8')
    await fs.writeFile(agentsMd, content.replace('<!-- truss:begin phase -->', '<!-- broken -->'))
    assert.equal(await exitCode(root), 2)
    await fs.rm(root, { recursive: true, force: true })
  })
})

// ── ST-02 retired paths (U6/D-074, D-081) ─────────────────────────────────────
// pm/ was a valid §2 routing target before this change and is now retired.
// Same precedent as RETIRED_KEYS in checks/ph.mjs and checks/bl.mjs: a retired
// path is not an unknown one, so an instance that still has pm/ on disk must
// get an I, never the W that would flip it from green to "not clean" the day
// this table changed.
describe('ST-02 retired paths', () => {
  it('flags a leftover pm/ as I with a retirement note, not W (U6/D-074)', async () => {
    const root = await makeRoot('truss-st02-pm-')
    try {
      await runInit(root, ['--name', 'Retired PM', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'pm'), { recursive: true })
      await fs.writeFile(path.join(root, 'pm', 'roadmap.md'), '# Roadmap\n')
      const ctx = await loadWorkspace(root)
      const findings = await st.run(ctx)
      const st02 = findings.filter(f => f.id === 'ST-02')
      // One finding for the retired root; nested content stays silent — it
      // would only repeat the same notice per file.
      assert.equal(st02.length, 1, JSON.stringify(st02))
      assert.equal(st02[0].severity, 'I', JSON.stringify(st02[0]))
      assert.equal(st02[0].file, 'pm/')
      assert.match(st02[0].message, /retired/)
      assert.equal(findings.filter(f => f.severity === 'W' && f.file.startsWith('pm')).length, 0, JSON.stringify(findings))
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('still flags a genuinely new, unrelated directory as W (retired != unknown)', async () => {
    const root = await makeRoot('truss-st02-newdir-')
    try {
      await runInit(root, ['--name', 'New Dir', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'foo'), { recursive: true })
      await fs.writeFile(path.join(root, 'foo', 'bar.md'), '# Bar\n')
      const ctx = await loadWorkspace(root)
      const findings = await st.run(ctx)
      const hit = findings.find(f => f.id === 'ST-02' && f.file === 'foo/')
      assert.ok(hit, JSON.stringify(findings.filter(f => f.id === 'ST-02')))
      assert.equal(hit.severity, 'W')
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})

// ── SY-08 ritual drift (D-010, D-058) ────────────────────────────────────────
describe('SY-08 ritual drift', () => {
  // Real files + real mtimes: SY-08 stats ctx.root/<rel> for every state/ and
  // context/ candidate from ctx.mdFiles and compares them directly, with a
  // 90-minute grace window for the write-back that follows a change.
  async function driftRoot() {
    const root = await makeRoot('truss-sy08-')
    await fs.mkdir(path.join(root, 'state'), { recursive: true })
    await fs.writeFile(path.join(root, 'state', 'current.md'), cleanCurrent())
    await fs.writeFile(path.join(root, 'state', 'decisions.md'), '# Decisions\n')
    return root
  }
  async function ctxFor(root) {
    const content = await fs.readFile(path.join(root, 'state', 'current.md'), 'utf8')
    const stat = await fs.stat(path.join(root, 'state', 'current.md'))
    return {
      files: new Map([['state/current.md', { lines: content.split('\n'), content, stat }]]),
      phases: { frontmatter: {}, defs: new Map() },
      diskPaths: [], root,
      mdFiles: ['state/current.md', 'state/decisions.md', 'state/map.md'],
    }
  }
  it('fires when state changed on a later day than current.md', async () => {
    const root = await driftRoot()
    const old = new Date(Date.now() - 2 * DAY)
    await fs.utimes(path.join(root, 'state', 'current.md'), old, old)
    const f = await sy.run(await ctxFor(root))
    assert.equal(ids(f, 'SY-08').length, 1)
    assert.match(ids(f, 'SY-08')[0].message, /decisions\.md/)
    await fs.rm(root, { recursive: true, force: true })
  })
  it('fires SAME day once the gap exceeds the grace window (D-058)', async () => {
    const root = await driftRoot()
    // current.md written 4h ago, decisions.md just now — same calendar day.
    const old = new Date(Date.now() - 4 * 3600_000)
    await fs.utimes(path.join(root, 'state', 'current.md'), old, old)
    const f = await sy.run(await ctxFor(root))
    assert.equal(ids(f, 'SY-08').length, 1)
    assert.match(ids(f, 'SY-08')[0].message, /4h later/)
    await fs.rm(root, { recursive: true, force: true })
  })
  it('stays quiet inside the grace window and when current.md is newest', async () => {
    const root = await driftRoot()
    // Both just written → quiet.
    assert.equal(ids(await sy.run(await ctxFor(root)), 'SY-08').length, 0)
    // A work unit in progress: state edited 30 min before current.md → quiet.
    const halfHour = new Date(Date.now() - 30 * 60_000)
    await fs.utimes(path.join(root, 'state', 'current.md'), halfHour, halfHour)
    assert.equal(ids(await sy.run(await ctxFor(root)), 'SY-08').length, 0)
    // current.md refreshed after older state → quiet.
    const old = new Date(Date.now() - 3 * DAY)
    await fs.utimes(path.join(root, 'state', 'decisions.md'), old, old)
    const now = new Date()
    await fs.utimes(path.join(root, 'state', 'current.md'), now, now)
    assert.equal(ids(await sy.run(await ctxFor(root)), 'SY-08').length, 0)
    await fs.rm(root, { recursive: true, force: true })
  })
  it('ignores the excluded surfaces (map.md, missing files)', async () => {
    const root = await driftRoot()
    const old = new Date(Date.now() - 2 * DAY)
    await fs.utimes(path.join(root, 'state', 'current.md'), old, old)
    await fs.utimes(path.join(root, 'state', 'decisions.md'), old, old)
    // A fresh script-generated map must NOT count as drift (excluded rel).
    await fs.writeFile(path.join(root, 'state', 'map.md'), '# Truss Map\n')
    const f = await sy.run(await ctxFor(root))
    assert.equal(ids(f, 'SY-08').length, 0)
    await fs.rm(root, { recursive: true, force: true })
  })
})

// ── SY-13 ────────────────────────────────────────────────────────────────────
// The direction doctor was blind in. SY-06 catches a settled entry that stayed
// behind; nothing caught a live dependency edge pointing AT one, so a plan could
// read "blocked by HT-022" for weeks after HT-022 was ticked off — and `truss
// status` carried that line into the next session's opening while `doctor` said
// "all checks passed".
describe('SY-13 dependency edges onto settled entries', () => {
  const CLOSER = '# Decisions\n\n## D-007 — Pick a queue\n\nDate: 2026-01-01\nCloses: OD-004\nDecision: SQS\nRationale: cheaper\nConsequences: none\n'

  it('flags a blockers: entry naming an OD that a Closes: line already closed', async () => {
    const current = '# Current\n\nfocus: x\nnext:\n  - ship\nblockers:\n  - waiting on OD-004\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(current),
      'state/decisions.md': file(CLOSER),
    })), 'SY-13')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /OD-004/)
    assert.match(f[0].message, /already settled/)
    assert.equal(f[0].file, 'state/current.md')
  })

  it('flags the same edge in a next: entry, and reads the inline list form too', async () => {
    const inlineNext = '# Current\n\nfocus: x\nnext: [land OD-004, unrelated]\nblockers: none\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(inlineNext),
      'state/decisions.md': file(CLOSER),
    })), 'SY-13')
    assert.equal(f.length, 1, 'the inline form must be read like the block form')
  })

  it('stays silent when the id is still open', async () => {
    const current = '# Current\n\nfocus: x\nnext:\n  - waiting on OD-009\nblockers: none\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(current),
      'state/decisions.md': file(CLOSER),
    })), 'SY-13')
    assert.equal(f.length, 0)
  })

  it('does not scan prose — naming a closed id in a rationale is correct writing', async () => {
    const current = '# Current\n\nfocus: the queue question from OD-004 is settled\nnext:\n  - ship\nblockers: none\n\nOD-004 is mentioned here in the body as well.\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(current),
      'state/decisions.md': file(CLOSER),
    })), 'SY-13')
    assert.equal(f.length, 0, 'only next:/blockers: are dependency edges')
  })

  it('reads domain frontmatter, and stops at the closing fence', async () => {
    const domain = '---\nfocus: billing\nnext:\n  - blocked by OD-004\nblockers: none\n---\n\n# Billing\n\n> Scope.\n\nOD-004 in the body is prose.\n'
    const f = ids(await sy.run(ctxOf({
      'context/billing.md': file(domain),
      'state/decisions.md': file(CLOSER),
    })), 'SY-13')
    assert.equal(f.length, 1)
    assert.equal(f[0].file, 'context/billing.md')
  })

  it('a checked-off HT counts as settled — the reported case', async () => {
    const root = await makeRoot('truss-sy13-ht-')
    try {
      await runInit(root, ['--name', 'Edges', '--lang', 'English'])
      await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
        '# Human ToDos\n\n- [x] HT-022 — grant the deploy key\n- [ ] HT-023 — still open\n')
      await fs.writeFile(path.join(root, 'state', 'current.md'),
        '# Current\n\nfocus: x\nnext:\n  - blocked by HT-022\n  - also waiting on HT-023\nblockers: none\n')
      const f = ids(await runChecks(root), 'SY-13')
      assert.equal(f.length, 1, 'only the checked-off one')
      assert.match(f[0].message, /HT-022/)
      assert.match(f[0].message, /checked off/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('an ARCHIVED decision is not settled — archiving keeps it binding', async () => {
    const root = await makeRoot('truss-sy13-archive-')
    try {
      await runInit(root, ['--name', 'Archived', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'archive', 'decisions'), { recursive: true })
      await fs.writeFile(path.join(root, 'archive', 'decisions', 'D-002.md'),
        '## D-002 — Old but binding\n\nDate: 2026-01-01\nDecision: keep\nRationale: r\nConsequences: c\n')
      await fs.writeFile(path.join(root, 'state', 'current.md'),
        '# Current\n\nfocus: x\nnext:\n  - implement what D-002 requires\nblockers: none\n')
      assert.equal(ids(await runChecks(root), 'SY-13').length, 0)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('a fresh workspace is silent', async () => {
    const root = await makeRoot('truss-sy13-clean-')
    try {
      await runInit(root, ['--name', 'Clean', '--lang', 'English'])
      assert.equal(ids(await runChecks(root), 'SY-13').length, 0)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})

// ── ST-02 names the escape it used to hide ──────────────────────────────────
// knownPaths is derived upward only (a row registers its parents, never its
// children), so a new directory could be cleared only one table row per file —
// the file inventory the §2 preamble rules out. The way around it existed and
// was spelled three different ways, none of them written down.
describe('ST-02 fix text names the summary-row escape', () => {
  it('a file inside an unlisted directory is told how to make the directory a summary row', async () => {
    const root = await makeRoot('truss-st02-summary-')
    try {
      await runInit(root, ['--name', 'Scripts', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'scripts'), { recursive: true })
      await fs.writeFile(path.join(root, 'scripts', 'secrets.sh'), '#!/bin/sh\necho hi\n')
      const f = ids(await runChecks(root), 'ST-02').find(x => (x.file || '').startsWith('scripts/secrets'))
      assert.ok(f, 'precondition: the file is reported')
      assert.match(f.fix, /summary row/)
      assert.match(f.fix, /scripts\//)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})

// A git system file is not unmanaged workspace content. `.gitattributes` was the
// one missing from that list, so every adopter whose repo has one — and most do —
// carried a permanent ST-02 they could only clear by inventing a table row for it.
describe('ST-02 treats .gitattributes like the other git system files', () => {
  it('does not report it as an unmanaged path', async () => {
    const root = await makeRoot('truss-st02-gitattributes-')
    try {
      await runInit(root, ['--name', 'Attrs', '--lang', 'English'])
      await fs.writeFile(path.join(root, '.gitattributes'), '* text=auto\n')
      const st02 = (await st.run(await loadWorkspace(root))).filter(f => f.id === 'ST-02')
      assert.equal(st02.length, 0, JSON.stringify(st02))
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})

// ── CX-01 says what it counted ──────────────────────────────────────────────
// Half of the answer to a metric that could be gamed: the message names every
// file it summed, so the basis is on screen. The other half is that the basis
// now comes out of §1 — see the block below.
describe('CX-01 names the files it counted', () => {
  it('the message lists every counted file, not only the heaviest three', async () => {
    const big = (n) => '# Big\n\n' + 'word '.repeat(n)
    const f = ids(await cx.run(ctxOf({
      'AGENTS.md': file(big(9000)),
      'state/current.md': file(big(2000)),
      'VISION.md': file(big(2000)),
      'state/profile.md': file(big(500)),
    })), 'CX-01')
    assert.equal(f.length, 1, 'precondition: over the warn band')
    assert.match(f[0].message, /Counted: /)
    for (const rel of ['AGENTS.md', 'state/current.md', 'VISION.md', 'state/profile.md']) {
      assert.ok(f[0].message.includes(rel), `counted list must name ${rel}`)
    }
  })
})

// ── CX-01/CX-02: the boot list comes out of §1 (D-095/OD-018) ───────────────
// A fixed six-file list made splitting a boot file the most effective way to
// quiet CX-01 and the only one that improved nothing. Deriving the list closes
// that, and brings two risks worth pinning: a §1 the parser cannot read must say
// so instead of silently measuring less, and our change must not turn a green
// instance red (`release-maturity.md`, D-081).
describe('CX-01 measures the load order this workspace declares', () => {
  const big = (n) => '# Big\n\n' + 'word '.repeat(n)
  const SECTION_1 = (...paths) =>
    '# A\n\n## 1 Load order\n\n1. This file — fully.\n'
    + paths.map((p, i) => `${i + 2}. \`${p}\` — loaded.\n`).join('')
    + '\n## 2 Structure\n'

  it('counts a boot file that §1 names but the shipped list never knew', async () => {
    const f = await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('state/current.md', 'state/current.tasks.md')),
      'state/current.md': file(big(6000)),
      'state/current.tasks.md': file(big(6000)),
    }))
    const cx01 = ids(f, 'CX-01')
    assert.equal(cx01.length, 1, 'the split halves are summed, so the budget is crossed')
    assert.ok(cx01[0].message.includes('state/current.tasks.md'))
    assert.equal(ids(f, 'CX-02').length, 0, 'a readable §1 raises no fallback notice')
  })

  it('falls back loudly when §1 cannot be read', async () => {
    const f = await cx.run(ctxOf({
      'AGENTS.md': file('# A\n\nno load order here\n'),
      'VISION.md': file(big(13000)),
    }))
    const cx02 = ids(f, 'CX-02')
    assert.equal(cx02.length, 1)
    assert.equal(cx02[0].severity, 'I')
    assert.match(cx02[0].message, /shipped list/)
    assert.equal(ids(f, 'CX-01').length, 1, 'the budget is still measured, just against the default set')
  })

  it('reports info, not a warning, when only the newly counted files cross the band', async () => {
    // Long-counted files stay under 18k on their own; the file §1 adds tips it over.
    const f = ids(await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('VISION.md', 'state/extra.md')),
      'VISION.md': file(big(9000)),        // ≈13.5k on its own
      'state/extra.md': file(big(4000)),   // ≈6k more
    })), 'CX-01')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'I', 'our change must not turn a green instance red')
    assert.ok(f[0].message.includes('state/extra.md'), 'and it must say which file is new')
  })

  it('never softens an error-band measurement, however new the files are', async () => {
    // The promise is "our change does not turn a green instance red", not "we
    // hide what the new measurement finds". `ackVerdict` refuses to downgrade an
    // E for the same reason.
    const f = ids(await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('VISION.md', 'state/extra.md')),
      'VISION.md': file(big(9000)),
      'state/extra.md': file(big(13000)),
    })), 'CX-01')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'E')
  })

  // Review finding: `counted` holds the boot files AND the phase read: targets, so
  // treating "not in CONTEXT_FILES" as "newly counted" made every read target look
  // new — and a workspace whose weight sat in one had its warning, and its error,
  // downgraded to info forever. The old code counted read targets all along.
  it('does not treat a phase read: target as newly counted', async () => {
    const phases = { frontmatter: { current: 'build' }, defs: new Map([['build', { read: 'context/architecture.md' }]]) }
    const f = ids(await cx.run(ctxOf({
      // Three named paths, so §1 really is derived — with fewer the parser
      // refuses and falls back, and this test would pass without testing anything.
      'AGENTS.md': file(SECTION_1('state/current.md', 'VISION.md', 'state/profile.md')),
      'state/current.md': file(big(10)),
      'context/architecture.md': file(big(14000)),
    }, { phases })), 'CX-01')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'W', 'a read target was always counted, so nothing about it is new')
  })

  // Review finding: deriving the list closed one gaming vector and would have
  // opened a cheaper one — a §1 that simply omits a boot file (dropped backticks,
  // a link, plain prose) would stop counting it, with `ok` still true, so no
  // fallback and no notice. §1 may only add to the shipped set.
  it('a §1 that omits a shipped boot file cannot lower the number', async () => {
    const files = {
      'state/current.md': file(big(6000)),
      'VISION.md': file(big(6000)),
      'state/profile.md': file(big(4000)),   // heavy, and left out of §1 below
    }
    // Both §1 bodies are the same length, so only the file SET can differ.
    const full = ids(await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('state/current.md', 'VISION.md', 'state/profile.md')),
      ...files,
    })), 'CX-01')
    const omits = ids(await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('state/current.md', 'VISION.md', 'state/risks.md')),
      ...files,
    })), 'CX-01')
    assert.equal(full.length, 1, 'precondition: over the band')
    assert.equal(omits.length, 1, 'omitting profile.md from §1 must not make it green')
    const countedIn = (f) => f[0].message.match(/Counted: (.*)$/)[1].split(', ').sort()
    assert.ok(countedIn(omits).includes('state/profile.md'),
      'a shipped boot file stays counted even when §1 stops naming it')
    assert.deepEqual(countedIn(omits), countedIn(full))
  })

  it('is a real warning again once the long-counted files alone exceed the band', async () => {
    const f = ids(await cx.run(ctxOf({
      'AGENTS.md': file(SECTION_1('VISION.md', 'state/extra.md')),
      'VISION.md': file(big(13000)),
      'state/extra.md': file(big(1000)),
    })), 'CX-01')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'W')
  })
})

// SY-13 must not read documented examples as real edges. The `Closes:` scan in
// checks/rf.mjs deliberately does not skip fences, because there the set only
// SUPPRESSES a warning; here it PRODUCES one, so a code block could invent a
// finding out of nothing.
describe('SY-13 ignores fenced and commented-out examples', () => {
  it('a Closes: line inside a code block does not settle anything', async () => {
    const doc = '# Decisions\n\nHow to close a question:\n\n```markdown\nCloses: OD-004\n```\n'
    const current = '# Current\n\nfocus: x\nnext:\n  - waiting on OD-004\nblockers: none\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(current),
      'state/decisions.md': file(doc),
    })), 'SY-13')
    assert.equal(f.length, 0)
  })

  it('a next: block inside a code block is not a dependency edge', async () => {
    const closer = '# Decisions\n\n## D-007 — X\n\nDate: 2026-01-01\nCloses: OD-004\nDecision: d\nRationale: r\nConsequences: c\n'
    const current = '# Current\n\nfocus: x\nblockers: none\n\nExample of the format:\n\n```yaml\nnext:\n  - waiting on OD-004\n```\n'
    const f = ids(await sy.run(ctxOf({
      'state/current.md': file(current),
      'state/decisions.md': file(closer),
    })), 'SY-13')
    assert.equal(f.length, 0)
  })
})

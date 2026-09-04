// lib/commands/split-decisions.mjs — one-time migration to the split log (D-087).
//
// Moves each entry of state/decisions.md into state/decisions/<ID>.md. This is
// a SPLIT, not a rewrite: every body is copied byte-for-byte, and the command
// proves it by rebuilding the index before and after and refusing to keep a
// result whose index differs. If they differ, something was lost or reordered —
// the safe outcome is the workspace it started with, not a best effort.
//
// Why a command and not `render`: rewriting state/ as a side effect of a
// read-shaped command is exactly the trap L-004 recorded (`upgrade` silently
// overwrote state/). This is opt-in, does one thing, and says what it did.
//
// The preamble (everything above the first entry — the heading, the convention
// notes, any archive pointers) STAYS in state/decisions.md. Content BELOW the
// last entry cannot be told apart from that entry's own trailing note, so it
// travels with it and the run says so instead of guessing. Dropping it would
// lose real content, most of all the pointers to already-archived ranges. The
// leftover file is inert for indexing (readDecisionSource prefers a directory
// that holds bodies) and stays loaded, so its links keep being checked. Prune
// it by hand once its contents have been routed.

import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from '../scaffold.mjs'
import {
  renderIndex, parseDecisionEntries, writeIndex,
  SOURCE_REL, DECISIONS_DIR, decisionPath, DECISION_FILE_RE,
} from '../decisions-index.mjs'

/** Thrown for a user-facing refusal; bin/truss.mjs turns it into exit 2. */
class Refusal extends Error {}

export async function runSplitDecisions(root, args = []) {
  const dryRun = args.includes('--dry-run')

  let source
  try {
    source = await fs.readFile(path.join(root, SOURCE_REL), 'utf8')
  } catch {
    throw new Refusal(`truss split-decisions: no ${SOURCE_REL} — nothing to split.`)
  }

  // Never merge into an existing split: the two would silently disagree about
  // which body is current, and readDecisionSource would pick the directory.
  let existing = []
  try {
    existing = (await fs.readdir(path.join(root, DECISIONS_DIR)))
      .filter((n) => DECISION_FILE_RE.test(n))
  } catch { /* no directory yet — the normal case */ }
  if (existing.length) {
    throw new Refusal(
      `truss split-decisions: ${DECISIONS_DIR}/ already holds ${existing.length} `
      + `decision${existing.length === 1 ? '' : 's'} — this workspace is already split.`,
    )
  }

  // CRLF: keep whatever the file uses. Splitting on '\n' leaves a trailing '\r'
  // on every line, and a naive rejoin would hand Windows adopters bodies with
  // mixed endings — the file's own convention is part of what "a split, not a
  // rewrite" promises.
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const entries = parseDecisionEntries(lines)

  // A heading like `## D-99` or `## D-1234` is not an entry to the parser, so it
  // would be swallowed whole into the body above it — silently, and the reader
  // of that body would find a second decision inside it. Refuse instead: the id
  // is malformed and only a human can say what it should be.
  const fenced = new Set()
  let inFence = false
  lines.forEach((l, i) => {
    if (l.startsWith('```') || l.startsWith('~~~')) { inFence = !inFence; return }
    if (inFence) fenced.add(i)
  })
  const malformed = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => !fenced.has(i) && /^##\s+D-\d+/.test(l) && !/^##\s+D-\d{3}\b/.test(l))
  if (malformed.length) {
    throw new Refusal(
      `truss split-decisions: ${SOURCE_REL} has ${malformed.length} heading(s) with a malformed id `
      + `(${malformed.map(m => `line ${m.i + 1}: ${m.l.trim()}`).join('; ')}).\n`
      + 'D-NNN is exactly three digits. Left as is, these would be swallowed into the entry above them.',
    )
  }
  if (!entries.length) {
    throw new Refusal(`truss split-decisions: no '## D-NNN' entries found in ${SOURCE_REL}.`)
  }

  // A duplicate id would have one body overwrite the other — silently, and only
  // the survivor would ever be read again. RF-03 reports duplicates; this
  // refuses to act on them.
  const seen = new Set()
  const dupes = entries.map(e => e.id).filter(id => seen.size === seen.add(id).size)
  if (dupes.length) {
    throw new Refusal(
      `truss split-decisions: duplicate id${dupes.length === 1 ? '' : 's'} in ${SOURCE_REL} `
      + `(${[...new Set(dupes)].join(', ')}) — fix them first, or one body would overwrite another.`,
    )
  }

  // Entry N runs from its heading to the line before entry N+1; the last runs to
  // the end of the file. Blank padding is trimmed and one newline restored, so a
  // body reads the same whether it was first, last or in the middle.
  const bodies = entries.map((e, i) => {
    const from = e.line - 1
    const to = i + 1 < entries.length ? entries[i + 1].line - 1 : lines.length
    const kept = lines.slice(from, to)
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop()
    return { id: e.id, text: kept.join(eol) + eol }
  })
  const preambleLines = lines.slice(0, entries[0].line - 1)
  while (preambleLines.length && !preambleLines[preambleLines.length - 1].trim()) preambleLines.pop()
  const preamble = preambleLines.join(eol)

  // Everything after the LAST entry lands in that entry's body — there is no
  // way to tell a trailing supersede note (which belongs to it) from a
  // file-level footer (which does not). A horizontal rule is the one reliable
  // marker of the latter, so say so rather than guess.
  const tail = bodies.length
    ? bodies[bodies.length - 1].text.split(/\r?\n/).some((l) => /^-{3,}\s*$/.test(l))
    : false

  // The proof: the entry lines the split produces must equal the ones the
  // single file produced. Compared as ENTRIES, not as whole files — the index
  // header names the layout, so it differs by design and would mask a real
  // difference behind an expected one. Each body is parsed on its own, the way
  // the split form is read afterwards.
  const expected = renderIndex(parseDecisionEntries(lines), 'dir')
  const rebuilt = renderIndex(
    bodies.flatMap(b => parseDecisionEntries(b.text.split('\n'))), 'dir')
  if (rebuilt !== expected) {
    throw new Refusal(
      'truss split-decisions: the split would change the decision index — aborted, nothing written.\n'
      + 'This means an entry would be lost, reordered or altered. Report it rather than working around it.',
    )
  }

  if (dryRun) {
    console.log(`truss split-decisions --dry-run: would write ${bodies.length} files to ${DECISIONS_DIR}/`)
    console.log(`  ${bodies[0].id} … ${bodies[bodies.length - 1].id}`)
    console.log(preamble
      ? `  ${SOURCE_REL} would keep its preamble (${preambleLines.length} lines) — route it, then prune by hand.`
      : `  ${SOURCE_REL} would be left empty — safe to delete once you have committed the split.`)
    if (tail) console.log(`  Check ${decisionPath(bodies[bodies.length - 1].id)}: it ends past a horizontal rule, which usually marks a file-level footer, not part of the entry.`)
    return { entries: bodies.length, dryRun: true, tail }
  }

  await fs.mkdir(path.join(root, DECISIONS_DIR), { recursive: true })
  const written = []
  try {
    for (const b of bodies) {
      const rel = decisionPath(b.id)
      await writeFileAtomic(path.join(root, rel), b.text)
      written.push(rel)
    }
    await writeFileAtomic(path.join(root, SOURCE_REL), preamble ? preamble + eol : '')
  } catch (err) {
    // Roll back to the workspace we started with rather than leave it half split.
    // The directory goes too, or "nothing changed" would be a lie.
    for (const rel of written) await fs.rm(path.join(root, rel), { force: true })
    await fs.rmdir(path.join(root, DECISIONS_DIR)).catch(() => {})
    await writeFileAtomic(path.join(root, SOURCE_REL), source)
    throw new Refusal(`truss split-decisions: failed partway (${err.message}) — rolled back, nothing changed.`)
  }

  const res = await writeIndex(root)
  console.log(`truss split-decisions: ${bodies.length} entries → ${DECISIONS_DIR}/ (${bodies[0].id} … ${bodies[bodies.length - 1].id})`)
  console.log(`  index rebuilt from ${res.form === 'dir' ? DECISIONS_DIR + '/' : SOURCE_REL}, unchanged in content`)
  console.log(preamble
    ? `  ${SOURCE_REL} kept its preamble (${preambleLines.length} lines) — route it, then prune by hand.`
    : `  ${SOURCE_REL} is now empty — safe to delete once the split is committed.`)
  if (tail) console.log(`  Check ${decisionPath(bodies[bodies.length - 1].id)}: it ends past a horizontal rule, which usually marks a file-level footer, not part of the entry.`)
  console.log(`  Next: node .truss/bin/truss.mjs map && node .truss/bin/truss.mjs doctor`)
  return { entries: bodies.length, written, preamble: Boolean(preamble), tail }
}

// lib/decisions-index.mjs — the boot-sized index of the decision log (D-075, D-087).
//
// The decision log is the only §1 input that grows without bound, so the boot
// loads an index instead. D-075 made that index title + `Decision:` line over a
// single state/decisions.md. D-087 went one step further, because measurement
// showed the `Decision:` line *is* the growth: 44 real entries cost 77 tokens
// each in the index, 16 without it. Dropping it is only safe if looking one up
// is cheap — which it is not while the bodies share one 11 648-token file. So
// the two moves are one package:
//
//   • bodies live in state/decisions/<ID>.md, one file per decision
//   • the index carries title + status only; the path is derived from the ID
//
// ── TWO FORMS, ONE CODE PATH (D-077) ───────────────────────────────────────
// A workspace that has never split still has state/decisions.md, and it must
// keep working and produce no finding. `readDecisionSource` detects the form
// from the workspace itself and returns lines either way; everything below
// operates on those lines and never learns which form it came from.
//
// ── FORM CONTRACT — do not "clean this up" into headings ────────────────────
// Entries are **bold list items**, one line each:
//
//   - **D-074** — Dashboard und Prompt-Bibliothek verlassen den Motor
//
// This is not a style choice, it is what keeps the index a pure *reference*:
//
//   • `parseIdDefinitions` (lib/md.mjs) reads `## D-074 — …` as a DEFINITION.
//     An index written with headings would define every D-NNN a second time —
//     RF-03 `E`, once per decision, on a workspace that did nothing wrong.
//   • `ID_LIST_RE` requires the id token immediately after `- `; the two
//     asterisks block that, so a bold list item is a reference, not a
//     definition.
//
// RF-02 stays satisfied because the bodies stay loaded: lib/workspace.mjs reads
// state/decisions/*.md into ctx the same way it reads archive/, so every id the
// index mentions is still defined exactly once — in exactly one file, which is
// what keeps RF-03 quiet. tests/decisions-index.test.mjs nails the form down: a
// refactor to headings must go red, not silently produce one RF-03 error per
// decision.
//
// The provenance line carries no timestamp on purpose: ST-10 compares the index
// against a freshly built one BY CONTENT (not by mtime), and a timestamp would
// make every comparison differ.

import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from './scaffold.mjs'
import { splitLines } from './md.mjs'

/** Where the index lives, and what it is generated from. */
export const INDEX_REL  = 'state/decisions-index.md'
/** Legacy single-file log — still fully supported (D-077). */
export const SOURCE_REL = 'state/decisions.md'
/** Split log (D-087): one body per decision, addressed by bare ID. */
export const DECISIONS_DIR = 'state/decisions'

/** Body path for a decision id — the index never stores it, it is derived. */
export const decisionPath = (id) => `${DECISIONS_DIR}/${id}.md`

/** Only `D-NNN.md` counts; anything else in the directory is ignored. */
export const DECISION_FILE_RE = /^(D-\d{3})\.md$/

/**
 * The loaded decision-log files from a workspace context, in ID order.
 * Split bodies when the workspace has them, the legacy single file otherwise —
 * the same precedence readDecisionSource applies. The two can still see
 * different file SETS: this reads ctx.files (ignore-filtered), readDecisionSource
 * reads the directory raw, so putting state/decisions/ in .trussignore makes
 * `render` index bodies the checks cannot see. That is why the map excludes the
 * directory by path (MAP_SKIP_PATHS) instead. Empty array = no log.
 *
 * Consumers loop and attribute findings to `file.relPath`: in the split form a
 * grammar finding must point at the body that has the defect, not at a file
 * that no longer exists.
 *
 * @param {{ files: Map<string, any> }} ctx
 * @returns {Array<any>} FileContext[]
 */
export function decisionFilesFrom(ctx) {
  const prefix = DECISIONS_DIR + '/'
  const split = [...ctx.files.keys()]
    .filter((rel) => rel.startsWith(prefix) && DECISION_FILE_RE.test(rel.slice(prefix.length)))
    .sort()
  if (split.length) return split.map((rel) => ctx.files.get(rel))
  const legacy = ctx.files.get(SOURCE_REL)
  return legacy ? [legacy] : []
}

const HEADING_RE  = /^##\s+(D-\d{3})\b\s*(.*)$/
const DECISION_RE = /^Decision:\s*(.*)$/
// A decision the index shows without its status would be a LIE the drift check
// cannot catch: ST-10 only proves the index matches its source, never that it
// says enough. An entry that has been superseded or is under challenge reads as
// live and uncontested to any session that stops at the index — and §1 only
// mandates the full file before *making or proposing* a decision, not before
// citing one. So the status rides on the title line, inside the two-line form.
const SUPERSEDED_RE = /^Superseded-by:\s*(.*)$/
const CHALLENGED_RE = /^Challenged-by:\s*(.*)$/

const header = (form) => [
  '# Decisions — Index',
  '',
  '> Auto-generated by `node .truss/bin/truss.mjs render` — do not edit; edit the source and re-run.',
  form === 'dir'
    ? '> Title and status per decision. The body of `D-NNN` is `state/decisions/D-NNN.md`; open the ones your task touches, and all of them before making or proposing a decision (AGENTS.md §1).'
    : `> Title and status per decision. The bodies are in \`${SOURCE_REL}\`; read the ones your task touches, and the file in full before making or proposing a decision (AGENTS.md §1).`,
]

/** True for an index written before D-087 — it carries `Decision:` lines. */
export const isLegacyIndex = (content) => /^\s{2}Decision:/m.test(content)

/**
 * Extract the indexable entries from state/decisions.md lines.
 * Fenced code blocks are skipped so a `## D-NNN` shown as a format example
 * (docs style) never becomes an entry.
 *
 * @param {string[]} lines
 * @returns {Array<{ id: string, title: string, decision: string|null, line: number }>}
 */
export function parseDecisionEntries(lines) {
  const entries = []
  let fenced = false
  let current = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '')

    if (line.startsWith('```') || line.startsWith('~~~')) { fenced = !fenced; continue }
    if (fenced) continue

    const heading = line.match(HEADING_RE)
    if (heading) {
      // A leading em/en dash or hyphen is the grammar's title separator, not
      // part of the title.
      const title = heading[2].replace(/^[—–-]\s*/, '').trim()
      current = { id: heading[1], title, decision: null, superseded: null, challenged: null, line: i + 1 }
      entries.push(current)
      continue
    }
    // Any other ## heading ends the entry (e.g. a section between decisions).
    if (/^##\s/.test(line)) { current = null; continue }

    if (!current) continue

    const superseded = line.match(SUPERSEDED_RE)
    if (superseded && current.superseded === null) current.superseded = superseded[1].trim()
    const challenged = line.match(CHALLENGED_RE)
    if (challenged && current.challenged === null) current.challenged = challenged[1].trim()

    if (current.decision !== null) continue
    const decision = line.match(DECISION_RE)
    if (decision) current.decision = decision[1].trim()
  }

  return entries
}

/**
 * Build the full index file content from state/decisions.md lines.
 * Pure — no I/O — so ST-10 can compare against it without writing anything.
 *
 * @param {string[]} lines
 * @returns {string}
 */
function statusMark(entry) {
  const marks = []
  if (entry.superseded) marks.push(`superseded by ${entry.superseded}`)
  if (entry.challenged) marks.push(`challenged by ${entry.challenged}`)
  return marks.length ? ` (${marks.join(' · ')})` : ''
}

export function buildIndex(lines, form = 'file') {
  return renderIndex(parseDecisionEntries(lines), form)
}

/**
 * Render an already-parsed entry list. The one place the index format lives.
 * `form` only selects the header sentence — a legacy workspace must not be told
 * to open `state/decisions/D-NNN.md`, which it does not have.
 */
export function renderIndex(entries, form = 'file') {
  const out = [...header(form), '']
  for (const entry of entries) {
    out.push(`- **${entry.id}**${statusMark(entry)} — ${entry.title}`)
  }
  return out.join('\n') + '\n'
}

/**
 * Read state/decisions.md and write state/decisions-index.md next to it.
 * Returns null when there is no source file (nothing to index is not an error),
 * otherwise { entries, path }.
 *
 * @param {string} root  absolute workspace root
 */
export async function readDecisionSource(root) {
  // Split form wins when it holds at least one body: a workspace mid-migration
  // may still carry an emptied state/decisions.md, and the directory is the
  // deliberate act. An empty or absent directory falls through to the file, so
  // creating state/decisions/ by accident cannot blank a workspace's index.
  let names = []
  try {
    names = (await fs.readdir(path.join(root, DECISIONS_DIR)))
      .filter((n) => DECISION_FILE_RE.test(n))
      .sort()
  } catch { /* no directory — legacy form */ }

  if (names.length) {
    const parts = []
    for (const name of names) {
      const body = await fs.readFile(path.join(root, DECISIONS_DIR, name), 'utf8')
      parts.push({ rel: `${DECISIONS_DIR}/${name}`, lines: splitLines(body) })
    }
    // `parts`, not one concatenated stream. parseDecisionEntries carries fenced
    // state line by line, so a single body with an unclosed ``` would swallow
    // every entry after it — in a layout whose whole promise is that one file
    // per decision makes them independent. `lines` stays for callers that want
    // the flat view; nothing that builds the index uses it.
    return { form: 'dir', parts, files: parts.map((p) => p.rel), lines: parts.flatMap((p) => [...p.lines, '']) }
  }

  try {
    const source = await fs.readFile(path.join(root, SOURCE_REL), 'utf8')
    const lines = splitLines(source)
    return { form: 'file', parts: [{ rel: SOURCE_REL, lines }], files: [SOURCE_REL], lines }
  } catch {
    return null
  }
}

/**
 * Entries of a decision source, each part parsed on its own so a defect in one
 * body cannot hide another. Returns entries in file order, each tagged with the
 * file it came from.
 *
 * @param {{ parts: Array<{rel: string, lines: string[]}> }} src
 */
export function parseDecisionSource(src) {
  return src.parts.flatMap((part) =>
    parseDecisionEntries(part.lines).map((e) => ({ ...e, rel: part.rel })))
}

/**
 * Read the decision log in whichever form the workspace uses and write
 * state/decisions-index.md next to it. Returns null when there is no log at all
 * (nothing to index is not an error), otherwise { entries, path, form }.
 *
 * @param {string} root  absolute workspace root
 */
export async function writeIndex(root) {
  const src = await readDecisionSource(root)
  if (!src) return null
  const entries = parseDecisionSource(src)
  await writeFileAtomic(path.join(root, INDEX_REL), renderIndex(entries, src.form))
  return { entries: entries.length, path: INDEX_REL, form: src.form }
}

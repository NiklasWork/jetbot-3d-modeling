// lib/schema.mjs — the entry-class catalogue, read from docs/schema.md
//
// D-079: which ID classes exist, where their entries live, what shape they have
// and which fields they owe is workspace data, not source code. This module is
// the only reader; md.mjs, checks/rf.mjs and SY-03 take what it returns.
//
// TWO SOURCES, ONE FORM. A workspace that has `docs/schema.md` uses its own —
// that is the whole point: adding a class is a table row, not a fork. A
// workspace that does not (never upgraded, or upgraded before this version)
// falls back to the copy the engine ships in `baseline/docs/schema.md`. That
// fallback is not a default kept in code beside the file: it IS the file, read
// from the engine instead of the project, so the two can never drift and no
// instance changes behaviour just because the engine moved under it (D-081).
//
// THREE STATES, NOT TWO. `docs/schema.md` is a name a project may already have
// used for something else entirely — a database schema, an API schema. Such a
// file is not a broken Truss schema, it is not one at all, and reporting it
// would turn a workspace red for a file it wrote long before Truss reserved the
// name. The evidence that separates the cases is in the file: a Truss schema has
// a table whose first column is headed `Class`. No such table → foreign, silent,
// shipped classes used. Such a table but a row the engine cannot use → ours and
// broken, and ST-11 says which row and why. This is D-081's absent/stale split
// applied to a filename collision.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTableRow, splitLines } from './md.mjs'
import { decisionFilesFrom, DECISIONS_DIR } from './decisions-index.mjs'

export const SCHEMA_REL = 'docs/schema.md'

/** The engine's own copy — the fallback, and the source a fresh `init` copies. */
export function baselineSchemaPath() {
  return path.resolve(fileURLToPath(import.meta.url), '..', '..', 'baseline', SCHEMA_REL)
}

const CLASS_ID_RE = /^[A-Z]{1,4}$/
const KNOWN_COLUMNS = ['class', 'file', 'form', 'required', 'optional']
// `NNN` is the documented placeholder; a literal three-digit example is accepted
// so a table copied from a real entry still parses.
const NUM = '(?:NNN|\\d{3})'
const HEADING_FORM_RE = new RegExp(`^(#{1,6})\\s+([A-Z]{1,4})-${NUM}\\b`)
const LIST_FORM_RE    = new RegExp(`^[-*]\\s+(?:\\[[ xX]\\]\\s+)?([A-Z]{1,4})-${NUM}\\b`)

/** Cell text as written: strip markdown emphasis and code ticks, collapse space. */
function cell(text) {
  return String(text ?? '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
}

/** "Date, Rationale or Why" → [['Date'], ['Rationale', 'Why']] — one entry per
 *  required field, each holding the names that satisfy it. */
function fieldList(text) {
  return cell(text)
    .split(',')
    .map(item => item.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean))
    .filter(alts => alts.length > 0)
}

/**
 * A File cell as a workspace-relative path.
 * Returns null for anything that would read outside the workspace or is not a
 * relative path at all. Normalising matters beyond tidiness: `files` is keyed by
 * this string, so `state/risks.md` and `./state/risks.md` in two rows would load
 * the same file twice and RF-03 would report every id in it as defined twice.
 */
function normaliseFile(raw) {
  const trailing = raw.endsWith('/')
  let rel = path.posix.normalize(raw.replace(/\\/g, '/'))
  if (path.posix.isAbsolute(rel)) return null
  if (rel === '..' || rel.startsWith('../')) return null
  if (rel === '.' || rel === './') return null
  if (trailing && !rel.endsWith('/')) rel += '/'
  return rel
}

/** Line indices inside fenced code blocks. schema.md documents its own table
 *  format by example, so a fenced row is documentation, never configuration. */
function fencedLines(lines) {
  const inside = new Set()
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inside.add(i); fence = !fence; continue }
    if (fence) inside.add(i)
  }
  return inside
}

/**
 * Parse the class table out of a schema file.
 * Returns { classes, problems, recognised }:
 *   recognised — the file carries a `Class`-headed table, i.e. it is a Truss
 *                schema at all (see the three-states note in the file header).
 *   problems   — human-readable; every one of them means a row was DROPPED, so
 *                a caller that ignores them is silently checking less.
 */
export function parseSchema(lines) {
  const classes = []
  const problems = []
  const fenced = fencedLines(lines)
  let columns = null
  let recognised = false

  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue
    const row = parseTableRow(lines[i])
    if (!row) { if (columns && !lines[i].startsWith('|')) columns = null; continue }

    if (!columns) {
      // The class table is the one whose first column is headed "Class". Any
      // other table in the file (or in a project's additions) is prose to us.
      const heads = row.map(c => cell(c).toLowerCase())
      if (heads[0] !== 'class') continue
      recognised = true
      columns = heads
      const missing = KNOWN_COLUMNS.filter(name => !columns.includes(name))
      if (missing.length) {
        problems.push(`the class table has no ${missing.join(', ')} column`)
        columns = null
      }
      continue
    }

    const at = (name) => row[columns.indexOf(name)]
    const id = cell(at('class'))
    if (!id) continue                                   // spacer row
    if (!CLASS_ID_RE.test(id)) {
      problems.push(`'${id}' is not a usable class prefix (one to four uppercase letters)`)
      continue
    }
    if (classes.some(c => c.id === id)) {
      problems.push(`class ${id} is listed more than once — only the first row is used`)
      continue
    }

    const rawFile = cell(at('file'))
    if (!rawFile) { problems.push(`class ${id} names no file`); continue }
    const file = normaliseFile(rawFile)
    if (!file) {
      problems.push(`class ${id}: '${rawFile}' is not a path inside the workspace`)
      continue
    }

    const formText = cell(at('form'))
    const headingM = formText.match(HEADING_FORM_RE)
    const listM = headingM ? null : formText.match(LIST_FORM_RE)
    if (!headingM && !listM) {
      problems.push(`class ${id} has no usable form — write '## ${id}-NNN — title' or '- [ ] ${id}-NNN — description'`)
      continue
    }
    // The Form cell repeats the class prefix, so the two can disagree. Left
    // unchecked, SY-03 matches on the Class cell and then prints the Form cell
    // as the fix — advice that cannot clear the finding it explains.
    const formId = headingM ? headingM[2] : listM[1]
    if (formId !== id) {
      problems.push(`class ${id}: the form says '${formId}-NNN' — the Class cell and the Form cell must name the same prefix`)
      continue
    }

    classes.push({
      id,
      file,
      dir: file.endsWith('/') ? file.slice(0, -1) : null,
      form: headingM ? 'heading' : 'list',
      // The heading level is part of the form. Without it a class written as
      // `### X-NNN` would parse and then never be checked, because the checker
      // would look for `## ` and find nothing (and its own fix text would tell
      // the reader to write the very form it ignores).
      level: headingM ? headingM[1].length : 0,
      formText,
      required: fieldList(at('required')),
      optional: fieldList(at('optional')).flat(),
    })
  }

  if (recognised && !classes.length && !problems.length) problems.push('no class rows found')
  return { classes, problems, recognised }
}

/** Read a file as lines. Returns null when it is not there, throws otherwise —
 *  "absent" and "present but unreadable" are different answers (finding #8). */
async function readLines(abs) {
  let content
  try {
    content = await fs.readFile(abs, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  return splitLines(content)
}

const shippedSchema = async () => parseSchema(await readLines(baselineSchemaPath()) ?? [])

const result = (parsed, { source, rel, problems }) => ({
  classes: parsed.classes,
  ids: parsed.classes.map(c => c.id),
  source, rel,
  problems: problems ?? parsed.problems,
})

/**
 * Load the schema for a workspace.
 * Returns { classes, ids, source: 'workspace'|'baseline', rel, problems }.
 * `rel` is set only when the workspace has a file that is recognisably a Truss
 * schema — it is what ST-11 keys on, so a foreign docs/schema.md stays silent.
 */
export async function loadSchema(root) {
  let own
  try {
    own = await readLines(path.join(root, SCHEMA_REL))
  } catch (err) {
    // Present but unreadable (permissions, a directory, an I/O error). Falling
    // back keeps the workspace working; staying silent about it would not.
    return result(await shippedSchema(), {
      source: 'baseline', rel: SCHEMA_REL,
      problems: [`could not be read (${err.code || err.message})`],
    })
  }

  if (!own) return result(await shippedSchema(), { source: 'baseline', rel: null, problems: [] })

  const parsed = parseSchema(own)
  // Not a Truss schema at all — someone else's docs/schema.md. Same answer as
  // if the file were not there, because for our purposes it is not.
  if (!parsed.recognised) return result(await shippedSchema(), { source: 'baseline', rel: null, problems: [] })

  // Ours, and at least partly usable. Problems ride along: each one is a class
  // that was dropped, and a dropped class is checked by nobody.
  if (parsed.classes.length) return result(parsed, { source: 'workspace', rel: SCHEMA_REL })

  return result(await shippedSchema(), {
    source: 'baseline', rel: SCHEMA_REL, problems: parsed.problems,
  })
}

/**
 * Which loaded files hold entries of a class.
 * A class whose File ends in `/` is a directory with one file per entry; every
 * other class is one file. The decision log is the single exception:
 * `decisionFilesFrom` carries the D-087 migration bridge (split bodies when they
 * exist, the legacy single file otherwise), and re-deriving that here would give
 * a split workspace and a non-split one two different answers about what the
 * log is.
 *
 * A directory row deliberately does not swallow a file another class claims —
 * writing `state/` as a class directory should not make that class's grammar
 * apply to risks.md, learnings.md and every other state file at once.
 */
export function filesForClass(ctx, cls) {
  if (!cls) return []
  if (cls.dir === DECISIONS_DIR) return decisionFilesFrom(ctx)
  if (cls.dir) {
    const prefix = cls.dir + '/'
    const claimed = new Set((ctx.schema?.classes || []).filter(c => !c.dir).map(c => c.file))
    return [...ctx.files.keys()]
      .filter(rel => rel.startsWith(prefix) && rel.endsWith('.md') && !claimed.has(rel))
      .sort()
      .map(rel => ctx.files.get(rel))
  }
  const file = ctx.files.get(cls.file)
  return file ? [file] : []
}

export const fileForClass = (ctx, cls) => filesForClass(ctx, cls)[0] || null
export const classById = (classes, id) => (classes || []).find(c => c.id === id) || null

/**
 * Where an entry of this class should be written, as a path a human can act on.
 * Prefers where the class's entries actually live: a workspace still holding its
 * decisions in one `state/decisions.md` must not be told to create
 * `state/decisions/D-404.md`, because that is not the layout the same run just
 * checked (D-087 keeps both valid).
 */
export function locationForNewEntry(ctx, cls, id) {
  if (!cls.dir) return cls.file
  const existing = filesForClass(ctx, cls)
  const inDir = existing.some(f => f.relPath.startsWith(cls.dir + '/'))
  if (!inDir && existing.length) return existing[0].relPath
  return `${cls.dir}/${id}.md`
}

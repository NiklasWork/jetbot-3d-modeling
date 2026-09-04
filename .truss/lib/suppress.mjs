// lib/suppress.mjs — silencing one info finding on one file, with a reason.
//
// THE PROBLEM (TF-008, from an external report). ST-05 told that workspace its
// five biggest domain files were over 450 lines and should be split; splitting
// them would have been wrong on the merits. A finding you are supposed to ignore
// forever is more expensive than no finding at all — it lowers the attention
// every other finding gets. lib/context-ack.mjs already makes this argument in
// its own header and built the way out, but only for CX-01 (`ACKABLE` is a
// closed set), and `.trussignore` is not a substitute: it removes the file from
// the map and from every OTHER check as well.
//
// THE MECHANISM. One line in the file the finding is about:
//
//     <!-- truss: st-05 ok — grammar table; splitting it would break the format -->
//
// The finding for that id on that path stops printing, and `doctor` says how
// many it dropped. Chosen over a central ignore file (OD-019 option C) because
// the justification then sits next to the thing it justifies and is read by
// whoever opens the file — the same "put it where the behaviour happens" rule
// that L-008 and L-010 arrived at independently. It is tracked, so it holds for
// every clone, and it is scoped to a path, so silencing ST-05 on one file leaves
// the file that really is too big still reported.
//
// FOUR LIMITS, each load-bearing:
//   • INFO ONLY. A warning or an error is by definition something to act on, and
//     `doctor` exits non-zero at W. Info is the severity whose whole failure mode
//     is being ignored, which is what this addresses. Widening later is easy;
//     narrowing after adopters rely on it is not.
//   • A REASON IS REQUIRED. A marker without one is not honoured. A suppression
//     nobody explained becomes an unexplained exception to the next reader —
//     exactly the state this is meant to prevent.
//   • IT ANSWERS ONE FINDING, NOT A CLASS. A check like SY-10 fires once per
//     entry in a single file; a (path, id) marker would blanket every one of
//     them, including entries written later that nobody reasoned about — and the
//     recorded reason would be untrue of the ones it silenced in passing. So a
//     marker applies only when exactly ONE finding of that id is open on that
//     file. Otherwise it applies to nothing and `doctor` says so.
//   • DOCUMENTED EXAMPLES DO NOT COUNT. This syntax gets written down, and a
//     marker shown as an example must not silence anything. That means all four
//     ways markdown quotes a line: fenced blocks (of any fence char and length,
//     so a ````-wrapped example of a ```-block still counts as quoted), indented
//     code blocks, blockquotes, and inline code. lib/md.mjs `ignoredLines`
//     cannot be reused: it also skips HTML comments, and the marker IS one.

/** `<!-- truss: <id> ok — <reason> -->`, anywhere on the line. */
const MARKER = /<!--\s*truss:\s*([a-z]{2,}-\d{2,})\s+ok\s*[—–-]\s*(\S.*?)\s*-->/i

/**
 * Is `index` inside a paired inline-code span on this line? Backticks pair left
 * to right; an unpaired trailing backtick opens nothing, which is why this walks
 * the line instead of using a regex over it.
 */
function insideCodeSpan(line, index) {
  let open = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '`') continue
    if (open === -1) { open = i; continue }
    if (index > open && index < i) return true
    open = -1
  }
  return false
}

/** Severities a marker may silence. See "INFO ONLY" above before widening. */
export const SUPPRESSIBLE = new Set(['I'])

/**
 * The check ids silenced in one file, with the reason given for each.
 * @param {string[]} lines
 * @returns {Map<string, string>} upper-case check id → reason
 */
export function suppressionsIn(lines) {
  const out = new Map()
  if (!Array.isArray(lines)) return out

  // Open fence, as CommonMark defines it: a run of >= 3 backticks or tildes.
  // It closes only on the SAME character and at least the same length, which is
  // what lets a ````-fenced example contain a ```-fenced one without the inner
  // pair ending the outer block.
  let fenceChar = null
  let fenceLen = 0

  for (const raw of lines) {
    const line = raw.trimEnd()
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceChar) {
      // A CLOSING fence carries no info string. Without that rule a ```js line
      // inside a ```-block ends it, and the fence state inverts for the rest of
      // the file — every later marker judged upside down.
      if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLen && !fence[2].trim()) {
        fenceChar = null; fenceLen = 0
      }
      continue
    }
    if (fence) { fenceChar = fence[1][0]; fenceLen = fence[1].length; continue }

    // Indented code block (4 spaces or a tab) and blockquote: both are ways of
    // showing a line rather than meaning it.
    if (/^(?: {4}|\t)/.test(line)) continue
    if (/^ {0,3}>/.test(line)) continue

    // Inline code — `<!-- truss: … -->` written mid-sentence is prose about the
    // syntax, not an instance of it. Test the marker's POSITION against the code
    // spans; do not rewrite the line first. Rewriting stripped backticks from
    // inside the marker too, and a reason naming a path or an id in backticks is
    // this project's house style — `<!-- truss: sy-10 ok — blocked by
    // \`state/decisions/D-094.md\` -->` lost its reason and stopped applying, with
    // no diagnostic at all. Silently discarding a real marker is the failure this
    // check is least able to explain to whoever wrote it.
    const m = line.match(MARKER)
    if (m && !insideCodeSpan(line, m.index)) out.set(m[1].toUpperCase(), m[2])
  }
  return out
}

/**
 * Split findings into the ones that still count and the ones a marker silences.
 *
 * A finding is only ever silenced by a marker in the file it points AT — the
 * path is the scope, so a marker cannot reach past its own file. Findings about
 * files the workspace never loaded (disk-only paths) are never suppressed,
 * because there are no lines to have carried a marker.
 *
 * A marker answers ONE finding. When several findings of the same id are open on
 * the same file it applies to none of them and is reported as unapplied: the
 * reason somebody wrote about one entry cannot stand in for the others, and
 * silencing them all would hide entries added after the marker.
 *
 * @param {Array<object>} findings
 * @param {{files: Map<string, {lines?: string[]}>}} ctx
 * @returns {{kept: Array<object>, suppressed: Array<object & {suppressedBy: string}>,
 *            unapplied: Array<{file: string, id: string, reason: string, matches: number}>}}
 */
export function applySuppressions(findings, ctx) {
  const cache = new Map()
  const markersFor = (file) => {
    if (!cache.has(file)) cache.set(file, suppressionsIn(ctx?.files?.get(file)?.lines))
    return cache.get(file)
  }

  // How many findings each marker could match, before deciding anything.
  const matchCount = new Map()
  const keyOf = (f) => `${f.file}\u0000${String(f.id).toUpperCase()}`
  for (const f of findings) {
    if (!SUPPRESSIBLE.has(f.severity) || !f.file) continue
    if (!markersFor(f.file).has(String(f.id).toUpperCase())) continue
    matchCount.set(keyOf(f), (matchCount.get(keyOf(f)) ?? 0) + 1)
  }

  const kept = []
  const suppressed = []
  const unapplied = []
  const reported = new Set()

  for (const f of findings) {
    if (!SUPPRESSIBLE.has(f.severity) || !f.file) { kept.push(f); continue }
    const id = String(f.id).toUpperCase()
    const reason = markersFor(f.file).get(id)
    if (!reason) { kept.push(f); continue }
    if (matchCount.get(keyOf(f)) === 1) {
      suppressed.push({ ...f, suppressedBy: reason })
      continue
    }
    kept.push(f)
    if (!reported.has(keyOf(f))) {
      reported.add(keyOf(f))
      unapplied.push({ file: f.file, id, reason, matches: matchCount.get(keyOf(f)) })
    }
  }
  return { kept, suppressed, unapplied }
}

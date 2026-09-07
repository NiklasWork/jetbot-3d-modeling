// .truss/tests/prose-scanner.test.mjs — links and IDs read the SAME text.
//
// WHY THIS IS A TEST AND NOT A REVIEW NOTE. `parseIdReferences` carefully skipped
// fenced blocks, inline code and HTML comments; `parseAllLinks` skipped none of
// them. The same documented example — a fenced block showing a file format with
// relative links — was therefore legal as an ID reference and a hard RF-01
// **error** as a link. There was no permitted way to document a format at all:
// the author had to falsify the example or live with permanent errors (TF-001).
//
// The asymmetry was silent, which is what made it expensive: seeing IDs ignored
// inside a fence implies links are too. Two scanners drift; one cannot. What this
// file locks is the *sameness*, not either scanner's details — a future edit that
// teaches one of them a new rule and forgets the other fails here.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseAllLinks, parseIdReferences, proseLines } from '../lib/md.mjs'

const CLASSES = ['D', 'TF']   // idMatchers takes bare prefixes, from docs/schema.md (D-079)

// One document carrying every shape, so the two parsers are asked the same thing.
const DOC = [
  'Real prose with a [link](state/current.md) and D-001.',       // 1  both see it
  '',                                                            // 2
  '```markdown',                                                 // 3
  '- [Recht](context/recht.md) — D-002',                         // 4  fenced: neither
  '```',                                                         // 5
  '',                                                            // 6
  'Inline `[Beispiel](context/nope.md)` and `D-003` are quotes.', // 7  neither
  '',                                                            // 8
  '<!-- a comment with [x](y.md) and D-004 -->',                 // 9  neither
  '',                                                            // 10
  'Trailing real [second](VISION.md) and D-005.',                // 11 both
]

describe('one scanner for prose — links and IDs cannot disagree (TF-001)', () => {
  it('parseAllLinks ignores fenced blocks, inline code and HTML comments', () => {
    const hrefs = parseAllLinks(DOC).map(l => l.href)
    assert.deepEqual(hrefs, ['state/current.md', 'VISION.md'])
  })

  it('parseIdReferences agrees, on the same document', () => {
    const ids = parseIdReferences(DOC, CLASSES).map(r => r.id)
    assert.deepEqual(ids, ['D-001', 'D-005'])
  })

  it('both report the SAME lines — the asymmetry is what TF-001 was', () => {
    const linkLines = [...new Set(parseAllLinks(DOC).map(l => l.line))]
    const idLines = [...new Set(parseIdReferences(DOC, CLASSES).map(r => r.line))]
    assert.deepEqual(linkLines, idLines)
  })

  it('a genuinely broken link in prose is still seen — the fix must not blind RF-01', () => {
    const found = parseAllLinks(['see [gone](state/nope.md)'])
    assert.equal(found.length, 1)
    assert.equal(found[0].href, 'state/nope.md')
  })
})

describe('the indented rule stays with IDs only, on purpose', () => {
  // A 4-space line is a Markdown code block outside a list and a continuation
  // inside one. Our own HT entries indent step continuations by five. Extending
  // the skip to links would stop RF-01 ever seeing a broken link in a numbered
  // step — a loosening nobody asked for, so the callers differ here by design.
  const INDENTED = ['  1. step', '     see [target](state/current.md) and D-009']

  it('links in an indented continuation are still checked', () => {
    assert.deepEqual(parseAllLinks(INDENTED).map(l => l.href), ['state/current.md'])
  })

  it('IDs in one are not — unchanged behaviour', () => {
    assert.deepEqual(parseIdReferences(INDENTED, CLASSES), [])
  })

  it('proseLines reports the indent without acting on it', () => {
    const flags = [...proseLines(INDENTED)].map(p => p.indented)
    assert.deepEqual(flags, [false, true])
  })
})

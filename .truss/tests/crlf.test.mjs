// .truss/tests/crlf.test.mjs — a Windows checkout must behave like a Unix one
//
// git checks out CRLF on Windows by default, and JS regexes treat \r as a line
// terminator: `.` never matches it and `$` never sits before it. Two parsers were
// blind to that, and both failed SILENTLY — parseFrontmatter returned an empty
// object, so state/phases.md lost its `current:` pointer; parseHeadings returned
// nothing at all, taking RF-01's anchor checks and every heading-based check with
// it. Neither produced a finding: the workspace just looked emptier than it was.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parseFrontmatter, parseHeadings, splitLines } from '../lib/md.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { makeRoot, runChecks, read } from './helpers.mjs'

const crlf = (text) => text.replace(/\r?\n/g, '\r\n')

describe('the parsers tolerate CRLF', () => {
  it('frontmatter fences, so phases.md keeps its current: pointer', () => {
    const lines = splitLines(crlf('---\ncurrent: build\n---\n\n## build\n'))
    assert.deepEqual(parseFrontmatter(lines).data, { current: 'build' })
    // and directly, for a caller that split the file itself
    assert.deepEqual(parseFrontmatter(['---\r', 'current: build\r', '---\r']).data,
      { current: 'build' })
  })

  it('headings, without dragging \r into the text or the anchor', () => {
    const [h] = parseHeadings(['## D-001 — Title\r'])
    assert.equal(h.text, 'D-001 — Title')
    assert.equal(h.anchor, parseHeadings(['## D-001 — Title'])[0].anchor)
  })

  it('splitLines drops the trailing empty line either way', () => {
    assert.deepEqual(splitLines('a\r\nb\r\n'), ['a', 'b'])
    assert.deepEqual(splitLines('a\nb\n'), ['a', 'b'])
  })
})

describe('a whole CRLF workspace', () => {
  it('produces exactly the findings its LF twin produces', async () => {
    const build = async (tag, convert) => {
      const root = await makeRoot(tag)
      await runInit(root, ['--name', 'Line Endings', '--lang', 'English', '--skills', 'none'])
      await fs.mkdir(path.join(root, 'state/decisions'), { recursive: true })
      await fs.writeFile(path.join(root, 'state/decisions/D-001.md'),
        '## D-001 — Node as the runtime\n\nDate: 2026-01-02\nDecision: Node 20+.\n' +
        'Rationale: installed everywhere.\nConsequences: node --test.\n')
      if (convert) {
        for (const rel of ['AGENTS.md', 'VISION.md', 'state/current.md', 'state/phases.md',
          'state/profile.md', 'state/open-decisions.md', 'state/decisions/D-001.md',
          'docs/schema.md']) {
          await fs.writeFile(path.join(root, rel), crlf(await read(root, rel)))
        }
      }
      return root
    }

    const lfRoot = await build('truss-lf-', false)
    const crlfRoot = await build('truss-crlf-', true)

    // the phase pointer is the canary: without it every PH check changes answer
    const phases = parseFrontmatter(splitLines(await read(crlfRoot, 'state/phases.md')))
    assert.ok(phases.data.current, 'CRLF phases.md lost its current: pointer')

    const key = (f) => `${f.id} ${f.severity} ${f.file || ''}`
    const lf = (await runChecks(lfRoot)).map(key).sort()
    const cr = (await runChecks(crlfRoot)).map(key).sort()
    assert.deepEqual(cr, lf)
  })
})

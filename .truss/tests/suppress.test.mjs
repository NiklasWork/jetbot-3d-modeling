// tests/suppress.test.mjs — silencing one info finding on one file (TF-008/D-096).
//
// The mechanism's value is entirely in its limits: it must silence the finding
// somebody deliberately answered, and nothing else. Each test below pins one
// limit, because a suppression that reaches further than intended is worse than
// the noise it replaces — it hides a real finding while looking like housekeeping.

import test from 'node:test'
import assert from 'node:assert/strict'

import fs from 'node:fs/promises'
import path from 'node:path'
import { suppressionsIn, applySuppressions, SUPPRESSIBLE } from '../lib/suppress.mjs'
import { loadWorkspace } from '../lib/workspace.mjs'
import { runAllChecks } from '../lib/run-checks.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { makeRoot } from './helpers.mjs'

const ctxWith = (files) => ({
  files: new Map(Object.entries(files).map(([rel, text]) => [rel, { lines: text.split('\n') }])),
})
const finding = (over) => ({ id: 'ST-05', severity: 'I', file: 'context/grammar.md', message: 'too long', ...over })

test('a marker names the check and carries a reason', () => {
  const found = suppressionsIn([
    '# Grammar',
    '<!-- truss: st-05 ok — grammar table; splitting it would break the format -->',
  ])
  assert.equal(found.get('ST-05'), 'grammar table; splitting it would break the format')
})

test('a marker without a reason does not count', () => {
  // An unexplained suppression is the state this mechanism exists to prevent.
  for (const line of ['<!-- truss: st-05 ok -->', '<!-- truss: st-05 ok — -->']) {
    assert.equal(suppressionsIn([line]).size, 0, line)
  }
})

// A review of the first cut broke this limit four ways. Markdown has more than
// one way to quote a line, and a scanner that knows only the plain ``` fence lets
// a file silence its own real finding by documenting the syntax.
test('a marker being shown rather than meant does not count — all four forms', () => {
  const cases = {
    'plain fence': ['```markdown', '<!-- truss: st-05 ok — example -->', '```'],
    // ````-wrapping is how you show a ```-fenced block; the inner pair must not
    // close the outer one.
    'nested fence': ['````markdown', '```', '<!-- truss: st-05 ok — example -->', '```', '````'],
    'tilde fence': ['~~~', '<!-- truss: st-05 ok — example -->', '~~~'],
    'indented code': ['Like so:', '', '    <!-- truss: st-05 ok — example -->'],
    'blockquote': ['> Write:', '> <!-- truss: st-05 ok — example -->'],
    'inline code': ['Write `<!-- truss: st-05 ok — example -->` at the top.'],
    'unclosed fence': ['```', '<!-- truss: st-05 ok — example -->'],
  }
  for (const [label, lines] of Object.entries(cases)) {
    assert.equal(suppressionsIn(lines).size, 0, `${label} must not silence anything`)
  }
  // …and a real marker beside all that still works.
  assert.equal(
    suppressionsIn(['```', 'x', '```', '<!-- truss: st-05 ok — the real one -->']).get('ST-05'),
    'the real one',
  )
})

test('the marker silences that finding on that file', () => {
  const ctx = ctxWith({
    'context/grammar.md': '<!-- truss: st-05 ok — the table is the format -->\n# Grammar\n',
  })
  const { kept, suppressed } = applySuppressions([finding()], ctx)
  assert.equal(kept.length, 0)
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0].suppressedBy, 'the table is the format')
})

test('it does not reach past its own file', () => {
  // The path is the scope — that is the whole difference to acking a check
  // globally, which would also silence the file that really is too big.
  const ctx = ctxWith({
    'context/grammar.md': '<!-- truss: st-05 ok — the table is the format -->\n',
    'context/other.md': '# Other\n',
  })
  const { kept } = applySuppressions([finding({ file: 'context/other.md' })], ctx)
  assert.equal(kept.length, 1, 'a different file keeps its finding')
})

test('it does not reach past its own check id', () => {
  const ctx = ctxWith({ 'context/grammar.md': '<!-- truss: st-05 ok — reason -->\n' })
  const { kept } = applySuppressions([finding({ id: 'SY-07' })], ctx)
  assert.equal(kept.length, 1)
})

test('warnings and errors are never suppressible', () => {
  // `doctor` exits non-zero at W: a warning is by definition something to act on.
  assert.deepEqual([...SUPPRESSIBLE], ['I'])
  const ctx = ctxWith({ 'context/grammar.md': '<!-- truss: st-05 ok — reason -->\n' })
  for (const severity of ['W', 'E']) {
    const { kept, suppressed } = applySuppressions([finding({ severity })], ctx)
    assert.equal(kept.length, 1, `${severity} must survive a marker`)
    assert.equal(suppressed.length, 0)
  }
})

test('a finding about a file the workspace never loaded is untouched', () => {
  const { kept } = applySuppressions([finding({ file: 'not/loaded.md' })], ctxWith({}))
  assert.equal(kept.length, 1)
})


// End to end, through the funnel every family's findings pass: the point of
// wiring this into run-checks rather than into each check is that no check has
// to know the mechanism exists.
test('a marker survives the whole doctor pipeline, and the run still reports it', async () => {
  const root = await makeRoot('truss-suppress-e2e-')
  try {
    await runInit(root, ['--name', 'Suppress', '--lang', 'English'])
    const long = '# Long\n\n' + Array(500).fill('a line of prose').join('\n') + '\n'
    await fs.mkdir(path.join(root, 'context'), { recursive: true })
    await fs.writeFile(path.join(root, 'context', 'grammar.md'), long)

    const before = await runAllChecks(await loadWorkspace(root))
    assert.ok(
      before.findings.some(f => f.id === 'ST-05' && f.file?.startsWith('context/grammar.md')),
      'precondition: the long file is reported',
    )
    assert.equal(before.suppressed.length, 0)

    await fs.writeFile(path.join(root, 'context', 'grammar.md'),
      '<!-- truss: st-05 ok — reference table, splitting it would break the format -->\n' + long)

    const after = await runAllChecks(await loadWorkspace(root))
    assert.ok(
      !after.findings.some(f => f.id === 'ST-05' && f.file?.startsWith('context/grammar.md')),
      'the answered finding stops printing',
    )
    assert.equal(after.suppressed.length, 1, 'and the run still counts it')
    assert.equal(after.exitCode, before.exitCode, 'silencing an info never changes the exit code')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// Pins the ordering claim in run-checks.mjs rather than trusting it: two files of
// the SAME length produce the same ST-05 message, so dedupe folds them into one
// row whose `file` is the first of the two. Suppressing after that fold would
// take both or neither. Suppressing per occurrence takes exactly the one that
// asked.
test('a marker on one of two identically-worded findings frees only that file', async () => {
  const root = await makeRoot('truss-suppress-dedupe-')
  try {
    await runInit(root, ['--name', 'Dedupe', '--lang', 'English'])
    // Both files must stay EXACTLY the same length: ST-05's message carries the
    // line count, and if adding the marker changed it the two messages would stop
    // matching, the fold would not happen, and this test would prove nothing
    // about ordering. So the marker REPLACES a line rather than being added.
    const body = Array(500).fill('a line of prose').join('\n') + '\n'
    const withPlaceholder = '# X\n\nplaceholder\n' + body
    const withMarker = '# X\n\n<!-- truss: st-05 ok — deliberately long -->\n' + body
    assert.equal(withPlaceholder.split('\n').length, withMarker.split('\n').length)

    await fs.mkdir(path.join(root, 'context'), { recursive: true })
    await fs.writeFile(path.join(root, 'context', 'a.md'), withPlaceholder)
    await fs.writeFile(path.join(root, 'context', 'b.md'), withPlaceholder)

    const before = await runAllChecks(await loadWorkspace(root))
    const folded = before.findings.filter(f => f.id === 'ST-05')
    assert.equal(folded.length, 1, 'precondition: the two identical messages fold into one row')
    assert.equal(folded[0].occurrences, 2, 'precondition: both files are behind that one row')

    // Mark the file that is NOT the fold representative. Suppressing after the
    // fold would look at the representative's path and miss this entirely.
    const repIsA = folded[0].file.includes('/a.md')
    const marked = repIsA ? 'b.md' : 'a.md'
    const kept = repIsA ? 'a.md' : 'b.md'
    await fs.writeFile(path.join(root, 'context', marked), withMarker)

    const after = await runAllChecks(await loadWorkspace(root))
    const rest = after.findings.filter(f => f.id === 'ST-05')
    assert.equal(after.suppressed.length, 1, `only ${marked} is silenced`)
    assert.equal(rest.length, 1, `${kept} is still reported`)
    assert.equal(rest[0].occurrences, 1, 'and it is reported for itself, not for both')
    assert.ok(rest[0].file.includes(kept), `the surviving finding is about ${kept}`)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// A marker answers one finding, not a class. SY-10 fires once per entry in a
// single file, so a (path, id) marker would blanket every entry in it — including
// ones written after the marker, which nobody reasoned about, and for which the
// recorded reason is simply untrue.
test('a marker does not apply when several findings of that id are open on the file', () => {
  const ctx = ctxWith({ 'state/open-decisions.md': '<!-- truss: sy-10 ok — OD-001 waits for Q4 -->\n' })
  const three = ['OD-001', 'OD-002', 'OD-003'].map(od =>
    finding({ id: 'SY-10', file: 'state/open-decisions.md', message: `${od} has been open a long time` }))

  const { kept, suppressed, unapplied } = applySuppressions(three, ctx)
  assert.equal(suppressed.length, 0, 'one reason cannot answer three questions')
  assert.equal(kept.length, 3)
  assert.equal(unapplied.length, 1)
  assert.equal(unapplied[0].matches, 3)
  assert.equal(unapplied[0].id, 'SY-10')
})

test('the same marker applies once the file is down to a single finding', () => {
  const ctx = ctxWith({ 'state/open-decisions.md': '<!-- truss: sy-10 ok — OD-001 waits for Q4 -->\n' })
  const one = [finding({ id: 'SY-10', file: 'state/open-decisions.md', message: 'OD-001 has been open a long time' })]
  const { kept, suppressed, unapplied } = applySuppressions(one, ctx)
  assert.equal(suppressed.length, 1)
  assert.equal(kept.length, 0)
  assert.equal(unapplied.length, 0)
})

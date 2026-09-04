import test from 'node:test';
import assert from 'node:assert';
import { CONTEXT_FILES, TOKENS_PER_WORD, wordCount, toTokens, phaseReadTargets, bootFilesFrom, measureBootContext } from '../lib/context-budget.mjs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLines } from '../lib/md.mjs';

// This module is the single source of truth shared by the doctor's CX-01 check
// (checks/cx.mjs). These
// tests lock the two things that previously diverged between them: the file set
// and the token factor.

test('token factor is words × 1.5', () => {
  assert.equal(TOKENS_PER_WORD, 1.5);
  assert.equal(toTokens(10), 15);
  assert.equal(toTokens(1000), 1500);
});

test('wordCount counts whitespace-separated tokens, trimmed', () => {
  assert.equal(wordCount('  one  two\nthree '), 3);
  assert.equal(wordCount(''), 0);
});

test('CONTEXT_FILES covers the mandatory §1 load order incl. open-decisions', () => {
  for (const f of [
    'AGENTS.md',
    'state/current.md',
    'VISION.md',
    'state/decisions-index.md',
    'state/open-decisions.md', // regression guard: the dashboard used to omit this
    'state/profile.md',
  ]) {
    assert.ok(CONTEXT_FILES.includes(f), `CONTEXT_FILES must include ${f}`);
  }
  // D-075: the index is boot context, the full decision log is not — it is
  // loaded on demand, before a decision is made or proposed. Counting both would
  // report a budget no session actually pays.
  assert.ok(
    !CONTEXT_FILES.includes('state/decisions.md'),
    'the full decision log left the always-loaded set when the index took its place',
  );
  // The task-specific domain file (§1 step 6) is intentionally NOT a static member.
  assert.equal(CONTEXT_FILES.length, 6);
});

test('phaseReadTargets resolves the current phase read: list (whitespace/comma/semicolon)', () => {
  const phases = {
    frontmatter: { current: 'discover' },
    defs: new Map([['discover', { read: 'a.md, b.md c.md;d.md' }]]),
  };
  assert.deepEqual(phaseReadTargets(phases), ['a.md', 'b.md', 'c.md', 'd.md']);
});

test('phaseReadTargets is empty when no current phase or no read: field', () => {
  assert.deepEqual(phaseReadTargets(null), []);
  assert.deepEqual(phaseReadTargets({ frontmatter: {}, defs: new Map() }), []);
  assert.deepEqual(
    phaseReadTargets({ frontmatter: { current: 'x' }, defs: new Map([['x', {}]]) }),
    [],
  );
});


// ── bootFilesFrom — the boot list comes out of §1, not out of this engine ────
// D-095/OD-018. The whole risk of deriving it is a silent wrong answer, so these
// pin both directions: what a real §1 yields, and that a §1 the parser cannot
// read says so instead of returning a short list.

const BASELINE_AGENTS = path.join(
  fileURLToPath(new URL('../baseline/AGENTS.md', import.meta.url)),
);

test('bootFilesFrom on the shipped AGENTS.md yields exactly the fallback set', async () => {
  const raw = await fsp.readFile(BASELINE_AGENTS, 'utf8');
  const r = bootFilesFrom(splitLines(raw));
  assert.equal(r.ok, true, r.reason ?? '');
  // Same members, any order: §1 is a load order, the sum does not care.
  assert.deepEqual([...r.files].sort(), [...CONTEXT_FILES].sort());
});

test('bootFilesFrom counts a split boot file — the gap it exists to close', () => {
  const lines = splitLines(
    '# A\n\n## 1 Load order\n\n'
    + '1. This file — fully, every session.\n'
    + '2. `state/current.md` — focus.\n'
    + '3. `state/current.tasks.md` — the half that was split off.\n'
    + '4. `VISION.md` — once per session.\n\n'
    + '## 2 Structure\n',
  );
  const r = bootFilesFrom(lines);
  assert.equal(r.ok, true);
  assert.ok(r.files.includes('state/current.tasks.md'),
    'splitting a boot file must no longer lower the measurement');
});

test('bootFilesFrom ignores placeholders and prose in backticks', () => {
  const lines = splitLines(
    '## 1 Load order\n\n'
    + '1. `state/current.md`, then the bodies at `state/decisions/D-NNN.md`.\n'
    + '2. A domain file `context/<domain>.md`; run `truss status`; see `VISION.md`.\n'
    + '3. The directory `archive/` is not loaded.\n\n'
    + '## 2 Next\n',
  );
  const r = bootFilesFrom(lines);
  assert.deepEqual(r.files, ['AGENTS.md', 'state/current.md', 'VISION.md']);
});

test('bootFilesFrom accepts a bare `## 1` heading', () => {
  const r = bootFilesFrom(splitLines(
    '## 1\n\n1. This file.\n2. `state/current.md`\n3. `VISION.md`\n\n## 2\n'));
  assert.equal(r.ok, true, r.reason ?? '');
  assert.deepEqual(r.files, ['AGENTS.md', 'state/current.md', 'VISION.md']);
});

test('bootFilesFrom refuses rather than under-counting', () => {
  for (const [label, lines] of [
    ['no §1', splitLines('# A\n\n## 2 Structure\n\n| Path |\n')],
    ['empty §1', splitLines('## 1 Load order\n\nRead everything.\n\n## 2 X\n')],
    ['no file at all', []],
  ]) {
    const r = bootFilesFrom(lines);
    assert.equal(r.ok, false, `${label} must not report a derived list`);
    assert.ok(r.reason, `${label} must name why`);
    assert.deepEqual(r.files, CONTEXT_FILES, `${label} falls back to the shipped set`);
  }
});


// ── one measurement, two callers ────────────────────────────────────────────
// CX-01 and `truss ack context` computed the boot sum separately. That was
// harmless until §1 began contributing files: from then on `ack` could reply
// "already under the threshold, nothing to acknowledge" about a warning CX-01 was
// still printing — an unclearable finding, which is the one thing context-ack
// exists to prevent. A comment in bin/truss.mjs asserted the two shared a code
// path; this test is what makes that true rather than claimed.
test('measureBootContext is what both CX-01 and ack see, §1 extras included', async () => {
  const big = (n) => '# B\n\n' + 'word '.repeat(n);
  const mk = (text) => ({ content: text, lines: splitLines(text) });
  const agents = '# A\n\n## 1 Load order\n\n1. This file.\n'
    + '2. `state/current.md`\n3. `VISION.md`\n4. `state/split.md`\n\n## 2 Structure\n';
  const ctx = {
    files: new Map(Object.entries({
      'AGENTS.md': mk(agents),
      'state/current.md': mk(big(100)),
      'VISION.md': mk(big(100)),
      'state/split.md': mk(big(4000)),      // named by §1 only
      'context/arch.md': mk(big(2000)),     // reached through the phase read:
    })),
    phases: { frontmatter: { current: 'build' }, defs: new Map([['build', { read: 'context/arch.md' }]]) },
  };

  const m = await measureBootContext(ctx);
  const files = m.counted.map((c) => c.file);
  assert.ok(files.includes('state/split.md'), 'a file only §1 names is counted');
  assert.ok(files.includes('context/arch.md'), 'so is the phase read: target');
  // The number a caller acts on is the sum of exactly what it reports counting —
  // the property that broke when two callers summed different sets.
  assert.equal(m.words, m.counted.reduce((s, c) => s + c.words, 0));
  assert.equal(m.tokens, toTokens(m.words));
  // priorSet is "what the pre-§1 measurement counted": shipped files plus read:
  // targets, never the §1 extras.
  assert.ok(m.priorSet.has('context/arch.md'), 'a read: target was always counted');
  assert.ok(!m.priorSet.has('state/split.md'), 'a §1-only file is what is new');
});

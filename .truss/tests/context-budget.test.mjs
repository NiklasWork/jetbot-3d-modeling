import test from 'node:test';
import assert from 'node:assert';
import { CONTEXT_FILES, TOKENS_PER_WORD, wordCount, toTokens, phaseReadTargets } from '../lib/context-budget.mjs';

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

// checks/cx.mjs — Context-size checks (CX-01, CX-02)
//
// CX-01  W/E  mandatory Truss boot metadata exceeds the token budget
//             (warn ≥ 18000, error ≥ 30000 token-equivalent; words × 1.5 heuristic)
// CX-02  I    the boot list could not be read from AGENTS.md §1 — CX-01 fell back
//
// "Mandatory Truss boot metadata" = the deterministic files an agent loads per the
// AGENTS.md §1 load order — READ OUT OF §1 (bootFilesFrom), not out of a constant
// in this engine. A fixed list measured a fixed six paths, so splitting a boot
// file in two lowered the number without lowering what a session loads: the most
// effective way to quiet this check was the only one that improved nothing
// (D-095/OD-018). Plus the current phase's `read:` targets (load-order step 6).
// A conditionally loaded file like open-decisions.md is counted as present: it
// ships with every workspace (D-035) and a static check cannot know the task.
// Task-selected domain files, source files and agent-tool additions stay out.
//
// Two guards, because this check now depends on parsing a project's own file:
//   • §1 unreadable → CX-02 (info) and the shipped CONTEXT_FILES are measured
//     instead. Loud fallback, never a silently shrunken number.
//   • crossing the threshold only because §1 names files the old list never saw
//     → info, once, naming them. `release-maturity.md` promises a green instance
//     is not turned red by our change, and D-081 requires that promise be kept on
//     workspace evidence rather than a release number.
//
// Token factor 1.5 (not 1.35): truss files are markdown dense with tables, IDs,
// paths and backticks, which tokenize into more sub-tokens than prose — 1.35 would
// systematically under-count and miss real bloat. The message labels it a "≈".
//
// The fallback list, the token factor, the budget bands and the phase-read
// resolution live in lib/context-budget.mjs, so every consumer sees the same
// number and the same thresholds it is judged against.
//
// REVIEW ACK (lib/context-ack.mjs): an absolute band cannot distinguish a
// bloated workspace from a legitimately big one, so once a lean project passes
// 18k the warning would be permanent and unresolvable — and an unclearable
// finding teaches the human to stop reading doctor. `truss ack context` records
// that the boot context was read through and judged lean at N tokens; while the
// measurement stays within ACK_HEADROOM of N, this finding is DOWNGRADED to
// info. Downgraded, never hidden: the number, the reviewed baseline and the
// re-fire ceiling stay on screen. An error-band measurement is never downgraded.

import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTEXT_FILES, TOKENS_PER_WORD, WARN_TOKENS, ERROR_TOKENS, toTokens, measureBootContext } from '../lib/context-budget.mjs'
import { ackVerdict } from '../lib/context-ack.mjs'

export const meta = [
  { id: 'CX-01', severity: 'W', title: 'mandatory Truss boot metadata exceeds the token budget', description: `Excludes task-selected domain/source context; W ≥ ${WARN_TOKENS}, E ≥ ${ERROR_TOKENS} token-equivalent (words × 1.5)` },
  { id: 'CX-02', severity: 'I', title: 'the boot list could not be read from AGENTS.md §1', description: 'CX-01 then measures the shipped six-file list instead of what this workspace actually loads — info, because a §1 the parser does not recognise is a shape it has not seen, not a broken workspace (D-081)' },
]

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Promise<Array>}
 */
export async function run(ctx) {
  const findings = []

  // One measurement function, shared with `truss ack context` — see its header
  // for why the two must not compute this separately.
  const { counted, words: totalWords, tokens, boot, priorSet } = await measureBootContext(
    ctx,
    async (rel) => {
      // A phase `read:` target may point at an on-demand file the workspace scan
      // never loaded.
      try { return await fs.readFile(path.join(ctx.root, rel), 'utf8') } catch { return null }
    },
  )

  if (!boot.ok) {
    findings.push({
      id: 'CX-02', severity: 'I',
      file: 'AGENTS.md',
      message: `the §1 load order could not be read (${boot.reason}) — CX-01 is measuring the shipped list (${CONTEXT_FILES.join(', ')}) instead of this workspace's own`,
      fix: `Nothing breaks; the budget is simply measured against the default set. To have it follow this workspace, keep §1 as a heading that starts with '## 1 ' and name each boot file in backticks (e.g. \`state/current.md\`).`,
    })
  }

  // What the OLD measurement would have said. `release-maturity.md` promises that
  // a change which would turn a green instance red runs at info first, and D-081
  // requires that promise be kept on workspace evidence rather than on a release
  // number — this is that evidence: an instance crossing the threshold ONLY
  // because §1 names files the shipped list never saw was green a moment ago
  // through no fault of ours.
  //
  // The prior set is the shipped files PLUS the phase `read:` targets, because
  // the old code counted those too (step 2 below has always run). Leaving them
  // out made every read target look newly counted, so a workspace whose weight
  // sat in a phase-read file had its warning — and its ERROR — downgraded to
  // info, permanently, which is the exact opposite of the promise.
  const priorWords = counted
    .filter(c => priorSet.has(c.file))
    .reduce((s, c) => s + c.words, 0)
  const newlyCounted = counted
    .filter(c => !priorSet.has(c.file))
    .map(c => c.file)
  // Never at the error band. `ackVerdict` refuses to downgrade an E for the same
  // reason and it holds here too: at 30k the size is unambiguous ballast, and a
  // workspace whose §1 alone adds 12k of boot context has a problem our release
  // note did not cause. The promise being kept is "we do not turn a green
  // instance red", not "we hide whatever the new measurement finds".
  const crossedOnlyByNewFiles = (tokens) =>
    boot.ok && newlyCounted.length > 0 &&
    tokens < ERROR_TOKENS && toTokens(priorWords) < WARN_TOKENS

  if (tokens >= WARN_TOKENS) {
    const hardSeverity = tokens >= ERROR_TOKENS ? 'E' : 'W'
    const threshold = hardSeverity === 'E' ? `${ERROR_TOKENS} error` : `${WARN_TOKENS} warn`
    const heaviest = [...counted]
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)
      .map(c => `${c.file} (≈${toTokens(c.words)})`)
      .join(', ')
    // What the number is made of, in full. CONTEXT_FILES is a fixed list, so a
    // workspace that splits a boot file lowers this measurement without lowering
    // what a session actually loads — and nothing on screen said which files were
    // in scope, which made that gap silent. Naming them does not fix the list; it
    // stops the number from being read as more than it is.
    const countedList = counted.map(c => c.file).join(', ')

    const verdict = ackVerdict(ctx.contextAck?.acks?.['CX-01'], tokens, hardSeverity)

    if (crossedOnlyByNewFiles(tokens) && !verdict.downgraded) {
      findings.push({
        id: 'CX-01', severity: 'I',
        file: 'AGENTS.md',
        message: `mandatory Truss boot metadata ≈ ${tokens} tokens — over the ${threshold} threshold, but only because §1 also names ${newlyCounted.join(', ')}, which earlier releases did not count (≈${toTokens(priorWords)} without them). Info, not a warning, because our change is what moved it. Heaviest: ${heaviest}. Counted: ${countedList}`,
        fix: `Read the newly counted files and decide whether they belong in every session's boot. If they do, record the size with \`truss ack context\`; if they do not, route them out of §1. Either way this becomes a full warning once the long-counted files alone exceed ${WARN_TOKENS}.`,
      })
    } else if (verdict.downgraded) {
      // Reviewed and judged lean at `baseline`; growth since then is still
      // inside the headroom. Report the fact, do not gate on it.
      findings.push({
        id: 'CX-01', severity: 'I',
        file: 'AGENTS.md',
        message: `mandatory Truss boot metadata ≈ ${tokens} tokens — above the ${threshold} threshold but within the reviewed baseline of ≈${verdict.baseline} (acked ${verdict.date}). Warns again above ≈${verdict.ceiling}. Heaviest: ${heaviest}. Counted: ${countedList}`,
        fix: `Nothing to do — this size was reviewed and judged lean. Re-review with the \`cleanup\` prompt (.truss/docs/rituals/cleanup.md) and re-run \`truss ack context\` after the next real trim, or \`truss ack context --clear\` to drop the baseline and get the full warning back.`,
      })
    } else {
      const staleAck = verdict.baseline
        ? ` Grown past the reviewed baseline of ≈${verdict.baseline} (acked ${verdict.date}, re-fire ceiling ≈${verdict.ceiling}).`
        : ''
      findings.push({
        id: 'CX-01', severity: hardSeverity,
        file: 'AGENTS.md',
        message: `mandatory Truss boot metadata ≈ ${tokens} tokens (${totalWords} words × ${TOKENS_PER_WORD}) — over the ${threshold} threshold.${staleAck} Task-selected domain/source context is not counted. Heaviest: ${heaviest}. Counted: ${countedList}`,
        // The cleanup procedure itself is canonical in .truss/docs/rituals/cleanup.md
        // (protection list included) — this only names it and the way out.
        fix: `Run the \`cleanup\` prompt (.truss/docs/rituals/cleanup.md): it inventories the always-loaded files, classifies every block as keep / route / archive / drop-duplicate, and protects the §1 load order, the §2 structure table, the generated blocks and every D-NNN. If the review concludes this size is genuinely earned, record it with \`truss ack context\` — the finding then reports as info until the context grows past the reviewed baseline.`,
      })
    }
  }

  return findings
}

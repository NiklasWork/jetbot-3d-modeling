// checks/cx.mjs — Context-size check (CX-01)
//
// CX-01  W/E  mandatory Truss boot metadata exceeds the token budget
//             (warn ≥ 18000, error ≥ 30000 token-equivalent; words × 1.5 heuristic)
//
// "Mandatory Truss boot metadata" = the deterministic files an agent loads per the
// AGENTS.md §1 load order, anchored to file *identities* (not the literal step
// numbers, which a project may renumber): AGENTS.md (incl. both generated blocks)
// + current.md + VISION.md + decisions.md + open-decisions.md + profile.md, plus
// the current phase's `read:` targets (load-order step 6). open-decisions.md is
// counted unconditionally: it ships with every workspace (D-035), and while §1
// loads it only when the task touches an open question, a check cannot know the
// task — so it is counted as present, which it always is. Task-selected domain files,
// source files, and agent-tool additions are outside this metric.
//
// Token factor 1.5 (not 1.35): truss files are markdown dense with tables, IDs,
// paths and backticks, which tokenize into more sub-tokens than prose — 1.35 would
// systematically under-count and miss real bloat. The message labels it a "≈".
//
// The file list (CONTEXT_FILES), the token factor, the budget bands and the
// phase-read resolution live in lib/context-budget.mjs, so every consumer sees
// the same number and the same thresholds it is judged against.
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
import { CONTEXT_FILES, TOKENS_PER_WORD, WARN_TOKENS, ERROR_TOKENS, wordCount, toTokens, phaseReadTargets } from '../lib/context-budget.mjs'
import { ackVerdict } from '../lib/context-ack.mjs'

export const meta = [
  { id: 'CX-01', severity: 'W', title: 'mandatory Truss boot metadata exceeds the token budget', description: `Excludes task-selected domain/source context; W ≥ ${WARN_TOKENS}, E ≥ ${ERROR_TOKENS} token-equivalent (words × 1.5)` },
]

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Promise<Array>}
 */
export async function run(ctx) {
  const findings = []
  const counted = [] // { file, words }
  const seen = new Set()

  const add = (rel, content) => {
    if (content == null || seen.has(rel)) return
    seen.add(rel)
    counted.push({ file: rel, words: wordCount(content) })
  }

  // 1) Always-loaded files (already parsed in ctx.files).
  for (const rel of CONTEXT_FILES) {
    const f = ctx.files.get(rel)
    if (f) add(rel, f.content)
  }

  // 2) Current phase `read:` targets (load-order step 6, deterministic part).
  for (const rel of phaseReadTargets(ctx.phases)) {
    if (seen.has(rel)) continue
    const f = ctx.files.get(rel)
    if (f) { add(rel, f.content); continue }
    // read: may point at an on-demand domain file that isn't table-managed.
    try { add(rel, await fs.readFile(path.join(ctx.root, rel), 'utf8')) } catch { /* missing — ignore */ }
  }

  const totalWords = counted.reduce((s, c) => s + c.words, 0)
  const tokens = toTokens(totalWords)

  if (tokens >= WARN_TOKENS) {
    const hardSeverity = tokens >= ERROR_TOKENS ? 'E' : 'W'
    const threshold = hardSeverity === 'E' ? `${ERROR_TOKENS} error` : `${WARN_TOKENS} warn`
    const heaviest = [...counted]
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)
      .map(c => `${c.file} (≈${toTokens(c.words)})`)
      .join(', ')

    const verdict = ackVerdict(ctx.contextAck?.acks?.['CX-01'], tokens, hardSeverity)

    if (verdict.downgraded) {
      // Reviewed and judged lean at `baseline`; growth since then is still
      // inside the headroom. Report the fact, do not gate on it.
      findings.push({
        id: 'CX-01', severity: 'I',
        file: 'AGENTS.md',
        message: `mandatory Truss boot metadata ≈ ${tokens} tokens — above the ${threshold} threshold but within the reviewed baseline of ≈${verdict.baseline} (acked ${verdict.date}). Warns again above ≈${verdict.ceiling}. Heaviest: ${heaviest}`,
        fix: `Nothing to do — this size was reviewed and judged lean. Re-review with the \`cleanup\` prompt (.truss/docs/rituals/cleanup.md) and re-run \`truss ack context\` after the next real trim, or \`truss ack context --clear\` to drop the baseline and get the full warning back.`,
      })
    } else {
      const staleAck = verdict.baseline
        ? ` Grown past the reviewed baseline of ≈${verdict.baseline} (acked ${verdict.date}, re-fire ceiling ≈${verdict.ceiling}).`
        : ''
      findings.push({
        id: 'CX-01', severity: hardSeverity,
        file: 'AGENTS.md',
        message: `mandatory Truss boot metadata ≈ ${tokens} tokens (${totalWords} words × ${TOKENS_PER_WORD}) — over the ${threshold} threshold.${staleAck} Task-selected domain/source context is not counted. Heaviest: ${heaviest}`,
        // The cleanup procedure itself is canonical in .truss/docs/rituals/cleanup.md
        // (protection list included) — this only names it and the way out.
        fix: `Run the \`cleanup\` prompt (.truss/docs/rituals/cleanup.md): it inventories the always-loaded files, classifies every block as keep / route / archive / drop-duplicate, and protects the §1 load order, the §2 structure table, the generated blocks and every D-NNN. If the review concludes this size is genuinely earned, record it with \`truss ack context\` — the finding then reports as info until the context grows past the reviewed baseline.`,
      })
    }
  }

  return findings
}

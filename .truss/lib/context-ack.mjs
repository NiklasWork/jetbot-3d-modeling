// lib/context-ack.mjs — the boot-context review record ("ack").
//
// THE PROBLEM IT SOLVES
// CX-01 judges the mandatory boot metadata against ABSOLUTE bands (18k warn /
// 30k error). An absolute band cannot tell "bloated" from "legitimately big":
// once a project's genuinely lean boot context sits above 18k, the warning is
// permanent and unresolvable, and a finding that can never be cleared trains
// the human to ignore doctor. That is the failure mode this file prevents.
//
// THE MECHANISM
// The ack records a point-in-time review: "at N tokens this workspace was read
// through and judged lean." CX-01 then measures GROWTH SINCE THAT REVIEW, not
// absolute size. Within `ACK_HEADROOM` of the reviewed baseline the finding is
// DOWNGRADED to info — never hidden: the number, the baseline and the re-fire
// ceiling all stay on screen, and `doctor --gate` stops being blocked by a
// question that was already answered.
//
// WHY NOT A COMMIT COUNTER / TIMER
// A commit counter was the obvious alternative and is worse on every axis:
// commits do not correlate with context growth (a typo commit counts like a
// 2000-line refactor), `auto-commit` leaves the cadence to a human habit, a
// workspace with a code-root overlay has two independent commit streams, truss
// must work in a non-git directory at all, and the check engine is deliberately
// hermetic — git lives in `truss status`, never inside a check (see the SY-05
// note in checks/sy.mjs). Time-based aging was already tried and retired: SY-02
// aged workspace state by the calendar and D-029 removed it because a resting
// project is not a broken one. The metric itself is the only honest clock.
//
// STORAGE
// `.truss/out/context-ack.json` — runtime output next to doctor.json, and
// gitignored like it. The ack is a local reading preference, not a project
// fact: it costs zero boot tokens, needs no AGENTS.md §2 table row, and a fresh
// clone starting without one is the correct conservative default (the warning
// simply speaks up once, and one command answers it).

import fs from 'node:fs/promises'
import path from 'node:path'

/** Path of the ack file, relative to the workspace root. */
export const ACK_REL_PATH = path.join('.truss', 'out', 'context-ack.json')

/**
 * Growth past a reviewed baseline that re-opens the question.
 * 0.15 on a ~19k baseline is ≈2.9k tokens ≈ 18 further decision entries — large
 * enough that the workspace has materially changed, small enough that real
 * bloat cannot hide behind it. Set, not derived; correct it at the first false
 * alarm, the way OD_STALE_DAYS is handled in checks/sy.mjs.
 */
export const ACK_HEADROOM = 0.15

/** Checks whose findings an ack may downgrade. Deliberately a closed set. */
export const ACKABLE = new Set(['CX-01'])

const CURRENT_VERSION = 1

/**
 * Read the ack record. Returns null when absent or unreadable — a missing,
 * truncated or hand-mangled ack must never break doctor, it just means
 * "not reviewed", which is the safe default.
 *
 * @param {string} root workspace root
 * @returns {Promise<{version: number, acks: Record<string, {tokens: number, date: string, note?: string}>}|null>}
 */
export async function readContextAck(root) {
  try {
    const raw = await fs.readFile(path.join(root, ACK_REL_PATH), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.acks !== 'object' || parsed.acks === null) return null
    return { version: parsed.version ?? CURRENT_VERSION, acks: parsed.acks }
  } catch {
    return null
  }
}

/**
 * Record a review for one check id. Merges into any existing record so acking
 * one check never silently drops another.
 *
 * @param {string} root
 * @param {string} id check id (must be in ACKABLE)
 * @param {{tokens: number, date?: string, note?: string}} entry
 */
export async function writeContextAck(root, id, entry) {
  if (!ACKABLE.has(id)) throw new Error(`context-ack: ${id} is not an ackable check`)
  const existing = await readContextAck(root)
  const acks = { ...(existing?.acks ?? {}) }
  acks[id] = {
    tokens: Math.round(entry.tokens),
    date: entry.date ?? new Date().toISOString().slice(0, 10),
    ...(entry.note ? { note: entry.note } : {}),
  }
  const outDir = path.join(root, '.truss', 'out')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(root, ACK_REL_PATH), JSON.stringify({ version: CURRENT_VERSION, acks }, null, 2) + '\n', 'utf8')
  return acks[id]
}

/**
 * Remove the whole ack record.
 *
 * Returns 'removed' | 'absent' | 'failed'. The three are deliberately NOT
 * collapsed into a boolean: a delete that fails (read-only mount, network
 * share, file locked by another process) must never be reported as "there was
 * nothing to clear" — the caller would then believe the warning is back at full
 * severity while the baseline silently still applies. That is the one way this
 * mechanism could mislead someone, so it is the one error path that is loud.
 */
export async function clearContextAck(root) {
  try { await fs.unlink(path.join(root, ACK_REL_PATH)); return 'removed' }
  catch (err) {
    if (err?.code === 'ENOENT') return 'absent'
    return 'failed'
  }
}

/**
 * Decide what an ack does to a measured value.
 *
 * `hardSeverity` is the severity the check reached on its own. An ack NEVER
 * touches an error: at the error band the size is unambiguous ballast and no
 * prior review buys silence. This is the safety property the whole mechanism
 * rests on — keep it.
 *
 * @param {{tokens: number, date: string, note?: string}|undefined|null} ack
 * @param {number} tokens current measurement
 * @param {'I'|'W'|'E'} hardSeverity
 * @returns {{downgraded: boolean, baseline: number|null, ceiling: number|null, date: string|null}}
 */
export function ackVerdict(ack, tokens, hardSeverity) {
  const none = { downgraded: false, baseline: null, ceiling: null, date: null }
  if (!ack || typeof ack.tokens !== 'number' || !Number.isFinite(ack.tokens) || ack.tokens <= 0) return none
  if (hardSeverity === 'E') return none
  const ceiling = Math.round(ack.tokens * (1 + ACK_HEADROOM))
  if (tokens > ceiling) return { downgraded: false, baseline: ack.tokens, ceiling, date: ack.date ?? null }
  return { downgraded: true, baseline: ack.tokens, ceiling, date: ack.date ?? null }
}

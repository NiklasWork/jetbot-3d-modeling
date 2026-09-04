// lib/context-budget.mjs — shared context-budget math.
//
// The SINGLE SOURCE OF TRUTH for the mandatory Truss boot-metadata estimate,
// imported by the doctor check (checks/cx.mjs → CX-01). Keeping the file list
// and the token factor here guarantees every consumer places the same number
// against the 18k warn / 30k error bands.
//
// Method: words × 1.5. Empirically validated 2026-07-03 against real BPE
// tokenizers on the truss markdown corpus:
//   • GPT-4 / cl100k  ≈ 1.52–1.54 tokens/word  → words×1.5 lands within ~2%
//   • Claude (legacy) ≈ 1.73–1.78 tokens/word  → words×1.5 under-counts ~15%
// tokens/word is far more stable across truss files than chars/token (paths,
// IDs, tables and backticks inflate chars/token variance), which is why a
// word-based factor beats the "chars ÷ 4" rule of thumb for this corpus. The
// estimate is GPT-class-calibrated and slightly optimistic for Claude.

export const TOKENS_PER_WORD = 1.5

// Boot-metadata budget bands (token-equivalent). Recalibrated 2026-07-24 against
// measured projects instead of the empty template — the old 9k/15k bands were
// derived from a fresh `init` (≈3.6k) and left barely 3k of headroom for a
// project's entire lifetime:
//   • fresh init, empty templates ................ ≈ 3.2k (3.6k before D-028)
//   • fresh project, vision + structure filled ... ≈ 9k    (was already warning)
//   • truss forge itself, 24 decisions ........... ≈ 9.3k  (was already warning)
// A real project's structural floor is ≈5.5–6k (framework template + structure
// table + filled vision/profile) before any work happens, and only decisions.md
// grows without bound (≈160 tokens/entry). WARN at 18k therefore lands where
// archiving genuinely pays (~60–80 decisions on top of a full base) and still
// costs under 10% of a 200k window; ERROR at 30k (15%) is unambiguous ballast.
// The words×1.5 factor under-counts Claude ~15%, which these bands absorb.
export const WARN_TOKENS  = 18000
export const ERROR_TOKENS = 30000

// Always-loaded boot context (AGENTS.md §1 load order, by file identity).
// open-decisions.md is only *conditionally* loaded per §1, but a static check
// cannot know the task, so it is counted unconditionally (conservative). The one
// task-selected domain file and source/tool context are intentionally NOT
// counted — they are unknowable statically. This metric must not be presented as
// total task context. The phase block itself is already inside AGENTS.md.
//
// state/decisions-index.md, NOT state/decisions.md (D-075): now that the index
// exists, §1 loads the full decision log only before a decision is made or
// proposed — a task-dependent step this metric cannot and must not assume. A
// workspace that has never run `truss render` has no index file, so nothing is
// counted in its place; ST-10 is what reports that state.
export const CONTEXT_FILES = [
  'AGENTS.md',
  'state/current.md',
  'VISION.md',
  'state/decisions-index.md',
  'state/open-decisions.md',
  'state/profile.md',
]

export const wordCount = (content) => (content.trim().match(/\S+/g) || []).length
export const toTokens  = (words) => Math.round(words * TOKENS_PER_WORD)

// The current phase's `read:` targets (§1 load-order step 6, deterministic part).
// `phases` is the object returned by lib/md.mjs parsePhases() — { frontmatter, defs }.
// Splits on whitespace as well as , ; so "read: a.md b.md" also works.
export function phaseReadTargets(phases) {
  const currentId = phases?.frontmatter?.current
  const def = currentId ? phases?.defs?.get(currentId) : null
  if (!def?.read) return []
  return def.read.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
}

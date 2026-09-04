// lib/commands/status.mjs — truss status (CLI-Summary)

import path from 'node:path'
import fs from 'node:fs/promises'
import { loadWorkspace } from '../workspace.mjs'
import { listDomains } from '../domains.mjs'
import { branchReport, recentCommits, fileLineAges, gitChangedPaths } from '../git.mjs'
import { observe, presenceLines, indexLockAge } from '../presence.mjs'
import { decisionFilesFrom } from '../decisions-index.mjs'
import { runAllChecks } from '../run-checks.mjs'
import { CHECKBOX_ANY, CHECKBOX_DONE, ignoredLines } from '../md.mjs'
import { classById, fileForClass } from '../schema.mjs'

const RECENT_COMMITS_MAX = 5
// Same 60-char cutoff other status-adjacent messages use (checks/sy.mjs,
// checks/ph.mjs) before appending '…' — keeps one line per commit.
const RECENT_SUBJECT_MAX = 60

export async function runStatus(root, argv) {
  let ctx
  try {
    ctx = await loadWorkspace(root)
  } catch (err) {
    console.error(`truss status: failed to load workspace — ${err.message}`)
    process.exit(2)
  }

  // ── Init guard ──────────────────────────────────────────────────────────
  // Mirror doctor's behaviour: a clear message instead of confusing output.
  if (ctx.agentsMissing) {
    console.log(
      '\nThis folder is not a Truss workspace yet. Start with:\n\n' +
      '  node .truss/bin/truss.mjs init\n\n' +
      '  For an existing project, use:  node .truss/bin/truss.mjs init --overlay\n'
    )
    process.exit(0)
  }

  const profileName = ctx.files
    .get('state/profile.md')
    ?.lines.find(line => /^name:\s*\S/.test(line))
    ?.replace(/^name:\s*/, '')
    .trim()
  const projectName = profileName || path.basename(root)
  const currentPhaseId = ctx.phases?.frontmatter?.current || 'unknown'
  const ordered = ctx.phases?.ordered || []
  const position = ordered.indexOf(currentPhaseId) + 1
  const total = ordered.length
  
  // Health is MEASURED here, not remembered. It used to be read from
  // .truss/out/doctor.json — a gitignored cache with no timestamp on screen, so
  // a fresh clone reported "unknown" until someone happened to run `doctor`, and
  // an existing report could contradict a doctor run from a minute earlier
  // without anything saying so. In the one field whose whole job is to be
  // trusted. The checks are re-run instead, off the workspace this command has
  // already loaded: ≈60 ms on top of a command a human runs once per session.
  // Nothing is written — `doctor` owns the report files and the detail output.
  // Exit codes are deliberately unchanged: `doctor` is the gate, `status` is the
  // briefing, and a CI step pinned to `status` must not start failing on a
  // warning it never saw before.
  let doctorSummary
  try {
    const { errors, warnings, infos } = await runAllChecks(ctx)
    const useColor = !!process.stdout.isTTY
    const hint = (errors.length + warnings.length + infos.length) > 0 ? ' — `truss doctor` for detail' : ''
    const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
    if (errors.length > 0)        doctorSummary = (useColor ? `\x1b[31m${n(errors.length, 'error')}\x1b[0m, ${n(warnings.length, 'warning')}` : `${n(errors.length, 'error')}, ${n(warnings.length, 'warning')}`) + hint
    else if (warnings.length > 0) doctorSummary = (useColor ? `\x1b[33m${n(warnings.length, 'warning')}\x1b[0m, ${n(infos.length, 'info')}` : `${n(warnings.length, 'warning')}, ${n(infos.length, 'info')}`) + hint
    else if (infos.length > 0)    doctorSummary = (useColor ? `\x1b[32mAll checks passed\x1b[0m, ${n(infos.length, 'info')}` : `All checks passed, ${n(infos.length, 'info')}`) + hint
    else                          doctorSummary = useColor ? '\x1b[32mAll checks passed\x1b[0m' : 'All checks passed'
  } catch (err) {
    // A health line that lies is worse than one that admits it cannot look.
    doctorSummary = `could not be measured (${err?.message || err}) — run \`truss doctor\``
  }

  const useColorGlobal = !!process.stdout.isTTY
  const boldPrefix = useColorGlobal ? '\x1b[1m' : ''
  const boldSuffix = useColorGlobal ? '\x1b[0m' : ''

  console.log(`\n${boldPrefix}${projectName}${boldSuffix} — truss status\n`)
  // Temporal anchor (D-010): status is the canonical session-start command, and
  // agents have no reliable clock — a current local timestamp lets them judge
  // the age of dates in state files (updated:, Opened:, Date:).
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  console.log(`  Date:    ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (local)`)
  // No state/phases.md at all (U4): the workspace runs without a phase model,
  // so there is no phase to report. Printing `unknown (? / 0)` would describe a
  // supported configuration as a defect. A file that IS present still gets the
  // line — and, when it defines nothing, the F-04 note below.
  const phasesPresent = ctx.files.has('state/phases.md')
  if (phasesPresent) {
    console.log(`  Phase:   ${currentPhaseId} (${total > 0 ? (position > 0 ? position : '?') : '?'} / ${total})`)
  }
  console.log(`  Health:  ${doctorSummary}`)

  // Core-state integrity (F-04): a present-but-unparseable phases.md yielded a
  // silent `unknown (? / 0)` line with exit 0, so a CI step that only ran
  // `status` saw green over a corrupt workspace. Flag it visibly and exit
  // non-zero; `doctor` still gives the detailed findings.
  if (phasesPresent && total === 0) {
    const yel = useColorGlobal ? '\x1b[33m' : '', rst = useColorGlobal ? '\x1b[0m' : ''
    console.log(`  ${yel}Note:${rst}    state/phases.md defines no phases — it may be malformed. Run \`truss doctor\`.`)
    process.exitCode = 1
  }

  // The same hole, entered through a different door (U4). A present-but-
  // UNREADABLE phases.md — chmod 000, a directory at the path, invalid UTF-8 —
  // never reaches ctx.files, so it is indistinguishable here from a workspace
  // that deliberately has no phase model: no Phase line, exit 0. That is F-04's
  // green-over-broken exactly, with a full phases.md sitting on disk. `doctor`
  // separates the two via PH-01; `status` must not merge them either.
  if (!phasesPresent && await pathExists(path.join(root, 'state', 'phases.md'))) {
    const yel = useColorGlobal ? '\x1b[33m' : '', rst = useColorGlobal ? '\x1b[0m' : ''
    console.log(`  ${yel}Note:${rst}    state/phases.md exists but could not be read. Run \`truss doctor\`.`)
    process.exitCode = 1
  }

  // Branch line — only for a configured code root with a readable checkout. The live
  // git read lives here, keeping the doctor checks pure.
  const br = await branchReport(root)
  if (br.present) {
    const codeRoot = br.codeRoot || 'code-root'
    const red = useColorGlobal ? '\x1b[31m' : '', grn = useColorGlobal ? '\x1b[32m' : '', rst = useColorGlobal ? '\x1b[0m' : ''
    let line
    if (br.info.detached) {
      line = `(detached at ${br.info.sha || '?'})` + (br.declared ? ` ${red}✗ declared '${br.declared}'${rst}` : '')
    } else if (!br.info.ok) {
      line = `${codeRoot}/ branch unreadable (${br.info.reason})`
    } else if (br.mismatch) {
      line = `${br.info.branch} ${red}✗ MISMATCH — declared '${br.declared}'${rst}; switch with: git -C ${codeRoot} switch ${br.declared}`
    } else if (br.match) {
      line = `${br.info.branch} ${grn}✓${rst} (declared)`
    } else {
      line = `${br.info.branch} (no 'branch:' declared in current.md)`
    }
    console.log(`  Branch:  ${line}`)
  }

  // Parallel sessions — who else is working in this tree, and what moved since
  // this session last looked (D-101). Like the branch line above, the live git
  // read belongs HERE, in the command layer, so the doctor checks stay pure.
  //
  // Reports only; it never gates and never changes the exit code. Deliberately
  // silent for a single session in a quiet tree: a line that shows up on every
  // run stops being read, and then it is worse than no line at all.
  const parallel = await parallelLines(root, useColorGlobal)
  for (const l of parallel) console.log(l)

  // Domain register — generated, never stored. AGENTS.md §1 step 6 tells an
  // agent to open "the one domain file your task belongs to", and until now
  // nothing said cheaply *which* files those are. This block answers it from
  // the domain files themselves (lib/domains.mjs), so it can never drift the
  // way a hand-kept register would. Silent when the workspace has no domains —
  // the baseline ships without a context/ directory at all.
  for (const l of domainLines(ctx, now)) console.log(l)

  // Recent commits — the workspace repo's own git log (not the code root),
  // replacing the hand-maintained `recently-done:` list current.md used to
  // carry (U6/D-074/D-077): git already has this, current and without upkeep.
  // Silent on any of: no git repo here, no commits yet, git disabled
  // (TRUSS_NO_GIT), or no git binary in PATH — never fails or changes exit.
  const recent = await recentCommits(root, RECENT_COMMITS_MAX)
  if (recent.ok && recent.commits.length > 0) {
    for (const [i, c] of recent.commits.entries()) {
      const label = i === 0 ? '  Recent: ' : '          '
      const subject = c.subject.length > RECENT_SUBJECT_MAX
        ? c.subject.slice(0, RECENT_SUBJECT_MAX - 3) + '…'
        : c.subject
      console.log(`${label} ${c.sha} ${subject}`)
    }
  }

  // Open human todos — the actions only the human can take. Same argument as the
  // Open block below, and the same gap it was built to close: an HT entry sat in
  // a file that nothing reads out, so nothing brought it back into view once the
  // session that wrote it had ended. No age is shown because the class carries no
  // date field; making it visible is what the median-38-day-old entry needed, not
  // a number.
  for (const l of await humanTodoLines(ctx, root, now)) console.log(l)

  // Open decisions — questions parked on the human's desk. status is the canonical
  // session-start command (§4), so this is the one place that guarantees a waiting
  // question is seen. Silent when there are none: an empty open-decisions.md is the
  // correct state of a project with nothing undecided.
  for (const l of openDecisionLines(ctx, now, useColorGlobal)) console.log(l)

  console.log('')
}

// Shown before the "… and N more" line. Deliberately higher than OD_SHOWN_MAX:
// the Open block is a nudge — five waiting questions are already too many, and
// the sixth loses nothing by being counted instead of named. The domain block
// is a *lookup table* ("which file does my task belong to"), so a cut costs the
// reader the answer, not just a reminder. Eight keeps the register inside a
// screen of status output while covering a project that has genuinely split its
// context; past that, state/map.md is the complete list and the overflow line
// says so.
const DOMAINS_SHOWN_MAX = 8
// Same 60-char cutoff as RECENT_SUBJECT_MAX — one line per domain.
const DOMAIN_FOCUS_MAX = 60

/**
 * Render the `Domains:` block: one line per domain with its focus, how many
 * open points it lists, and how long since it was last touched.
 * @returns {string[]} lines to print (empty when the workspace has no domains)
 */
function domainLines(ctx, now) {
  const domains = listDomains(ctx)
  if (domains.length === 0) return []

  // Freshest first — an agenda, not an index. It also makes the DOMAINS_SHOWN_MAX
  // cut meaningful: what falls off is the context nobody has touched in longest,
  // never the file this session is working in. Path order breaks mtime ties so a
  // fresh clone (near-identical mtimes) still prints deterministically.
  const ordered = [...domains].sort((a, b) =>
    (b.stat?.mtimeMs || 0) - (a.stat?.mtimeMs || 0) || a.relPath.localeCompare(b.relPath))

  const out = []
  for (const [n, d] of ordered.slice(0, DOMAINS_SHOWN_MAX).entries()) {
    const label = n === 0 ? '  Domains:' : '          '
    const focus = d.focus.length > DOMAIN_FOCUS_MAX
      ? d.focus.slice(0, DOMAIN_FOCUS_MAX - 3) + '…'
      : d.focus
    const notes = [`${d.next.length} open`]
    if (d.stat) notes.push(`${Math.max(0, Math.floor((now - d.stat.mtimeMs) / 86_400_000))}d`)
    out.push(`${label} ${d.name} — ${focus}  (${notes.join(', ')})`)
  }
  if (ordered.length > DOMAINS_SHOWN_MAX) {
    out.push(`           … and ${ordered.length - DOMAINS_SHOWN_MAX} more in context/ (full list: state/map.md)`)
  }
  return out
}

const HT_SHOWN_MAX = 5
// Same 60-char cutoff the other status blocks use.
const HT_TEXT_MAX = 60

/**
 * Render the `ToDo:` block: the OPEN entries of HUMAN-TODOS.md.
 * Checked-off entries are working memory on their way to the archive (SY-07) and
 * are not shown. Silent when nothing is open.
 * @returns {string[]}
 */
async function humanTodoLines(ctx, root, now) {
  const cls = classById(ctx.schema?.classes, 'HT')
  const ht = fileForClass(ctx, cls)
  if (!cls || !ht) return []

  // `- [ ] HT-NNN — …`; the checkbox fragments are shared with lib/md.mjs so
  // this cannot disagree with SY-07 about what "done" looks like (see D-046),
  // and the ID comes from the class so renaming it in the schema keeps this
  // pointed at the entries instead of switching the block off.
  //
  // WHY THE ID IS PART OF THE MATCH. An entry carries an indented body — steps
  // and two labels (docs/conventions.md) — and a step may well be a checkbox.
  // Matching any `- [ ]` line in the file would list every sub-step of one
  // entry as its own open todo, which is the block's whole point inverted: the
  // human's queue would grow with the detail written into it.
  const anyRe  = new RegExp(`^\\s*[-*]\\s+${CHECKBOX_ANY}\\s+(${cls.id}-\\d{3}\\b.*)$`)
  const doneRe = new RegExp(`^\\s*[-*]\\s+${CHECKBOX_DONE}\\s+${cls.id}-\\d{3}\\b`)

  // Fenced and commented-out lines are examples, not work — the same rule SY-07
  // applies to the same file. Without it a documented `- [ ] HT-NNN — …` inside a
  // code block would be listed here as an open todo on every session start.
  const fenced = ignoredLines(ht.lines)
  const open = []
  for (const [i, line] of ht.lines.entries()) {
    if (fenced.has(i)) continue
    if (doneRe.test(line)) continue
    const m = line.match(anyRe)
    if (m && m[1].trim()) open.push({ text: m[1].trim(), line: i + 1 })
  }
  if (open.length === 0) return []

  // How long each entry has sat untouched, from one `git blame` over the file.
  // Only reached when something is actually open, because blame costs ~70 ms and
  // most workspaces have nothing waiting. An empty map (no git, no checkout,
  // untracked file) simply means no ages are printed — never an error.
  const ages = await fileLineAges(root, ht.relPath)
  const idleDays = (entry) => {
    const at = ages.get(entry.line)
    return at == null ? null : Math.max(0, Math.floor((now - at) / 86_400_000))
  }

  // Longest-idle first. The block is a nudge, and the entry nobody has touched
  // in six weeks is the one it exists for — so it must never be the one the
  // HT_SHOWN_MAX cut drops. Entries without an age keep file order behind the
  // dated ones rather than sorting as if they were fresh.
  const ordered = [...open].sort((a, b) => {
    const da = idleDays(a), db = idleDays(b)
    if (da == null && db == null) return a.line - b.line
    if (da == null) return 1
    if (db == null) return -1
    return db - da || a.line - b.line
  })

  const out = []
  for (const [n, entry] of ordered.slice(0, HT_SHOWN_MAX).entries()) {
    const label = n === 0 ? '  ToDo:   ' : '          '
    // The entry title is written bold so the file reads as a task with a body
    // below it; the terminal has no bold here, so the markers would be four
    // stray asterisks on the session-start screen. Stripped before the cut, so
    // the 60 characters are 60 the human actually sees.
    const text = entry.text.replace(/\*\*/g, '')
    const short = text.length > HT_TEXT_MAX ? text.slice(0, HT_TEXT_MAX - 3) + '…' : text
    const days = idleDays(entry)
    // `idle`, not an age: blame reports the last commit that TOUCHED the line,
    // so re-wording an entry restarts its clock. The OD block one section below
    // prints a real age from `Opened:` — two identical-looking numbers meaning
    // different things is exactly the silent wrongness worth one extra word.
    out.push(`${label} ${short}${days == null ? '' : `  (idle ${days}d)`}`)
  }
  if (open.length > HT_SHOWN_MAX) {
    out.push(`           … and ${open.length - HT_SHOWN_MAX} more in ${ht.relPath}`)
  }
  return out
}

const OD_SHOWN_MAX = 5

/**
 * Render the `Open:` block: one line per open decision with its age, marked when
 * it challenges a recorded decision.
 * @returns {string[]} lines to print (empty when there is nothing open)
 */
function openDecisionLines(ctx, now, useColor) {
  const od = ctx.files.get('state/open-decisions.md')
  if (!od) return []

  // OD-NNN → D-NNN, from the `Challenged-by:` markers in the decision log —
  // split bodies or the legacy single file, whichever this workspace uses.
  const challenges = new Map()
  for (const dec of decisionFilesFrom(ctx)) {
    let currentD = null
    for (const line of dec.lines) {
      const h = line.match(/^##\s+(D-\d{3})\b/)
      if (h) { currentD = h[1]; continue }
      const c = line.match(/^\s*Challenged-by\s*:\s*(.+)$/i)
      if (c && currentD) for (const id of c[1].match(/OD-\d{3}/g) || []) challenges.set(id, currentD)
    }
  }

  const entries = []
  for (let i = 0; i < od.lines.length; i++) {
    const m = od.lines[i].match(/^##\s+(OD-\d{3})\s*[—–-]?\s*(.*)$/)
    if (!m) continue
    let days = null
    for (let j = i + 1; j < od.lines.length && !/^##\s+/.test(od.lines[j]); j++) {
      const o = od.lines[j].match(/^\s*opened:\s*(\d{4}-\d{2}-\d{2})\s*$/i)
      if (o) { days = Math.floor((now - Date.parse(`${o[1]}T00:00:00Z`)) / 86_400_000); break }
    }
    entries.push({ id: m[1], title: m[2].trim(), days, challenges: challenges.get(m[1]) })
  }
  if (entries.length === 0) return []

  const yel = useColor ? '\x1b[33m' : '', rst = useColor ? '\x1b[0m' : ''
  const out = []
  for (const [n, e] of entries.slice(0, OD_SHOWN_MAX).entries()) {
    const label = n === 0 ? '  Open:   ' : '          '
    const notes = []
    if (e.days != null) notes.push(`${e.days}d`)
    if (e.challenges) notes.push(`${yel}challenges ${e.challenges}${rst}`)
    const suffix = notes.length ? `  (${notes.join(', ')})` : ''
    out.push(`${label} ${e.id}${e.title ? ` — ${e.title}` : ''}${suffix}`)
  }
  if (entries.length > OD_SHOWN_MAX) {
    out.push(`           … and ${entries.length - OD_SHOWN_MAX} more in state/open-decisions.md`)
  }
  return out
}

async function pathExists(absPath) {
  try { await fs.access(absPath); return true }
  catch { return false }
}

/**
 * The `Parallel:` block — presence and journal, rendered for `truss status`.
 *
 * Everything git-shaped stays in this command layer (same reason as the branch
 * line): the check engine is hermetic and must not learn to run git.
 *
 * Never throws and never changes the exit code. Returns [] when there is
 * nothing to say, which is the normal case for a single session.
 *
 * @returns {Promise<string[]>} lines to print
 */
async function parallelLines(root, useColor) {
  try {
    // The workspace repo — the tree whose index and HEAD the sessions share.
    const changed = await gitChangedPaths(root)
    const head = await recentCommits(root, 1)
    const obs = await observe(root, {
      head: head.ok ? (head.commits[0]?.sha ?? null) : null,
      dirty: changed.ok ? changed.paths : [],
    })
    const lines = presenceLines(obs, {
      lockAgeMs: await indexLockAge(root),
      gitAvailable: changed.ok,
    })
    if (lines.length === 0) return []

    const yel = useColor ? '\x1b[33m' : '', rst = useColor ? '\x1b[0m' : ''
    return lines.map((l, i) =>
      i === 0 ? `  ${yel}Parallel:${rst} ${l}` : `           ${l}`)
  } catch {
    // A presence layer that can break `truss status` would be worse than none.
    return []
  }
}

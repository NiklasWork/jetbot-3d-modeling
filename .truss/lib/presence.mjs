// lib/presence.mjs — who else is working in this tree, and what moved since you
// last looked.
//
// THE PROBLEM IT SOLVES
// Several agent sessions run at once in ONE working tree, on one branch. Truss
// cannot intercept their writes — it is not a daemon, not a filesystem layer,
// and it must stay tool-agnostic. Two things went wrong in the field: a session
// committed paths that belonged to another session and were still unreviewed,
// and a read-modify-write ran on a state file another session had already
// rewritten. Neither is visible to the session causing it. `git status` is the
// only warning, and it only warns whoever thinks to look.
//
// WHAT THIS DOES — AND DELIBERATELY DOES NOT
// It makes the other session VISIBLE. It does not coordinate, allocate, claim,
// lock, or serialise anything: no lane is reserved, no write is blocked, no
// session is demoted to reader. Visibility is the whole product decision (D-101)
// — everything here is a report, never a gate.
//
// WHY IT CANNOT ROT (crash-only, Candea/Fox 2003)
// There is exactly ONE code path, and it is the recovery path: reading prunes.
// No `truss cleanup`, no shutdown hook, no "tidy up your session" line in
// AGENTS.md — each of those is the rarely-run branch that crash-only design
// exists to remove, and in this workspace it is the L-003 class (a rule whose
// observance hangs on the next session remembering it is not a rule). A hung
// agent keeps its record, which is correct: it IS still present. A killed agent
// loses its record at the next read by anyone.
//
// THE LIVENESS PREDICATE (order matters — modelled on Emacs src/filelock.c)
//   1. foreign host          → do not count it, do not delete it. A shared or
//                              synced directory cannot be judged from here.
//   2. unreadable / no name  → delete. rename() only ever publishes complete
//                              files, so a truncated record cannot be legitimate.
//   3. foreign boot epoch    → delete. This is what catches a pid reused across
//                              a reboot, and it needs no process lookup at all.
//   4. it is my own host pid → alive.
//   5. process.kill(pid, 0)  → alive on success AND on EPERM. EPERM means "the
//                              process exists but belongs to another user";
//                              reading it as dead would UNDER-report other
//                              sessions, and under-reporting is the dangerous
//                              direction here. ESRCH → delete.
//   6. start time mismatch   → delete (pid reused inside one boot, POSIX only).
//
// WHY THE BOOT EPOCH IS COMPUTED, NOT READ
// `Math.floor(Date.now()/1000 - os.uptime())` yields the same boot second as
// `sysctl -n kern.boottime` / `/proc/sys/kernel/random/boot_id`, costs ~0.02 ms
// instead of ~2.3 ms, needs no subprocess, and works on Windows — where `ps`
// does not exist at all. The tolerance below absorbs suspend and NTP drift.
//
// IDENTITY, AND WHY IT MAY BE ABSENT
// A session is identified by its long-lived HOST process: walk up from this
// process and take the first ancestor that is not a shell. Shells are skipped;
// `node` deliberately is NOT — skipping it would collapse several node-based
// agent hosts onto their shared terminal, i.e. under-report. Where `ps` is
// unavailable (Windows) there is no reliable identity, and then this module
// reports NO session count at all rather than a wrong one. The journal half
// still works, because it only ever compares a session against its own
// previous run.
//
// STORAGE
// `.truss/out/presence/*.json` — runtime output next to doctor.json, gitignored
// like it (precedent: lib/context-ack.mjs). Gitignored is not cosmetic: a
// coordination file inside the tracked tree gets committed by accident, which is
// exactly the incident class this module reports on.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CONTEXT_FILES } from './context-budget.mjs'

const execFileP = promisify(execFile)

/** Directory holding the per-session records, relative to the workspace root. */
export const PRESENCE_REL_DIR = path.join('.truss', 'out', 'presence')

/**
 * Seconds of slack when comparing boot epochs.
 *
 * `os.uptime()` drifts across suspend/resume and NTP steps, so two live sessions
 * on one machine can compute boot seconds a little apart. The asymmetry decides
 * the value: too TIGHT and a live session's record is deleted as "foreign
 * epoch", which under-reports — the dangerous direction. Too loose only lets a
 * pid recycled shortly after a reboot look alive, and step 6 catches that on
 * POSIX anyway. So this errs generous on purpose.
 */
export const EPOCH_TOLERANCE_S = 300

/** Shells to walk through when looking for the agent host. `node` is NOT here — see header. */
const SHELLS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'fish', 'csh', 'tcsh', 'ksh',
  '-sh', '-bash', '-zsh', '-dash', '-fish', '-csh', '-tcsh', '-ksh',
])

/** How far up the process tree to look before giving up. */
const MAX_ANCESTRY_DEPTH = 8

/** Above this many records, skip the per-record start-time re-check (step 6). */
const START_RECHECK_MAX = 8

const CURRENT_VERSION = 1

/** Environment markers that name the agent host. Order is not significant — first hit wins. */
const TOOL_ENV = [
  ['CLAUDECODE', 'claude-code'], ['CLAUDE_CODE', 'claude-code'],
  ['CURSOR_AGENT', 'cursor'], ['CURSOR_TRACE_ID', 'cursor'],
  ['CODEX_THREAD_ID', 'codex'], ['CODEX_SANDBOX', 'codex'],
  ['GEMINI_CLI', 'gemini-cli'], ['CLINE_ACTIVE', 'cline'],
  ['COPILOT_MODEL', 'copilot'], ['COPILOT_GITHUB_TOKEN', 'copilot'],
  ['OPENCODE_CLIENT', 'opencode'], ['AIDER_MODEL', 'aider'],
]

/** The boot second of this machine. Pure arithmetic, no subprocess, cross-platform. */
export function bootEpoch() {
  return Math.floor(Date.now() / 1000 - os.uptime())
}

/**
 * Is this pid a live process?
 *
 * EPERM counts as ALIVE: the process exists, it simply belongs to another user.
 * A naive `try { kill } catch { dead }` would bury every other user's session,
 * and missing a session is worse here than inventing one.
 */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (err) { return err?.code === 'EPERM' }
}

/** Which agent host is running us, if it says so. Never throws. */
function toolFromEnv() {
  for (const [key, name] of TOOL_ENV) if (process.env[key]) return name
  return null
}

/** `ps -o <fields> -p <pid>`, trimmed, or null. Never throws. */
async function ps(fields, pid) {
  try {
    const { stdout } = await execFileP('ps', ['-o', fields, '-p', String(pid)], { timeout: 2000 })
    return stdout.trim() || null
  } catch { return null }
}

/** Start time of a pid as an opaque string (POSIX only), or null. */
async function startTime(pid) {
  return await ps('lstart=', pid)
}

/**
 * The long-lived agent host behind this CLI invocation.
 *
 * @returns {Promise<{pid:number, comm:string, start:string|null}|null>}
 *   null when the process tree cannot be read (no `ps`, i.e. Windows). Callers
 *   MUST treat null as "identity unknown" and suppress any session count —
 *   never as "one session".
 */
export async function hostProcess() {
  let pid = process.ppid
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
    const line = await ps('ppid=,comm=', pid)
    if (!line) return null
    const sp = line.search(/\s/)
    if (sp === -1) return null
    const ppid = Number(line.slice(0, sp).trim())
    const comm = line.slice(sp + 1).trim()
    if (!comm) return null
    if (!SHELLS.has(path.basename(comm))) {
      return { pid, comm: path.basename(comm), start: await startTime(pid) }
    }
    if (!Number.isInteger(ppid) || ppid <= 1) return null
    pid = ppid
  }
  return null
}

/** Filename-safe hostname. */
const safeHost = () => (os.hostname() || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')

/**
 * Hash the boot-context files (CONTEXT_FILES — the same list CX-01 measures, so
 * there is no second truth about what "core state" means).
 *
 * Hash, not mtime: mtime is wrong in both directions — an editor touch with no
 * content change raises a false alarm, and a false alarm is what turns this line
 * into noise nobody reads. Measured cost of hashing over mtime: 0.76 ms, i.e.
 * 0.3 % of a `truss status` run. There is no trade-off to make at that price.
 */
export async function coreSnapshot(root) {
  const core = {}
  for (const rel of CONTEXT_FILES) {
    try {
      const buf = await fs.readFile(path.join(root, rel))
      core[rel] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    } catch { /* absent file is a legitimate state, not an entry */ }
  }
  return core
}

/** Path of one session's record. */
const recordPath = (root, pid) => path.join(root, PRESENCE_REL_DIR, `${safeHost()}__${pid}.json`)

/**
 * Read every record, pruning the dead ones on the way through.
 *
 * This is the ONLY place records are removed — reading is the cleanup, so there
 * is no command anyone could forget to run. Never throws: a presence layer that
 * can break `truss status` would be worse than no presence layer.
 *
 * @returns {Promise<{live: object[], foreignHost: number, pruned: number}>}
 *   `live` excludes records from other hosts (they cannot be judged from here).
 */
export async function readPresence(root, self = null) {
  const dir = path.join(root, PRESENCE_REL_DIR)
  const out = { live: [], foreignHost: 0, pruned: 0 }
  let names
  try { names = await fs.readdir(dir) } catch { return out }

  const host = os.hostname()
  const boot = bootEpoch()
  const drop = async (p) => {
    try { await fs.unlink(p); out.pruned++ } catch { /* a concurrent reader got there first */ }
  }

  const candidates = []
  for (const name of names) {
    const full = path.join(dir, name)
    if (!name.endsWith('.json')) { await drop(full); continue }   // .tmp leftovers and stray files

    let rec
    try { rec = JSON.parse(await fs.readFile(full, 'utf8')) } catch { await drop(full); continue }
    // rename() only ever publishes a complete record, so anything missing a
    // required field cannot have been written by this code — it is provably junk.
    if (!rec || typeof rec !== 'object' || !Number.isInteger(rec.pid) || typeof rec.host !== 'string') {
      await drop(full); continue
    }
    if (rec.host !== host) { out.foreignHost++; continue }        // step 1: never judge, never delete
    if (!Number.isInteger(rec.boot) || Math.abs(rec.boot - boot) > EPOCH_TOLERANCE_S) {
      await drop(full); continue                                  // step 3: foreign epoch
    }
    if (self && rec.pid === self.pid) { out.live.push({ ...rec, self: true }); continue }  // step 4
    if (!alive(rec.pid)) { await drop(full); continue }           // step 5
    candidates.push({ rec, full })
  }

  // Step 6 — pid reuse WITHIN one boot. One `ps` per candidate, so it is capped:
  // past the cap the boot epoch alone is accepted, which can only over-report.
  const recheck = candidates.length <= START_RECHECK_MAX
  for (const { rec, full } of candidates) {
    if (recheck && rec.start) {
      const now = await startTime(rec.pid)
      if (now && now !== rec.start) { await drop(full); continue }
    }
    out.live.push(rec)
  }
  return out
}

/**
 * Write this session's record: presence and read-state in one artefact.
 *
 * tmp + rename, so a reader never sees half a record and a crash mid-write
 * leaves at most a .tmp file that the next read removes.
 *
 * `first` is kept from the session's FIRST run and never updated — it is what
 * lets a later run say "this path was already in the tree when you started",
 * which is a checkable fact, unlike "this path belongs to someone else".
 *
 * Never throws: a read-only or full disk must not break `truss status`.
 */
export async function writePresence(root, self, { head = null, dirty = [], core = {}, previous = null } = {}) {
  if (!self) return null
  const now = new Date().toISOString()
  const record = {
    v: CURRENT_VERSION,
    host: os.hostname(),
    boot: bootEpoch(),
    pid: self.pid,
    comm: self.comm,
    start: self.start ?? null,
    tool: toolFromEnv(),
    started: previous?.started ?? now,
    seen: now,
    first: previous?.first ?? { dirty: [...dirty] },
    snapshot: { head, dirty: [...dirty], core },
  }
  const dir = path.join(root, PRESENCE_REL_DIR)
  const dst = recordPath(root, self.pid)
  const tmp = `${dst}.${process.pid}.tmp`
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(record) + '\n', 'utf8')
    await fs.rename(tmp, dst)
  } catch {
    try { await fs.unlink(tmp) } catch { /* nothing to undo */ }
    return null
  }
  return record
}

/**
 * What changed since THIS session's previous run — never "since someone else's".
 *
 * @returns {{coreChanged: string[], headMoved: {from: string, to: string}|null,
 *            preexisting: string[], minutes: number|null}}
 */
export function journalDiff(previous, { head = null, dirty = [], core = {} } = {}) {
  const empty = { coreChanged: [], headMoved: null, preexisting: [], minutes: null }
  if (!previous?.snapshot) return empty

  const prev = previous.snapshot
  const coreChanged = Object.keys({ ...prev.core, ...core })
    .filter(rel => (prev.core?.[rel] ?? null) !== (core?.[rel] ?? null))
    .sort()

  const headMoved = prev.head && head && prev.head !== head ? { from: prev.head, to: head } : null

  // Paths that were already dirty when this session first ran and still are.
  // Deliberately NOT called "someone else's": it may be this session's own older
  // work, and Truss cannot tell. What it CAN say is when the path appeared.
  const firstDirty = new Set(previous.first?.dirty ?? [])
  const preexisting = dirty.filter(p => firstDirty.has(p)).sort()

  let minutes = null
  const seen = Date.parse(previous.seen ?? '')
  if (Number.isFinite(seen)) minutes = Math.max(0, Math.round((Date.now() - seen) / 60000))

  return { coreChanged, headMoved, preexisting, minutes }
}

/**
 * Everything the CLI needs, in one call: prune, read, diff, write.
 *
 * Never throws and never changes an exit code — the caller prints `lines` and
 * carries on. `sessions` is null when identity could not be established, which
 * the caller MUST render as "unknown", not as "one".
 *
 * @returns {Promise<{sessions: number|null, others: object[], diff: object,
 *                    identity: boolean, foreignHost: number}>}
 */
export async function observe(root, { head = null, dirty = [] } = {}) {
  if (process.env.TRUSS_NO_PRESENCE) {
    return { sessions: null, others: [], diff: journalDiff(null), identity: false, foreignHost: 0 }
  }
  try {
    const self = await hostProcess()
    const core = await coreSnapshot(root)
    const { live, foreignHost } = await readPresence(root, self)
    const previous = self ? live.find(r => r.pid === self.pid) ?? null : null
    const diff = journalDiff(previous, { head, dirty, core })
    await writePresence(root, self, { head, dirty, core, previous })
    const others = live.filter(r => !self || r.pid !== self.pid)
    return {
      sessions: self ? others.length + 1 : null,
      others,
      diff,
      identity: !!self,
      foreignHost,
    }
  } catch {
    return { sessions: null, others: [], diff: journalDiff(null), identity: false, foreignHost: 0 }
  }
}

/**
 * Render the report block.
 *
 * Form is not decoration here. Every line names the PLACE, the OBSERVED VALUE
 * and the ALLOWED ALTERNATIVE, because a message shaped that way is followed far
 * more often than a bare diagnostic or a prohibition — and it is phrased as
 * something to DO, never as something to refrain from ("commit with X", not
 * "never use git add -A"): rules that add an action are followed; rules that ask
 * for restraint are not, whatever their wording.
 *
 * Silence is a feature. With one session and nothing moved this returns [] — a
 * line that appears on every run stops being read, and then it is worse than no
 * line at all.
 *
 * @param {object} obs        result of observe()
 * @param {{lockAgeMs: number|null, gitAvailable: boolean}} extra
 */
export function presenceLines(obs, { lockAgeMs = null, gitAvailable = true } = {}) {
  const lines = []
  const multi = (obs.sessions ?? 1) > 1

  if (multi) {
    const who = obs.others
      .map(r => `${r.tool || r.comm || 'session'}(${r.pid})${ageOf(r.started)}`)
      .join(', ')
    lines.push(`${obs.sessions} sessions live in this tree — also: ${who}`)
  }

  const { preexisting, coreChanged, headMoved, minutes } = obs.diff

  if (multi && gitAvailable && preexisting.length > 0) {
    const shown = preexisting.slice(0, 4).join(', ')
    const more = preexisting.length > 4 ? `, +${preexisting.length - 4} more` : ''
    lines.push(`Already uncommitted before your session began: ${shown}${more}`)
    lines.push(`  → stage by path: git commit -- <the paths you changed>   (git add -A takes these too)`)
  }

  if (coreChanged.length > 0 || headMoved) {
    const since = minutes === null ? '' : ` (${minutes} min)`
    const what = []
    if (headMoved) what.push(`HEAD ${headMoved.from} → ${headMoved.to}`)
    if (coreChanged.length) what.push(coreChanged.join(', '))
    lines.push(`Changed since your last truss run${since}: ${what.join('; ')}`)
    if (coreChanged.length) lines.push(`  → re-read those files before you rewrite them`)
  }

  if (lockAgeMs !== null) {
    const secs = Math.max(0, Math.round(lockAgeMs / 1000))
    lines.push(`.git/index.lock exists, ${secs}s old${multi ? ` — ${obs.sessions} sessions live` : ''}`)
    // git's own message suggests deleting the lock. That advice is written for one
    // person at one machine; with a second session in the tree it destroys the
    // other process's write. Give the positive action instead, and an exit.
    lines.push(`  → wait ~2s and repeat your git command; do not delete the lock`)
    lines.push(`  → after three tries, say so and continue without committing`)
  }

  return lines
}

/** " since 2h10" / " since 12min" — cheap, and absent when unparseable. */
function ageOf(iso) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((Date.now() - t) / 60000))
  return min >= 60 ? ` since ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : ` since ${min}min`
}

/**
 * Age of `<repo>/.git/index.lock`, or null when absent/unreadable.
 * A pure fs read — deliberately not a git call, so it cannot queue behind the
 * very lock it is reporting on.
 */
export async function indexLockAge(repoDir) {
  try {
    const st = await fs.stat(path.join(repoDir, '.git', 'index.lock'))
    return Math.max(0, Date.now() - st.mtimeMs)
  } catch { return null }
}

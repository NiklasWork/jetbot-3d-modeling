// .truss/tests/init.test.mjs — WP-INIT tests (`truss init`)
// Run with: node --test .truss/tests/init.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { runInit, parseInitArgs, stripFindings, InitError } from '../lib/commands/init.mjs'
import { parsePhases, parseBlocks } from '../lib/md.mjs'
import { renderNoPhasesBlock } from '../lib/render.mjs'
import { makeRoot, runChecks, errorsOf, exists, read } from './helpers.mjs'

async function phaseBlockOf(root) {
  const blocks = parseBlocks((await read(root, 'AGENTS.md')).split('\n'))
  return (blocks.get('phase')?.innerLines ?? []).join('\n')
}

describe('parseInitArgs', () => {
  it('parses spaced and = forms', () => {
    assert.deepEqual(parseInitArgs(['--name', 'A', '--lang', 'English']),
      { name: 'A', lang: 'English', overlay: false, noPhases: false, codeRoot: null, adoptAgents: false, root: null, skills: null, findings: true })
    assert.deepEqual(parseInitArgs(['--name=A B', '--overlay']),
      { name: 'A B', lang: null, overlay: true, noPhases: false, codeRoot: null, adoptAgents: false, root: null, skills: null, findings: true })
  })
  it('rejects the retired --repo flag (D-059 — init never places the code)', () => {
    assert.throws(() => parseInitArgs(['--overlay', '--repo', '/p/code']), InitError)
    assert.throws(() => parseInitArgs(['--overlay', '--repo=https://x/y.git']), InitError)
  })
  it('parses --root (spaced and =)', () => {
    assert.equal(parseInitArgs(['--root', '/p/ws']).root, '/p/ws')
    assert.equal(parseInitArgs(['--root=/p/ws']).root, '/p/ws')
    assert.throws(() => parseInitArgs(['--root']), InitError)
  })
  it('parses and validates --code-root', () => {
    assert.equal(
      parseInitArgs(['--overlay', '--code-root', 'product/source/']).codeRoot,
      'product/source',
    )
    assert.throws(() => parseInitArgs(['--code-root', 'product']), InitError)
    assert.throws(() => parseInitArgs(['--overlay', '--code-root', '../code']), InitError)
  })
  it('parses explicit AGENTS.md adoption', () => {
    assert.equal(parseInitArgs(['--adopt-agents']).adoptAgents, true)
  })
  it('parses skill selection', () => {
    assert.equal(parseInitArgs(['--skills', 'superpowers,ecc']).skills, 'superpowers,ecc')
    assert.equal(parseInitArgs(['--skills=none']).skills, 'none')
    assert.equal(parseInitArgs(['--findings', 'off']).findings, false)
    assert.equal(parseInitArgs(['--findings=off']).findings, false)
    assert.equal(parseInitArgs(['--findings=on']).findings, true)
    assert.throws(() => parseInitArgs(['--findings', 'maybe']), InitError)
  })
  it('throws on unknown flag', () => {
    assert.throws(() => parseInitArgs(['--bogus']), InitError)
  })
  it('rejects a missing or flag-like value (N-4)', () => {
    assert.throws(() => parseInitArgs(['--lang']), InitError)
    assert.throws(() => parseInitArgs(['--name', '--overlay']), InitError)
    assert.throws(() => parseInitArgs(['--name']), InitError)
  })
})

describe('init — the §1 scaffold set', () => {
  // D-035: what the §1 load order names ships with the workspace; everything else
  // is on demand. open-decisions.md is the one that was wrongly cut (D-028 part 3)
  // and is the reason this rule is now written down and tested.
  it('creates every §1 file and none of the on-demand ones', async () => {
    const root = await makeRoot('truss-init-scaffold-')
    await runInit(root, ['--name', 'Scaffold', '--lang', 'English'])

    for (const rel of ['AGENTS.md', 'VISION.md', 'state/current.md',
                       'state/open-decisions.md', 'state/profile.md', 'state/phases.md']) {
      await assert.doesNotReject(() => read(root, rel), `§1 file ${rel} must be scaffolded`)
    }
    for (const rel of ['state/risks.md', 'state/learnings.md', 'HUMAN-TODOS.md']) {
      await assert.rejects(() => read(root, rel), `${rel} must stay on demand`)
    }
  })

  it('ships open-decisions.md with the entry template the checks parse', async () => {
    const root = await makeRoot('truss-init-od-')
    await runInit(root, ['--name', 'Template', '--lang', 'English'])
    const od = await read(root, 'state/open-decisions.md')

    // The file is usually empty, so it cannot teach its grammar by example — the
    // template lives in the header instead (extends D-031 to always-empty files).
    assert.match(od, /## OD-NNN — \[question title\]/)
    assert.match(od, /Opened: YYYY-MM-DD/)
    assert.match(od, /\(recommended\)/)
    assert.match(od, /\+\[upside\] \/ –\[downside\]/)
    // …and the template must not itself trip the grammar checks.
    const findings = await runChecks(root)
    assert.equal(findings.filter(f => f.file === 'state/open-decisions.md').length, 0)
  })
})

describe('init (core)', () => {
  it('scaffolds a clean, doctor-green core instance', async () => {
    const root = await makeRoot('truss-init-core-')
    const res = await runInit(root, ['--name', 'Acme', '--lang', 'English'])

    // phases.md = the core seed: ONE real phase, whose job is to write the plan
    const phases = parsePhases((await read(root, 'state/phases.md')).split('\n'))
    assert.equal(phases.frontmatter.current, 'kickoff')
    assert.deepEqual(phases.ordered, ['kickoff'])

    // placeholder substitution
    const profile = await read(root, 'state/profile.md')
    assert.match(profile, /name: Acme/)
    assert.match(profile, /language: English/)
    assert.match(await read(root, 'VISION.md'), /Acme/)

    // rendered blocks (D-028: all preferences off → empty block + phase 1/1)
    const agents = await read(root, 'AGENTS.md')
    assert.doesNotMatch(agents, /- [\w-]+=\w+ ::/)
    assert.match(agents, /all preferences off/)
    assert.match(await phaseBlockOf(root), /\*\*Phase 1\/1 — kickoff/)

    assert.equal(res.conflicts.length, 0)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  describe('init --skills', () => {
    it('installs no skill or agent assets for none but preserves provenance', async () => {
      const root = await makeRoot('truss-init-skills-none-')
      await runInit(root, ['--name', 'None', '--lang', 'English', '--skills', 'none'])
      const fs = await import('node:fs/promises')
      const path = await import('node:path')

      await assert.doesNotReject(() => fs.access(path.join(root, '.claude', 'SOURCES.md')))
      await assert.rejects(fs.access(path.join(root, '.claude', 'skills')))
      await assert.rejects(fs.access(path.join(root, '.claude', 'agents')))
    })

    it('installs nothing when --skills is omitted (D-069 default) and records an empty selection', async () => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const root = await makeRoot('truss-init-skills-default-')
      const res = await runInit(root, ['--name', 'Default', '--lang', 'English'])

      assert.deepEqual(res.skills, [])
      await assert.rejects(fs.access(path.join(root, '.claude', 'skills')))
      await assert.rejects(fs.access(path.join(root, '.claude', 'agents')))
      assert.deepEqual(JSON.parse(await read(root, '.claude/.truss-skills.json')), { groups: [] })
    })

    it('installs all groups with --skills all and selected groups on request', async () => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const allRoot = await makeRoot('truss-init-skills-all-')
      await runInit(allRoot, ['--name', 'All', '--lang', 'English', '--skills', 'all'])
      await assert.doesNotReject(() => fs.access(path.join(allRoot, '.claude', 'skills', 'marketing-seo-audit')))
      await assert.doesNotReject(() => fs.access(path.join(allRoot, '.claude', 'agents', 'ecc-architect.md')))

      const selectedRoot = await makeRoot('truss-init-skills-selected-')
      await runInit(selectedRoot, ['--name', 'Selected', '--lang', 'English', '--skills', 'superpowers,ecc'])
      await assert.doesNotReject(() => fs.access(path.join(selectedRoot, '.claude', 'skills', 'superpowers-brainstorming')))
      await assert.doesNotReject(() => fs.access(path.join(selectedRoot, '.claude', 'agents', 'ecc-architect.md')))
      await assert.rejects(fs.access(path.join(selectedRoot, '.claude', 'skills', 'marketing-seo-audit')))
      await assert.rejects(fs.access(path.join(selectedRoot, '.claude', 'agents', 'anthropic-code-architect.md')))
    })
  })
})

describe('init --findings', () => {
  it('mentions the findings channel by default and keeps it on demand', async () => {
    const root = await makeRoot('truss-init-findings-on-')
    const res = await runInit(root, ['--name', 'FOn', '--lang', 'English'])

    assert.equal(res.findings, 'on')
    assert.match(await read(root, 'AGENTS.md'), /state\/truss-findings\.md/)
    assert.match(await read(root, 'AGENTS.md'), /TF-NNN truss findings/)
    assert.match(await read(root, 'docs/conventions.md'), /### TF-NNN/)
    await assert.rejects(() => read(root, 'state/truss-findings.md'), 'the file stays on demand')
  })

  it('omits every mention when off and stays doctor-green', async () => {
    const root = await makeRoot('truss-init-findings-off-')
    const res = await runInit(root, ['--name', 'FOff', '--lang', 'English', '--findings', 'off'])

    assert.equal(res.findings, 'off')
    for (const rel of ['AGENTS.md', 'docs/conventions.md']) {
      const content = await read(root, rel)
      assert.doesNotMatch(content, /truss-findings/, `${rel} must not mention the channel`)
      assert.doesNotMatch(content, /TF-/, `${rel} must not reference TF ids`)
    }
    assert.doesNotMatch(await read(root, 'docs/conventions.md'), /## Profile[\s\S]*### TF-NNN/, 'no stray grammar block left behind')
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('refuses to leave remnants when the baseline drifts out of the stripping contract', () => {
    const baseline = [
      '| state/learnings.md (on demand) | A | systemic weaknesses |',
      '| state/truss-findings.md (on demand) | A | friction with Truss itself |',
      '',
      'IDs: L-NNN learnings · TF-NNN truss findings — sequential, never reused.',
      'writing your first D-/R-/L-/TF- entry or a new file type this session',
      '### TF-NNN — Truss finding (upstream feedback)',
      '',
      '```markdown',
      '## TF-NNN — [short finding title]',
      '```',
      '',
      '## Profile',
    ].join('\n') + '\n'
    const clean = stripFindings(baseline)
    assert.doesNotMatch(clean, /truss-findings|TF-/, 'every mention must go')
    assert.match(clean, /## Profile/, 'the anchor heading must survive')
    // Drift in any of the three exact-match spots must fail loudly, not silently:
    for (const drifted of [
      baseline.replace(' · ', '\t'),                       // IDs fragment changed
      baseline.replace('D-/R-/L-/TF-', 'D-/R-/L- /TF-'),   // §6 fragment changed
      `${baseline}\n\nstray reference to TF-001`,          // remnant added elsewhere
    ]) {
      assert.throws(() => stripFindings(drifted), InitError)
    }
  })
})

describe('init --no-phases (U4)', () => {
  it('scaffolds no state/phases.md, writes the notice block, and stays clean', async () => {
    const root = await makeRoot('truss-init-nophases-')
    const res = await runInit(root, ['--name', 'NP', '--lang', 'English', '--no-phases'])

    assert.equal(await exists(root, 'state/phases.md'), false, 'the file must not be scaffolded')
    assert.match(res.currentPhase, /none/, 'the report must not claim a current phase')
    assert.equal(await phaseBlockOf(root), renderNoPhasesBlock().join('\n'),
      'the phase block must carry exactly the canonical notice')
    // The whole point: no findings at all — not a suppressed error, silence.
    assert.deepEqual(await runChecks(root), [],
      'a workspace without a phase model must be completely silent')
  })

  it('leaves the default alone — init without the flag still installs phases (E8)', async () => {
    const root = await makeRoot('truss-init-phases-default-')
    await runInit(root, ['--name', 'DP', '--lang', 'English'])

    assert.equal(await exists(root, 'state/phases.md'), true)
    assert.match(await phaseBlockOf(root), /^> Rendered \d{4}-\d{2}-\d{2}T\d{2}:\d{2} from `state\/phases\.md`/)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('refuses rather than deleting an existing phases.md', async () => {
    const root = await makeRoot('truss-init-nophases-conflict-')
    await runInit(root, ['--name', 'C', '--lang', 'English'])
    await assert.rejects(
      runInit(root, ['--name', 'C', '--lang', 'English', '--no-phases']),
      /state\/phases\.md already exists|already/,
    )
    assert.equal(await exists(root, 'state/phases.md'), true, 'the existing file must survive')
  })
})

describe('init --overlay', () => {
  it('uses ingest→operate phases and adds repo/ to .gitignore', async () => {
    const root = await makeRoot('truss-init-overlay-')
    await runInit(root, ['--name', 'Legacy', '--lang', 'English', '--overlay'])

    const phases = parsePhases((await read(root, 'state/phases.md')).split('\n'))
    assert.equal(phases.frontmatter.current, 'ingest')
    assert.deepEqual(phases.ordered, ['ingest', 'operate'])
    assert.match(await read(root, '.gitignore'), /repo\//)
    assert.match(await phaseBlockOf(root), /\*\*Phase 1\/2 — ingest/)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('leaves repo/ to the human and stays doctor-clean until it exists (D-059)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-repo-')
    const res = await runInit(root, ['--name', 'Legacy', '--lang', 'English', '--overlay'])

    assert.equal(res.repo, undefined, 'init reports no repo placement any more')
    await assert.rejects(fs.lstat(path.join(root, 'repo')), 'init created nothing under repo/')
    assert.match(
      await read(root, '.gitignore'),
      /repo\//,
      'the overlay still gitignores the destination it documents',
    )
    assert.equal(errorsOf(await runChecks(root)).length, 0)

    // …and the documented placement command produces a clean overlay too.
    await fs.mkdir(path.join(root, 'repo'))
    await fs.writeFile(path.join(root, 'repo', 'index.js'), '// code\n')
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('uses an existing configured code root without moving or ignoring it', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-code-root-')
    await fs.mkdir(path.join(root, 'truss'))
    await fs.writeFile(path.join(root, 'truss', 'index.js'), '// product\n')

    const res = await runInit(root, [
      '--name', 'Truss Dev', '--lang', 'English', '--overlay',
      '--code-root', 'truss',
    ])

    assert.equal(res.codeRoot, 'truss')
    assert.equal(res.codeRootReady, true)
    assert.match(await read(root, 'state/profile.md'), /^code-root: truss$/m)
    assert.match(await read(root, 'AGENTS.md'), /^\| truss\/ \(on demand\) \|/m)
    assert.match(await read(root, 'state/phases.md'), /forbidden-globs: truss\/\*\*/)
    assert.doesNotMatch(await read(root, 'state/phases.md'), /forbidden-globs: repo\/\*\*/)
    assert.doesNotMatch(await read(root, '.gitignore'), /(?:^|\n)truss\/(?:\n|$)/)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('rejects a missing configured code root before writing', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-code-root-missing-')
    await assert.rejects(
      runInit(root, [
        '--name', 'Missing', '--lang', 'English', '--overlay',
        '--code-root', 'missing',
      ]),
      /does not exist/,
    )
    await assert.rejects(fs.access(path.join(root, 'VISION.md')))
  })
})

describe('init no-overwrite & pre-flight', () => {
  it('refuses to re-init an already-initialised workspace', async () => {
    const root = await makeRoot('truss-init-reinit-')
    await runInit(root, ['--name', 'A', '--lang', 'English'])
    // Both spellings must hit the AGENTS.md already-initialised check. Since
    // D-069 every init writes .claude/.truss-skills.json, so the bare re-run is
    // the case that regressed once and must stay covered.
    await assert.rejects(runInit(root, ['--name', 'B', '--lang', 'English']), /already looks initialised/i)
    await assert.rejects(
      runInit(root, ['--name', 'B', '--lang', 'English', '--skills', 'all']),
      /already looks initialised/i,
    )
  })

  it('preserves a pre-existing file on partial re-run and reports it as a conflict', async () => {
    const root = await makeRoot('truss-init-partial-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.writeFile(path.join(root, 'VISION.md'), '# custom vision\n')
    const res = await runInit(root, ['--name', 'A', '--lang', 'English'])
    assert.ok(res.conflicts.some(p => p.endsWith('VISION.md')), 'pre-existing file reported as conflict')
    assert.equal(await read(root, 'VISION.md'), '# custom vision\n', 'pre-existing file untouched')
  })

  it('rejects a marker-free AGENTS.md before writing anything', async () => {
    const root = await makeRoot('truss-init-agents-refuse-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# Existing instructions\n')
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English']),
      /--adopt-agents/
    )
    await assert.rejects(fs.access(path.join(root, 'VISION.md')))
    assert.equal(await read(root, 'AGENTS.md'), '# Existing instructions\n')
  })

  it('adopts a marker-free AGENTS.md only with explicit opt-in', async () => {
    const root = await makeRoot('truss-init-agents-adopt-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# Existing instructions\n\nKeep this rule.\n')
    const res = await runInit(root, ['--name', 'A', '--lang', 'English', '--adopt-agents'])
    const agents = await read(root, 'AGENTS.md')
    assert.match(agents, /^# Existing instructions/)
    assert.match(agents, /Keep this rule\./)
    assert.match(agents, /<!-- truss:begin phase -->/)
    assert.equal(res.adoptedAgents, true)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })

  it('merges repo/ into an existing overlay .gitignore', async () => {
    const root = await makeRoot('truss-init-gitignore-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n')
    await runInit(root, ['--name', 'A', '--lang', 'English', '--overlay'])
    assert.equal(await read(root, '.gitignore'), 'dist/\nrepo/\n')
  })

  it('rejects destination parent blockers during preflight', async () => {
    const root = await makeRoot('truss-init-preflight-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.writeFile(path.join(root, 'docs'), 'blocks the baseline directory\n')
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English']),
      /preflight failed/
    )
    await assert.rejects(fs.access(path.join(root, 'VISION.md')))
    await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
    assert.equal(await read(root, 'docs'), 'blocks the baseline directory\n')
  })

  it('rejects an invalid generated-map target and can retry cleanly', async () => {
    const root = await makeRoot('truss-init-map-preflight-')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const blocker = path.join(root, 'state', 'map.md')
    await fs.mkdir(blocker, { recursive: true })
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English']),
      /preflight failed/
    )
    await assert.rejects(fs.access(path.join(root, 'VISION.md')))
    await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
    await fs.rm(blocker, { recursive: true, force: true })
    const res = await runInit(root, ['--name', 'A', '--lang', 'English'])
    assert.equal(res.currentPhase, 'kickoff')
  })
})

describe('init missing args (non-TTY)', () => {
  it('errors instead of hanging when name/lang are missing', async () => {
    const root = await makeRoot('truss-init-missing-')
    await assert.rejects(runInit(root, ['--name', 'only']), InitError)
  })
})

describe('init root separation (D-024 / OD-005)', () => {
  it('refuses a --root target without its own engine and writes nothing', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const root = await makeRoot('truss-init-engine-')
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-init-target-'))
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English', '--root', target]),
      /no \.truss\/ engine/,
    )
    // Neither the target nor the engine's own directory was scaffolded.
    assert.deepEqual(await fs.readdir(target), [])
    await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
  })

  it('refuses when the CLI cwd (invokedCwd) is a foreign engine-less directory', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const root = await makeRoot('truss-init-engine-')
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-init-cwd-'))
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English'], cwd),
      /no \.truss\/ engine/,
    )
    await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
  })

  it('refuses on engine version mismatch between caller and target', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-engine-')
    const target = await makeRoot('truss-init-target-')
    await fs.writeFile(path.join(target, '.truss', 'VERSION'), '0.0.0-other\n', 'utf8')
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English', '--root', target]),
      /version mismatch/,
    )
    await assert.rejects(fs.access(path.join(target, 'AGENTS.md')))
  })

  it('refuses when the target engine has no VERSION (partial copy)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-engine-')
    const target = await makeRoot('truss-init-target-')
    await fs.rm(path.join(target, '.truss', 'VERSION'), { force: true })
    await assert.rejects(
      runInit(root, ['--name', 'A', '--lang', 'English', '--root', target]),
      /version mismatch or undetermined/,
    )
    await assert.rejects(fs.access(path.join(target, 'AGENTS.md')))
  })

  it('initialises a foreign target that carries its own same-version engine', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-engine-')
    const target = await makeRoot('truss-init-target-')
    const res = await runInit(root, ['--name', 'T', '--lang', 'English', '--root', target])
    assert.equal(res.currentPhase, 'kickoff')
    await fs.access(path.join(target, 'AGENTS.md'))
    await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
  })

  it('--root pointing at the engine root behaves exactly as before', async () => {
    const root = await makeRoot('truss-init-selfroot-')
    const res = await runInit(root, ['--name', 'S', '--lang', 'English', '--root', root])
    assert.equal(res.currentPhase, 'kickoff')
    await read(root, 'AGENTS.md')
  })

  it('deletability preflight rejects a read-only target before any write', async (t) => {
    if (process.getuid?.() === 0) { t.skip('running as root — chmod is not enforced'); return }
    // On Windows, fs.chmod maps only the read-only bit and does not stop file
    // creation/deletion inside a directory, so a 0o555 dir stays writable and the
    // preflight has nothing to reject. The behaviour is POSIX-permission-specific.
    if (process.platform === 'win32') { t.skip('chmod does not restrict directory writes on Windows'); return }
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = await makeRoot('truss-init-ro-')
    await fs.chmod(root, 0o555)
    try {
      await assert.rejects(
        runInit(root, ['--name', 'A', '--lang', 'English']),
        /not writable\/deletable/,
      )
      await assert.rejects(fs.access(path.join(root, 'AGENTS.md')))
    } finally {
      await fs.chmod(root, 0o755)
    }
  })
})

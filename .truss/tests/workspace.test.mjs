// .truss/tests/workspace.test.mjs — M2 + M3 check tests
// Run with: node --test .truss/tests/workspace.test.mjs
//
// Uses node:test (built-in, Node >= 20). No external test framework.

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  parseFrontmatter, parseTableRow, parseTrussMarker,
  parseLinks, parseBlocks, parsePhases, parseIdReferences, parseIdDefinitions,
  headingToAnchor, parseHeadings, parsePhaseList,
} from '../lib/md.mjs'

import { parseStructureTable, loadWorkspace, resolveRoot } from '../lib/workspace.mjs'
import { loadSchema } from '../lib/schema.mjs'

// The ID classes the engine ships (docs/schema.md). parseIdDefinitions and
// parseIdReferences take them as an argument since D-079 — there is no built-in
// list to fall back on, which is the point: the classes are workspace data.
const IDS = (await loadSchema(path.join(os.tmpdir(), 'truss-no-such-workspace'))).ids
import {
  parseExitItems, globToRegex, renderPhaseBlock, renderNoPhasesBlock,
  renderPrefsBlock, parsePrefsRows, endSentence,
} from '../lib/render.mjs'
import { writeBlock } from '../lib/writer.mjs'
import * as st from '../checks/st.mjs'
import * as bl from '../checks/bl.mjs'
import * as rf from '../checks/rf.mjs'
import * as ph from '../checks/ph.mjs'

// Synthetic ctx objects stand in for a workspace that HAS state/phases.md.
// lib/workspace.mjs attaches `stat` only when the file was actually read, and
// since U4 that flag is the absent/present line: without it PH and BL-02 treat
// the workspace as running with no phase model. Hand-built fixtures must say
// which side of that line they are on.
const PRESENT = { size: 10 }

const execFileP = promisify(execFile)

const FIXTURE = path.join(fileURLToPath(import.meta.url), '..', 'fixture')
// Repo .truss engine dir (this file lives at <repo>/.truss/tests/workspace.test.mjs).
const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')

// ── md.mjs unit tests ────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses simple frontmatter', () => {
    const lines = ['---', 'current: discover', 'profile: software', '---', 'body']
    const { data, bodyStart } = parseFrontmatter(lines)
    assert.equal(data.current, 'discover')
    assert.equal(data.profile, 'software')
    assert.equal(bodyStart, 4)
  })

  describe('parsePhaseList', () => {
    it('accepts comma and semicolon separators consistently', () => {
      assert.deepEqual(parsePhaseList('repo/**, pm/**; context/tmp/**'), [
        'repo/**', 'pm/**', 'context/tmp/**',
      ])
    })
  })

  it('returns empty when no frontmatter', () => {
    const lines = ['# heading', 'body']
    const { data, bodyStart } = parseFrontmatter(lines)
    assert.deepEqual(data, {})
    assert.equal(bodyStart, 0)
  })
})

describe('parseTableRow', () => {
  it('parses a standard row', () => {
    const cells = parseTableRow('| AGENTS.md | A | router |')
    assert.deepEqual(cells, ['AGENTS.md', 'A', 'router'])
  })

  it('returns null for separator', () => {
    assert.equal(parseTableRow('|---|---|---|'), null)
  })

  it('returns null for non-table line', () => {
    assert.equal(parseTableRow('## heading'), null)
  })
})

describe('parseTrussMarker', () => {
  it('detects begin marker', () => {
    const m = parseTrussMarker('<!-- truss:begin preferences -->')
    assert.deepEqual(m, { type: 'begin', id: 'preferences' })
  })

  it('detects end marker', () => {
    const m = parseTrussMarker('<!-- truss:end phase -->')
    assert.deepEqual(m, { type: 'end', id: 'phase' })
  })

  it('returns null for non-marker', () => {
    assert.equal(parseTrussMarker('<!-- regular comment -->'), null)
    assert.equal(parseTrussMarker('## heading'), null)
  })
})

describe('parseLinks', () => {
  it('finds all links in a line', () => {
    const links = parseLinks('See [VISION.md](VISION.md) and [doc](docs/git.md#section).')
    assert.equal(links.length, 2)
    assert.equal(links[0].href, 'VISION.md')
    assert.equal(links[1].href, 'docs/git.md#section')
  })

  it('ignores non-link text', () => {
    assert.deepEqual(parseLinks('No links here.'), [])
  })
})

describe('parseBlocks', () => {
  it('extracts paired blocks', () => {
    const lines = [
      '<!-- truss:begin preferences -->',
      'content',
      '<!-- truss:end preferences -->',
    ]
    const blocks = parseBlocks(lines)
    assert(blocks.has('preferences'))
    assert.equal(blocks.get('preferences').startLine, 1)
    assert.equal(blocks.get('preferences').endLine, 3)
    assert.deepEqual(blocks.get('preferences').innerLines, ['content'])
  })

  it('flags orphan begin', () => {
    const lines = ['<!-- truss:begin phase -->', 'content']
    const blocks = parseBlocks(lines)
    assert(blocks.get('phase').orphanBegin)
  })

  it('flags orphan end', () => {
    const lines = ['content', '<!-- truss:end phase -->']
    const blocks = parseBlocks(lines)
    assert(blocks.get('phase').orphanEnd)
  })
})

describe('parsePhases', () => {
  it('parses phases.md correctly', () => {
    const lines = [
      '---', 'current: discover', '---',
      '',
      '## discover',
      'label: Discovery',
      'purpose: explore.',
      'behavior: divergent.',
      'exit: something.',
      '',
      '## build',
      'label: Build',
      'purpose: implement.',
      'behavior: pragmatic.',
      'exit: all done.',
    ]
    const { frontmatter, ordered, defs } = parsePhases(lines)
    assert.equal(frontmatter.current, 'discover')
    assert.deepEqual(ordered, ['discover', 'build'])
    assert.equal(defs.get('discover').label, 'Discovery')
    assert.equal(defs.get('build').purpose, 'implement.')
  })
})

describe('headingToAnchor', () => {
  it('converts standard headings', () => {
    assert.equal(headingToAnchor('Load order'), 'load-order')
    // & is stripped → double space → collapsed to one dash by \s+ match
    assert.equal(headingToAnchor('Structure & routing'), 'structure-routing')
    // — (em dash) stripped, double space → single dash
    assert.equal(headingToAnchor('D-001 — Title'), 'd-001-title')
  })
})

describe('parseIdReferences — skips noise', () => {
  it('skips fenced code blocks', () => {
    const lines = ['```', 'D-001 in code block', '```', 'D-002 in prose']
    const refs = parseIdReferences(lines, IDS)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].id, 'D-002')
  })

  it('skips inline code', () => {
    const refs = parseIdReferences(['See `D-001` for example but also D-002.'], IDS)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].id, 'D-002')
  })

  it('skips single-line HTML comments', () => {
    const refs = parseIdReferences(['<!-- D-001 example --> but D-002 is real.'], IDS)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].id, 'D-002')
  })

  it('skips multi-line HTML comments', () => {
    const lines = ['<!-- Example:', '- D-001 through D-003', '-->', 'Real ref: D-004.']
    const refs = parseIdReferences(lines, IDS)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].id, 'D-004')
  })

  it('skips the durable Closes trace for a removed open decision', () => {
    const refs = parseIdReferences([
      'Closes: OD-001',
      'Related follow-up: OD-002',
    ], IDS)
    assert.deepEqual(refs, [{ id: 'OD-002', line: 2 }])
  })
})

describe('parseIdDefinitions', () => {
  it('detects heading definitions', () => {
    const lines = ['## D-001 — Tech stack decision', 'content']
    const defs = parseIdDefinitions(lines, IDS)
    assert.equal(defs.length, 1)
    assert.equal(defs[0].id, 'D-001')
    assert.equal(defs[0].line, 1)
  })

  it('detects list item definitions', () => {
    const lines = ['- [ ] HT-001 — Review the spec']
    const defs = parseIdDefinitions(lines, IDS)
    assert.equal(defs.length, 1)
    assert.equal(defs[0].id, 'HT-001')
  })
})

// ── workspace.mjs + check integration tests ──────────────────────────────────

describe('parseStructureTable', () => {
  it('extracts managed paths from fixture AGENTS.md', async () => {
    const content = await fs.readFile(path.join(FIXTURE, 'AGENTS.md'), 'utf8')
    const lines = content.split('\n')
    const rows = parseStructureTable(lines)
    const allPaths = rows.flatMap(r => r.paths)
    assert(allPaths.includes('AGENTS.md'), 'should include AGENTS.md')
    assert(allPaths.includes('state/current.md'), 'should include state/current.md')
    assert(allPaths.includes('docs/conventions.md'), 'should include docs/conventions.md')
    assert(rows.some(r => r.template), 'should have template row for <domain>')
    assert(rows.some(r => r.onDemand && r.paths.includes('archive/')), 'archive/ should be on-demand')
  })
})

describe('loadWorkspace + ST checks on valid fixture', () => {
  let ctx

  before(async () => {
    ctx = await loadWorkspace(FIXTURE)
  })

  it('loads structure table', () => {
    assert(ctx.structureTable.length > 0, 'structure table should have rows')
  })

  it('loads phases', () => {
    assert.equal(ctx.phases.frontmatter.current, 'discover')
    assert(ctx.phases.defs.has('discover'))
    assert(ctx.phases.defs.has('validate'))
  })

  it('loads blocks from AGENTS.md', () => {
    assert(ctx.blocks.has('preferences'), 'should have preferences block')
    assert(ctx.blocks.has('phase'), 'should have phase block')
  })

  it('ST checks: no ST-01 errors (all table paths exist)', async () => {
    const findings = await st.run(ctx)
    const st01 = findings.filter(f => f.id === 'ST-01')
    assert.equal(st01.length, 0, `unexpected ST-01 errors: ${JSON.stringify(st01)}`)
  })

  it('ST checks: no ST-02 warnings (no unmanaged files)', async () => {
    const findings = await st.run(ctx)
    const st02 = findings.filter(f => f.id === 'ST-02')
    assert.equal(st02.length, 0, `unexpected ST-02 warnings: ${JSON.stringify(st02)}`)
  })

  it('BL checks: preferences block is valid (BL-03 clean)', async () => {
    const findings = await bl.run(ctx)
    const bl03 = findings.filter(f => f.id === 'BL-03')
    assert.equal(bl03.length, 0, `unexpected BL-03 errors: ${JSON.stringify(bl03)}`)
  })

  it('BL checks: markers are paired (BL-01 clean)', async () => {
    const findings = await bl.run(ctx)
    const bl01 = findings.filter(f => f.id === 'BL-01')
    assert.equal(bl01.length, 0, `unexpected BL-01 errors: ${JSON.stringify(bl01)}`)
  })

  it('RF checks: no broken links (RF-01 clean)', async () => {
    const findings = await rf.run(ctx)
    const rf01 = findings.filter(f => f.id === 'RF-01')
    assert.equal(rf01.length, 0, `unexpected RF-01 errors: ${JSON.stringify(rf01)}`)
  })

  it('RF checks: no undefined IDs in operational files (RF-02 clean)', async () => {
    const findings = await rf.run(ctx)
    const rf02 = findings.filter(f => f.id === 'RF-02')
    assert.equal(rf02.length, 0, `unexpected RF-02 warnings: ${JSON.stringify(rf02)}`)
  })
})

describe('BL-01: unpaired markers detected', async () => {
  it('flags orphan begin', async () => {
    const lines = ['<!-- truss:begin preferences -->', 'content']
    const blocks = parseBlocks(lines)
    // Simulate a ctx with only the broken preferences block
    const ctx = {
      blocks,
      phases: { frontmatter: {}, ordered: [], defs: new Map() },
      files: new Map(),
    }
    const findings = await bl.run(ctx)
    assert(findings.some(f => f.id === 'BL-01' && f.message.includes("begin marker has no matching end")),
      'should flag orphan begin as BL-01')
  })
})

describe('BL-03: invalid pref value detected', async () => {
  it('flags unknown value', async () => {
    const lines = [
      '<!-- truss:begin preferences -->',
      '> provenance',
      '',
      '| key | value | behavior |',
      '|---|---|---|',
      '| scope | turbo | does stuff |',
      '<!-- truss:end preferences -->',
    ]
    const blocks = parseBlocks(lines)
    const ctx = {
      blocks,
      phases: { frontmatter: {}, ordered: [], defs: new Map() },
      files: new Map(),
    }
    const findings = await bl.run(ctx)
    assert(findings.some(f => f.id === 'BL-03' && f.message.includes("invalid value 'turbo'")),
      'should flag invalid pref value as BL-03')
  })

  it('flags unknown key', async () => {
    const lines = [
      '<!-- truss:begin preferences -->',
      '> provenance',
      '',
      '| key | value | behavior |',
      '|---|---|---|',
      '| superpower | on | does magic |',
      '<!-- truss:end preferences -->',
    ]
    const blocks = parseBlocks(lines)
    const ctx = {
      blocks,
      phases: { frontmatter: {}, ordered: [], defs: new Map() },
      files: new Map(),
    }
    const findings = await bl.run(ctx)
    assert(findings.some(f => f.id === 'BL-03' && f.message.includes("unknown key 'superpower'")),
      'should flag unknown pref key as BL-03')
  })
})

describe('RF-03: duplicate ID definition detected', async () => {
  it('flags duplicate D-NNN', async () => {
    const idDefs = new Map([
      ['D-001', [
        { file: 'state/decisions.md', line: 3 },
        { file: 'state/decisions.md', line: 20 },
      ]],
    ])
    const ctx = {
      root: FIXTURE,
      files: new Map(),
      idDefs,
      idRefs: new Map(),
      phases: { frontmatter: {}, ordered: [], defs: new Map() },
    }
    const findings = await rf.run(ctx)
    assert(findings.some(f => f.id === 'RF-03' && f.message.includes("D-001")),
      'should flag duplicate ID as RF-03')
  })
})

describe('ST-04: stub drift detected', async () => {
  it('flags stub without AGENTS.md reference', async () => {
    // Build a minimal workspace in /tmp (outside the mounted drive to avoid EPERM)
    const tmpDir = '/tmp/truss-test-st04'
    const write = async (rel, content) => {
      const abs = path.join(tmpDir, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
    }

    // Read fixture AGENTS.md (it has a valid structure table)
    const agentsMd = await fs.readFile(path.join(FIXTURE, 'AGENTS.md'), 'utf8')
    await write('AGENTS.md', agentsMd)

    // Standard required files
    for (const f of ['README.md', 'VISION.md', 'HUMAN-TODOS.md', '.gitignore']) {
      await write(f, `# ${f}\n`)
    }

    // Bad CLAUDE.md (no AGENTS.md reference — ST-04 should catch this)
    await write('CLAUDE.md', 'This stub is broken — it does not mention the agents file.\n')

    // Valid other stubs
    await write('GEMINI.md', 'Read AGENTS.md\n')
    await write('.cursorrules', '# Read AGENTS.md\n')
    await write('.github/copilot-instructions.md', 'Read AGENTS.md\n')

    // State files
    const phasesMd = await fs.readFile(path.join(FIXTURE, 'state/phases.md'), 'utf8')
    await write('state/phases.md', phasesMd)
    for (const f of ['current.md', 'decisions.md', 'open-decisions.md', 'profile.md']) {
      await write(`state/${f}`, `# ${f}\n`)
    }

    // Docs files
    for (const f of ['conventions.md', 'protocols.md', 'git.md', 'import.md']) {
      await write(`docs/${f}`, `# ${f}\n`)
    }

    // .truss skeleton
    await write('.truss/VERSION', '1.0.0-alpha\n')
    await write('.truss/prompts/custom/discover-kickoff.md', 'stub\n')
    await write('.truss/prompts/custom/validate-kickoff.md', 'stub\n')

    const ctx = await loadWorkspace(tmpDir)
    const findings = await st.run(ctx)
    const st04 = findings.filter(f => f.id === 'ST-04')
    assert(st04.some(f => f.file === 'CLAUDE.md'), `should flag bad CLAUDE.md as ST-04; got: ${JSON.stringify(st04)}`)

    // Cleanup
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })
})

// ── M3 tests ─────────────────────────────────────────────────────────────────

describe('parseExitItems', () => {
  it('parses all item types', () => {
    const items = parseExitItems('file: foo.md; glob: research*.md; section: VISION.md#Problem; approved (human)')
    assert.equal(items.length, 4)
    assert.equal(items[0].type, 'file')
    assert.equal(items[0].path, 'foo.md')
    assert.equal(items[1].type, 'glob')
    assert.equal(items[1].pattern, 'research*.md')
    assert.equal(items[2].type, 'section')
    assert.equal(items[2].file, 'VISION.md')
    assert.equal(items[2].heading, 'Problem')
    assert.equal(items[3].type, 'human')
  })

  it('marks unrecognized items as unknown', () => {
    const items = parseExitItems('VISION.md#Problem filled.')
    assert.equal(items.length, 1)
    assert.equal(items[0].type, 'unknown')
  })

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseExitItems(''), [])
    assert.deepEqual(parseExitItems(undefined), [])
  })
})

describe('globToRegex', () => {
  it('matches simple patterns', () => {
    const re = globToRegex('research*.md')
    assert(re.test('research-notes.md'))
    assert(re.test('research.md'))
    assert(!re.test('not-research.md'))
  })

  it('matches ** across path separators', () => {
    const re = globToRegex('repo/**')
    assert(re.test('repo/src/index.js'))
    assert(re.test('repo/deep/nested/file.ts'))
    assert(!re.test('docs/file.md'))
  })

  it('? matches exactly one character', () => {
    const re = globToRegex('file?.md')
    assert(re.test('fileA.md'))
    assert(!re.test('file.md'))
    assert(!re.test('fileAB.md'))
  })
})

describe('renderPhaseBlock', () => {
  it('renders all expected lines', () => {
    const phaseDef = {
      label: 'Discovery',
      purpose: 'explore.',
      behavior: 'divergent.',
      allowed: 'notes',
      forbidden: 'code',
      exit: 'section: VISION.md#Problem; done (human)',
      prompts: 'discover-kickoff',
    }
    const lines = renderPhaseBlock(phaseDef, 'discover', 1, 4, '2026-06-01T09:00')
    assert(lines[0].includes('Rendered 2026-06-01T09:00'))
    assert(lines[0].includes('state/phases.md'))
    assert(lines[2].includes('Phase 1/4 — discover (Discovery)'))
    assert(lines[3].includes('Purpose: explore.'))
    assert(lines[4].includes('Behavior: divergent.'))
    assert(lines[5].includes('Allowed: notes. Forbidden: code.'))
    assert(lines[6].includes('Exit (checked by'))
    assert(lines[7].includes('Prompts: discover-kickoff'))
  })

  it('omits allowed/forbidden line when both absent', () => {
    const phaseDef = { label: 'X', purpose: 'p.', behavior: 'b.', exit: 'done (human)' }
    const lines = renderPhaseBlock(phaseDef, 'x', 1, 1, '2026-01-01T00:00')
    assert(!lines.some(l => l.startsWith('Allowed:') || l.startsWith('Forbidden:')))
  })
})

describe('writeBlock (round-trip)', () => {
  it('replaces inner content and leaves markers intact', async () => {
    const tmpFile = '/tmp/truss-test-writeblock.md'
    const original = [
      '# Test',
      '<!-- truss:begin phase -->',
      'old content',
      '<!-- truss:end phase -->',
      'after',
    ].join('\n')
    await fs.writeFile(tmpFile, original, 'utf8')

    await writeBlock(tmpFile, 'phase', ['new line 1', 'new line 2'])

    const result = await fs.readFile(tmpFile, 'utf8')
    const lines = result.split('\n')
    assert(lines.includes('<!-- truss:begin phase -->'))
    assert(lines.includes('<!-- truss:end phase -->'))
    assert(lines.includes('new line 1'))
    assert(lines.includes('new line 2'))
    assert(!lines.includes('old content'))

    try { await fs.unlink(tmpFile) } catch {}
  })

  it('throws when marker is missing', async () => {
    const tmpFile = '/tmp/truss-test-writeblock-err.md'
    await fs.writeFile(tmpFile, '# no markers here\n', 'utf8')
    await assert.rejects(
      () => writeBlock(tmpFile, 'phase', ['content']),
      /not found/
    )
    try { await fs.unlink(tmpFile) } catch {}
  })
})

describe('PH-01: phases.md grammar', async () => {
  it('flags unknown key', async () => {
    const defs = new Map([['discover', {
      purpose: 'p.', behavior: 'b.', exit: 'done (human)', 'super-secret': 'x',
    }]])
    const ctx = {
      root: FIXTURE,
      gate: false,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-01' && f.message.includes("unknown key 'super-secret'")))
  })

  it('flags missing required key', async () => {
    const defs = new Map([['discover', { purpose: 'p.', exit: 'done (human)' }]]) // behavior missing
    const ctx = {
      root: FIXTURE,
      gate: false,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-01' && f.message.includes("required key 'behavior'")))
  })

  it('flags unknown exit item type', async () => {
    const defs = new Map([['discover', {
      purpose: 'p.', behavior: 'b.', exit: 'VISION.md#Problem filled.',
    }]])
    const ctx = {
      root: FIXTURE,
      gate: false,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-01' && f.message.includes('exit item not recognized')))
  })
})

describe('PH-02: current pointer valid', async () => {
  it('flags missing current', async () => {
    const ctx = {
      root: FIXTURE,
      gate: false,
      phases: {
        ordered: ['discover'],
        defs: new Map([['discover', { purpose: 'p.', behavior: 'b.', exit: 'done (human)' }]]),
        frontmatter: {},
        stat: PRESENT,
      },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-02' && f.message.includes("missing 'current:'")))
  })

  it('flags current pointing to nonexistent phase', async () => {
    const ctx = {
      root: FIXTURE,
      gate: false,
      phases: {
        ordered: ['discover'],
        defs: new Map([['discover', { purpose: 'p.', behavior: 'b.', exit: 'done (human)' }]]),
        frontmatter: { current: 'build' },
        stat: PRESENT,
      },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-02' && f.message.includes("'build' is not a defined phase")))
  })
})

describe('PH checks: valid fixture is clean', async () => {
  let ctx

  before(async () => {
    ctx = await loadWorkspace(FIXTURE)
    ctx.gate = false
  })

  it('PH-01 clean on valid fixture', async () => {
    const findings = await ph.run(ctx)
    const ph01 = findings.filter(f => f.id === 'PH-01')
    assert.equal(ph01.length, 0, `unexpected PH-01: ${JSON.stringify(ph01)}`)
  })

  it('PH-02 clean on valid fixture', async () => {
    const findings = await ph.run(ctx)
    const ph02 = findings.filter(f => f.id === 'PH-02')
    assert.equal(ph02.length, 0, `unexpected PH-02: ${JSON.stringify(ph02)}`)
  })

  it('PH-03 clean (repo/ does not exist in fixture)', async () => {
    const findings = await ph.run(ctx)
    const ph03 = findings.filter(f => f.id === 'PH-03')
    assert.equal(ph03.length, 0, `unexpected PH-03: ${JSON.stringify(ph03)}`)
  })
})

// ── B1: resolveRoot must not percent-encode spaced paths ──────────────────────

describe('resolveRoot (B1)', () => {
  // URLs are derived from real OS-absolute paths via pathToFileURL so the test
  // is valid on Windows too (a hardcoded POSIX file:// URL has no drive letter
  // and makes fileURLToPath throw ERR_INVALID_FILE_URL_PATH on win32). The space
  // in the directory name is what pathToFileURL percent-encodes, so this still
  // proves resolveRoot decodes %20 back to a space.
  it('decodes a path containing a space — no %20', () => {
    const dir = path.join(os.tmpdir(), 'My Projects', 'app')
    const url = pathToFileURL(path.join(dir, '.truss', 'bin', 'truss.mjs')).href
    const root = resolveRoot(url)
    assert.equal(root, dir)
    assert(!root.includes('%20'), 'resolved root must not contain %20')
  })

  it('handles multiple encoded characters', () => {
    const dir = path.join(os.tmpdir(), 'Mobile Documents', 'a b')
    const url = pathToFileURL(path.join(dir, '.truss', 'bin', 'truss.mjs')).href
    const root = resolveRoot(url)
    assert.equal(root, dir)
    assert(!root.includes('%20'), 'resolved root must not contain %20')
  })
})

// ── B2: render punctuation + golden block ─────────────────────────────────────

describe('endSentence (B2)', () => {
  it('adds a terminator when missing', () => {
    assert.equal(endSentence('foo bar'), 'foo bar.')
  })
  it('does not duplicate an existing period', () => {
    assert.equal(endSentence('foo bar.'), 'foo bar.')
  })
  it('normalises other terminators and trailing space', () => {
    assert.equal(endSentence('foo!'), 'foo.')
    assert.equal(endSentence('foo?  '), 'foo.')
  })
})

describe('renderPhaseBlock — no double period (B2)', () => {
  it('renders single period when source values already end in one', () => {
    const phaseDef = {
      label: 'Discovery',
      purpose: 'explore the idea, collect raw research, map the problem space.',
      behavior: 'divergent — generate options, defer judgment, no premature convergence.',
      allowed: 'domain notes, research, open questions, sketches, VISION.md sections.',
      forbidden: 'code in repo/, final decisions without D-entry, spec documents, architecture diagrams.',
      read: 'state/profile.md',
      exit: 'section: VISION.md#Problem; glob: research*.md; pursue/park leaning noted (human)',
      prompts: 'discover-kickoff, discover-recap',
    }
    const lines = renderPhaseBlock(phaseDef, 'discover', 1, 4, '2026-06-13T13:00')
    const allowedLine = lines.find(l => l.startsWith('Allowed:'))
    assert(allowedLine, 'allowed/forbidden line should exist')
    assert(!allowedLine.includes('..'), `double period leaked: ${allowedLine}`)
    assert(allowedLine.includes('VISION.md sections. Forbidden:'))
    assert(allowedLine.endsWith('architecture diagrams.'))
  })

  it('golden: locks the exact rendered block', () => {
    const phaseDef = {
      label: 'Discovery',
      purpose: 'explore the idea, collect raw research, map the problem space.',
      behavior: 'divergent — generate options, defer judgment, no premature convergence.',
      allowed: 'domain notes, research, open questions, sketches, VISION.md sections.',
      forbidden: 'code in repo/, final decisions without D-entry, spec documents, architecture diagrams.',
      read: 'state/profile.md',
      exit: 'section: VISION.md#Problem; glob: research*.md; pursue/park leaning noted (human)',
      prompts: 'discover-kickoff, discover-recap',
    }
    const lines = renderPhaseBlock(phaseDef, 'discover', 1, 4, '2026-06-13T13:00')
    const expected = [
      '> Rendered 2026-06-13T13:00 from `state/phases.md` — edit there, then run `truss render`. Advancing `current:` is human-only (propose via HUMAN-TODOS.md); phase definitions are agent-maintained — restructure with a D-NNN and tell the human (AGENTS.md §5).',
      '',
      '**Phase 1/4 — discover (Discovery)**',
      'Purpose: explore the idea, collect raw research, map the problem space.',
      'Behavior: divergent — generate options, defer judgment, no premature convergence.',
      'Allowed: domain notes, research, open questions, sketches, VISION.md sections. Forbidden: code in repo/, final decisions without D-entry, spec documents, architecture diagrams.',
      'Read this phase (beyond §1): state/profile.md',
      'Exit (checked by `doctor --gate`): section: VISION.md#Problem; glob: research*.md; pursue/park leaning noted (human)',
      'Prompts: discover-kickoff, discover-recap (`.truss/prompts/`)',
    ]
    assert.deepEqual(lines, expected)
  })
})

// ── A2: check registry ────────────────────────────────────────────────────────

describe('check registry (A2)', () => {
  it('every check module exports a well-formed meta list', () => {
    for (const [name, mod] of [['st', st], ['bl', bl], ['rf', rf], ['ph', ph]]) {
      assert(Array.isArray(mod.meta), `${name}.meta must be an array`)
      assert(mod.meta.length > 0, `${name}.meta must be non-empty`)
      for (const entry of mod.meta) {
        assert(/^[A-Z]{2}-\d{2}$/.test(entry.id), `${name}: bad id ${entry.id}`)
        assert(['E', 'W', 'I'].includes(entry.severity), `${name}: bad severity for ${entry.id}`)
        assert(typeof entry.title === 'string' && entry.title.length > 0, `${name}: missing title for ${entry.id}`)
      }
    }
  })

  it('combined registry covers the expected catalog ids', () => {
    const ids = [st, bl, rf, ph].flatMap(m => m.meta.map(e => e.id))
    for (const expected of [
      'ST-01', 'ST-06', 'BL-01', 'BL-02', 'BL-03',
      'RF-01', 'PH-01', 'PH-04', 'PH-05', 'PH-06',
    ]) {
      assert(ids.includes(expected), `registry missing ${expected}`)
    }
    // ids must be unique
    assert.equal(new Set(ids).size, ids.length, 'registry has duplicate ids')
  })
})

// ── A4: parse-degradation guards ──────────────────────────────────────────────

describe('ST-06: structure-table parse guard (A4)', () => {
  it('fires when AGENTS.md is missing', async () => {
    const ctx = {
      root: FIXTURE, agentsMissing: true,
      structureTable: [], diskPaths: [], files: new Map(),
    }
    const findings = await st.run(ctx)
    assert(findings.some(f => f.id === 'ST-06' && f.message.includes('not found')),
      'should flag missing AGENTS.md as ST-06')
  })

  it('fires when AGENTS.md exists but the table is empty', async () => {
    const ctx = {
      root: FIXTURE, agentsMissing: false,
      structureTable: [], diskPaths: [], files: new Map(),
    }
    const findings = await st.run(ctx)
    assert(findings.some(f => f.id === 'ST-06' && f.message.includes('structure table is empty')),
      'should flag empty table as ST-06')
  })

  it('does NOT fire on the valid fixture', async () => {
    const ctx = await loadWorkspace(FIXTURE)
    const findings = await st.run(ctx)
    assert.equal(findings.filter(f => f.id === 'ST-06').length, 0)
  })
})

describe('PH-05: phases parse guard (A4)', () => {
  it('fires when phases.md exists (has a stat) but defines no phases', async () => {
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: [], defs: new Map(), frontmatter: {}, stat: { size: 10 } },
    }
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-05'), 'should flag empty phases.md as PH-05')
  })

  it('does NOT fire when phases.md is absent (no stat)', async () => {
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: [], defs: new Map(), frontmatter: {} },
    }
    const findings = await ph.run(ctx)
    assert.equal(findings.filter(f => f.id === 'PH-05').length, 0)
  })
})

// ── A5: PH-06 static exit-target validation ───────────────────────────────────

describe('PH-06: static exit-target validation (A5)', () => {
  it('fires for a broken section/file target in a non-current phase', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'section: VISION.md#Problem; done (human)' }],
      ['plan', { purpose: 'p.', behavior: 'b.', exit: 'section: VISION.md#NoSuchHeading; file: missing.md' }],
    ])
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: ['discover', 'plan'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    const ph06 = findings.filter(f => f.id === 'PH-06')
    assert(ph06.some(f => f.message.includes('NoSuchHeading')), 'should flag broken section')
    assert(ph06.some(f => f.message.includes('missing.md')), 'should flag missing file')
  })

  it('does NOT flag glob items outside --gate', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'glob: research*.md; done (human)' }],
    ])
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert.equal(findings.filter(f => f.id === 'PH-06').length, 0, 'glob must stay gate-only')
  })

  it('is clean on the valid fixture (all section targets resolve)', async () => {
    const ctx = await loadWorkspace(FIXTURE)
    ctx.gate = false
    const findings = await ph.run(ctx)
    assert.equal(findings.filter(f => f.id === 'PH-06').length, 0,
      `unexpected PH-06 on fixture: ${JSON.stringify(findings.filter(f => f.id === 'PH-06'))}`)
  })

  it('under --gate, the current phase is covered by PH-04, not duplicated by PH-06', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'section: VISION.md#NoSuchHeading' }],
    ])
    const ctx = {
      root: FIXTURE, gate: true,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert.equal(findings.filter(f => f.id === 'PH-06').length, 0, 'PH-06 should skip current phase under gate')
    assert(findings.some(f => f.id === 'PH-04' && f.severity === 'E'), 'PH-04 should report it instead')
  })

  it('under --gate, surfaces (human) exit items as a PH-04 warning checklist', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'pursue or park decision recorded (human)' }],
    ])
    const ctx = {
      root: FIXTURE, gate: true,
      phases: { ordered: ['discover'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    assert.equal(findings.filter(f => f.id === 'PH-04' && f.severity === 'E').length, 0,
      'a human-only exit item must not produce a machine error')
    assert(findings.some(f => f.id === 'PH-04' && f.severity === 'W'),
      'human exit items should surface as a PH-04 warning checklist')
  })

  // ── D-071: severity graded by phase position relative to current: ─────────
  it('grades a missing target in a phase at/before current: as W (unchanged message)', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'section: VISION.md#NoSuchHeading' }],
      ['plan', { purpose: 'p.', behavior: 'b.', exit: 'done (human)' }],
    ])
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: ['discover', 'plan'], defs, frontmatter: { current: 'plan' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    const ph06 = findings.filter(f => f.id === 'PH-06')
    assert.equal(ph06.length, 1, 'the finding must still be emitted, not disappear')
    assert.equal(ph06[0].severity, 'W')
    assert.equal(ph06[0].message, "phase 'discover': exit target heading 'NoSuchHeading' not found in VISION.md")
  })

  it('grades the same missing target in a future phase as I (not-due-yet wording)', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'done (human)' }],
      ['plan', { purpose: 'p.', behavior: 'b.', exit: 'section: VISION.md#NoSuchHeading' }],
    ])
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: ['discover', 'plan'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    const ph06 = findings.filter(f => f.id === 'PH-06')
    assert.equal(ph06.length, 1, 'the finding must still be emitted, not disappear')
    assert.equal(ph06[0].severity, 'I')
    assert.match(ph06[0].message, /not due yet/)
    assert.match(ph06[0].message, /NoSuchHeading/)
  })

  it('grades a missing file: target the same way as section: (W at/before, I after)', async () => {
    const defs = new Map([
      ['discover', { purpose: 'p.', behavior: 'b.', exit: 'file: missing-a.md' }],
      ['plan', { purpose: 'p.', behavior: 'b.', exit: 'file: missing-b.md' }],
    ])
    const ctx = {
      root: FIXTURE, gate: false,
      phases: { ordered: ['discover', 'plan'], defs, frontmatter: { current: 'discover' }, stat: PRESENT },
    }
    const findings = await ph.run(ctx)
    const ph06 = findings.filter(f => f.id === 'PH-06')
    assert.equal(ph06.length, 2)
    const atCurrent = ph06.find(f => f.message.includes('missing-a.md'))
    const future = ph06.find(f => f.message.includes('missing-b.md'))
    assert.equal(atCurrent.severity, 'W')
    assert.equal(future.severity, 'I')
    assert.match(future.message, /not due yet/)
  })
})

// ── T1: BL-02 drift detection ─────────────────────────────────────────────────

describe('BL-02: phase block drift (T1)', () => {
  // Build a ctx whose phases produce a known render, then compare against an
  // in-sync block (clean) and a drifted block (fires).
  const phaseDef = {
    label: 'Discovery', purpose: 'explore.', behavior: 'divergent.',
    allowed: 'notes', forbidden: 'code',
    exit: 'section: VISION.md#Problem; done (human)', prompts: 'discover-kickoff',
  }
  const ordered = ['discover']
  const defs = new Map([['discover', phaseDef]])
  const frontmatter = { current: 'discover' }
  const phases = { ordered, defs, frontmatter, stat: PRESENT }

  const buildCtx = (innerLines) => ({
    phases,
    blocks: new Map([['phase', { startLine: 1, endLine: 99, innerLines }]]),
    files: new Map(),
  })

  it('clean when the block matches a fresh render', async () => {
    const innerLines = renderPhaseBlock(phaseDef, 'discover', 1, 1, '2026-06-13T10:00')
    const findings = await bl.run(buildCtx(innerLines))
    assert.equal(findings.filter(f => f.id === 'BL-02').length, 0, 'in-sync block must not flag BL-02')
  })

  it('fires when the block body has drifted', async () => {
    const innerLines = renderPhaseBlock(phaseDef, 'discover', 1, 1, '2026-06-13T10:00')
    innerLines[3] = 'Purpose: SOMETHING ELSE ENTIRELY.'  // tamper with the body
    const findings = await bl.run(buildCtx(innerLines))
    assert(findings.some(f => f.id === 'BL-02' && f.message.includes('drifted')),
      'drifted block should flag BL-02')
  })

  it('a timestamp-only change does NOT count as drift', async () => {
    const innerLines = renderPhaseBlock(phaseDef, 'discover', 1, 1, '1999-01-01T00:00')
    const findings = await bl.run(buildCtx(innerLines))
    assert.equal(findings.filter(f => f.id === 'BL-02').length, 0,
      'only the timestamp differs from "now" — must not be drift')
  })
})

// ── U4: BL-02 with no phase model ────────────────────────────────────────────

describe('BL-02: no state/phases.md (U4)', () => {
  const absent = { ordered: [], defs: new Map(), frontmatter: {} }  // no stat = not read
  const ctxWith = (innerLines) => ({
    phases: absent,
    blocks: new Map([['phase', { startLine: 1, endLine: 99, innerLines }]]),
    files: new Map(),
  })

  it('accepts exactly the canonical notice render writes', async () => {
    const findings = await bl.run(ctxWith(renderNoPhasesBlock()))
    assert.deepEqual(findings.filter(f => f.id === 'BL-02'), [],
      'render and BL-02 must agree, or every no-phases workspace goes red')
  })

  it('fires when the block still advertises a phase model', async () => {
    const stale = renderPhaseBlock(
      { purpose: 'p.', behavior: 'b.', exit: 'done (human)' }, 'discover', 1, 1, '2026-06-13T10:00',
    )
    const findings = await bl.run(ctxWith(stale))
    assert(findings.some(f => f.id === 'BL-02' && /could not be read/.test(f.message)),
      'a block promising gates the workspace does not have must not pass silently')
  })

  it('is not fooled by surrounding blank lines', async () => {
    const findings = await bl.run(ctxWith(['', ...renderNoPhasesBlock(), '']))
    assert.deepEqual(findings.filter(f => f.id === 'BL-02'), [])
  })
})

// ── T3: checks fire correctly (PH-03, ST-02/03/05) ───────────────────────────

describe('PH-03: forbidden-glob hit fires (T3)', () => {
  it('flags a changed path, not a pre-existing clean file', async () => {
    const tmp = await mkTmp('ph03')
    await writeFileIn(tmp, 'repo/src/index.js', 'console.log(1)\n')
    await execFileP('git', ['init'], { cwd: path.join(tmp, 'repo') })
    await execFileP('git', ['add', '.'], { cwd: path.join(tmp, 'repo') })
    await execFileP(
      'git',
      ['-c', 'user.name=Truss Test', '-c', 'user.email=truss@example.invalid', 'commit', '-m', 'baseline'],
      { cwd: path.join(tmp, 'repo') }
    )
    const defs = new Map([['build', {
      purpose: 'p.', behavior: 'b.', exit: 'done (human)', 'forbidden-globs': 'repo/**',
    }]])
    const ctx = {
      root: tmp, gate: false,
      phases: { ordered: ['build'], defs, frontmatter: { current: 'build' }, stat: PRESENT },
    }
    const cleanFindings = await ph.run(ctx)
    assert.equal(cleanFindings.filter(f => f.id === 'PH-03').length, 0,
      'pre-existing committed files must not be treated as phase violations')
    await writeFileIn(tmp, 'repo/src/index.js', 'console.log(2)\n')
    const findings = await ph.run(ctx)
    assert(findings.some(f => f.id === 'PH-03' && f.message.includes('repo/**')),
      `should flag forbidden-glob hit; got ${JSON.stringify(findings)}`)
    await rmTmp(tmp)
  })
})

describe('ST-02 / ST-03 / ST-05 fire correctly (T3)', () => {
  it('ST-02 flags an unmanaged top-level file', async () => {
    const tmp = await scaffoldWorkspace('st02')
    await writeFileIn(tmp, 'rogue-file.md', '# rogue\n')
    const ctx = await loadWorkspace(tmp)
    const findings = await st.run(ctx)
    assert(findings.some(f => f.id === 'ST-02' && f.file.includes('rogue-file.md')),
      `should flag rogue-file.md as ST-02; got ${JSON.stringify(findings.filter(f => f.id === 'ST-02'))}`)
    await rmTmp(tmp)
  })

  it('ST-03 flags an empty table-managed directory', async () => {
    const tmp = await scaffoldWorkspace('st03')
    // Empty the docs/ dir so ST-03 fires for it
    await fs.rm(path.join(tmp, 'docs'), { recursive: true, force: true })
    await fs.mkdir(path.join(tmp, 'docs'), { recursive: true })
    const ctx = await loadWorkspace(tmp)
    const findings = await st.run(ctx)
    assert(findings.some(f => f.id === 'ST-03' && f.file === 'docs/'),
      `should flag empty docs/ as ST-03; got ${JSON.stringify(findings.filter(f => f.id === 'ST-03'))}`)
    await rmTmp(tmp)
  })

  it('ST-05 flags a file over 450 lines', async () => {
    const tmp = await scaffoldWorkspace('st05')
    const big = Array.from({ length: 460 }, (_, i) => `line ${i}`).join('\n') + '\n'
    await writeFileIn(tmp, 'VISION.md', big)  // VISION.md is table-managed → loaded
    const ctx = await loadWorkspace(tmp)
    const findings = await st.run(ctx)
    assert(findings.some(f => f.id === 'ST-05' && f.file === 'VISION.md'),
      `should flag big VISION.md as ST-05; got ${JSON.stringify(findings.filter(f => f.id === 'ST-05'))}`)
    await rmTmp(tmp)
  })
})

// ── T4: render + set end-to-end against a temp workspace ──────────────────────

describe('render + set end-to-end (T4)', () => {
  it('render rewrites the phase block; set rewrites a preference', async () => {
    const tmp = await mkTmp('e2e')
    // Copy the real engine so the CLI resolves its root to tmp and reads prefs/.
    await fs.cp(ENGINE_DIR, path.join(tmp, '.truss'), { recursive: true })
    // Minimal but valid workspace.
    await writeFileIn(tmp, 'state/phases.md', [
      '---', 'current: discover', '---', '',
      '## discover',
      'label: Discovery',
      'purpose: explore.',
      'behavior: divergent.',
      'allowed: notes, sketches.',
      'forbidden: code, specs.',
      'exit: done (human)',
      '',
    ].join('\n'))
    await writeFileIn(tmp, 'AGENTS.md', [
      '# AGENTS.md', '',
      '<!-- truss:begin preferences -->',
      '> provenance',
      '',
      '**RIGOR & VERIFICATION**',
      '- scope=thorough :: cover the edge cases',
      '<!-- truss:end preferences -->',
      '',
      '<!-- truss:begin phase -->',
      '> placeholder YYYY-MM-DDTHH:MM',
      '<!-- truss:end phase -->',
      '',
    ].join('\n'))

    const bin = path.join(tmp, '.truss', 'bin', 'truss.mjs')

    // render
    await execFileP('node', [bin, 'render'], { cwd: tmp })
    let agents = await fs.readFile(path.join(tmp, 'AGENTS.md'), 'utf8')
    assert(agents.includes('**Phase 1/1 — discover (Discovery)**'), 'render should write the phase heading')
    assert(agents.includes('Allowed: notes, sketches. Forbidden: code, specs.'),
      'render should write a single-period allowed/forbidden line')
    assert(!agents.includes('..'), 'render output must not contain a double period')

    // set
    await execFileP('node', [bin, 'set', 'scope', 'minimal'], { cwd: tmp })
    agents = await fs.readFile(path.join(tmp, 'AGENTS.md'), 'utf8')
    assert(/-\s*scope=minimal\s*::/.test(agents), 'set should change scope to minimal (new directive format)')

    await rmTmp(tmp)
  })
})

// ── temp-workspace helpers ────────────────────────────────────────────────────

let tmpCounter = 0
async function mkTmp(tag) {
  const dir = path.join('/tmp', `truss-test-${tag}-${process.pid}-${tmpCounter++}`)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function rmTmp(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }) } catch {}
}

async function writeFileIn(root, rel, content) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

// Build a minimal valid workspace (clean ST checks) in /tmp, derived from the
// fixture's AGENTS.md + phases.md so the structure table is real.
async function scaffoldWorkspace(tag) {
  const tmp = await mkTmp(tag)
  const agentsMd = await fs.readFile(path.join(FIXTURE, 'AGENTS.md'), 'utf8')
  await writeFileIn(tmp, 'AGENTS.md', agentsMd)
  const phasesMd = await fs.readFile(path.join(FIXTURE, 'state/phases.md'), 'utf8')
  await writeFileIn(tmp, 'state/phases.md', phasesMd)
  for (const f of ['README.md', 'VISION.md', 'HUMAN-TODOS.md', '.gitignore']) {
    await writeFileIn(tmp, f, `# ${f}\n`)
  }
  await writeFileIn(tmp, 'CLAUDE.md', 'Read AGENTS.md\n')
  await writeFileIn(tmp, 'GEMINI.md', 'Read AGENTS.md\n')
  await writeFileIn(tmp, '.cursorrules', '# Read AGENTS.md\n')
  await writeFileIn(tmp, '.github/copilot-instructions.md', 'Read AGENTS.md\n')
  for (const f of ['current.md', 'decisions.md', 'open-decisions.md', 'profile.md']) {
    await writeFileIn(tmp, `state/${f}`, `# ${f}\n`)
  }
  for (const f of ['conventions.md', 'protocols.md', 'git.md', 'import.md']) {
    await writeFileIn(tmp, `docs/${f}`, `# ${f}\n`)
  }
  await writeFileIn(tmp, '.truss/VERSION', '1.0.0-test\n')
  await writeFileIn(tmp, '.truss/prompts/custom/discover-kickoff.md', 'stub\n')
  await writeFileIn(tmp, '.truss/prompts/custom/validate-kickoff.md', 'stub\n')
  return tmp
}

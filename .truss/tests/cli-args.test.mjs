// .truss/tests/cli-args.test.mjs — the per-command argument gate (D-060).
//
// Before the gate, `--help` was recognised only as the FIRST argument: `truss
// ack context --help` acknowledged the boot context and wrote the baseline,
// `truss phase <id> --help` set the phase. The CLI contract is what beta
// freezes, so it is tested here — both the pure inspector and the real binary.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { COMMAND_META, COMMAND_BY_NAME, inspectArgs } from '../lib/command-meta.mjs'
import { makeRoot, exists } from './helpers.mjs'

const execFileP = promisify(execFile)
const BIN = (root) => path.join(root, '.truss', 'bin', 'truss.mjs')

/** Run the real CLI; never throws — returns { code, stdout, stderr }. */
async function run(root, args) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [BIN(root), ...args], {
      env: { ...process.env, TRUSS_NO_GIT: '1' },
      cwd: root,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('command metadata', () => {
  it('declares a flag surface for every command', () => {
    for (const meta of COMMAND_META) {
      assert.ok(meta.flags, `${meta.name} declares no flags map`)
      for (const [flag, spec] of Object.entries(meta.flags)) {
        assert.match(flag, /^--?[a-z][a-z-]*$/, `${meta.name}: odd flag '${flag}'`)
        assert.equal(typeof spec, 'object')
      }
    }
  })

  it('documents every declared flag in the command display string or help text', () => {
    // `display` is what `truss help` prints; a flag nobody can discover is a
    // trap, so each command either spells its flags out or says "[flags]".
    for (const meta of COMMAND_META) {
      if (!Object.keys(meta.flags).length) continue
      const shown = meta.display.includes('[flags]')
        || Object.keys(meta.flags).every(f => meta.display.includes(f))
      assert.ok(shown, `${meta.name}: display '${meta.display}' hides its flags`)
    }
  })
})

describe('inspectArgs', () => {
  const ack = COMMAND_BY_NAME.get('ack')
  const doctor = COMMAND_BY_NAME.get('doctor')

  it('routes --help from any position', () => {
    assert.deepEqual(inspectArgs(ack, ['--help']), { help: true })
    assert.deepEqual(inspectArgs(ack, ['context', '--help']), { help: true })
    assert.deepEqual(inspectArgs(ack, ['context', '--clear', '-h']), { help: true })
  })

  it('rejects an unknown flag and names it', () => {
    assert.deepEqual(inspectArgs(doctor, ['--jsonn']), { unknown: '--jsonn' })
    assert.deepEqual(inspectArgs(doctor, ['--json', '--bogus']), { unknown: '--bogus' })
  })

  it('accepts only the flag forms each command really parses', () => {
    assert.deepEqual(inspectArgs(ack, ['context', '--note', 'reviewed']), {})
    assert.deepEqual(inspectArgs(ack, ['context', '--note=reviewed']), { unknown: '--note=reviewed' })
    assert.deepEqual(inspectArgs(doctor, ['--gate', '--json']), {})
  })

  it('treats a value token as payload, not syntax', () => {
    // `--note --help` records the literal note; it must not open the help.
    assert.deepEqual(inspectArgs(ack, ['context', '--note', '--help']), {})
  })

  it('stops inspecting at literalFrom (preference values)', () => {
    const set = COMMAND_BY_NAME.get('set')
    assert.deepEqual(inspectArgs(set, ['--help']), { help: true })
    assert.deepEqual(inspectArgs(set, ['control-word', '--anything']), {})
  })

  it('routes skills help and unknown flags through the shared argument gate', () => {
    const skills = COMMAND_BY_NAME.get('skills')
    assert.deepEqual(inspectArgs(skills, ['list', '--help']), { help: true })
    assert.deepEqual(inspectArgs(skills, ['list', '--bogus']), { unknown: '--bogus' })
  })
})

describe('argument gate (real CLI)', () => {
  it('explains a writing command instead of running it (`ack context --help`)', async () => {
    const root = await makeRoot('truss-args-ack-')
    await run(root, ['init', '--name', 'Args', '--lang', 'English'])
    const res = await run(root, ['ack', 'context', '--help'])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /truss ack context/)
    assert.match(res.stdout, /--clear/)
    assert.equal(
      await exists(root, '.truss/out/context-ack.json'),
      false,
      '--help must not record an acknowledgement',
    )
  })

  it('explains `phase <id> --help` instead of advancing the phase', async () => {
    const root = await makeRoot('truss-args-phase-')
    await run(root, ['init', '--name', 'Args', '--lang', 'English'])
    const res = await run(root, ['phase', 'kickoff', '--help'])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /truss phase/)
    assert.doesNotMatch(res.stdout, /phase changed/i)
  })

  it('rejects an unknown flag with exit 1 and points at the command help', async () => {
    const root = await makeRoot('truss-args-unknown-')
    await run(root, ['init', '--name', 'Args', '--lang', 'English'])
    const res = await run(root, ['doctor', '--jsn'])
    assert.equal(res.code, 1)
    assert.match(res.stderr, /unknown argument '--jsn'/)
    assert.match(res.stderr, /doctor --help/)
  })

  it('still runs the command when every flag is declared', async () => {
    const root = await makeRoot('truss-args-ok-')
    await run(root, ['init', '--name', 'Args', '--lang', 'English'])
    const res = await run(root, ['doctor', '--json'])
    assert.equal(res.code, 0)
    assert.equal(await exists(root, '.truss/out/doctor.json'), true)
  })
})

// .truss/tests/helpers.mjs — shared helpers for the command tests.
// Not a *.test.mjs file, so node --test never runs it directly; init.test.mjs
// imports it. Each test file runs in its own process (node:test isolates files),
// so the global tweaks below are scoped per file.

import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from '../lib/workspace.mjs'
import * as st from '../checks/st.mjs'
import * as bl from '../checks/bl.mjs'
import * as rf from '../checks/rf.mjs'
import * as ph from '../checks/ph.mjs'
import * as sy from '../checks/sy.mjs'
import * as cx from '../checks/cx.mjs'

// Never prompt (no readline hang) and never shell out to git in tests.
process.stdin.isTTY = false
process.env.TRUSS_NO_GIT = '1'

// This file lives at <repo>/.truss/tests/helpers.mjs → ENGINE_DIR = <repo>/.truss
export const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')

/** Copy the engine subdirs init needs into <root>/.truss (curated, not the whole tree). */
export async function copyEngine(root) {
  const dest = path.join(root, '.truss')
  for (const sub of ['bin', 'lib', 'checks', 'prefs', 'prompts', 'baseline']) {
    await fs.cp(path.join(ENGINE_DIR, sub), path.join(dest, sub), { recursive: true })
  }
  try { await fs.cp(path.join(ENGINE_DIR, 'VERSION'), path.join(dest, 'VERSION')) } catch {}
}

/** Make a fresh temp workspace root with the engine copied in. */
export async function makeRoot(tag = 'truss-test-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), tag))
  await copyEngine(root)
  return root
}

/** Run the full check suite (ST/BL/RF/PH/SY/CX/HY) against a workspace and return findings. */
export async function runChecks(root, { gate = false } = {}) {
  const ctx = await loadWorkspace(root)
  ctx.gate = gate
  const findings = []
  for (const mod of [st, bl, rf, ph, sy, cx]) findings.push(...await mod.run(ctx))
  return findings
}

export const errorsOf = (findings) => findings.filter(f => f.severity === 'E')

export async function read(root, rel) { return fs.readFile(path.join(root, rel), 'utf8') }
export async function exists(root, rel) {
  try { await fs.access(path.join(root, rel)); return true } catch { return false }
}

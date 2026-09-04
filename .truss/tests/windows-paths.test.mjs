// .truss/tests/windows-paths.test.mjs — a path derived from a module URL must be
// a real path on Windows too.
//
// WHY THIS IS A TEST AND NOT A REVIEW NOTE. `new URL(…).pathname` returns
// `/D:/a/repo/…` on Windows; `path.join` then reads the leading slash as
// drive-relative and produces `D:\D:\a\repo\…`, which does not exist. The file
// read fails with ENOENT and the test that used it fails for a reason unrelated
// to what it asserts — invisible on macOS and Linux, where the same expression
// happens to work.
//
// It has already been fixed once: 77a366e (2026-08-07) corrected
// tests/context-ack.test.mjs and its message even named the pattern to copy. Three
// weeks later tests/split-decisions.test.mjs was written with the broken form
// again, and Windows CI went red and stayed red across two release cuts. A fix
// applied to the site does not hold the class; this does.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives at <repo>/.truss/tests/ → ENGINE_DIR = <repo>/.truss
const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')

// The broken shape: a module URL and a `.pathname` read on the same line. Built
// so this file's own source cannot match it.
const BROKEN = /import\.meta\.url[^\n]*\.pathname/

async function everyModule(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'out' || entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await everyModule(abs))
    else if (entry.name.endsWith('.mjs')) out.push(abs)
  }
  return out
}

describe('module-URL paths work on Windows', () => {
  it('no engine or test module derives a path from .pathname', async () => {
    const offenders = []
    for (const abs of await everyModule(ENGINE_DIR)) {
      const src = await fs.readFile(abs, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        if (BROKEN.test(line)) offenders.push(`${path.relative(ENGINE_DIR, abs)}:${i + 1}`)
      }
    }
    assert.deepEqual(offenders, [],
      'derive the path with fileURLToPath(…) instead: the URL property yields ' +
      "'/D:/…' on Windows, which path.join turns into 'D:\\D:\\…'")
  })
})

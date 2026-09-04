// .truss/tests/stdout-flush.test.mjs — a command may not exit on a queued stdout.
//
// WHY THIS IS A TEST AND NOT A REVIEW NOTE. On a POSIX pipe, stdout writes are
// asynchronous: libuv hands the kernel as much as the pipe accepts and queues
// the rest. `process.exit()` drops the queue. The reader gets a truncated
// document, the exit code is 0, and nothing anywhere reports a problem.
//
// It is not theoretical. `doctor --json` on a 182 KB report, against a consumer
// that had not started reading yet, left 181526 bytes queued at exit and lost
// 50454 of them. CI hit the small end of the same effect: a 9562-byte report cut
// at 8157, failing as "Unterminated string in JSON at position 8157"
// (macOS/Node 20, run 33825489580). It passed on Linux and on macOS/Node 22 in
// the same matrix, so a green run next to it proves nothing about the next one.
//
// A fix at the one exit site would not hold: the dispatcher has thirty of them,
// and any new command adds another. This guards the class — the same shape as
// windows-paths.test.mjs, and for the same reason (see its header, and L-015).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives at <repo>/.truss/tests/ → ENGINE_DIR = <repo>/.truss
const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')
const CLI = path.join(ENGINE_DIR, 'bin', 'truss.mjs')

// The Node version guard is the one legitimate raw exit: it runs before anything
// else, must stay CJS-safe for the error it exists to print, and writes ~100
// bytes to stderr — orders of magnitude under any pipe buffer.
const ALLOWED_RAW_EXIT_BEFORE_LINE = 15

describe('a command never exits on a queued stdout', () => {
  it('bin/truss.mjs routes every exit through exitFlushed', async () => {
    const src = await fs.readFile(CLI, 'utf8')
    const lines = src.split('\n')

    const offenders = []
    let insideHelper = false
    for (const [i, line] of lines.entries()) {
      if (/^async function exitFlushed\(/.test(line)) { insideHelper = true; continue }
      if (insideHelper) { if (line === '}') insideHelper = false; continue }
      if (line.trimStart().startsWith('//')) continue          // the comment may name it
      if (!/(?<!await )process\.exit\(/.test(line)) continue
      if (i + 1 <= ALLOWED_RAW_EXIT_BEFORE_LINE) continue
      offenders.push(`bin/truss.mjs:${i + 1}: ${line.trim()}`)
    }

    assert.deepEqual(offenders, [],
      'call `await exitFlushed(code)` instead of `process.exit(code)`: exiting ' +
      'with bytes still queued truncates piped output silently')
  })

  it('the helper is still there to route them through', async () => {
    const src = await fs.readFile(CLI, 'utf8')
    assert.match(src, /^async function exitFlushed\(code\) \{/m,
      'exitFlushed is the whole mechanism — deleting it re-opens the class')
    assert.match(src, /writableLength/,
      'the drain must wait on what is actually queued')
  })
})

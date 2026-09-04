// .truss/tests/map-bundle.test.mjs — WP-G regression guard.
// doctor avoids a second tree walk by deriving ctx.mdFiles from loadWorkspace's
// single walk (mapMdFilesFromDiskPaths) and feeding it to generateMapContent for
// ST-07. That bundled file set MUST be byte-identical to the standalone map walk,
// otherwise ST-07 false-fires ("map.md outdated") on a freshly generated map.
// The tricky case is symlinks: walkWorkspace and walkMdFiles must agree on them.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { makeRoot } from './helpers.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { loadWorkspace } from '../lib/workspace.mjs'
import { generateMapContent } from '../lib/commands/map.mjs'

async function standaloneVsBundled(root) {
  const standalone = await generateMapContent(root)            // own walk (walkMdFiles)
  const ctx = await loadWorkspace(root)
  const bundled = await generateMapContent(root, ctx.mdFiles)  // reuse single walk
  return { standalone, bundled }
}

describe('WP-G: bundled map walk equals standalone walk', () => {
  it('is byte-identical on a fresh core instance', async () => {
    const root = await makeRoot('truss-mapbundle-')
    await runInit(root, ['--name', 'MB', '--lang', 'English'])
    const { standalone, bundled } = await standaloneVsBundled(root)
    assert.equal(bundled, standalone)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('stays byte-identical when a symlinked .md is present', async () => {
    const root = await makeRoot('truss-mapbundle-sym-')
    await runInit(root, ['--name', 'MB', '--lang', 'English'])
    // A real domain file plus a symlink to it. walkWorkspace must not record the
    // symlink as a file (it is not isFile()), matching the standalone walk.
    await fs.writeFile(path.join(root, 'real-domain.md'), '# Real\n\n> A real domain file.\n')
    try {
      await fs.symlink(path.join(root, 'real-domain.md'), path.join(root, 'linked-domain.md'))
    } catch {
      // Platform without symlink permission — skip the assertion rather than fail.
      await fs.rm(root, { recursive: true, force: true })
      return
    }
    const { standalone, bundled } = await standaloneVsBundled(root)
    assert.equal(bundled, standalone)
    assert.doesNotMatch(bundled, /linked-domain\.md/, 'symlink must not appear in the map')
    await fs.rm(root, { recursive: true, force: true })
  })
})

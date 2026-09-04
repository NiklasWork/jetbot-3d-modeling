// lib/writer.mjs — The single block writer for AGENTS.md (GE-9)
//
// AGENTS.md has exactly two generated blocks (preferences, phase).
// This is the only writer of generated AGENTS.md block contents.
// Commands that render blocks (init, render, set, phase) go through writeBlock().

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTrussMarker } from './md.mjs'

/**
 * Replace the inner content of a truss block in AGENTS.md.
 * Idempotent: running twice with the same content is a no-op (same bytes out).
 *
 * @param {string}   agentsMdPath  absolute path to AGENTS.md
 * @param {string}   blockId       e.g. 'phase' or 'preferences'
 * @param {string[]} newInnerLines lines to write between the markers
 * @throws if markers are missing or unpaired
 */
export async function writeBlock(agentsMdPath, blockId, newInnerLines) {
  const content = await fs.readFile(agentsMdPath, 'utf8')
  const lines = content.split('\n')

  let beginIdx = -1
  let endIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const marker = parseTrussMarker(lines[i])
    if (!marker) continue
    if (marker.id !== blockId) continue
    if (marker.type === 'begin') {
      if (beginIdx !== -1) throw new Error(`writeBlock: duplicate begin marker for '${blockId}'`)
      beginIdx = i
    } else {
      if (endIdx !== -1) throw new Error(`writeBlock: duplicate end marker for '${blockId}'`)
      endIdx = i
    }
  }

  if (beginIdx === -1) throw new Error(`writeBlock: begin marker for '${blockId}' not found in ${agentsMdPath}`)
  if (endIdx === -1) throw new Error(`writeBlock: end marker for '${blockId}' not found — orphan begin`)
  if (endIdx < beginIdx) throw new Error(`writeBlock: end marker for '${blockId}' appears before begin`)

  // Build the new file: everything before begin+1, new inner, everything from end
  const before = lines.slice(0, beginIdx + 1)        // includes begin marker
  const after  = lines.slice(endIdx)                  // includes end marker

  // Ensure no trailing blank line artifact: if last line of file is '', preserve it
  const newLines = [...before, ...newInnerLines, ...after]
  const newContent = newLines.join('\n')

  // Write atomically via temp file if possible, fall back to direct write
  const tmpPath = agentsMdPath + '.tmp'
  try {
    await fs.writeFile(tmpPath, newContent, 'utf8')
    await fs.rename(tmpPath, agentsMdPath)
  } catch {
    // rename may fail across devices or in restricted sandboxes — direct write fallback
    try { await fs.unlink(tmpPath) } catch {}
    await fs.writeFile(agentsMdPath, newContent, 'utf8')
  }
}

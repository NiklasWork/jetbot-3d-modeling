// lib/commands/skills.mjs — install or remove baseline skill groups.

import fs from 'node:fs/promises'
import path from 'node:path'
import { applyTree, writeFileSafe } from '../scaffold.mjs'
import {
  discoverGroups,
  readSelectedGroups,
  SkillSelectionError,
  writeSelectedGroups,
} from '../skill-groups.mjs'

export class SkillsError extends Error {}

async function exists(absPath) {
  try {
    await fs.access(absPath)
    return true
  } catch {
    return false
  }
}

function selectedGroups(groups, selection) {
  if (selection === 'all') return new Set(groups.keys())
  if (!groups.has(selection)) {
    throw new SkillsError(
      `skills: unknown group '${selection}'. Available: ${[...groups.keys()].join(', ')}`,
    )
  }
  return new Set([selection])
}

async function isInstalled(root, assets) {
  const paths = [
    ...assets.skills.map(skill => path.join(root, '.claude', 'skills', skill)),
    ...assets.agents.map(agent => path.join(root, '.claude', 'agents', agent)),
  ]
  return paths.length > 0 && (await Promise.all(paths.map(exists))).every(Boolean)
}

async function addGroup(root, baselineDir, assets) {
  const result = { written: [], skipped: [], errors: [] }
  for (const skill of assets.skills) {
    const copied = await applyTree(
      path.join(baselineDir, '.claude', 'skills', skill),
      path.join(root, '.claude', 'skills', skill),
    )
    result.written.push(...copied.written)
    result.skipped.push(...copied.skipped)
    result.errors.push(...copied.errors)
  }
  for (const agent of assets.agents) {
    const source = path.join(baselineDir, '.claude', 'agents', agent)
    const target = path.join(root, '.claude', 'agents', agent)
    const copied = await writeFileSafe(target, await fs.readFile(source, 'utf8'))
    if (copied.status === 'written') result.written.push(target)
    else if (copied.status === 'skipped-exists') result.skipped.push(target)
    else result.errors.push({ path: target, error: copied.error })
  }
  return result
}

async function treeSnapshot(root, rel = '') {
  let entries
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  } catch {
    return null
  }
  const snapshot = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRel = path.join(rel, entry.name)
    if (entry.isDirectory()) {
      const nested = await treeSnapshot(root, entryRel)
      if (!nested) return null
      snapshot.push({ path: entryRel, type: 'directory' }, ...nested)
    } else if (entry.isFile()) {
      try {
        snapshot.push({
          path: entryRel,
          type: 'file',
          content: await fs.readFile(path.join(root, entryRel)),
        })
      } catch {
        return null
      }
    } else {
      return null
    }
  }
  return snapshot
}

async function treesMatch(source, target) {
  const [sourceTree, targetTree] = await Promise.all([
    treeSnapshot(source),
    treeSnapshot(target),
  ])
  if (!sourceTree || !targetTree || sourceTree.length !== targetTree.length) return false
  return sourceTree.every((entry, index) =>
    entry.path === targetTree[index].path &&
    entry.type === targetTree[index].type &&
    (entry.type !== 'file' || entry.content.equals(targetTree[index].content)),
  )
}

async function filesMatch(source, target) {
  try {
    const [sourceContent, targetContent] = await Promise.all([
      fs.readFile(source),
      fs.readFile(target),
    ])
    return sourceContent.equals(targetContent)
  } catch {
    return false
  }
}

async function removeGroup(root, baselineDir, assets) {
  const result = { removed: [], preserved: [] }
  for (const skill of assets.skills) {
    const source = path.join(baselineDir, '.claude', 'skills', skill)
    const target = path.join(root, '.claude', 'skills', skill)
    if (await exists(target)) {
      if (await treesMatch(source, target)) {
        await fs.rm(target, { recursive: true })
        result.removed.push(target)
      } else {
        result.preserved.push(target)
      }
    }
  }
  for (const agent of assets.agents) {
    const source = path.join(baselineDir, '.claude', 'agents', agent)
    const target = path.join(root, '.claude', 'agents', agent)
    if (await exists(target) && await filesMatch(source, target)) {
      await fs.unlink(target)
      result.removed.push(target)
    } else if (await exists(target)) {
      result.preserved.push(target)
    }
  }
  return result
}

function printList(rows) {
  const widths = {
    group: Math.max('Group'.length, ...rows.map(row => row.group.length)),
    skills: Math.max('Skills'.length, ...rows.map(row => String(row.skills).length)),
    agents: Math.max('Agents'.length, ...rows.map(row => row.agents.length ? String(row.agents).length : 1)),
  }
  console.log(
    `Group${' '.repeat(widths.group - 'Group'.length)} ` +
    `Skills${' '.repeat(widths.skills - 'Skills'.length)} ` +
    `Agents${' '.repeat(widths.agents - 'Agents'.length)} Installed`,
  )
  for (const row of rows) {
    const agents = row.agents || '—'
    console.log(
      `${row.group.padEnd(widths.group)} ${String(row.skills).padEnd(widths.skills)} ` +
      `${String(agents).padEnd(widths.agents)} ${row.installed ? '✓' : '—'}`,
    )
  }
}

export async function runSkills(root, argv) {
  const [subcommand, selection] = argv
  const baselineDir = path.join(root, '.truss', 'baseline')
  if (!(await exists(baselineDir))) {
    throw new SkillsError(`skills: baseline not found at ${baselineDir}`)
  }
  const groups = await discoverGroups(baselineDir)

  if (subcommand === 'list' && argv.length === 1) {
    const rows = await Promise.all([...groups].map(async ([group, assets]) => ({
      group,
      skills: assets.skills.length,
      agents: assets.agents.length,
      installed: await isInstalled(root, assets),
    })))
    printList(rows)
    return rows
  }
  if (!['add', 'remove'].includes(subcommand) || !selection || argv.length !== 2) {
    throw new SkillsError('skills: usage: truss skills <list|add|remove> [group|all]')
  }

  const selected = selectedGroups(groups, selection)
  let enabled
  try {
    enabled = await readSelectedGroups(root, groups)
  } catch (err) {
    if (err instanceof SkillSelectionError) throw new SkillsError(`skills: ${err.message}`)
    throw err
  }
  if (subcommand === 'add') {
    const result = { written: [], skipped: [], errors: [] }
    for (const group of selected) {
      const copied = await addGroup(root, baselineDir, groups.get(group))
      result.written.push(...copied.written)
      result.skipped.push(...copied.skipped)
      result.errors.push(...copied.errors)
    }
    if (result.errors.length) {
      const first = result.errors[0]
      throw new SkillsError(`skills: could not install ${first.path}: ${first.error}`)
    }
    for (const group of selected) enabled.add(group)
    await writeSelectedGroups(root, groups, enabled)
    console.log(`truss skills: added ${[...selected].join(', ')} (${result.written.length} written, ${result.skipped.length} existing)`)
    return result
  }

  const result = { removed: [], preserved: [] }
  for (const group of selected) {
    const removed = await removeGroup(root, baselineDir, groups.get(group))
    result.removed.push(...removed.removed)
    result.preserved.push(...removed.preserved)
    enabled.delete(group)
  }
  await writeSelectedGroups(root, groups, enabled)
  console.log(
    `truss skills: removed ${[...selected].join(', ')} ` +
    `(${result.removed.length} paths, ${result.preserved.length} preserved)`,
  )
  return result
}

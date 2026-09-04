// lib/skill-groups.mjs — discover baseline skill groups without a separate catalog.

import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from './scaffold.mjs'

export const SKILL_SELECTION_REL = '.claude/.truss-skills.json'
export class SkillSelectionError extends Error {}

async function entriesAt(absPath) {
  try {
    return await fs.readdir(absPath, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

function prefixOf(name) {
  const dash = name.indexOf('-')
  return dash === -1 ? null : name.slice(0, dash)
}

/**
 * Scan the baseline's Claude assets and group them by their shared name prefix.
 * A singleton prefix is treated as misc so standalone names such as
 * `code-reviewer.md` do not accidentally become a category.
 *
 * @returns {Promise<Map<string, {skills: string[], agents: string[]}>>}
 */
export async function discoverGroups(baselineDir) {
  const skillsDir = path.join(baselineDir, '.claude', 'skills')
  const agentsDir = path.join(baselineDir, '.claude', 'agents')
  const [skillEntries, agentEntries] = await Promise.all([
    entriesAt(skillsDir),
    entriesAt(agentsDir),
  ])
  const assets = [
    ...skillEntries
      .filter(entry => entry.isDirectory())
      .map(entry => ({ kind: 'skill', name: entry.name })),
    ...agentEntries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => ({ kind: 'agent', name: entry.name })),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const prefixCounts = new Map()
  for (const { name } of assets) {
    const prefix = prefixOf(name)
    if (prefix) prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
  }

  const groups = new Map()
  for (const asset of assets) {
    const prefix = prefixOf(asset.name)
    const group = prefix && prefixCounts.get(prefix) > 1 ? prefix : 'misc'
    if (!groups.has(group)) groups.set(group, { skills: [], agents: [] })
    groups.get(group)[`${asset.kind}s`].push(asset.name)
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/** Build baseline-relative path prefixes for groups omitted from a selection. */
export function buildExcludes(groups, selected) {
  const excludes = new Set()
  for (const [group, assets] of groups) {
    if (selected.has(group)) continue
    for (const skill of assets.skills) excludes.add(`.claude/skills/${skill}`)
    for (const agent of assets.agents) excludes.add(`.claude/agents/${agent}`)
  }
  return excludes
}

/**
 * Parse an init selection into its enabled baseline groups.
 * value === null/undefined means --skills was not given at all: the baseline
 * skills/agents frontmatter (5794 words / ~8.7k tokens, D-069) loads into
 * every host-agent session and Truss cannot see it (.claude/ is .trussignore'd),
 * so the no-flag default is now "install nothing" rather than "install all".
 */
export function selectedGroupsFor(value, groups) {
  if (value == null) return new Set()
  if (value === 'all') return new Set(groups.keys())
  if (value === 'none') return new Set()
  const selected = new Set(value.split(',').map(group => group.trim()).filter(Boolean))
  if (selected.size === 0 || [...selected].some(group => !groups.has(group))) {
    throw new SkillSelectionError(
      `--skills expects all, none, or comma-separated groups: ${[...groups.keys()].join(', ')}`,
    )
  }
  return selected
}

export function selectionContent(groups, selected) {
  if (selected.size === groups.size) return null
  return `${JSON.stringify({ groups: [...selected].sort() }, null, 2)}\n`
}

/**
 * Read explicit opt-ins. Absence means all groups remain enabled, including
 * groups introduced by a future engine upgrade.
 */
export async function readSelectedGroups(root, groups) {
  const configPath = path.join(root, SKILL_SELECTION_REL)
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return new Set(groups.keys())
    throw err
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SkillSelectionError(`invalid skill selection state at ${SKILL_SELECTION_REL}`)
  }
  if (!parsed || !Array.isArray(parsed.groups) || parsed.groups.some(group => typeof group !== 'string')) {
    throw new SkillSelectionError(`invalid skill selection state at ${SKILL_SELECTION_REL}`)
  }
  return new Set(parsed.groups.filter(group => groups.has(group)))
}

/** Persist an opt-in selection; an all-groups selection removes the override. */
export async function writeSelectedGroups(root, groups, selected) {
  const configPath = path.join(root, SKILL_SELECTION_REL)
  const content = selectionContent(groups, selected)
  if (content === null) {
    try {
      await fs.unlink(configPath)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    return
  }
  await writeFileAtomic(configPath, content)
}

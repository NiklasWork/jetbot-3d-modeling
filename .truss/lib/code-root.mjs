// lib/code-root.mjs — canonical configured code-worktree boundary.

import fs from 'node:fs/promises'
import path from 'node:path'

const RESERVED_TOP_LEVEL = new Set([
  '.git', '.truss', 'archive', 'context', 'docs', 'skills', 'state',
])

export class CodeRootError extends Error {}

/** Validate and normalize one workspace-relative directory path. */
export function normalizeCodeRoot(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (raw.includes('\\') || path.posix.isAbsolute(raw)) {
    throw new CodeRootError('code-root must be a relative POSIX directory path')
  }

  const withoutSlash = raw.replace(/\/+$/, '')
  const normalized = path.posix.normalize(withoutSlash)
  const parts = normalized.split('/')
  if (
    !normalized ||
    normalized === '.' ||
    normalized !== withoutSlash ||
    parts.some(
      part => !part || part === '.' || part === '..' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part),
    ) ||
    RESERVED_TOP_LEVEL.has(parts[0])
  ) {
    throw new CodeRootError(
      'code-root must stay inside the workspace and outside Truss-managed directories',
    )
  }
  return normalized
}

function profileCodeRoot(raw) {
  const line = raw
    .split(/\r?\n/)
    .find(item => item.trimStart().toLowerCase().startsWith('code-root:'))
  if (!line) return { present: false, value: null }
  return {
    present: true,
    value: line.slice(line.indexOf(':') + 1).trim(),
  }
}

async function isDirectory(absPath) {
  try { return (await fs.stat(absPath)).isDirectory() }
  catch { return false }
}

/**
 * Resolve the configured code root. Older overlay workspaces without the
 * profile key retain their historical repo/ default.
 */
export async function resolveCodeRoot(root) {
  let parsed = { present: false, value: null }
  try {
    parsed = profileCodeRoot(
      await fs.readFile(path.join(root, 'state', 'profile.md'), 'utf8'),
    )
  } catch { /* an uninitialised workspace has no profile yet */ }

  if (parsed.present && parsed.value) {
    try {
      const rel = normalizeCodeRoot(parsed.value)
      return {
        rel,
        abs: path.join(root, ...rel.split('/')),
        source: 'profile',
        error: null,
      }
    } catch (err) {
      return {
        rel: null,
        abs: null,
        source: 'profile',
        error: err.message,
        raw: parsed.value,
      }
    }
  }

  const legacyRepo = path.join(root, 'repo')
  if (!parsed.present && await isDirectory(legacyRepo)) {
    return { rel: 'repo', abs: legacyRepo, source: 'legacy-overlay', error: null }
  }

  return { rel: null, abs: null, source: parsed.present ? 'profile' : 'none', error: null }
}

export async function assertExistingCodeRoot(root, value) {
  const rel = normalizeCodeRoot(value)
  const abs = path.join(root, ...rel.split('/'))
  if (!await isDirectory(abs)) {
    throw new CodeRootError(`code-root directory does not exist: ${rel}/`)
  }
  return { rel, abs }
}

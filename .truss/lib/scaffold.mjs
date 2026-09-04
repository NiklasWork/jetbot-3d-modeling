// lib/scaffold.mjs — atomic/no-overwrite whole-file primitives for init.
//
// Contract (A3):
//   - Atomic: temp file + rename. A failed rename is an error; there is no
//     direct-write fallback that can leave a truncated destination.
//   - Never overwrites: if the destination already exists, it is left untouched
//     and reported as 'skipped-exists'. No silent clobbering of existing work.
//   - Returns a status per file so callers can build a bundled conflict report.
//
// Zero external dependencies — node: built-ins only.

import fs from 'node:fs/promises'
import path from 'node:path'

function isExcluded(rel, exclude) {
  if (!exclude) return false
  const normalized = rel.split(path.sep).join('/')
  return [...exclude].some(prefix =>
    normalized === prefix || normalized.startsWith(`${prefix}/`),
  )
}

/** Atomically create or replace a whole file. Throws without touching the target on failure. */
export async function writeFileAtomic(absPath, content) {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const tmpPath = `${absPath}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmpPath, content, 'utf8')
    await fs.rename(tmpPath, absPath)
  } catch (err) {
    try { await fs.unlink(tmpPath) } catch {}
    throw err
  }
}

/**
 * Read and inventory a source tree before init writes. Existing destination
 * files are conflicts to preserve; non-directory parent components are fatal.
 */
export async function inventoryTree(srcDir, destDir, { exclude = null } = {}) {
  const result = { files: [], conflicts: [], errors: [] }

  const walk = async (relDir) => {
    const absSrcDir = path.join(srcDir, relDir)
    let entries
    try { entries = await fs.readdir(absSrcDir, { withFileTypes: true }) }
    catch (err) {
      result.errors.push({ path: absSrcDir, error: err.message })
      return
    }

    for (const entry of entries) {
      const rel = relDir ? path.join(relDir, entry.name) : entry.name
      if (isExcluded(rel, exclude)) continue
      if (entry.isDirectory()) {
        await walk(rel)
        continue
      }
      if (!entry.isFile()) continue

      const absSrc = path.join(srcDir, rel)
      const absDest = path.join(destDir, rel)
      try { await fs.readFile(absSrc, 'utf8') }
      catch (err) {
        result.errors.push({ path: absSrc, error: err.message })
        continue
      }

      let parent = path.dirname(absDest)
      while (parent !== destDir && parent.startsWith(destDir + path.sep)) {
        try {
          const stat = await fs.lstat(parent)
          if (!stat.isDirectory()) {
            result.errors.push({ path: parent, error: 'destination parent is not a directory' })
            break
          }
        } catch (err) {
          if (err.code !== 'ENOENT') result.errors.push({ path: parent, error: err.message })
        }
        parent = path.dirname(parent)
      }

      try {
        const targetStat = await fs.lstat(absDest)
        if (!targetStat.isFile()) {
          result.errors.push({ path: absDest, error: 'destination exists but is not a regular file' })
        } else {
          result.conflicts.push(absDest)
        }
      } catch (err) {
        if (err.code !== 'ENOENT') result.errors.push({ path: absDest, error: err.message })
      }
      result.files.push({ rel, absSrc, absDest })
    }
  }

  await walk('')
  return result
}

/**
 * Write a whole file atomically, never overwriting an existing destination.
 *
 * Creates parent directories as needed, then uses writeFileAtomic. The
 * no-overwrite guard is checked first via
 * fs.access — there is an inherent TOCTOU window, but truss init/add run
 * single-threaded against a quiescent workspace, so a concurrent creator is out
 * of scope (one root agent at a time, STRUKTUR §8 "Concurrent Agents").
 *
 * @param {string} absPath  Absolute path of the destination file.
 * @param {string} content  Full file contents to write.
 * @returns {Promise<{status: 'written'|'skipped-exists'|'error', path: string, error?: string}>}
 *   - 'written'        the file did not exist and was created.
 *   - 'skipped-exists' the file already existed and was left untouched.
 *   - 'error'         the write failed; `error` carries the message.
 */
export async function writeFileSafe(absPath, content) {
  // No-overwrite guard (A3): an existing destination is a conflict, never clobbered.
  try {
    await fs.access(absPath)
    return { status: 'skipped-exists', path: absPath }
  } catch {
    // Does not exist — proceed to write.
  }

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true })
  } catch (err) {
    return { status: 'error', path: absPath, error: err.message }
  }

  try {
    await writeFileAtomic(absPath, content)
    return { status: 'written', path: absPath }
  } catch (err) {
    return { status: 'error', path: absPath, error: err.message }
  }
}

/**
 * Recursively copy every file under `srcDir` into `destDir`, mirroring the
 * relative layout. Each file goes through writeFileSafe, so existing files in
 * the destination are never overwritten — they are collected as `skipped`.
 *
 * Directories are created implicitly by writeFileSafe (an empty source
 * directory produces no destination directory — truss has no empty-folder
 * concept, AGENTS.md §5).
 *
 * @param {string} srcDir   Absolute path of the source tree (e.g. the baseline).
 * @param {string} destDir  Absolute path of the destination root (e.g. the workspace root).
 * @returns {Promise<{written: string[], skipped: string[], errors: Array<{path: string, error: string}>}>}
 *   Paths are absolute destination paths. `errors` pairs each failed path with its message.
 */
export async function applyTree(srcDir, destDir, { exclude = null } = {}) {
  const result = { written: [], skipped: [], errors: [] }

  /** @param {string} relDir  path relative to srcDir, '' at the root */
  const walk = async (relDir) => {
    const absSrcDir = path.join(srcDir, relDir)
    let entries
    try {
      entries = await fs.readdir(absSrcDir, { withFileTypes: true })
    } catch (err) {
      result.errors.push({ path: absSrcDir, error: err.message })
      return
    }

    for (const entry of entries) {
      const rel = relDir ? path.join(relDir, entry.name) : entry.name
      if (isExcluded(rel, exclude)) continue
      if (entry.isDirectory()) {
        await walk(rel)
      } else if (entry.isFile()) {
        const absSrc = path.join(srcDir, rel)
        const absDest = path.join(destDir, rel)
        let content
        try {
          content = await fs.readFile(absSrc, 'utf8')
        } catch (err) {
          result.errors.push({ path: absSrc, error: err.message })
          continue
        }
        const r = await writeFileSafe(absDest, content)
        if (r.status === 'written') result.written.push(r.path)
        else if (r.status === 'skipped-exists') result.skipped.push(r.path)
        else result.errors.push({ path: r.path, error: r.error })
      }
      // Symlinks and other entry types are intentionally ignored — the baseline
      // is a plain file tree.
    }
  }

  await walk('')
  return result
}

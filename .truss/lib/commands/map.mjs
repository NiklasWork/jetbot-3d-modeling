import fs from 'node:fs/promises';
import path from 'node:path';
import { loadIgnore } from '../ignore.mjs';
import { resolveCodeRoot } from '../code-root.mjs';
import { wordCount, toTokens } from '../context-budget.mjs';

// ── Per-file read-cost estimate (~Tokens column) ──────────────────────────
// Rationale: show what exists AND its retrieval cost, so an agent can make an
// informed load decision instead of treating "on demand" as a binary category.
// Same estimation method as the boot-budget (lib/context-budget.mjs, words × 1.5)
// so the two never disagree on methodology.
//
// Values are rounded coarsely (2-ish significant figures) because they are a
// nudge, not an accounting figure — and coarse values keep the map visually
// stable across small edits. Token drift alone does NOT mark the map outdated:
// ST-07 compares maps with the tokens column stripped (mapComparisonKey below),
// so doctor stays quiet when only word counts move. Fresh values arrive with
// the next `truss map` run.

// Full-content read cap. Markdown beyond this is almost certainly bulk data
// that belongs in .trussignore; estimate from byte size instead of loading it.
const TOKEN_READ_CAP_BYTES = 2 * 1024 * 1024;
const BYTES_PER_WORD_ESTIMATE = 6; // rough md average, used only above the cap

// Round + format a token estimate for display: <1000 → nearest 10 (`~340`),
// ≥1000 → nearest 100 shown as k (`~1.2k`). Minimum shown value is ~10.
export function formatTokens(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return '~10';
  if (tokens < 1000) {
    const rounded = Math.max(10, Math.round(tokens / 10) * 10);
    if (rounded < 1000) return `~${rounded}`;
    // 995–999 round up to 1000 → fall through to the k format below.
  }
  const k = Math.round(tokens / 100) / 10;
  return k >= 10 ? `~${Math.round(k)}k` : `~${k}k`;
}

// Comparison key for ST-07 freshness checks: newline-normalised, trimmed, and
// with the LAST cell of every table row removed (that is the volatile ~Tokens
// column; titles/descriptions have their pipes escaped, so the last `|` pair is
// a reliable cell boundary). Applied to both the generated and the on-disk map,
// so structural drift still fires while token drift alone does not. An
// old-format (3-column) map on disk still compares unequal to a new 4-column
// map — normalising both sides removes one column from each, leaving 2 vs 3.
export function mapComparisonKey(content) {
  return content
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\r?\n/)
    .map(line => line.trimEnd().startsWith('|') && line.trimEnd().endsWith('|')
      ? line.trimEnd().replace(/\|[^|]*\|$/, '|')
      : line)
    .join('\n');
}

// Directories the map skips entirely (engine-internal or summary-managed). A dir
// with one of these names is skipped at any depth. Exported as the single source
// of truth so doctor can reproduce the same file set without a second walk.
export const MAP_SKIP_DIRS = new Set(['.truss', '.git', '.github', 'node_modules', 'packages', 'archive']);

// Directories the map skips by their EXACT relative path, not by bare name.
// state/decisions/ (D-087) holds one body per decision — listing 40+ rows with
// individual read-cost estimates would bury the domain files the map exists to
// show, and the decision index already is that listing. Path-keyed rather than
// name-keyed on purpose: a project's own context/decisions/ must stay mapped.
export const MAP_SKIP_PATHS = new Set(['state/decisions']);

// True for a path inside a MAP_SKIP_PATHS directory (or the directory itself).
export const isMapSkippedPath = (rel) =>
  MAP_SKIP_PATHS.has(rel) || [...MAP_SKIP_PATHS].some(d => rel.startsWith(`${d}/`));

// Files the map skips (AI-agent adapter stubs), matched by lowercase basename.
export const MAP_SKIP_FILES = new Set(['claude.md', 'gemini.md', 'roo_code.md', 'cursor.md']);

// Bounded-rendering thresholds (shared by generateMapContent and the runMap guard).
export const COLLAPSE_THRESHOLD = 25;   // md files under one non-core top-level dir → collapse
export const MAX_ROWS_PER_GROUP = 50;   // hard cap on rows rendered per group
const CORE_TOPLEVEL = new Set(['', 'state', 'docs', 'context']); // '' = root-level files

// Non-core top-level dirs whose md-file count exceeds COLLAPSE_THRESHOLD. These
// are folded into a single "bulk data" node instead of being enumerated, and are
// what the runMap guard warns about before overwriting map.md.
export function collapsedTopLevels(mdFiles) {
  const counts = new Map();
  for (const f of mdFiles) {
    const top = f.includes('/') ? f.split('/')[0] : '';
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  const collapsed = new Map();
  for (const [t, c] of counts) {
    if (!CORE_TOPLEVEL.has(t) && c > COLLAPSE_THRESHOLD) collapsed.set(t, c);
  }
  return collapsed;
}

// Load the ignore layer and return the map's md-file set (used by runMap for both
// the pre-write guard and generation, avoiding a second tree walk).
export async function scanMapTree(root) {
  const { isIgnored } = await loadIgnore(root);
  const codeRoot = await resolveCodeRoot(root);
  return walkMdFiles(root, isIgnored, codeRoot.rel);
}

// Standalone recursive walk for the markdown files the map covers. Used by
// `truss map` and init, where no precomputed path list exists.
// `isIgnored` (from lib/ignore.mjs) is loaded once here and applied per entry so
// user-excluded / gitignored trees never reach the map. When omitted (tests,
// legacy callers) it is loaded from `root`.
async function walkMdFiles(root, isIgnored, codeRootRel = null) {
  if (!isIgnored) isIgnored = (await loadIgnore(root)).isIgnored;
  const mdFiles = [];
  async function walk(dirRel) {
    const abs = path.join(root, dirRel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rel === codeRootRel) continue;
        const isCodeRootParent = codeRootRel?.startsWith(`${rel}/`);
        if (MAP_SKIP_DIRS.has(entry.name) && !isCodeRootParent) continue;
        if (MAP_SKIP_PATHS.has(rel)) continue;
        if (isIgnored(rel, true)) continue; // user-declared / gitignored tree
        // Sequential traversal avoids EMFILE limits from massive directory trees
        await walk(rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (MAP_SKIP_FILES.has(entry.name.toLowerCase())) continue;
        if (isIgnored(rel, false)) continue;
        mdFiles.push(rel);
      }
    }
  }
  await walk('');
  return mdFiles;
}

// Reduce a precomputed disk-path list (from loadWorkspace's single tree walk)
// to the EXACT md-file set walkMdFiles would produce, so doctor/ST-07 can reuse
// that walk instead of running a second one. Same SKIP rules, per path segment.
export function mapMdFilesFromDiskPaths(diskPaths, isIgnored, codeRootRel = null) {
  return diskPaths.filter(rel => {
    if (rel.endsWith('/') || !rel.endsWith('.md')) return false;
    if (codeRootRel && (rel === codeRootRel || rel.startsWith(`${codeRootRel}/`))) {
      return false;
    }
    const segs = rel.split('/');
    if (segs.some(s => MAP_SKIP_DIRS.has(s))) return false;
    if (isMapSkippedPath(rel)) return false;
    if (MAP_SKIP_FILES.has(segs[segs.length - 1].toLowerCase())) return false;
    // diskPaths from walkWorkspace are already ignore-filtered; re-checking here
    // keeps this a pure, self-consistent filter matching walkMdFiles for callers
    // that pass a raw path list.
    if (isIgnored && isIgnored(rel, false)) return false;
    return true;
  });
}

/**
 * Generate map content grouping paths by folder. Pass a precomputed `mdFilesInput`
 * (e.g. from mapMdFilesFromDiskPaths) to skip the standalone walk; omit it to walk.
 * Output is identical either way — files are grouped and sorted deterministically.
 */
export async function generateMapContent(root, mdFilesInput) {
  let mdFiles;
  if (mdFilesInput) {
    mdFiles = [...mdFilesInput];
  } else {
    const codeRoot = await resolveCodeRoot(root);
    mdFiles = await walkMdFiles(root, undefined, codeRoot.rel);
  }

  if (!mdFiles.includes('state/map.md')) {
    mdFiles.push('state/map.md');
  }

  const validFileData = [];
  const BATCH_SIZE = 50;

  // Process files in batches to combine parallel speed with EMFILE safety
  for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
    const batch = mdFiles.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (file) => {
      const abs = path.join(root, file);
      
      if (file === 'state/map.md') {
        // Self-referential row: the reader already has this file open, so a
        // read-cost estimate would be useless — mark it as not applicable.
        validFileData.push({ file, group: '/state', title: 'Truss Map', description: 'Auto-generated overview of domain files. Do not edit manually.', tokens: null });
        return;
      }

      try {
        const stat = await fs.stat(abs);
        let topContent;
        let tokens;
        if (stat.size > TOKEN_READ_CAP_BYTES) {
          // Bulk file (belongs in .trussignore): read only the head for
          // title/description, estimate the read cost from byte size.
          const fh = await fs.open(abs, 'r');
          try {
            const buffer = Buffer.alloc(2048);
            const { bytesRead } = await fh.read(buffer, 0, 2048, 0);
            topContent = buffer.toString('utf8', 0, bytesRead);
          } finally {
            await fh.close().catch(() => {});
          }
          tokens = toTokens(Math.round(stat.size / BYTES_PER_WORD_ESTIMATE));
        } else {
          const content = await fs.readFile(abs, 'utf8');
          topContent = content.slice(0, 2048);
          tokens = toTokens(wordCount(content));
        }

        // Frontmatter is state, not prose (U5: domain files carry focus:/next:/
        // blockers: there). It must not reach the title/description scan below:
        // a YAML comment inside it — `# TODO: split this file` — matches the
        // `^#\s+` title pattern and becomes the map entry's title. Anchored at
        // the very start, so a document that merely opens with a horizontal
        // rule is untouched.
        topContent = topContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

        let title = '';
        let description = '*[No description]*';

        const titleMatch = topContent.match(/^#\s+(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();
        else title = path.basename(file, '.md'); // Fallback

        const descMatch = topContent.match(/^>\s+(.+)$/m);
        if (descMatch) description = descMatch[1].trim();

        // Escape pipe characters to prevent Markdown table injection
        title = title.replace(/\|/g, '&#124;');
        description = description.replace(/\|/g, '&#124;');
        
        // Strip newlines to prevent markdown breakage
        title = title.replace(/[\r\n]/g, ' ');
        description = description.replace(/[\r\n]/g, ' ');

        // Platform independent group building
        const parts = file.split('/');
        const group = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/';
        
        validFileData.push({ file, group, title, description, tokens });
      } catch {
        // Ignore read errors
      }
    }));
  }

  // ── Bounded rendering (defence in depth) ────────────────────────────────
  // Even with the ignore layer, a legitimate-but-large tree (a big docs export,
  // a data dir a user forgot to exclude) must not turn the map into a wall of
  // rows. Any NON-core top-level directory contributing more than
  // COLLAPSE_THRESHOLD md files is folded into a single "bulk data" node instead
  // of being enumerated; individual groups are also capped by MAX_ROWS_PER_GROUP.
  const collapsed = collapsedTopLevels(validFileData.map(fd => fd.file));

  // Group by folder, folding collapsed top-level trees into one synthetic row.
  const grouped = new Map();
  for (const fd of validFileData) {
    const top = fd.file.includes('/') ? fd.file.split('/')[0] : '';
    if (collapsed.has(top)) {
      const g = `/${top}`;
      if (!grouped.has(g)) {
        grouped.set(g, [{
          file: `${top}/`,
          group: g,
          title: 'bulk data',
          description: `${collapsed.get(top)} files, unmapped — add \`${top}/\` to .trussignore to exclude`,
          tokens: null,
          _collapsed: true,
        }]);
      }
      continue;
    }
    if (!grouped.has(fd.group)) grouped.set(fd.group, []);
    grouped.get(fd.group).push(fd);
  }

  // Deterministic sorting
  const sortedGroups = [...grouped.keys()].sort((a, b) => a < b ? -1 : (a > b ? 1 : 0));

  let mdContent = `# Truss Map\n\n> Auto-generated overview of domain files. Do not edit manually. ~Tokens ≈ estimated read cost per file (words × 1.5, coarsely rounded) — weigh it before loading.\n\n`;

  for (const group of sortedGroups) {
    mdContent += `## ${group}\n\n`;
    mdContent += `| File | Title | Description | ~Tokens |\n`;
    mdContent += `|---|---|---|---|\n`;

    const items = grouped.get(group).sort((a, b) => a.file < b.file ? -1 : (a.file > b.file ? 1 : 0));
    const shown = items.slice(0, MAX_ROWS_PER_GROUP);
    for (const item of shown) {
      const cost = item.tokens == null ? '—' : formatTokens(item.tokens);
      mdContent += `| \`${item.file}\` | ${item.title} | ${item.description} | ${cost} |\n`;
    }
    if (items.length > MAX_ROWS_PER_GROUP) {
      mdContent += `| … | *${items.length - MAX_ROWS_PER_GROUP} more files* | *capped for readability — narrow scope via .trussignore* | — |\n`;
    }
    mdContent += `\n`;
  }

  return mdContent;
}

export async function runMap(root, args) {
  // Init guard: map is meaningless without a Truss workspace.
  try {
    await fs.access(path.join(root, 'AGENTS.md'));
  } catch {
    console.log('This folder is not a Truss workspace yet. Run `truss init` first.');
    process.exit(0);
  }

  try {
    // Single walk, reused for the pre-write guard and generation.
    const mdFiles = await scanMapTree(root);

    // Guard the destructive action: warn (non-blocking, so a non-interactive
    // `map` run still completes) before overwriting map.md
    // when a large unmapped tree is about to be folded in. This doubles as the
    // discovery UI for .trussignore.
    const collapsed = collapsedTopLevels(mdFiles);
    if (collapsed.size > 0) {
      const list = [...collapsed].map(([t, c]) => `${t}/ (${c} files)`).join(', ');
      console.warn(
        `truss map: heads-up — large unmapped tree(s) folded into a single "bulk data" node: ${list}.\n` +
        `           If this is foreign/bulk data, add it to .trussignore to drop it from the map and doctor entirely.`
      );
    }

    const content = await generateMapContent(root, mdFiles);
    const stateDir = path.join(root, 'state');
    await fs.mkdir(stateDir, { recursive: true });

    const mapPath = path.join(stateDir, 'map.md');
    await fs.writeFile(mapPath, content, 'utf8');

    console.log(`truss map: successfully generated state/map.md`);
  } catch (err) {
    console.error(`truss map: failed — ${err.message}`);
    process.exit(2);
  }
}

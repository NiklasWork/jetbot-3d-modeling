// checks/rf.mjs — Reference checks (RF-01 … RF-03)
//
// RF-01  E  relative markdown link doesn't resolve to an existing file/anchor
// RF-02  W  structured ID referenced but not defined anywhere
// RF-03  E  structured ID defined more than once

import fs from 'node:fs/promises'
import path from 'node:path'
import { headingToAnchor } from '../lib/md.mjs'
import { locationForNewEntry } from '../lib/schema.mjs'

// Declarative catalog of the checks this module implements (A2).
export const meta = [
  { id: 'RF-01', severity: 'E', title: 'Relative markdown link does not resolve' },
  { id: 'RF-02', severity: 'W', title: 'Referenced ID has no definition' },
  { id: 'RF-03', severity: 'E', title: 'ID defined more than once' },
];

// Which prefixes are "structured" and therefore require a definition is not a
// constant here: it is whatever docs/schema.md lists (D-079, lib/schema.mjs).
// A project that adds a class gets RF-02/RF-03 on it without touching code.

// Files exempt from RF-01 link checking (e.g., external links, anchors-only links)
function isExternalLink(href) {
  return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
}

function isAnchorOnlyLink(href) {
  return href.startsWith('#');
}

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Array<Finding>}
 */
export async function run(ctx) {
  const findings = [];
  const { root, files, idDefs, idRefs } = ctx;
  const classById = new Map((ctx.schema?.classes || []).map(c => [c.id, c]));

  // ── RF-01: relative links must resolve ────────────────────────────────
  for (const [relPath, fileCtx] of files) {
    const fileDir = path.dirname(relPath);

    for (const { text, href, line } of fileCtx.links) {
      if (isExternalLink(href)) continue;

      // Split href into file path and anchor
      const [filePart, anchor] = href.split('#');

      if (!filePart) {
        // Anchor-only link within the same file
        if (anchor) {
          const headings = fileCtx.headings;
          const normalised = headingToAnchor(anchor);
          const exists = headings.some(h => h.anchor === normalised || h.anchor === anchor.toLowerCase());
          if (!exists) {
            findings.push({
              id: 'RF-01', severity: 'E',
              file: relPath, line,
              message: `broken anchor link [${text}](#${anchor}) — heading not found in this file`,
              fix: `Fix the anchor or add a heading matching '#${anchor}'`,
              // Group by the missing heading, not by the link text: the same dead
              // anchor linked from ten places is one defect (see dedupeFindings).
              dedupeKey: `anchor:${relPath}#${normalised}`,
            });
          }
        }
        continue;
      }

      // Resolve the file path relative to the linking file, handling absolute repo paths and URL encoding
      const decodedFilePart = decodeURIComponent(filePart);
      const resolved = path.normalize(
        decodedFilePart.startsWith('/')
          ? decodedFilePart.slice(1)
          : path.join(fileDir === '.' ? '' : fileDir, decodedFilePart)
      );
      const targetRel = resolved.replace(/\\/g, '/'); // normalise on Windows
      const absTarget = path.join(root, targetRel);

      let targetExists = false;
      let targetFileCtx = null;
      try {
        await fs.access(absTarget);
        targetExists = true;
        targetFileCtx = files.get(targetRel) || null;
      } catch { /* file doesn't exist */ }

      if (!targetExists) {
        findings.push({
          id: 'RF-01', severity: 'E',
          file: relPath, line,
          message: `broken link [${text}](${href}) — target file '${targetRel}' does not exist`,
          fix: `Create '${targetRel}' or fix the link path`,
          dedupeKey: `target:${targetRel}`,
        });
        continue;
      }

      // Check anchor in target file
      if (anchor && targetFileCtx) {
        const normalised = headingToAnchor(anchor);
        const exists = targetFileCtx.headings.some(
          h => h.anchor === normalised || h.anchor === anchor.toLowerCase()
        );
        if (!exists) {
          findings.push({
            id: 'RF-01', severity: 'E',
            file: relPath, line,
            message: `broken anchor link [${text}](${href}) — heading '#${anchor}' not found in '${targetRel}'`,
            fix: `Fix the anchor or add a matching heading in '${targetRel}'`,
            dedupeKey: `anchor:${targetRel}#${normalised}`,
          });
        }
      } else if (anchor && !targetFileCtx) {
        // File exists but we didn't load it (e.g. inside .truss/) — skip anchor check
      }
    }
  }

  // ── RF-02: referenced IDs must be defined ─────────────────────────────
  // Scope: only operational files (state/, AGENTS.md, HUMAN-TODOS.md,
  // domain files). The docs/ filter below is a safety net, not the reason docs/
  // is quiet: while the §2 table carries `docs/` as a directory row, loadWorkspace
  // never loads those files at all — directory rows are skipped, and only context/
  // and archive/ get a second pass. A project that lists docs/<file>.md
  // individually DOES load them, and then this filter is what keeps IDs used as
  // format examples from being read as real references.
  // An OD entry is REMOVED when it is decided (no tombstones, AGENTS.md §3): its
  // permanent trace is the `Closes: OD-NNN` line in the deciding D-entry. That
  // makes the id legitimately undefined — so a decision naming the question it
  // closed must not be flagged, or the no-tombstone rule would forbid writing a
  // readable rationale.
  const closedIds = new Set();
  for (const fileCtx of files.values()) {
    for (const line of fileCtx.lines || []) {
      const m = line.match(/^\s*Closes:\s*(.+)$/);
      if (m) for (const tok of m[1].match(/[A-Z]+-\d+/g) || []) closedIds.add(tok);
    }
  }

  for (const [id, allRefs] of idRefs) {
    const prefix = id.split('-')[0];
    const cls = classById.get(prefix);
    if (!cls) continue;
    if (idDefs.has(id)) continue;
    if (closedIds.has(id)) continue;

    // Filter to operational files only
    const operationalRefs = allRefs.filter(
      r => !r.file.startsWith('docs/')
    );
    if (operationalRefs.length === 0) continue;

    const first = operationalRefs[0];
    findings.push({
      id: 'RF-02', severity: 'W',
      file: first.file, line: first.line,
      message: `reference to '${id}' but no definition found in any file`,
      // The schema names the file, so this text cannot go stale the way a
      // hard-coded list did when the decision log became a directory (D-087) —
      // and it names the layout this workspace actually uses, not the one the
      // schema prefers, so a workspace still on a single decisions.md is not
      // told to create a file in a directory it does not keep.
      // Third way out, and the one with no other signpost: two Truss workspaces
      // that talk to each other share the grammar and therefore the ID namespace.
      // Filing another instance's report is the channel state/truss-findings.md
      // exists for, and it made the receiver warn about ids that were never
      // theirs to define (TF-002). Inline code already reads as a quotation —
      // the parser skips it — so the fix is one backtick pair, and it belongs in
      // this line rather than only in a rules file: this is what actually gets
      // read when the warning fires.
      fix: `Define '${id}' in ${locationForNewEntry(ctx, cls, id)}, in the form '${cls.formText}' (docs/schema.md). If it was decided and removed, the deciding entry's 'Closes: ${id}' line is the trace — point the reference at that entry instead. If '${id}' belongs to ANOTHER workspace (quoting a report someone else's Truss produced), wrap it in inline code — \`${id}\` — which reads it as a quotation instead of a reference.`,
    });
  }

  // ── RF-03: IDs must not be defined more than once ─────────────────────
  for (const [id, defs] of idDefs) {
    if (defs.length > 1) {
      const locations = defs.map(d => `${d.file}:${d.line}`).join(', ');
      findings.push({
        id: 'RF-03', severity: 'E',
        file: defs[0].file, line: defs[0].line,
        message: `'${id}' is defined ${defs.length} times (${locations})`,
        fix: `Keep exactly one definition of '${id}'; remove or supersede the duplicates`,
      });
    }
  }

  return findings;
}

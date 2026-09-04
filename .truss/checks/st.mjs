// checks/st.mjs — Structure Table checks (ST-01 … ST-05)
//
// ST-01  E  path from structure table doesn't exist on disk
// ST-02  W  disk path not yet listed in structure table (hint); I when the path
//           was a routing target retired by an engine change (RETIRED_PATHS) —
//           a retired path is not an unknown one, same distinction PH-01 makes
//           for phase keys and BL-03 for preference keys (D-081)
// ST-03  W  empty directory (table-managed)
// ST-04  W  adapter stub deviates from expected one-liner
// ST-05  I  file has more than 450 lines (growth-rule hint)
// ST-09  I  engine file(s) diverged from .truss/MANIFEST.sha256 (silent if absent)
// ST-10  I/W decision index absent (I) or out of step with decisions.md (W)
// ST-11  W  docs/schema.md holds a row the engine had to drop (that class stops being checked)

import fs from 'node:fs/promises'
import path from 'node:path'
import { ADAPTER_STUBS, STUB_PATTERNS, SUMMARY_DIRS } from '../lib/workspace.mjs'
import { generateMapContent, mapComparisonKey } from '../lib/commands/map.mjs'
import { verifyEngine } from '../lib/engine-manifest.mjs'
import { renderIndex, parseDecisionSource, readDecisionSource, isLegacyIndex, INDEX_REL, SOURCE_REL, DECISIONS_DIR } from '../lib/decisions-index.mjs'

// Declarative catalog of the checks this module implements (A2).
// Lets consumers (--json) enumerate ALL checks, not only fired ones.
// Additive metadata only — does not affect run() or the finding shape.
export const meta = [
  { id: 'ST-01', severity: 'E', title: 'Structure-table path missing on disk' },
  { id: 'ST-02', severity: 'W', title: 'New file — not yet in structure table (hint, not error)', description: 'I instead of W for a path in RETIRED_PATHS (D-081) — retired is not unknown' },
  { id: 'ST-03', severity: 'W', title: 'Empty table-managed directory' },
  { id: 'ST-04', severity: 'W', title: 'Adapter stub does not point to AGENTS.md' },
  { id: 'ST-05', severity: 'I', title: 'File exceeds growth-rule line limit (450)' },
  { id: 'ST-06', severity: 'E', title: 'AGENTS.md or its §2 structure table could not be parsed', description: 'Guards against silent degradation (A4): an empty table makes ST-01/ST-02 vacuous' },
  { id: 'ST-07', severity: 'W', title: 'Truss map is outdated', description: 'state/map.md does not match the actual workspace markdown files' },
  { id: 'ST-08', severity: 'W', title: 'AGENTS.md is missing a numbered top-level section', description: '§1–§6 are the contract every prompt, doc and check cross-references' },
  { id: 'ST-09', severity: 'I', title: 'Engine file differs from the release manifest', description: 'D-070: fires only when .truss/MANIFEST.sha256 exists — silent on instances or test workspaces without one' },
  { id: 'ST-10', severity: 'W', title: 'Decision index missing, out of step, or holding an entry it cannot address', description: 'D-075/D-081/D-087: info while the index has never been generated or is still in the pre-D-087 format (steps not taken, not defects); warning once it exists and disagrees with the source, or when a decision body sits where the index can never reach it — a stale or incomplete index lies to every session boot' },
  { id: 'ST-11', severity: 'W', title: 'docs/schema.md holds a row the engine cannot use', description: 'D-079: the entry classes are read from this file. Any row the engine drops switches RF-02, RF-03 and SY-03 off for that class in silence; a file that is not a Truss schema at all (no Class-headed table) is not reported, so an unrelated docs/schema.md stays green' },
];

// Top-level paths that were a valid §2 routing target before an engine change
// retired them, mapped to why. A retired path is not an unknown path: an
// instance that still has it on disk must not flip from green to a W the day
// this table changes (D-081) — same precedent as RETIRED_KEYS in checks/ph.mjs
// (phase keys) and checks/bl.mjs (preference keys, via lib/prefs.mjs).
// U6/D-074: project-wide planning routing through `pm/` retired — it was never
// loaded or checked (docs/concepts.md), the present-but-unvalidated trap this
// change closes. Keyed by the bare directory name (no trailing slash).
const RETIRED_PATHS = new Map([
  ['pm', 'project-wide planning routing was retired (U6/D-074) — it now belongs in a domain file under context/ (loaded and checked like any other); bulk artefacts that should stay unchecked belong in .trussignore'],
])

// Paths that exist on disk but are intentionally not in the structure table
// (system files, adapter stubs handled by ST-04, gitignore, etc.)
const DISK_EXCLUDE = new Set([
  // The legacy single-file decision log (D-087). Still fully supported and
  // still loaded (lib/workspace.mjs migration bridge), just no longer a table
  // row. Belt and braces: ST-02 already skips everything under state/, because
  // the `(on demand)` row for state/decisions-index.md makes `state` a dynamic
  // summary dir — a pre-existing gap this entry does not depend on. Not a
  // RETIRED_PATH either: nothing about this path is retired, it is one of two
  // valid layouts.
  'state/decisions.md',
  'LICENSE',
  '.gitignore',
  '.trussignore',
  '.prettierrc',
  '.env.example',
  ...ADAPTER_STUBS,
  ...ADAPTER_STUBS.map(s => s.includes('/') ? s.split('/')[0] + '/' : null).filter(Boolean),
  // .truss/ is in the table; its contents are excluded from ST-02
]);

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Array<Finding>}
 */
export async function run(ctx) {
  const findings = [];
  const { root, structureTable, diskPaths } = ctx;

  // ── ST-06: parse-degradation guard (A4) ────────────────────────────────
  // An empty structure table makes ST-01/ST-02 vacuously pass — doctor would go
  // green at near-zero coverage. Flag the cause instead of failing silently.
  if (ctx.agentsMissing) {
    findings.push({
      id: 'ST-06', severity: 'E',
      file: 'AGENTS.md',
      message: 'AGENTS.md not found — structure-table checks cannot run',
      fix: 'Restore AGENTS.md at the workspace root (it holds the §2 structure table and the generated blocks)',
    });
  } else if (structureTable.length === 0) {
    findings.push({
      id: 'ST-06', severity: 'E',
      file: 'AGENTS.md',
      message: 'AGENTS.md §2 structure table is empty or its heading was not found — ST-01/ST-02 cannot validate anything',
      fix: 'Ensure AGENTS.md has a "## 2 ..." heading followed by the structure table (| Path | Owner | ... |)',
    });
  }

  // ── ST-08: the numbered sections are a cross-reference contract ─────────
  // Prompts, docs and check fix-hints all point at "AGENTS.md §N". A section
  // that silently disappears during an edit breaks every one of those pointers
  // without any other check noticing, so the headings are verified directly.
  const agentsFile = ctx.files?.get('AGENTS.md');
  if (agentsFile) {
    const present = new Set(
      agentsFile.lines
        .map(l => l.match(/^##\s+(\d)\s/))
        .filter(Boolean)
        .map(m => m[1]),
    );
    const missing = ['1', '2', '3', '4', '5', '6'].filter(n => !present.has(n));
    if (missing.length) {
      findings.push({
        id: 'ST-08', severity: 'W',
        file: 'AGENTS.md',
        message: `AGENTS.md is missing top-level section${missing.length > 1 ? 's' : ''} ${missing.map(n => `§${n}`).join(', ')} — cross-references to them no longer resolve`,
        fix: `Restore the "## ${missing[0]} …" heading (§1 load order · §2 structure · §3 rules · §4 session protocol · §5 hard limits · §6 on-demand docs)`,
      });
    }
  }

  // Build a set of all managed relative paths from the table
  const tablePaths = new Set();
  for (const row of structureTable) {
    for (const p of row.paths) {
      tablePaths.add(p);
      // Also register the directory portion for dir rows ending in /
    }
  }

  // ── ST-01: table-managed paths must exist ──────────────────────────────
  for (const row of structureTable) {
    if (row.template) continue;  // <domain> rows skipped
    if (row.onDemand) continue;  // on-demand paths may not exist yet

    for (const rel of row.paths) {
      const abs = path.join(root, rel);
      try {
        await fs.access(abs);
      } catch {
        findings.push({
          id: 'ST-01', severity: 'E',
          file: rel,
          message: `path in structure table does not exist`,
          fix: `Create ${rel} (or add it to .gitignore if not yet needed)`,
        });
      }
    }
  }

  // Also check adapter stubs (not in table yet, but expected by template)
  for (const stub of ADAPTER_STUBS) {
    const abs = path.join(root, stub);
    try {
      await fs.access(abs);
    } catch {
      findings.push({
        id: 'ST-01', severity: 'E',
        file: stub,
        message: `adapter stub does not exist`,
        fix: `Create ${stub} with a one-line redirect to AGENTS.md`,
      });
    }
  }

  // ── ST-02: disk paths not in structure table ───────────────────────────
  // Build the "known" set: table paths + stubs + system files
  const knownPaths = new Set([...tablePaths, ...ADAPTER_STUBS]);
  knownPaths.add('.github/');       // parent dir of copilot stub
  knownPaths.add('LICENSE');
  knownPaths.add('.gitignore');
  knownPaths.add('.trussignore');
  knownPaths.add('.prettierrc');
  knownPaths.add('.env.example');

  // Also add implicit parent directories of table-managed files
  // e.g. "docs/conventions.md" implies "docs/" is known
  for (const p of tablePaths) {
    const parts = p.split('/');
    if (parts.length > 1) {
      for (let d = 1; d < parts.length; d++) {
        knownPaths.add(parts.slice(0, d).join('/') + '/')
      }
    }
  }

  // Dynamic summary directories from the structure table — hoisted out of the
  // per-path loop below; it does not change between iterations.
  const dynamicSummaryDirs = new Set();
  for (const row of structureTable) {
    if (row.summary) {
      for (const p of row.paths) dynamicSummaryDirs.add(p.split('/')[0]);
    }
  }

  for (const diskRel of diskPaths) {
    if (DISK_EXCLUDE.has(diskRel)) continue;

    const relNoSlash = diskRel.replace(/\/$/, '');
    const topDir = relNoSlash.split('/')[0];

    // Skip .git
    if (diskRel === '.git/' || diskRel.startsWith('.git/')) continue;

    // Skip .github/ dir and its children (stubs inside are handled by ST-04)
    if (diskRel === '.github/' || diskRel.startsWith('.github/')) continue;

    // Skip .truss internals (dir itself is table-managed)
    if (diskRel.startsWith('.truss/') && diskRel !== '.truss/') continue;

    // Skip contents of summary-row dirs (archive/, code root, etc., plus user-defined)
    if (dynamicSummaryDirs.has(topDir) && relNoSlash.includes('/')) continue;

    // ── retired paths (D-081): a retired path is not an unknown one ──────────
    // One I finding at the retired root; nested content under it is silent —
    // it would only repeat the same notice per file for no added information.
    if (RETIRED_PATHS.has(topDir)) {
      if (relNoSlash.includes('/')) continue;
      findings.push({
        id: 'ST-02', severity: 'I',
        file: diskRel,
        message: `'${diskRel}' is a retired routing target, not an unmanaged one — ${RETIRED_PATHS.get(topDir)}`,
        fix: `No action needed to stay green. Move its content per the note above, then remove '${diskRel}' when empty.`,
      });
      continue;
    }

    // Check against known paths (with and without trailing slash)
    if (knownPaths.has(diskRel) || knownPaths.has(relNoSlash)) continue;
    if (knownPaths.has(relNoSlash + '/')) continue;

    findings.push({
      id: 'ST-02', severity: 'W',
      file: diskRel,
      message: `new file not yet noted in the §2 structure table — the agent will map it during normal work`,
      fix: `No action needed. '${relNoSlash}' will be added to the §2 table next time the agent updates it, or add it yourself if you like.`,
    });
  }

  // ── ST-03: empty directories ───────────────────────────────────────────
  const dirsToCheck = ['state', 'docs'];
  for (const dir of dirsToCheck) {
    const abs = path.join(root, dir);
    try {
      const entries = await fs.readdir(abs);
      if (entries.length === 0) {
        findings.push({
          id: 'ST-03', severity: 'W',
          file: dir + '/',
          message: `directory is empty`,
          fix: `Populate ${dir}/ with its expected files or remove if not needed`,
        });
      }
    } catch { /* dir doesn't exist — ST-01 will catch it */ }
  }

  // ── ST-04: adapter stubs must point to AGENTS.md ──────────────────────
  for (const stub of ADAPTER_STUBS) {
    const abs = path.join(root, stub);
    let content;
    try { content = await fs.readFile(abs, 'utf8'); }
    catch { continue; } // missing handled by ST-01

    const pattern = STUB_PATTERNS[stub];
    if (!pattern.test(content)) {
      findings.push({
        id: 'ST-04', severity: 'W',
        file: stub,
        message: `adapter stub does not reference AGENTS.md`,
        fix: `Update ${stub}: it should be a one-liner telling the agent to read AGENTS.md`,
      });
    }
  }

  // ── ST-05: files > 450 lines (growth-rule hint) ────────────────────────
  const LIMIT = 450;
  for (const [relPath, fileCtx] of ctx.files) {
    if (fileCtx.lines.length > LIMIT) {
      findings.push({
        id: 'ST-05', severity: 'I',
        file: relPath,
        line: fileCtx.lines.length,
        message: `file has ${fileCtx.lines.length} lines (> ${LIMIT}); consider splitting per growth rule`,
        fix: `Apply the growth rule: if this file has 5+ themes or ~450+ lines, convert to a folder`,
      });
    }
  }

  // ── ST-07: map.md is outdated ───────────────────────────────────────────
  try {
    // Reuse the md-file list from loadWorkspace's single walk (ctx.mdFiles) to
    // avoid a second full tree walk; fall back to a standalone walk if absent.
    const expectedMapContent = await generateMapContent(root, ctx.mdFiles);
    const mapAbs = path.join(root, 'state', 'map.md');
    let actualMapContent = null;
    try {
      actualMapContent = await fs.readFile(mapAbs, 'utf8');
    } catch {
      // Doesn't exist
    }

    // mapComparisonKey strips the volatile ~Tokens column from both sides:
    // token-estimate drift alone (any content edit changes word counts) must
    // not flag the map as outdated after every edit — that would be pure
    // doctor noise. Structural drift (files, titles, descriptions) still fires;
    // token values refresh with the next `truss map` run.
    const expectedNormalized = mapComparisonKey(expectedMapContent);
    const actualNormalized = actualMapContent ? mapComparisonKey(actualMapContent) : null;

    if (actualNormalized !== expectedNormalized) {
      findings.push({
        id: 'ST-07', severity: 'W',
        file: 'state/map.md',
        message: actualMapContent === null ? 'map.md is missing' : 'map.md is outdated',
        fix: `Run 'node .truss/bin/truss.mjs map' to regenerate the domain file map`,
      });
    }
  } catch (err) {
    // If map generation fails, report it as an error
    findings.push({
      id: 'ST-07', severity: 'E',
      file: 'state/map.md',
      message: `Failed to evaluate map.md: ${err.message}`,
      fix: `Check the workspace for recursive parsing errors`,
    });
  }

  // ── ST-10: the decision index against its source ───────────────────────
  // Same shape as ST-07 (map.md), and by CONTENT, never by mtime: a `touch` on
  // decisions.md, a checkout that rewrites both files, or a re-run of `render`
  // that produced the identical bytes must all stay quiet — only a real
  // disagreement is a finding.
  //
  // Two severities, on purpose (D-081):
  //   • no index file at all → I. The workspace is not broken, it has simply
  //     never run `render` since the index existed. Every pre-D-075 instance is
  //     in that state, and `doctor` exits 1 on a W — a warning here would mean
  //     "no longer green" for every one of them on upgrade day. Same staffing as
  //     ST-09 (silent without a manifest) and PH (silent without phases.md).
  //   • index present but disagreeing with decisions.md → W. That one is not a
  //     missing step, it is a file that lies: §1 loads it every session, so a
  //     stale index feeds every boot a decision log that no longer exists.
  // No source file → nothing to be stale against; ST-01 owns that case.
  // The source is whichever form this workspace uses (D-087): the split
  // directory, or the legacy single file. readDecisionSource decides, so this
  // check never has to know — and a workspace that has not split produces
  // exactly the findings it produced before.
  const decisionSrc = await readDecisionSource(root);
  if (decisionSrc) {
    const label = decisionSrc.form === 'dir' ? `${DECISIONS_DIR}/` : SOURCE_REL;
    // Per part, never over a concatenated stream: one body with an unclosed
    // fence must not be able to hide the entries after it (the defect this
    // check would otherwise be blind to, because both sides would lose them).
    const expected = renderIndex(parseDecisionSource(decisionSrc), decisionSrc.form);
    let actual = null;
    try { actual = await fs.readFile(path.join(root, INDEX_REL), 'utf8'); }
    catch { /* absent — handled below */ }

    if (actual === null) {
      findings.push({
        id: 'ST-10', severity: 'I',
        file: INDEX_REL,
        message: `no decision index yet — until it exists, the §1 boot context has no decision summary (source: ${label})`,
        fix: `Run 'node .truss/bin/truss.mjs render' to generate ${INDEX_REL}, then commit it.`,
      });
    } else if (isLegacyIndex(actual)) {
      // D-081: an engine upgrade alone must not turn a green workspace red.
      // The index format changed with D-087, so EVERY pre-D-087 workspace has a
      // mismatching index the moment it swaps the engine — through no fault of
      // its own and with nothing yet wrong in its files. Regenerating is one
      // command, so this is a step not yet taken, not a file that lies.
      findings.push({
        id: 'ST-10', severity: 'I',
        file: INDEX_REL,
        message: `decision index is in the pre-D-087 format (it carries Decision: lines) — regenerating shrinks the boot context`,
        fix: `Run 'node .truss/bin/truss.mjs render'. The index now carries title and status only; the bodies are read on demand.`,
      });
    } else if (actual !== expected) {
      findings.push({
        id: 'ST-10', severity: 'W',
        file: INDEX_REL,
        message: `decision index no longer matches ${label} — every session boots on a summary that is out of date`,
        fix: `Run 'node .truss/bin/truss.mjs render' to regenerate ${INDEX_REL}. It is generated, never hand-edited — a local edit here is overwritten, so fix the wording in ${label}.`,
      });
    }

    // ── ST-10, second half: an entry that exists but can never be indexed ──
    // The index is addressed by ID: `D-NNN` resolves to state/decisions/D-NNN.md
    // and nothing else. A body somewhere else, or under a name that disagrees
    // with its own heading, still DEFINES its id (lib/workspace.mjs loads the
    // whole tree), so RF-02 is satisfied and nothing else notices — the entry is
    // simply invisible to every session. That is the most expensive shape a
    // defect can take here, so it gets a warning of its own.
    if (decisionSrc.form === 'dir') {
      const prefix = `${DECISIONS_DIR}/`;
      for (const [rel, f] of ctx.files) {
        if (!rel.startsWith(prefix) || !rel.endsWith('.md')) continue;
        const declared = rel.slice(prefix.length).match(/^(D-\d{3})\.md$/)?.[1] ?? null;
        const defined = f.idDefs.filter((d) => d.id.startsWith('D-')).map((d) => d.id);
        if (!defined.length) continue;
        const wrong = declared === null || defined.some((id) => id !== declared);
        if (!wrong) continue;
        findings.push({
          id: 'ST-10', severity: 'W',
          file: rel, line: f.idDefs[0].line,
          message: `${defined.join(', ')} defined in ${rel}, which the index cannot address — a decision is reached as ${DECISIONS_DIR}/<ID>.md`,
          fix: declared === null
            ? `Rename it to ${DECISIONS_DIR}/${defined[0]}.md (top level, no suffix). Until then the entry is invisible to every session boot, even though its id still resolves.`
            : `Either rename the file to ${DECISIONS_DIR}/${defined[0]}.md or change the heading to '## ${declared} — …' so name and entry agree.`,
        });
      }

      // A leftover state/decisions.md is inert for indexing once the directory
      // wins — so an entry written into it after the split is loaded, defines
      // its id, and is read by nobody. `split-decisions` leaves the file behind
      // on purpose (its preamble is real content), which makes this trap easy
      // to fall into rather than exotic.
      const legacy = ctx.files.get(SOURCE_REL);
      const stranded = legacy?.idDefs.filter((d) => d.id.startsWith('D-')) ?? [];
      if (stranded.length) {
        findings.push({
          id: 'ST-10', severity: 'W',
          file: SOURCE_REL, line: stranded[0].line,
          message: `${stranded.map((d) => d.id).join(', ')} still in ${SOURCE_REL}, but this workspace reads ${DECISIONS_DIR}/ — the entr${stranded.length === 1 ? 'y is' : 'ies are'} indexed by nobody`,
          fix: `Move each entry to ${DECISIONS_DIR}/<ID>.md, then run 'node .truss/bin/truss.mjs render'. ${SOURCE_REL} keeps only what the split left there (archive pointers and notes); route those and delete it.`,
        });
      }
    }
  }

  // ── ST-11: the workspace's own schema could not be used ────────────────
  // The failure this guards against is silence, not noise: a docs/schema.md that
  // parses to zero classes would make every XX-NNN token unstructured, and
  // RF-02, RF-03 and SY-03 would all pass with nothing to say. loadSchema falls
  // back to the shipped copy in that case (so the workspace keeps working); this
  // is where the fallback becomes visible. A workspace with no docs/schema.md at
  // all is not this case — it never had one, and the fallback is the normal path.
  // `rel` is set only for a file that IS a Truss schema (a Class-headed table);
  // someone else's docs/schema.md never reaches here. Every problem means a row
  // was dropped, and a dropped class is checked by nobody — so a partly broken
  // table is reported just as loudly as an unusable one. Reporting only the
  // total loss was the original gap: one bad row switched a class off in silence.
  if (ctx.schema?.rel && ctx.schema.problems?.length) {
    const total = ctx.schema.source === 'baseline'
    findings.push({
      id: 'ST-11', severity: 'W',
      file: ctx.schema.rel, line: 1,
      message: total
        ? `${ctx.schema.rel} defines no usable entry class (${ctx.schema.problems.join('; ')}) — the engine's own copy is being used instead`
        : `${ctx.schema.rel}: ${ctx.schema.problems.length} row(s) ignored — ${ctx.schema.problems.join('; ')}`,
      fix: total
        ? `Restore the class table: a header row starting with 'Class', then one row per class with File, Form, Required and Optional columns. The shipped copy in .truss/baseline/${ctx.schema.rel} is a working example.`
        : `Fix or remove each row named above. An ignored row is not a smaller check — the class it names stops being a structured ID, so RF-02, RF-03 and SY-03 all fall silent for it.`,
    })
  }

  // ── ST-09: engine files diverged from the release manifest ────────────
  // No manifest → verifyEngine returns null → emit nothing at all, not even
  // an info note. Test workspaces and any pre-D-070 instance must stay silent.
  const engineDivergence = await verifyEngine(path.join(root, '.truss'));
  if (engineDivergence) {
    const { modified, missing, extra, unreadable } = engineDivergence;
    // unreadable is its own class (Defect 1): those files could not be
    // checked at all, so they are named but never folded into modified/missing.
    const total = modified.length + missing.length + extra.length + unreadable.length;
    if (total > 0) {
      const SAMPLE_LIMIT = 8;
      const labelled = [
        ...modified.map(f => `modified ${f}`),
        ...missing.map(f => `missing ${f}`),
        ...extra.map(f => `extra ${f}`),
        ...unreadable.map(f => `unreadable ${f}`),
      ].sort();
      const sample = labelled.slice(0, SAMPLE_LIMIT);
      const more = labelled.length - sample.length;
      findings.push({
        id: 'ST-09', severity: 'I',
        file: '.truss/MANIFEST.sha256',
        message: `${total} engine file${total === 1 ? '' : 's'} differ${total === 1 ? 's' : ''} from the release manifest `
          + `(${modified.length} modified, ${missing.length} missing, ${extra.length} extra, ${unreadable.length} unreadable): ${sample.join(', ')}`
          + (more > 0 ? ` (+${more} more)` : ''),
        // Each class resolves differently under 'truss upgrade' (Defect 3): a
        // modified file is replaced, a missing one restored, an extra one
        // removed — never claim a diff tool that only works for people who
        // committed .truss/ into their own repository.
        fix: `Expected and fine if the engine was adapted on purpose — 'truss upgrade' replaces modified files with the `
          + `new release's versions, restores missing ones, and removes extra ones entirely; all three survive only in `
          + `the pre-upgrade backup (.truss.bak-<version>/). Unreadable files could not be checked at all — fix `
          + `their permissions and re-run doctor for an accurate report. To see what actually changed: if .truss/ is `
          + `itself a git checkout, diff it against the release tag for the installed version (e.g. 'git diff v<version>' `
          + `from inside .truss/); otherwise there is nothing to diff until the next upgrade, when the backup holds the `
          + `old files.`,
      });
    }
  }

  return findings;
}

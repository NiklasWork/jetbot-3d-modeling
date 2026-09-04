// lib/commands/init.mjs — `truss init` (WP-INIT).
//
// init preflights and configures a workspace from the core baseline. Existing
// files are preserved except for explicit AGENTS.md adoption, overlay .gitignore
// merge, and the generated map. Fatal workspace writes are rolled back.
//
// Argument semantics, step order and write discipline:
//   --name <name>   → profile.md `name:`, VISION/README titles
//   --lang <lang>   → profile.md `language:` (the language the agent answers in)
//   --overlay       → existing-project mode (phases ingest→operate, .gitignore +repo/)
//   --code-root <dir> → (overlay only) use an existing relative directory instead
//                       of repo/; no placement or .gitignore mutation.
//   --no-phases     → scaffold WITHOUT state/phases.md (U4). The workspace then
//                     runs with no phase model: no gates, no forbidden lists, no
//                     exit criteria, and the AGENTS.md phase block carries the
//                     canonical notice instead. Opt-in only — the default stays
//                     "with phases", because gates are the one place Truss can
//                     say no.
//
// init never places the code itself (D-059): the workspace gitignores repo/, and
// the human clones or symlinks into it — one documented git command instead of a
// platform-dependent init path nobody can inspect. See docs/import.md.
//   --root <path>   → explicit workspace target (defaults to the CLI caller's cwd).
// Missing required answers + TTY → interactive readline; no TTY → error (no hang).
//
// Root separation (D-024, closes OD-005): the engine location (resolveRoot from
// the script path) and the workspace target are distinct. The CLI dispatcher
// passes its cwd as invokedCwd; init targets that directory (or --root), never
// silently the engine's own directory. A target that differs from the engine
// root must carry its own .truss/ engine of the same VERSION — otherwise init
// aborts before any write. In-process callers (tests) omit invokedCwd and keep
// the old behavior: target = the root argument.
//
// A project that needs a different lifecycle gets it from the kickoff, not from
// a shipped profile: init scaffolds a single `kickoff` phase whose job is to
// author the real phase plan (overlay: `ingest → operate`, likewise a seed).
// init itself only ever scaffolds the core baseline (or the
// overlay); domain (context/) files are created on demand during the work.
//
// Phase source is resolved EXACTLY ONCE (overlay → core-overlay phases; else
// baseline core phases) and state/phases.md is written once, BEFORE
// applyTree(baseline) — so the baseline's own phases.md is harmlessly skipped
// rather than written twice. Substituted skeletons (VISION/README/profile, and the
// overlay .gitignore) are likewise pre-written before applyTree; these expected
// skips are filtered out of the conflict report.
//
// runInit THROWS on a fatal user error (bad args, already-initialised) and RETURNS
// a result object on success — so it is testable in-process. The CLI dispatcher
// (bin/truss.mjs) wraps it to map a throw to exit code 2.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import {
  applyTree,
  inventoryTree,
  writeFileAtomic,
  writeFileSafe,
} from "../scaffold.mjs";
import { writeBlock } from "../writer.mjs";
import { renderPrefsBlock, renderPhaseBlock, renderNoPhasesBlock } from "../render.mjs";
import { parsePhases, parseBlocks } from "../md.mjs";
import { defaultPrefsRows } from "../defaults.mjs";
import { generateMapContent } from "./map.mjs";
import { buildIndex, readDecisionSource, INDEX_REL } from "../decisions-index.mjs";
import {
  assertExistingCodeRoot,
  CodeRootError,
  normalizeCodeRoot,
} from "../code-root.mjs";
import {
  buildExcludes,
  discoverGroups,
  selectedGroupsFor,
  selectionContent,
  SKILL_SELECTION_REL,
  SkillSelectionError,
} from "../skill-groups.mjs";

const execFileP = promisify(execFile);

/** A fatal, user-facing init error (mapped to exit code 2 by the dispatcher). */
export class InitError extends Error {}

const LANG_TOKEN =
  "[primary language for all agent output — e.g. English, German]";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Parse argv into init options. Supports "--flag v" and "--flag=v". */
export function parseInitArgs(argv) {
  const opts = {
    name: null,
    lang: null,
    overlay: false,
    noPhases: false,
    codeRoot: null,
    adoptAgents: false,
    root: null,
    skills: null,
    findings: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Consume the next token as a value; reject a missing value or one that looks
    // like another flag (so `--name --overlay` errors clearly instead of taking
    // '--overlay' as the name).
    const value = (flag) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-"))
        throw new InitError(`init: ${flag} expects a value`);
      i++;
      return v;
    };
    if (a === "--overlay") opts.overlay = true;
    else if (a === "--no-phases") opts.noPhases = true;
    else if (a === "--adopt-agents") opts.adoptAgents = true;
    else if (a === "--name") opts.name = value("--name");
    else if (a === "--lang") opts.lang = value("--lang");
    else if (a === "--code-root") opts.codeRoot = value("--code-root");
    else if (a === "--root") opts.root = value("--root");
    else if (a === "--skills") opts.skills = value("--skills");
    else if (a === "--findings" || a.startsWith("--findings=")) {
      const v = a === "--findings" ? value("--findings") : a.slice("--findings=".length);
      if (v !== "on" && v !== "off")
        throw new InitError(`init: --findings expects 'on' or 'off', got '${v}'`);
      opts.findings = v === "on";
    }
    else if (a.startsWith("--name=")) opts.name = a.slice("--name=".length);
    else if (a.startsWith("--lang=")) opts.lang = a.slice("--lang=".length);
    else if (a.startsWith("--code-root=")) opts.codeRoot = a.slice("--code-root=".length);
    else if (a.startsWith("--root=")) opts.root = a.slice("--root=".length);
    else if (a.startsWith("--skills=")) opts.skills = a.slice("--skills=".length);
    else
      throw new InitError(
        `init: unknown argument '${a}'. Flags: --name --lang --overlay --no-phases --code-root --adopt-agents --root --skills --findings`,
      );
  }
  if (opts.codeRoot && !opts.overlay) {
    throw new InitError(
      "init: --code-root only applies with --overlay (it selects existing code inside the workspace).",
    );
  }
  if (opts.codeRoot) {
    try { opts.codeRoot = normalizeCodeRoot(opts.codeRoot); }
    catch (err) {
      if (err instanceof CodeRootError) throw new InitError(`init: ${err.message}`);
      throw err;
    }
  }
  return opts;
}

/** Fill missing answers interactively when stdin is a TTY; otherwise leave them. */
async function resolveInteractive(opts, groups) {
  if (opts.name && opts.lang && opts.skills !== null) return;
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    if (!opts.name)
      opts.name = (await rl.question("Project name: ")).trim() || null;
    if (!opts.lang)
      opts.lang =
        (await rl.question("Primary agent language (e.g. English): ")).trim() ||
        null;
    if (!opts.overlay) {
      const o = (await rl.question("Overlay an existing project? (y/N): "))
        .trim()
        .toLowerCase();
      if (o === "y" || o === "yes") opts.overlay = true;
    }
    if (opts.skills === null) {
      console.log("\nOpt into baseline skill groups? They load into every session (enter number, comma-separated, or 'a' for all; default 'n' for none):\n");
      const ordered = [...groups];
      for (const [index, [group, assets]] of ordered.entries()) {
        const agents = assets.agents.length
          ? `, ${assets.agents.length} agent${assets.agents.length === 1 ? "" : "s"}`
          : "";
        const examples = assets.skills
          .slice(0, 3)
          .map(name => name.slice(name.indexOf("-") + 1).replaceAll("-", " "))
          .join(", ");
        console.log(` ${index + 1}. ${group} — ${assets.skills.length} skills${agents}${examples ? ` (${examples}${assets.skills.length > 3 ? ", …" : ""})` : ""}`);
      }
      const choice = (await rl.question("\nChoice [n]: ")).trim().toLowerCase() || "n";
      if (choice === "a") opts.skills = "all";
      else if (choice === "n") opts.skills = "none";
      else {
        const numbers = choice.split(",").map(value => Number(value.trim()));
        if (!numbers.every(number => Number.isInteger(number) && number >= 1 && number <= ordered.length)) {
          throw new InitError("init: skill selection must be 'a', 'n', or valid group numbers.");
        }
        opts.skills = [...new Set(numbers)].map(number => ordered[number - 1][0]).join(",");
      }
    }
  } finally {
    rl.close();
  }
}

async function readMaybe(absPath) {
  try { return await fs.readFile(absPath, "utf8"); }
  catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * The findings channel (state/truss-findings.md, TF-NNN) is opt-out at init
 * time: default on, `--findings off` removes every AGENTS.md / conventions
 * mention so an instance carries zero boot cost for a feature it does not use.
 * Baseline content is pinned to the engine release, so exact-content stripping
 * is safe — and a post-strip guard turns baseline drift into a loud failure
 * instead of silently shipping leftovers. Runs on baseline text ONLY (never on
 * an adopted preamble).
 * @returns {string} the text without any findings mention
 * @throws {InitError} when remnants remain — the baseline drifted from this contract
 */
export function stripFindings(text) {
  const stripped = text
    .split("\n")
    .filter((l) => !l.includes("state/truss-findings.md"))
    .join("\n")
    .replace(" · TF-NNN truss findings", "")
    .replace("R-/L-/TF-", "R-/L-")
    .replace(/\n### TF-NNN[\s\S]*?(?=\n## Profile\n)/, "\n");
  if (/truss-findings|TF-/.test(stripped)) {
    throw new InitError(
      "init: --findings off could not remove every findings mention — the bundled " +
        "baseline drifted from stripFindings() in lib/commands/init.mjs; " +
        "refusing to write a partial opt-out.",
    );
  }
  return stripped;
}

/**
 * Resolve AGENTS.md before any write. Marker-free files require explicit
 * adoption; their content remains first and the Truss router is appended.
 */
async function prepareAgents(root, baselineDir, adoptAgents, findingsOn = true) {
  const agentsPath = path.join(root, "AGENTS.md");
  let baseline = await fs.readFile(path.join(baselineDir, "AGENTS.md"), "utf8");
  // Strip BEFORE the router meets an adopted preamble: stripFindings() and its
  // remnant guard are written against baseline text and must neither touch nor
  // judge user content (--adopt-agents).
  if (!findingsOn) baseline = stripFindings(baseline);
  const raw = await readMaybe(agentsPath);
  if (raw == null) {
    assertRenderMarkers(baseline);
    return { content: baseline, original: null, adopted: false };
  }

  const blocks = parseBlocks(raw.split("\n"));
  const phase = blocks.get("phase");
  const rendered = phase?.innerLines?.some((l) => l.startsWith("**Phase "));
  if (rendered) {
    throw new InitError(
      "init: this workspace already looks initialised (AGENTS.md has a rendered phase block).\n" +
        "       init never overwrites an existing instance (A1). Use 'truss set' / 'render' instead.",
    );
  }
  const blockIsComplete = (id) => {
    const block = blocks.get(id);
    return block && !block.orphanBegin && !block.orphanEnd &&
      !block.duplicateBegin && block.startLine && block.endLine;
  };
  if (blockIsComplete("preferences") && blockIsComplete("phase")) {
    return { content: raw, original: raw, adopted: false };
  }
  if (raw.includes("<!-- truss:")) {
    throw new InitError(
      "init: existing AGENTS.md contains incomplete or duplicate Truss markers.\n" +
      "       Repair or remove the markers before running init; no files were changed.",
    );
  }
  if (!adoptAgents) {
    throw new InitError(
      "init: existing AGENTS.md has no Truss markers; no files were changed.\n" +
      "       Re-run with --adopt-agents to preserve it as a preamble and append the Truss router.",
    );
  }
  const content = `${raw.trimEnd()}\n\n---\n\n${baseline}`;
  assertRenderMarkers(content);
  return {
    content,
    original: raw,
    adopted: true,
  };
}

function assertRenderMarkers(content) {
  const blocks = parseBlocks(content.split("\n"));
  for (const id of ["preferences", "phase"]) {
    const block = blocks.get(id);
    if (!block || block.orphanBegin || block.orphanEnd ||
        block.duplicateBegin || !block.startLine || !block.endLine) {
      throw new InitError(
        `init: baseline AGENTS.md has invalid '${id}' render markers; no files were changed.`,
      );
    }
  }
}

/** Resolve the single phase-source content for state/phases.md. */
async function resolvePhasesContent(baselineDir, overlay, codeRoot = null) {
  const source = overlay
    ? path.join(baselineDir, "overlay", "phases.md")
    : path.join(baselineDir, "state", "phases.md");
  const raw = await fs.readFile(source, "utf8");
  if (overlay && codeRoot && codeRoot !== "repo") {
    return raw.replaceAll("repo/**", `${codeRoot}/**`);
  }
  return raw;
}

async function gitInitMaybe(root, report) {
  if (process.env.TRUSS_NO_GIT) {
    report.git = "skipped (TRUSS_NO_GIT)";
    return;
  }
  if (await exists(path.join(root, ".git"))) {
    report.git = "existing repo — left as is";
    return;
  }
  try {
    await execFileP("git", ["init"], { cwd: root });
    report.git = "initialised wrapper repo (git init)";
  } catch (err) {
    const msg = err?.message || String(err) || "unknown error";
    report.git = `git init skipped (${msg.split("\n")[0]}) — workspace is valid without git`;
  }
}

/** realpath with a fallback to path.resolve for not-yet-existing paths. */
async function realpathSafe(p) {
  try { return await fs.realpath(p); }
  catch { return path.resolve(p); }
}

/**
 * Resolve the workspace target (D-024): --root wins, then the CLI caller's cwd,
 * then the engine root itself (in-process callers/tests). A target that is not
 * the engine root must carry its own .truss/ engine at the same VERSION.
 * Returns the absolute workspace root to scaffold. Throws InitError otherwise.
 */
async function resolveWorkspaceRoot(engineRoot, opts, invokedCwd) {
  const requested = opts.root ? path.resolve(opts.root) : invokedCwd;
  if (requested == null) return engineRoot;
  const [engineReal, targetReal] = await Promise.all([
    realpathSafe(engineRoot),
    realpathSafe(requested),
  ]);
  if (engineReal === targetReal) return engineRoot;

  const targetEngine = path.join(requested, ".truss");
  if (!(await exists(path.join(targetEngine, "baseline")))) {
    throw new InitError(
      `init: target ${requested} has no .truss/ engine; no files were changed.\n` +
        "       init scaffolds the directory it is run from (or --root), never the engine's own directory.\n" +
        `       Copy the .truss/ folder into the target first, then run there: node .truss/bin/truss.mjs init`,
    );
  }
  const vEngine = (await readMaybe(path.join(engineRoot, ".truss", "VERSION")))?.trim();
  const vTarget = (await readMaybe(path.join(targetEngine, "VERSION")))?.trim();
  // A missing VERSION on either side is treated as a mismatch: a partially
  // copied engine (baseline present, VERSION lost) must not be scaffolded
  // against — the versions cannot be proven equal.
  if (!vEngine || !vTarget || vEngine !== vTarget) {
    throw new InitError(
      `init: engine version mismatch or undetermined — invoked ${vEngine ?? "?"} (${engineRoot}), target carries ${vTarget ?? "?"} (${requested}); no files were changed.\n` +
        "       Run the target's own engine: node .truss/bin/truss.mjs init",
    );
  }
  console.log(
    `init: initialising ${requested} with its local engine (invoked via ${engineRoot})`,
  );
  return requested;
}

/**
 * Probe that init can both create and delete files in the target (OD-005-C):
 * a target where unlink fails (EPERM, read-only mount) would otherwise strand
 * a half-written workspace that rollback cannot clean up.
 */
async function assertDeletable(root) {
  const dirs = [root];
  if (await exists(path.join(root, "state"))) dirs.push(path.join(root, "state"));
  for (const dir of dirs) {
    const probe = path.join(dir, `.truss-init-probe-${process.pid}`);
    try {
      await fs.writeFile(probe, "probe", "utf8");
      await fs.unlink(probe);
    } catch (err) {
      throw new InitError(
        `init: target ${dir} is not writable/deletable (${err.code || err.message}); no files were changed.\n` +
          "       A failed write there could not be rolled back — fix permissions first.",
      );
    }
  }
}

/**
 * Configure a fresh workspace. See file header / ADR §4 for the contract.
 * @param {string}   root  Absolute engine root (from resolveRoot); also the
 *                         workspace target unless invokedCwd/--root differ.
 * @param {string[]} argv  Arguments after "init".
 * @param {string?}  invokedCwd  The CLI caller's cwd (dispatcher only); null
 *                         for in-process callers keeps target = root.
 * @returns {Promise<object>}  Result summary (also printed). Throws InitError on fatal error.
 */
export async function runInit(root, argv, invokedCwd = null) {
  const opts = parseInitArgs(argv);
  root = await resolveWorkspaceRoot(root, opts, invokedCwd);
  const trussDir = path.join(root, ".truss");
  const baselineDir = path.join(trussDir, "baseline");
  if (!(await exists(baselineDir))) {
    throw new InitError(
      `init: baseline not found at ${baselineDir} — is this a truss clone?`,
    );
  }
  const groups = await discoverGroups(baselineDir);
  await resolveInteractive(opts, groups);
  if (!opts.name || !opts.lang) {
    throw new InitError(
      "init: --name and --lang are required (or run in a TTY to answer interactively).",
    );
  }
  let selectedGroups;
  try {
    selectedGroups = selectedGroupsFor(opts.skills, groups);
  } catch (err) {
    if (err instanceof SkillSelectionError) throw new InitError(`init: ${err.message}`);
    throw err;
  }
  const skillExcludes = buildExcludes(groups, selectedGroups);
  // --no-phases (U4): the baseline ships its own state/phases.md, so it must be
  // excluded from the tree copy as well — otherwise applyTree would write back
  // the very file this flag is about not having.
  const treeExcludes = new Set(skillExcludes);
  if (opts.noPhases) treeExcludes.add("state/phases.md");
  const skillSelection = selectionContent(groups, selectedGroups);
  if (opts.codeRoot) {
    try { await assertExistingCodeRoot(root, opts.codeRoot); }
    catch (err) {
      if (err instanceof CodeRootError) throw new InitError(`init: ${err.message}`);
      throw err;
    }
  }
  const codeRoot = opts.overlay ? (opts.codeRoot || "repo") : null;

  // Resolve and validate every prerequisite before the first workspace write.
  const phasesContent = opts.noPhases
    ? null
    : await resolvePhasesContent(baselineDir, opts.overlay, codeRoot);
  const parsed = phasesContent === null
    ? null
    : parsePhases(phasesContent.split("\n"));
  const currentId = parsed ? parsed.frontmatter.current : null;
  if (parsed && !parsed.defs.get(currentId)) {
    throw new InitError(
      `init: resolved phases.md has no current phase '${currentId}'`,
    );
  }
  const def = parsed ? parsed.defs.get(currentId) : null;
  const existingPhases = await readMaybe(path.join(root, "state", "phases.md"));
  if (opts.noPhases) {
    // Refusing here rather than deleting: init never removes existing work.
    if (existingPhases != null) {
      throw new InitError(
        "init: --no-phases, but state/phases.md already exists; no files were changed.\n" +
        "       Move it aside first, or re-run without --no-phases.",
      );
    }
  } else if (existingPhases != null && existingPhases !== phasesContent) {
    throw new InitError(
      "init: existing state/phases.md conflicts with the selected baseline; no files were changed.\n" +
      "       Move it aside or reconcile it before retrying.",
    );
  }
  const agentsPlan = await prepareAgents(root, baselineDir, opts.adoptAgents, opts.findings);
  // After prepareAgents, deliberately. Since D-069 every init writes a skill
  // selection file, so on a re-run this guard would otherwise fire first and
  // report a skills conflict for what is really an already-initialised
  // workspace — the diagnosis the human needs comes from prepareAgents.
  if (skillSelection !== null && await exists(path.join(root, SKILL_SELECTION_REL))) {
    throw new InitError(
      `init: existing ${SKILL_SELECTION_REL} conflicts with the requested skill selection; no files were changed.`,
    );
  }
  if (codeRoot && codeRoot !== "repo") {
    agentsPlan.content = agentsPlan.content.replaceAll(
      "| repo/ (on demand) |",
      `| ${codeRoot}/ (on demand) |`,
    );
  }
  const inventory = await inventoryTree(baselineDir, root, { exclude: treeExcludes });
  const mapPath = path.join(root, "state", "map.md");
  try {
    const mapStat = await fs.lstat(mapPath);
    if (!mapStat.isFile()) {
      inventory.errors.push({
        path: mapPath,
        error: "generated map target exists but is not a regular file",
      });
    }
  } catch (err) {
    if (err.code !== "ENOENT") inventory.errors.push({ path: mapPath, error: err.message });
  }
  if (inventory.errors.length > 0) {
    const first = inventory.errors[0];
    throw new InitError(
      `init: preflight failed at ${first.path}: ${first.error}; no files were changed.`,
    );
  }
  let defaultRows;
  try {
    defaultRows = await defaultPrefsRows(root);
  } catch (err) {
    throw new InitError(`init: preference render preflight failed: ${err.message}; no files were changed.`);
  }
  const prefsBlock = renderPrefsBlock(defaultRows);
  const phaseBlock = opts.noPhases
    ? renderNoPhasesBlock()
    : renderPhaseBlock(
        def,
        currentId,
        parsed.ordered.indexOf(currentId) + 1,
        parsed.ordered.length,
      );

  // Pre-write resolved/substituted files BEFORE applyTree, so the no-overwrite
  //    guard does not clobber them and we control their content. A pre-write target
  //    that already exists is a REAL conflict (partial re-run / live workspace) and
  //    is reported; the path is also marked expected so the later baseline skip of
  //    the same file is not double-counted.
  const subst = (s) =>
    s
      .replace(/\[project name\]/gi, opts.name)
      .split(LANG_TOKEN)
      .join(opts.lang);
  const prewriteConflicts = [];
  const expectedSkips = new Set();
  const created = [];
  const originals = new Map();
  let baseRes = { written: [], skipped: [], errors: [] };

  const rememberOriginal = async (abs) => {
    if (originals.has(abs)) return;
    const raw = await readMaybe(abs);
    if (raw != null) originals.set(abs, raw);
  };

  const prewrite = async (rel, content) => {
    const abs = path.join(root, rel);
    expectedSkips.add(abs);
    const r = await writeFileSafe(abs, content);
    if (r.status === "skipped-exists") prewriteConflicts.push(abs);
    else if (r.status === "written") created.push(abs);
    else throw new InitError(`init: could not write ${rel}: ${r.error}`);
  };

  const rollback = async () => {
    const rollbackErrors = [];
    for (const [abs, raw] of [...originals.entries()].reverse()) {
      try { await writeFileAtomic(abs, raw); }
      catch (err) { rollbackErrors.push(`${abs}: ${err.message}`); }
    }
    for (const abs of [...new Set(created)].reverse()) {
      try { await fs.unlink(abs); }
      catch (err) {
        if (err.code !== "ENOENT") rollbackErrors.push(`${abs}: ${err.message}`);
      }
    }
    const dirs = [...new Set(created.map(abs => path.dirname(abs)))]
      .filter(dir => dir !== root && !dir.startsWith(path.join(root, ".truss")))
      .sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      try { await fs.rmdir(dir); }
      catch (err) {
        if (!["ENOENT", "ENOTEMPTY"].includes(err.code)) {
          rollbackErrors.push(`${dir}: ${err.message}`);
        }
      }
    }
    return rollbackErrors;
  };

  await assertDeletable(root);

  try {
    if (skillSelection !== null) await prewrite(SKILL_SELECTION_REL, skillSelection);
    if (!opts.noPhases) await prewrite("state/phases.md", phasesContent);
    if (!opts.findings) {
      const convRaw = await fs.readFile(
        path.join(baselineDir, "docs", "conventions.md"),
        "utf8",
      );
      await prewrite("docs/conventions.md", stripFindings(convRaw));
    }
    for (const rel of ["VISION.md", "README.md", "state/profile.md"]) {
      const raw = await fs.readFile(path.join(baselineDir, rel), "utf8");
      const configured = rel === "state/profile.md"
        ? subst(raw).replace(/^code-root:.*$/m, `code-root: ${codeRoot || ""}`)
        : subst(raw);
      await prewrite(rel, configured);
    }

    const agentsMd = path.join(root, "AGENTS.md");
    expectedSkips.add(agentsMd);
    if (agentsPlan.original == null) {
      await prewrite("AGENTS.md", agentsPlan.content);
    } else {
      await rememberOriginal(agentsMd);
      await writeFileAtomic(agentsMd, agentsPlan.content);
    }

    if (opts.overlay && codeRoot === "repo") {
      const giPath = path.join(root, ".gitignore");
      const baselineGi = await fs.readFile(path.join(baselineDir, ".gitignore"), "utf8");
      const existingGi = await readMaybe(giPath);
      const sourceGi = existingGi ?? baselineGi;
      const hasRepoIgnore = sourceGi.split(/\r?\n/).some(
        line => ["/repo/", "repo/"].includes(line.trim()),
      );
      const mergedGi = hasRepoIgnore
        ? sourceGi
        : sourceGi.replace(/\s*$/, "") + "\nrepo/\n";
      expectedSkips.add(giPath);
      if (existingGi == null) {
        await prewrite(".gitignore", mergedGi);
      } else if (mergedGi !== existingGi) {
        await rememberOriginal(giPath);
        await writeFileAtomic(giPath, mergedGi);
      }
    }

    baseRes = await applyTree(baselineDir, root, { exclude: treeExcludes });
    created.push(...baseRes.written);
    if (baseRes.errors.length > 0) {
      const first = baseRes.errors[0];
      throw new InitError(`init: baseline write failed at ${first.path}: ${first.error}`);
    }

    const overlayPhasePath = path.join(root, "overlay", "phases.md");
    if (baseRes.written.includes(overlayPhasePath)) {
      await fs.rm(path.join(root, "overlay"), { recursive: true, force: true });
      created.splice(created.indexOf(overlayPhasePath), 1);
      baseRes.written = baseRes.written.filter((p) => p !== overlayPhasePath);
    }

    await writeBlock(
      agentsMd,
      "preferences",
      prefsBlock,
    );
    await writeBlock(
      agentsMd,
      "phase",
      phaseBlock,
    );

    // The decision index (D-075) is written BEFORE the map: it is a workspace
    // markdown file, so a map generated first would already be outdated by it
    // and a fresh instance would open with an ST-07 warning.
    const indexPath = path.join(root, INDEX_REL);
    const existingIndex = await readMaybe(indexPath);
    if (existingIndex != null) await rememberOriginal(indexPath);
    else created.push(indexPath);
    // Built through readDecisionSource so `init` on an existing workspace
    // (overlay, re-run) honours whichever layout it already uses (D-087).
    const decisionSrc = await readDecisionSource(root);
    await writeFileAtomic(indexPath, buildIndex(decisionSrc?.lines ?? [""]));

    const existingMap = await readMaybe(mapPath);
    if (existingMap != null) await rememberOriginal(mapPath);
    else created.push(mapPath);
    await writeFileAtomic(mapPath, await generateMapContent(root));
  } catch (err) {
    const rollbackErrors = await rollback();
    let rollbackMessage;
    if (rollbackErrors.length === 0) {
      rollbackMessage = " Workspace changes were rolled back.";
    } else {
      // OD-005-C: a partial rollback must leave a durable trace, not only a
      // scrolling error line — write the remaining paths as a list file.
      const listPath = path.join(root, "truss-init-rollback.txt");
      const body =
        "# truss init — rollback incomplete. These paths kept their (possibly partial) state:\n" +
        rollbackErrors.map((e) => `- ${e}`).join("\n") + "\n";
      let listNote = "";
      try {
        await writeFileAtomic(listPath, body);
        listNote = ` Full list: ${listPath}.`;
      } catch { /* target may be unwritable — the message below still carries the first path */ }
      rollbackMessage =
        ` Rollback was incomplete (${rollbackErrors.length} path${rollbackErrors.length === 1 ? "" : "s"}).${listNote}` +
        ` First: ${rollbackErrors[0]}`;
    }
    throw new InitError(`init: ${err.message}.${rollbackMessage}`);
  }

  // 6. git init (best-effort; an instance is valid without git).
  const report = {};
  await gitInitMaybe(root, report);

  const codeRootReady = codeRoot
    ? await exists(path.join(root, ...codeRoot.split("/")))
    : false;

  // 7. Build + print the bundled report.
  const baselineConflicts = baseRes.skipped.filter(
    (p) => !expectedSkips.has(p),
  );
  const conflicts = [...prewriteConflicts, ...baselineConflicts];
  const result = {
    name: opts.name,
    lang: opts.lang,
    overlay: opts.overlay,
    codeRoot,
    codeRootReady,
    skills: [...selectedGroups],
    findings: opts.findings ? "on" : "off",
    currentPhase: currentId ?? "(none — no phase model)",
    baselineWritten: baseRes.written.length,
    conflicts,
    errors: [],
    adoptedAgents: agentsPlan.adopted,
    git: report.git,
  };
  printReport(root, result);
  return result;
}

function rel(root, p) {
  return path.relative(root, p) || p;
}

function printReport(root, r) {
  const L = [];
  L.push("");
  L.push(`truss init — '${r.name}' (${r.lang})${r.overlay ? ", overlay" : ""}`);
  L.push("");
  L.push(`  Baseline files written: ${r.baselineWritten}`);
  L.push(`  Current phase:          ${r.currentPhase}`);
  L.push(`  Truss findings:         ${r.findings}`);
  L.push(`  Git:                    ${r.git}`);
  L.push(`  Skills:                 ${r.skills.length ? r.skills.join(", ") : "none"}`);
  if (!r.skills.length) {
    L.push(`    (node .truss/bin/truss.mjs skills list to see them, ... skills add <group> to install)`);
  }
  if (r.codeRoot) L.push(`  Code root:              ${r.codeRoot}/`);
  if (r.conflicts.length) {
    L.push("");
    L.push(`  Skipped (already existed — not overwritten):`);
    for (const p of r.conflicts) L.push(`    - ${rel(root, p)}`);
  }
  if (r.errors.length) {
    L.push("");
    L.push(`  Errors:`);
    for (const e of r.errors) L.push(`    - ${rel(root, e.path)}: ${e.error}`);
  }
  L.push("");
  L.push("  Next steps:");
  // Numbered steps are built in a list so they renumber themselves whether or
  // not the overlay "bring code in" step is present.
  const steps = [];
  if (r.overlay && !r.codeRootReady) {
    steps.push([
      `Bring your existing code in under ${r.codeRoot}/ (it keeps its own history):`,
      `     git clone <your-repo-url> ${r.codeRoot}/      # or: ln -s /path/to/code ${r.codeRoot}`,
    ]);
  }
  if (r.overlay) {
    steps.push(["Run: node .truss/bin/truss.mjs doctor"]);
    steps.push([
      "Start the ingest phase — the agent asks you the few things the code",
      "   can't tell it (vision, status, role), then surveys the code and fits",
      "   the phase model. Move to operate when done.",
    ]);
  } else {
    steps.push([
      "Start with the boot prompt below — it has the agent interview you to turn",
      "   your idea into VISION.md, state/profile.md and a phase plan (no blank-template filling).",
    ]);
    steps.push(["Run: node .truss/bin/truss.mjs doctor"]);
  }
  steps.push([
    "Agent preferences (subagents, ask-vs-infer, commit behavior) start off —",
    "   your AI tool's own behavior applies. Set the ones you want with:",
    "   node .truss/bin/truss.mjs set <key> <value>",
  ]);
  steps.forEach((lines, i) => {
    L.push(`    ${i + 1}. ${lines[0]}`);
    for (const extra of lines.slice(1)) L.push(`    ${extra}`);
  });
  L.push("");
  L.push("  Boot prompt for your AI tool:");
  for (const line of bootPromptLines(r)) L.push(`    ${line}`);
  L.push("");
  console.log(L.join("\n"));
}

/**
 * The copy-paste boot prompt, tailored to how the workspace was initialised.
 * A fresh project has the agent interview the human into VISION.md, profile.md
 * and a phase plan, and carries the raw idea inline; an overlay points the agent
 * at the ingest phase's own job — intake, survey, fit the phase model — and a
 * missing code root defers it until the directory exists.
 *
 * Deliberately English regardless of --lang: the boot prompt is part of the
 * canonical (English) skeleton. Content language is enforced where agents
 * actually read rules — AGENTS.md §3 + profile.md `language:`.
 */
function bootPromptLines(r) {
  if (!r.overlay) {
    return [
      '"Read AGENTS.md fully, then follow §1 load order. This is a fresh project —',
      "  don't start anything yet. Interview me to turn my idea into VISION.md,",
      "  state/profile.md and a phase plan, and probe for anything missing or vague.",
      '  My idea/vision: <paste your idea, your role, and what you want to achieve here>."',
    ];
  }
  const ingest = [
    "  interview me for what the code cannot reveal (problem, status, my",
    "  role), then survey it and fit the phase model.\"",
  ];
  if (!r.codeRootReady) {
    return [
      `"Once ${r.codeRoot}/ holds your code, read AGENTS.md fully, then follow §1 load`,
      "  order. You are in the ingest phase:",
      ...ingest,
    ];
  }
  return [
    '"Read AGENTS.md fully, then follow §1 load order. You are in the ingest',
    `  phase, over the existing code under ${r.codeRoot}/:`,
    ...ingest,
  ];
}

// lib/md.mjs — markdown primitive parsers
// Zero external dependencies. All functions are pure (no I/O).

/**
 * Parse YAML-ish frontmatter from an array of lines.
 * Expects lines[0] === '---' to indicate frontmatter is present.
 * Returns { data: Record<string,string>, bodyStart: number }
 * where bodyStart is the index of the first non-frontmatter line.
 */
export function parseFrontmatter(lines) {
  // A trailing \r is tolerated on both fences: on Windows CRLF is what git
  // checks out by default, and a fence that fails to match here returns an EMPTY
  // frontmatter — state/phases.md would silently lose its `current:` pointer,
  // which is the one line the whole phase machinery turns on.
  const fence = (line) => line?.trimEnd() === '---';
  if (!fence(lines[0])) return { data: {}, bodyStart: 0 };
  const data = {};
  let i = 1;
  let currentKey = null;
  for (; i < lines.length; i++) {
    if (fence(lines[i])) { i++; break; }
    const line = lines[i].trimEnd();
    const m = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      data[currentKey] = m[2];
    } else if (currentKey) {
      data[currentKey] += '\n' + line.trim();
    }

  }
  return { data, bodyStart: i };
}

/**
 * Split file content into lines for parsing, tolerating CRLF.
 * Writers must NOT use this: they split and rejoin to preserve a file's own
 * line endings, and normalising there would rewrite the whole file.
 */
export function splitLines(content) {
  const lines = String(content).split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Parse a list-valued phase field. Commas are the documented form; semicolons
 * remain accepted so older profiles and hand-written phase files stay valid.
 */
export function parsePhaseList(value) {
  if (!value) return [];
  return String(value)
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Parse a list-valued **frontmatter** field, as it comes out of
 * parseFrontmatter(). Two written forms are accepted:
 *
 *   next: alpha, beta          → ['alpha', 'beta']   (comma list, one-liners)
 *   next:                      → ['alpha', 'beta']   (YAML block)
 *     - alpha
 *     - beta
 *
 * The block is the documented form because an entry may then contain a comma;
 * the comma list stays valid for short single-line values. parseFrontmatter
 * folds continuation lines into the value with '\n' (see above), so the block
 * arrives here as "\n- alpha\n- beta" — that leading newline is why the test
 * below allows one.
 *
 * Inline YAML (`next: [a, b]`) is deliberately NOT supported: it would fall
 * through to parsePhaseList and yield ['[a', 'b]'], i.e. parse silently wrong.
 * docs/conventions.md names the two supported forms instead.
 */
export function parseFrontmatterList(value) {
  if (!value) return [];
  const raw = String(value);
  if (/^\n?\s*-\s/.test(raw)) {
    return raw
      .split('\n')
      .map(line => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }
  return parsePhaseList(raw);
}

/**
 * Parse all markdown links [text](href) from a single line.
 * Returns Array<{ text: string, href: string }>
 */
export function parseLinks(line) {
  const results = [];
  const re = /\[([^\]]*)\]\(((?:[^)(]+|\([^)(]*\))*)\)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    results.push({ text: m[1], href: m[2] });
  }
  return results;
}

/**
 * Parse a markdown table row "| col1 | col2 |".
 * Returns trimmed cell strings, or null if not a table row.
 * Separator rows (|---|---| etc.) are returned as null.
 */
export function parseTableRow(line) {
  if (!line.startsWith('|')) return null;
  if (/^\|[-:| ]+\|$/.test(line.trim())) return null; // separator
  const cells = line.split('|');
  // Remove first (empty before first |) and last (empty after last |)
  cells.shift();
  cells.pop();
  return cells.map(c => c.trim());
}

/**
 * Find a truss HTML comment marker in a line.
 * Format: <!-- truss:begin <id> --> or <!-- truss:end <id> -->
 * Returns { type: 'begin'|'end', id: string } or null.
 */
export function parseTrussMarker(line) {
  // Trailing \r (a CRLF file split on \n) and trailing spaces are tolerated: on
  // Windows CRLF is the default, and a marker that fails to parse there makes
  // every block-aware feature — BL-01/BL-02, render, the upgrade block
  // alignment — silently do nothing instead of reporting a problem.
  const m = line.match(/^<!-- truss:(begin|end) ([a-z-]+) -->[ \t\r]*$/);
  if (!m) return null;
  return { type: m[1], id: m[2] };
}

/**
 * Find all structured IDs (D-NNN, OD-NNN, …) in a string.
 * `classes` is the list of ID prefixes the workspace knows — it comes from
 * docs/schema.md via lib/schema.mjs, never from a constant here (D-079).
 * Returns Array<string> (e.g. ['D-001', 'HT-003']).
 */
export function findIds(text, classes) {
  const re = new RegExp(idMatchers(classes).any.source, 'g');
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    found.push(`${m[1]}-${m[2]}`);
  }
  return found;
}

/**
 * Convert a heading text to a GitHub-flavored markdown anchor.
 * Lowercases, replaces spaces with hyphens, strips non-alphanumeric (except hyphens).
 */
export function headingToAnchor(text) {
  return text
    .toLowerCase()
    .replace(/`[^`]+`/g, s => s.slice(1, -1)) // strip backtick formatting
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse all headings from an array of lines.
 * Returns Array<{ level: number, text: string, anchor: string, line: number }>
 * line is 1-based.
 */
export function parseHeadings(lines) {
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    // `\r?$` and not just `$`: JS treats \r as a line terminator, so `.` never
    // matches it and `$` never sits before it — a CRLF file yielded ZERO
    // headings, taking RF-01's anchor checks, the map descriptions and every
    // heading-based check down with it, silently.
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\r?$/);
    if (m) {
      const text = m[2].trim();
      headings.push({
        level: m[1].length,
        text,
        anchor: headingToAnchor(text),
        line: i + 1,
      });
    }
  }
  return headings;
}

/**
 * Find all markdown links across all lines of a file.
 * Returns Array<{ text: string, href: string, line: number }> (line is 1-based).
 */
export function parseAllLinks(lines) {
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    for (const link of parseLinks(lines[i])) {
      results.push({ ...link, line: i + 1 });
    }
  }
  return results;
}

// Checkbox syntax — ONE source of truth for every module that reads a task
// list. GitHub-flavoured Markdown accepts `[ ]`, `[x]` and `[X]`, and renderers
// treat the last two as identical. Splitting this across modules is how D-046
// happened: `parseIdDefinitions` matched only `[ x]` while SY-07 matched
// `[xX]`, so an entry checked off with a capital X counted as settled but was
// invisible as a definition — RF-02 then warned about an ID that was sitting
// right there, with no legal way to clear the finding.
//   CHECKBOX_ANY   — any state, for "is this a task line at all"
//   CHECKBOX_DONE  — checked only, for "has this been settled"
// Both are fragment sources, not regexes: callers interpolate them.
export const CHECKBOX_ANY  = '\\[[ xX]\\]'
export const CHECKBOX_DONE = '\\[[xX]\\]'

/**
 * Regexes for one set of ID classes. The set is workspace data (docs/schema.md,
 * see lib/schema.mjs), so these cannot be module constants — they are built per
 * class list and cached, because every loaded file asks for the same one.
 *
 * An empty class list would otherwise compile to `(?:)-\\d{3}`, which matches a
 * bare "-042" in any file; it is refused instead. A workspace whose schema
 * yields no class falls back to the shipped one before it ever reaches here.
 */
const MATCHER_CACHE = new Map()
export function idMatchers(classes) {
  const key = (classes || []).join('|')
  if (!key) throw new Error('idMatchers: no ID classes — the schema must define at least one')
  let m = MATCHER_CACHE.get(key)
  if (!m) {
    const token = `(?:${key})-\\d{3}`
    m = {
      token,
      any:     new RegExp(`\\b(${key})-(\\d{3})\\b`, 'g'),
      heading: new RegExp(`^#{1,6}\\s+(${token})\\b`),
      list:    new RegExp(`^[-*]\\s+(?:${CHECKBOX_ANY}\\s+)?(${token})\\b`),
    }
    MATCHER_CACHE.set(key, m)
  }
  return m
}

/**
 * Find all structured IDs defined in a file (i.e. appearing as definition headings).
 * A "definition" is a heading like "## D-001 — Title" or a list item "- [ ] HT-001 — ...".
 * Returns Array<{ id: string, line: number }> (line is 1-based).
 */
export function parseIdDefinitions(lines, classes) {
  const { heading: ID_HEADING_RE, list: ID_LIST_RE } = idMatchers(classes);
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Heading definitions: ## D-001 — ...
    const headingM = line.match(ID_HEADING_RE);
    if (headingM) {
      defs.push({ id: headingM[1], line: i + 1 });
      continue;
    }
    // List item definitions: - [ ] HT-001 — ... or - HT-001 —
    const listM = line.match(ID_LIST_RE);
    if (listM) {
      defs.push({ id: listM[1], line: i + 1 });
    }
  }
  return defs;
}

/**
 * Find all structured IDs referenced (used but not necessarily defined) in a file.
 * Skips fenced code blocks, inline code, HTML comments (single- and multi-line),
 * and indented code blocks.
 * Returns Array<{ id: string, line: number }> (line is 1-based).
 */
export function parseIdReferences(lines, classes) {
  const refs = [];
  let inFencedBlock = false;
  let inHtmlComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A resolving decision keeps `Closes: OD-NNN` after the OD definition is
    // removed, so this durable trace is intentionally not a live reference.
    if (/^Closes:\s+OD-\d{3}\s*$/.test(line.trim())) continue;

    // Toggle fenced code block
    if (!inHtmlComment && (line.startsWith('```') || line.startsWith('~~~'))) {
      inFencedBlock = !inFencedBlock;
      continue;
    }
    if (inFencedBlock) continue;

    // Indented code block (4 spaces or tab)
    if (line.startsWith('    ') || line.startsWith('\t')) continue;

    // Handle multi-line HTML comments
    let working = line;
    if (inHtmlComment) {
      const endIdx = working.indexOf('-->');
      if (endIdx === -1) continue; // whole line is inside comment
      inHtmlComment = false;
      working = working.slice(endIdx + 3);
    }

    // Strip single-line HTML comments <!-- ... --> and detect unclosed ones
    working = working.replace(/<!--.*?-->/g, '');
    if (working.includes('<!--')) {
      working = working.slice(0, working.indexOf('<!--'));
      inHtmlComment = true;
    }

    // Strip inline code `...` (single backticks)
    working = working.replace(/`[^`]+`/g, '');

    const ids = findIds(working, classes);
    for (const id of ids) {
      refs.push({ id, line: i + 1 });
    }
  }
  return refs;
}

/**
 * Extract blocks delimited by truss markers from lines.
 * Returns Map<id, { startLine, endLine, innerLines: string[] }>
 * startLine/endLine are 1-based (the marker lines themselves).
 */
export function parseBlocks(lines) {
  const blocks = new Map();
  const opens = new Map(); // id → startLine (1-based)

  for (let i = 0; i < lines.length; i++) {
    const marker = parseTrussMarker(lines[i]);
    if (!marker) continue;

    if (marker.type === 'begin') {
      if (opens.has(marker.id)) {
        // Duplicate begin — record as error marker
        const prev = blocks.get(marker.id) || {};
        blocks.set(marker.id, { ...prev, duplicateBegin: true, line: i + 1 });
      } else {
        opens.set(marker.id, i + 1);
      }
    } else {
      // end
      if (!opens.has(marker.id)) {
        // End without begin
        const prev = blocks.get(marker.id) || {};
        blocks.set(marker.id, { ...prev, orphanEnd: true, endLine: i + 1 });
      } else {
        const startLine = opens.get(marker.id);
        opens.delete(marker.id);
        const innerLines = lines.slice(startLine, i); // between markers (0-based slice)
        blocks.set(marker.id, {
          startLine,
          endLine: i + 1,
          innerLines,
          // Detect previous partial/error entry
          ...(blocks.get(marker.id) || {}),
        });
      }
    }
  }

  // Any remaining opens are begin-without-end
  for (const [id, startLine] of opens) {
    blocks.set(id, { ...(blocks.get(id) || {}), startLine, orphanBegin: true });
  }

  return blocks;
}

/**
 * Marker for lines inside a phase section that are neither a `key: value` line
 * nor an indented continuation of one. Non-enumerable so `Object.keys(def)`
 * (PH-01's unknown-key scan) never sees it.
 */
export const PHASE_STRAY = Symbol('phase-stray-lines')
export const PHASE_UNKNOWN_KEYS = Symbol('phase-unknown-keys')

/**
 * Parse a phases.md section body (lines after the ## heading until next ##).
 * Returns a phase definition object.
 *
 * Grammar: every line is `key: value`; a wrapped value continues on an
 * **indented** line. Anything else is free text, which this file does not
 * accept — it would be swallowed into the preceding key and rendered verbatim
 * into the AGENTS.md phase block, i.e. into every session boot. Such lines are
 * collected under PHASE_STRAY instead so PH-01 can report them (D-061).
 */
export function parsePhaseSection(lines) {
  const def = {};
  const stray = [];
  const unknownKeys = [];
  const knownKeys = ['label', 'name', 'purpose', 'behavior', 'allowed', 'forbidden',
    'forbidden-globs', 'read', 'exit', 'prompts'];
  let currentKey = null;
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { currentKey = null; continue; } // blank line ends a value
    const indented = /^\s/.test(line);
    const m = indented ? null : line.match(/^([a-z-]+):\s*(.*)$/);
    if (m) {
      if (knownKeys.includes(m[1])) {
        currentKey = m[1];
        def[currentKey] = m[2];
      } else {
        currentKey = null; // Drop unknown keys
        unknownKeys.push(m[1]);
      }
    } else if (indented && currentKey) {
      def[currentKey] += '\n' + line.trim();
    } else {
      currentKey = null;
      stray.push(line.trim());
    }
  }
  Object.defineProperty(def, PHASE_STRAY, { value: stray, enumerable: false });
  Object.defineProperty(def, PHASE_UNKNOWN_KEYS, { value: unknownKeys, enumerable: false });
  return def;
}

/**
 * Parse state/phases.md content.
 * Returns { frontmatter, ordered: string[], defs: Map<id, def> }
 */
export function parsePhases(lines) {
  const { data: frontmatter, bodyStart } = parseFrontmatter(lines);
  const ordered = [];
  const defs = new Map();

  let currentId = null;
  let sectionLines = [];

  const flush = () => {
    if (currentId) {
      defs.set(currentId, parsePhaseSection(sectionLines));
    }
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+([a-z][a-z0-9-]+)\s*$/);
    if (m) {
      flush();
      currentId = m[1];
      ordered.push(currentId);
      sectionLines = [];
    } else if (currentId) {
      sectionLines.push(lines[i]);
    }
  }
  flush();

  return { frontmatter, ordered, defs };
}

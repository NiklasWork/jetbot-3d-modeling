# Skill & Agent Sources

> Machine-assisted import 2026-08-07. Each file carries a `<!-- Source: … -->` header.

| Prefix | Repo | License | Imported |
|---|---|---|---|
| `superpowers-*` | [obra/superpowers](https://github.com/obra/superpowers) | MIT | 9 skills, 1 agent |
| `anthropic-*` | [anthropics/claude-code](https://github.com/anthropics/claude-code) | © Anthropic PBC — All rights reserved. Marketplace plugins; NOT open source. Imported for reference only. | 2 skills, 1 agent |
| `context7-*` | [upstash/context7](https://github.com/upstash/context7) | MIT | 4 skills, 1 agent |
| `ecc-*` | [affaan-m/ECC](https://github.com/affaan-m/ECC) | MIT | 9 skills, 6 agents |
| `composio-*` | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | per-skill LICENSE.txt | 11 skills |
| `uiux-*` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | 7 skills |
| `stop-slop` | [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) | MIT | 1 skill |
| `marketing-*` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT | 40 skills |
| `no-ai-slop` | [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) | MIT | 1 skill |

**Totals: 84 skills, 9 agents**

## Direct imports, outside the Truss catalogue

`no-ai-slop` was fetched from upstream on 2026-09-09, not through `truss skills add`.
Scanned with skillspector 2.11.1 first: three MEDIUM findings, all false positives
(an unpinned `npx` in the project's own README, and a path matcher firing on the
skill's self-referential `skills/no-ai-slop/SKILL.md`). Its instructions were read
in full before install: prose rules only, no network, no execution.

`stop-slop`'s three `references/*.md` were fetched from the same upstream on the
same day. Truss ships only the `SKILL.md` of a vendored skill, which left this one
pointing at files that were never copied (TF-003).

## Update policy

- Never edit imported files directly — patch upstream and re-import.
- Check for upstream changes periodically via `gh api repos/<owner>/<repo>/commits --jq '.[0].sha'`.
- `academic-research-skills` (Imbad0202): CC BY-NC 4.0 — excluded (non-commercial only).

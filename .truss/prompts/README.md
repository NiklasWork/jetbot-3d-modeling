# Prompts

Truss ships no prompt library. This directory is the place your project puts
its own prompts — nothing else lives here.

## `custom/`

`custom/<id>.md` is a plain Markdown file you write and open yourself when you
want it. No command reads the directory, no check verifies it, and nothing
loads it into a session automatically.

The directory is not shipped: git does not track empty folders, so `custom/`
comes into being the moment you create it.

## Preference overrides

One optional exception to "nothing reads it": `lib/defaults.mjs` looks for
`custom/prefs/<key>/<value>.md` when it renders the behavior text for a
preference. If that file exists, its body replaces the shipped wording for that
key/value pair. If it doesn't, the shipped default is used.

## Why there's no library

The shipped library — ten prompts plus three engine rituals — was removed
because it loaded every fresh instance with pre-made method knowledge (how to
plan, how to critique, how to run a kickoff). That worked against the
framework's own principle that files are the source of truth, not baked-in
habits.

Two procedures survived because the engine names them by path, and a `fix:`
string a check prints is a contract. They live under
[`../docs/rituals/`](../docs/rituals/): `cleanup.md`, the controlled-forgetting
procedure named by `CX-01` and `SY-09`, and `upgrade.md`, the standing
instruction for the judgment half of a version upgrade.

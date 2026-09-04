# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: Erster funktionierender Durchstich — Brush auf M4 mit Testdaten zum Laufen bringen

branch: main

next:
- Brush auf M4 installieren (cargo build) und mit öffentlichem Testdatensatz trainieren
- JetBot aufbauen und IMX219 Fisheye kalibrieren (Schachbrettmuster, OpenCV)
- Erste eigene Videoaufnahme verarbeiten (undistort → ffmpeg → MASt3R → Brush)
- SuperSplat Viewer auf Coolify deployen

blockers: JetBot noch nicht aufgebaut

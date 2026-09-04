# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:
- Entscheidung zu OD-001 (Pose-Stack) und OD-002 (Aufnahmeprotokoll) einholen — beide blockieren jede eigene Aufnahme
- Stufe 0: Brush auf M4 bauen, öffentlichen Datensatz trainieren, Laufzeit/Splat-Zahl/Thermik messen (D-002 nennt ~6 min/~92 % unbelegt)
- Stufe 0: SuperSplat Viewer auf Coolify deployen, .sog-Testmodell laden, splat-transform- und Viewer-Version pinnen
- Stufe 1: JetBot booten, ins WLAN bringen, teleoperation-Notebook öffnen — manuelle Steuerung mit Live-Bild sollte laut Image bereits laufen
- Demo-Rückfallebene anlegen: bekannt-guter Datensatz plus Bildschirmaufnahme des Live-Trainings, lokal ohne Netz lauffähig

blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: Erster Durchstich ohne JetBot (Brush + SuperSplat), während OD-001/OD-002 offen sind

branch: main

next:
- Entscheidung zu OD-001 (Pose-Stack) und OD-002 (Aufnahmeprotokoll) einholen — beide blockieren jede eigene Aufnahme
- Brush auf M4 bauen (cargo) und mit öffentlichem Datensatz trainieren — Laufzeit, Splat-Zahl und Thermik messen statt schätzen (D-002 nennt ~6 min/~92 % unbelegt)
- SuperSplat Viewer auf Coolify deployen, .sog-Testmodell laden, splat-transform- und Viewer-Version pinnen sobald es läuft
- Demo-Rückfallebene anlegen: bekannt-guter Datensatz plus Bildschirmaufnahme des Live-Trainings, lokal lauffähig ohne Netz
- Aufnahmegeometrie für den JetBot festlegen: Kamera so hoch wie das Chassis erlaubt und leicht nach oben, Schleifen statt Geradeausfahrt

blockers: OD-001 und OD-002 unentschieden — betrifft alles ab eigener Aufnahme

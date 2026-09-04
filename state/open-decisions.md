# Open Decisions

> Briefings for undecided questions that block or shape work — including a challenge to a recorded decision (AGENTS.md §3).
> On decision → `D-NNN` in state/decisions/ with `Closes: OD-NNN`, then remove the entry here; no "DECIDED" tombstones. Empty is the correct state of a project with nothing undecided — never delete this file.
> `OD-NNN` sequential, never reused: the next free number is one above the highest `OD-NNN` here **or** in a `Closes:` line under state/decisions/.
> The entry shape below is a machine contract — `doctor`'s SY-03 parses the option lines, so keep it. Full grammar: docs/conventions.md.

<!-- Entry template — an OD is a briefing the human can decide from without reconstructing your analysis.

## OD-NNN — [question title]

Opened: YYYY-MM-DD
Context: [why this matters now, and what it blocks]
Options:
- A: [short label] — [what choosing it means] +[upside] / –[downside]
- B: [short label] (recommended) — [what choosing it means] +[upside] / –[downside]
- C: [short label] — [what choosing it means] +[upside] / –[downside]
- …: so viele, wie die Frage wirklich hat — zwei sind das Minimum, nicht die Form
Trade-offs: [cross-cutting: cost, reversibility — only what the option lines don't carry]
Leaning: [which option and why, one line · or "none" plus what input would decide it]
Needed from human: [the decision or input you need]

Option lines are keyed (A:/B:/C:/…), label before the ` — `, then upside after `+` and
downside after `–`, separated by ` / `. Es gibt keine Obergrenze: liste jede Option,
die die Frage wirklich hat — eine echte Dreier-Wahl in ein Ja/Nein zu pressen
verdeckt genau die Möglichkeit, die der Mensch gewählt hätte. Mark at most one
option `(recommended)`, and only if `Leaning:` agrees. Keep the label short — it is
the click target. -->

## OD-001 — Pose-Schätzung: mlx-mast3r beibehalten oder auf COLMAP umstellen?

Opened: 2026-09-04
Context: Fordert D-003 heraus (Grund: neue Evidenz, die die Entscheidung nicht hatte), und stellt damit auch die Pflicht-Eigenschaft von D-005 in Frage. Drei geprüfte Befunde: (1) `Aedelon/mlx-mast3r` hat 11 Stars, 1 Fork, letzter Commit 2026-01-22 und **keine LICENSE-Datei** — D-002 hat msplat bei 59 Stars als "zu unreif" verworfen, D-003 nimmt ein unreiferes Paket an; ohne Lizenz ist die Nutzung rechtlich nicht eingeräumt. (2) Die Behauptung "exportiert direkt in COLMAP-Format" trifft nicht zu — die API liefert `get_im_poses()`, also 4×4-Matrizen; der Schritt MASt3R → Brush existiert nicht und muss samt Intrinsics und Init-Punktwolke selbst geschrieben werden. (3) MASt3R-Vorteil sind wenige, weitwinklige, texturarme Bilder; ein Raum-Video ist der Gegenfall (viele Frames, hohe Überlappung) — genau der freundlichste Fall für COLMAPs Sequential Matcher und der teuerste für MASt3R. Blockiert jede eigene Aufnahme.
Options:
- A: COLMAP primär (recommended) — `brew install colmap`, Sequential Matcher, `image_undistorter` erzeugt die Pinhole-Bilder aus den Fisheye-Aufnahmen; MASt3R bleibt Fallback wenn COLMAP an einer Szene scheitert +bewährt, liefert die Init-Punktwolke die Brush erwartet, macht die Schachbrett-Kalibrierung aus D-005 optional / –langsamer, scheitert an texturlosen Wänden eher als MASt3R
- B: D-003 beibehalten — mlx-mast3r primär, Konverter zu COLMAP/transforms.json selbst schreiben +MLX-nativ, robuster bei texturarmen Flächen / –unreifes Paket ohne Lizenz, ungeplante Konverter-Arbeit, Frame-Budget ungeklärt (reines MASt3R-Global-Alignment läuft jenseits ~64 Views aus dem Speicher)
- C: Upstream `naver/mast3r` auf PyTorch MPS statt MLX-Port — offizielles MASt3R-SfM inkl. COLMAP-Export, ~1,6× langsamer als MLX +offizieller Code, echte SfM-Skalierung, klare Lizenz (CC BY-NC-SA) / –langsamer, MPS-Support von MASt3R nicht garantiert
Trade-offs: Umkehrbar — alle drei enden in COLMAP-Sparse-Format, ein späterer Wechsel kostet nur den Pose-Schritt neu. A ist heute nicht installiert (`colmap` fehlt lokal), B kostet vor dem ersten Ergebnis einen selbstgeschriebenen Konverter.
Leaning: A — der einfachste Weg zuerst (state/profile.md), und er entfernt gleichzeitig die Kalibrierungs-Pflicht aus D-005. Texturarmut ist billiger über die Aufnahme (Licht, Schleifen) zu lösen als über einen getauschten SfM-Stack.
Needed from human: Welche Option. Bei A zusätzlich: bleibt D-005 als optionaler Weg bestehen oder wird es superseded?

## OD-002 — Aufnahme: Stop-and-Go oder Fahrt-Aufnahme?

Opened: 2026-09-04
Context: Nirgends im Plan adressiert und der wahrscheinlichste konkrete Fehlschlag. Die IMX219 ist ein Rolling-Shutter-Sensor; im Innenraum regelt die Automatik auf lange Belichtung. Ein fahrender JetBot erzeugt damit Bewegungsunschärfe plus Rolling-Shutter-Scherung — Pose-Schätzung und 3DGS brechen beide an unscharfen Frames ein, und zwar sichtbar, nicht subtil. Betrifft jede eigene Aufnahme.
Options:
- A: Stop-and-Go (recommended) — fahren, anhalten, Einzelbild aufnehmen, weiterfahren +scharfe Bilder ohne Zusatzhardware, kein Rolling-Shutter-Effekt, volle Sensorauflösung statt H.264-Artefakte / –langsamer, braucht ein Aufnahmeskript auf dem Jetson, "Roboter fährt und filmt" wird als Erzählung schwächer
- B: Kontinuierliche Videofahrt wie geplant — ffmpeg extrahiert Frames aus dem Video +eine Fahrt, einfachste Erzählung für die Präsentation / –Unschärfe und Scherung bei Innenraumlicht sehr wahrscheinlich, H.264-Kompressionsartefakte vor der Pose-Schätzung
- C: Langsame Fahrt mit fixierter kurzer Belichtung und starkem Zusatzlicht — Belichtung manuell festnageln statt Automatik +Fahrt bleibt erhalten, Unschärfe beherrschbar / –braucht viel Licht im Raum, hohes Sensorrauschen, muss experimentell eingestellt werden
Trade-offs: Billig umkehrbar, kostet nur eine neue Aufnahmefahrt. Entscheidet aber, ob auf dem Jetson ein Aufnahmeskript (A) oder nur eine Videoaufnahme (B/C) gebaut wird.
Leaning: A — Bildschärfe ist die Eingangsgröße, an der die gesamte Pipeline hängt; sie über die Aufnahme zu sichern ist billiger als jeder Reparaturversuch stromabwärts. C als Rückfallebene, falls die Erzählung "fahren und filmen" für die Präsentation wichtiger ist.
Needed from human: Welche Option — und ob "der Roboter fährt während der Aufnahme" für die Präsentation gesetzt ist.

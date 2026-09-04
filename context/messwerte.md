# Messwerte

> Belongs here: gemessene Laufzeiten und Größen auf der echten Hardware, mit Messbedingung. Not here: Werkzeugbegründungen (state/decisions/), Planung (context/plan-*.md).

Übernommene Zahlen aus der Recherchephase werden hier durch gemessene ersetzt. Was hier steht, ist nachgerechnet; was in einer Entscheidung steht und hier fehlt, ist es nicht.

## Referenzlauf Brush — 2026-09-04

Bedingung: MacBook Air M4, 24 GB, lüfterlos, macOS 27. Brush aus Quellstand vom 2026-09-04, Release-Build. Datensatz `tandt/truck` (Tanks & Temples), 251 Bilder à 979×546, COLMAP-Posen mitgeliefert. Ohne Viewer, mit `--eval-split-every 8`.

| Größe | Wert |
|---|---|
| Bau von Brush aus den Quellen | 13 min 58 s |
| Training, 8000 Schritte | **20 min 07 s** |
| Spitzen-Speicher | 3,9 GB |
| Splats im Ergebnis | 1.284.760 |
| Export `.ply` (SH-Grad 3) | 289 MB |
| Konvertierung nach `.sog` | 1 min 07 s |
| Ergebnis `.sog` | **19,1 MB — Faktor 15,1** |

CPU-Zeit lag bei nur 85 s Nutzer- plus 58 s Systemzeit gegen 1207 s Wanduhr: die Arbeit lief erwartungsgemäß auf der GPU über Metal, nicht auf der CPU.

## Was das an den Entscheidungen korrigiert

| Behauptung | Herkunft | Befund |
|---|---|---|
| „~6 min für 8000 Steps" | D-002 | **falsch** — 20 min, Faktor 3,3 daneben |
| „~92 % der vollen Qualität" | D-002 | **ungeprüft** — kein Vergleichslauf über 30k Schritte gemacht |
| Schalter `--total-steps` | D-002 | **falsch** — heißt `--total-train-iters` |
| Manuelles Downsampling nötig | D-002 | **hinfällig** — Brush verkleinert selbst (`--max-resolution`, Vorgabe 1920) |
| `.sog` 15–20× kleiner als `.ply` | D-004 | **bestätigt** — Faktor 15,1 |
| Konvertierung „~15 sec" | D-004 | **falsch** — 1 min 07 s |
| `npx splat-transform` | D-004 | **falsch** — Paket heißt `@playcanvas/splat-transform` |

## Offene Messlücke

latent: Drosselung ist nicht gemessen. `pmset -g therm` liefert auf Apple Silicon keine `CPU_Speed_Limit`-Zeile, der Sampler schrieb leere Werte. Für eine echte Thermik-Aussage braucht es `sudo powermetrics --samplers smc` oder einen längeren Lauf mit Durchsatzvergleich am Anfang und am Ende. Relevant, sobald ein Lauf deutlich über 20 min geht.

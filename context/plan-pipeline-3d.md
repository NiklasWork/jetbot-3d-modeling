---
focus: Aus einem Ordner Fotos ein betrachtbares 3D-Modell machen — mit einem Befehl, reproduzierbar
next:
  - Paket 1 — Werkzeuge lauffähig machen (colmap, brush, splat-transform)
  - Paket 2 — Referenzlauf mit öffentlichem Datensatz, Laufzeit und Thermik messen
  - Paket 3 — COLMAP-Strecke an eigenen Handyfotos erproben
blockers: none
---

# Plan pipeline-3d

> Belongs here: der Weg von heute bis zum ersten Prototypen des Mac-Strangs. Not here: Werkzeugbegründungen (state/decisions/), Roboter-Arbeit (context/plan-roboter.md).

**Prototyp erreicht, wenn:** ein Ordner mit Fotos durch einen Befehl zu einem `.sog` wird, das im Browser navigierbar ist — ohne Roboter, ohne Handarbeit dazwischen.

Jedes Paket ist einzeln abnehmbar. Kein Paket beginnt, bevor das vorige seine Prüfung besteht.

1. **Werkzeuge lauffähig.** `brew install colmap`, Brush aus den Quellen bauen, `npx splat-transform` einmal ziehen.
   *Fertig wenn:* alle drei starten und ihre Version ausgeben.

2. **Referenzlauf.** Einen bekannten öffentlichen Datensatz durch Brush schicken, mit Live-Viewer. Laufzeit, Splat-Zahl, CPU-Temperatur und Drosselung mitschreiben.
   *Fertig wenn:* der Viewer eine erkennbare Szene zeigt und echte Zahlen die Schätzungen aus D-002 ersetzen.

3. **COLMAP-Strecke.** Rund 50 Handyfotos einer Schreibtischecke, dann `feature_extractor` → `sequential_matcher` → `mapper` → `image_undistorter`. Bewusst mit dem Handy, damit Aufnahmequalität hier keine Fehlerquelle ist.
   *Fertig wenn:* über 90 % der Bilder registriert sind und entzerrte Pinhole-Bilder vorliegen.

4. **Verkettung.** Ein Skript, das aus Paket 3 und Paket 2 eine Strecke macht: Ordner rein, `.ply` raus.
   *Fertig wenn:* ein einziger Befehl auf einem frischen Ordner durchläuft.

5. **Komprimieren und anzeigen.** `.ply` → `.sog`, SuperSplat lokal, Modell laden. Versionen von splat-transform und Viewer festnageln.
   *Fertig wenn:* das eigene Modell im Browser navigierbar ist.

6. **Prototyp.** Alles in einem Befehl, im README beschrieben.
   *Fertig wenn:* jemand anderes es allein aus dem README wiederholen kann.

## Danach, nicht jetzt

Fisheye-Bilder vom Roboter statt Handyfotos · Objektlabels aus den Posen im Modell verorten · gefahrene Bahn als Linie einzeichnen · Ausrollen auf den Lenovo.

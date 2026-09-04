---
focus: Der Roboter fährt gesteuert und legt scharfe, richtig große Bilder in einem Ordner ab
next:
  - Paket 1 — Roboter booten, ins WLAN bringen, SD-Karte sichern
  - Paket 2 — Steuerung und Live-Bild aus den mitgelieferten Notebooks
  - Paket 3 — Stop-and-Go-Aufnahmeskript schreiben
blockers: none
---

# Plan roboter

> Belongs here: der Weg von heute bis zum ersten Prototypen des JetBot-Strangs. Not here: Hardware-Fakten (context/architektur.md), Mac-Arbeit (context/plan-pipeline-3d.md).

**Prototyp erreicht, wenn:** eine gesteuerte Fahrt durch einen Raumteil einen Ordner scharfer Bilder erzeugt, den pipeline-3d ohne Nacharbeit verarbeitet.

Alles hier läuft auf Python 3.6 (D-008). Jedes Paket ist einzeln abnehmbar.

1. **Roboter am Netz.** Booten, WLAN einrichten, Jupyter im Browser erreichen. Vorher die SD-Karte sichern — siehe HT-001, danach wird verändert.
   *Fertig wenn:* `basic_motion` bewegt die Räder aus dem Browser.

2. **Steuerung und Bild.** Das mitgelieferte `teleoperation`-Notebook in Betrieb nehmen. Kamera so hoch montieren, wie das Chassis erlaubt, leicht nach oben gekippt.
   *Fertig wenn:* du fährst und siehst dabei das Live-Bild.

3. **Aufnahmeskript.** Die Stop-and-Go-Schleife aus D-013: ein Stück fahren → anhalten → Ausschwingen abwarten → Bild → wiederholen, während der Mensch die Richtung vorgibt. Bilder auf höchstens 1280×960 verkleinern, in Farbe, Dateiname mit Zeitstempel.
   *Fertig wenn:* eine Fahrt einen Ordner erzeugt, in dem stichprobenartig geprüfte Bilder scharf sind.

4. **Übertragung.** Ein Befehl vom Mac holt den Ordner.
   *Fertig wenn:* der Ordner vollständig auf dem Mac liegt.

5. **Prototyp.** Eine echte Aufnahmefahrt durch eine Zimmerecke, übergeben an pipeline-3d.
   *Fertig wenn:* daraus ein Modell entsteht — der Beweis, dass beide Stränge zusammenpassen.

## Danach, nicht jetzt

Objekterkennung mit jetson-inference (D-012) · Fahralgorithmus statt Handsteuerung · Erkennungen pro Bild mitschreiben.

# Architektur

> Belongs here: Rollenteilung der drei Maschinen und der Stufenplan bis zum Durchstich. Not here: Werkzeugwahl (state/decisions/), offene Fragen (state/open-decisions.md).

## Rollenteilung

Die Grenze ist Latenz, nicht Rechenleistung: was in unter ~100 ms reagieren muss, läuft auf dem Roboter; alles andere auf dem Mac.

- **JetBot** — Sensor und Aktor. Fahren, Kamerabild aufnehmen, Bild für die Bedienoberfläche streamen, Aufnahmen ablegen. Später optional ein kleines vortrainiertes Modell im Fahrtakt. Nie: Pose-Schätzung, nie 3DGS-Training.
- **MacBook M4** — Rechenwerk und Bühne. Pose-Schätzung, 3DGS-Training mit sichtbarem Live-Viewer, Konvertierung nach `.sog`. Steuert den Roboter nie in Echtzeit.
- **Lenovo-Server (Coolify)** — Schaufenster, sonst nichts (D-007). Statisches Hosting des fertigen Modells. Keine GPU, nicht nachrüstbar, 4 Kerne — als Rechenknoten für jede Aufgabe hier langsamer als der Mac. Harte Grenze: **~9 MBit/s Upload**. Ein 50-MB-Modell braucht damit knapp eine Minute pro Abruf; ein Hörsaal, der gleichzeitig lädt, bringt die Leitung zum Erliegen. Für die Vorführung deshalb lokal vom Mac ausliefern und den Web-Link als Mitnahme danach verstehen.

## Hardware-Realität JetBot

Bestätigt über das aufgespielte Image `jetbot-043_nano-4gb-jp45`: klassischer Jetson Nano 4GB, 128-Kern-Maxwell-GPU, ~0,5 TFLOPS, 4 GB geteilter Speicher — kein Orin. Software: JetBot 0.4.3 auf JetPack 4.5 (Ubuntu 18.04, Python 3.6, CUDA 10.2, TensorRT 7.1), eingefroren per D-008. Das trägt kleine, ältere Modelle im Fahrtakt und sonst nichts.

Das Image bringt die JetBot-Notebooks mit — `basic_motion` und `teleoperation` liefern die manuelle Steuerung samt Live-Kamerabild aus D-006 bereits fertig, `collision_avoidance` und `road_following` sind die Vorlage für den optionalen Fahralgorithmus.

## Stufenplan

Jede Stufe ist für sich vorführbar. Keine Stufe hängt an einer späteren.

1. **Stufe 0 — Pipeline ohne Roboter.** Öffentlicher Datensatz → Brush mit Live-Viewer auf dem Mac → `.sog` → SuperSplat auf Coolify. Beweist die gesamte hintere Hälfte und liefert sofort das visuell stärkste Artefakt des Projekts.
2. **Stufe 1 — Roboter fährt, Bild kommt an.** Manuelle Steuerung mit Live-Kamerabild im Browser. Hängt an nichts aus Stufe 0.
3. **Stufe 2 — Verbinden.** Roboter nimmt auf, Mac rechnet, Ergebnis landet im Web-Viewer. Aufnahmegeometrie ist hier die Qualitätsgröße: Kamera so hoch wie das Chassis erlaubt und leicht nach oben, Schleifen statt Geradeausfahrt, viel Licht, lieber ein gut erfasster Raumteil als ein schlecht erfasster ganzer Raum.
4. **Stufe 3 — Ausbau.** In beliebiger Reihenfolge: Fahralgorithmus, Modell auf der Roboter-GPU, Rekonstruktion während der Fahrt.

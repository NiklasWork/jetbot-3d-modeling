# Architektur

> Belongs here: Rollenteilung der Maschinen, die zwei Entwicklungsstränge und der Stufenplan. Not here: Werkzeugwahl (state/decisions/), offene Fragen (state/open-decisions.md).

## Rollenteilung

Die Grenze ist Latenz, nicht Rechenleistung: was in unter ~100 ms reagieren muss, läuft auf dem Roboter; alles andere auf dem Mac.

- **JetBot** — Sensor und Aktor. Fahren, Kamerabild aufnehmen, Bild für die Bedienoberfläche streamen, Aufnahmen ablegen. Später optional ein kleines vortrainiertes Modell im Fahrtakt. Nie: Pose-Schätzung, nie 3DGS-Training.
- **MacBook M4** — Rechenwerk und Bühne. Pose-Schätzung, 3DGS-Training mit sichtbarem Live-Viewer, Konvertierung nach `.sog`. Steuert den Roboter nie in Echtzeit.
- **Lenovo-Server (Coolify)** — Schaufenster, sonst nichts (D-007). Statisches Hosting des fertigen Modells. Keine GPU, nicht nachrüstbar, 4 Kerne — als Rechenknoten für jede Aufgabe hier langsamer als der Mac. Harte Grenze: **~9 MBit/s Upload**. Ein 50-MB-Modell braucht damit knapp eine Minute pro Abruf; ein Hörsaal, der gleichzeitig lädt, bringt die Leitung zum Erliegen. Für die Vorführung deshalb lokal vom Mac ausliefern und den Web-Link als Mitnahme danach verstehen.

## Hardware-Realität JetBot

Bestätigt über das aufgespielte Image `jetbot-043_nano-4gb-jp45`: klassischer Jetson Nano 4GB, 128-Kern-Maxwell-GPU, ~0,5 TFLOPS, 4 GB geteilter Speicher — kein Orin. Software: JetBot 0.4.3 auf JetPack 4.5 (Ubuntu 18.04, Python 3.6, CUDA 10.2, TensorRT 7.1), eingefroren per D-008. Das trägt kleine, ältere Modelle im Fahrtakt und sonst nichts.

**Python lässt sich aufrüsten, es nützt nur nichts.** Ein neueres Python ist auf Ubuntu 18.04 installierbar (deadsnakes oder Eigenbau), aber NVIDIA liefert CUDA-fähige PyTorch-Räder ausschließlich für das mitgelieferte Python 3.6 — auch der offizielle `l4t-pytorch`-Container ist 3.6. Alles darüber hieße PyTorch selbst mit CUDA übersetzen. Und die eigentliche Decke liegt tiefer als Python: die Maxwell-GPU kann nur CUDA 10.2, PyTorch 2.x verlangt CUDA 11+. Ein moderner Torch-Stack ist auf dieser Hardware also unabhängig von der Python-Version nicht erreichbar. Wer trotzdem ein neueres Modell fahren will, geht über ONNX → TensorRT 7.1: das läuft GPU-beschleunigt aus Python 3.6 heraus und macht die Modellwahl von der Python-Version unabhängig.

Das Image bringt die JetBot-Notebooks mit — `basic_motion` und `teleoperation` liefern die manuelle Steuerung samt Live-Kamerabild aus D-006 bereits fertig, `collision_avoidance` und `road_following` sind die Vorlage für den optionalen Fahralgorithmus.

## Stufenplan

Jede Stufe ist für sich vorführbar. Keine Stufe hängt an einer späteren.

1. **Stufe 0 — Pipeline ohne Roboter.** Öffentlicher Datensatz → Brush mit Live-Viewer auf dem Mac → `.sog` → SuperSplat **lokal auf dem Mac**. Beweist die gesamte hintere Hälfte und liefert sofort das visuell stärkste Artefakt des Projekts. Das Ausrollen auf den Lenovo ist zurückgestellt: es ändert nur die Adresse, an der derselbe Viewer liegt, und wird bei Bedarf zum Schluss nachgeholt.
2. **Stufe 1 — Roboter fährt, Bild kommt an.** Manuelle Steuerung mit Live-Kamerabild im Browser. Hängt an nichts aus Stufe 0.
3. **Stufe 2 — Verbinden.** Roboter nimmt auf, Mac rechnet, Ergebnis landet im Viewer. Aufnahmegeometrie ist hier die Qualitätsgröße: Kamera so hoch wie das Chassis erlaubt und leicht nach oben, Schleifen statt Geradeausfahrt, viel Licht, lieber ein gut erfasster Raumteil als ein schlecht erfasster ganzer Raum.
4. **Stufe 3 — Ausbau.** In beliebiger Reihenfolge: Objekterkennung mit Verortung im Modell (D-012), Fahralgorithmus, Ausrollen auf den Lenovo, Rekonstruktion während der Fahrt.

## Zwei Entwicklungsstränge

Getrennte Repos, getrennte Laufzeit, getrennt vorführbar (D-011). Sie treffen sich an genau einer Stelle: dem Ordner mit Bildern, den der Roboter erzeugt und die Pipeline liest.

| | `repos/pipeline-3d/` | `repos/roboter/` |
|---|---|---|
| Läuft auf | MacBook M4, macOS | JetBot, Ubuntu 18.04 |
| Sprache | Python 3.14 / Shell | **Python 3.6** — kein Walrus, keine dataclasses |
| Werkzeuge | COLMAP, Brush, splat-transform | JetBot 0.4.3, jetson-inference |
| Liefert | das 3D-Modell und den Viewer | Bilder, Steuerung, Objekterkennungen |
| Vorführbar als | wachsendes Modell im Live-Viewer | fahrender Roboter mit Live-Erkennung |

Die Schnittstelle ist bewusst dumm: ein Ordner mit Bildern plus eine Datei mit Erkennungen pro Bild. Kein Protokoll, keine Netzwerk-API, keine gemeinsame Bibliothek — damit bleibt jede Seite ohne die andere lauffähig und einzeln reparierbar.

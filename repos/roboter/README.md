# roboter

Alles, was auf dem JetBot läuft: fahren, aufnehmen, später Objekte erkennen.
Erzeugt den Bilderordner, den `pipeline-3d` weiterverarbeitet — und funktioniert ohne sie.

## Zielsystem

| | |
|---|---|
| Gerät | Waveshare JetBot, Jetson Nano 4GB |
| Image | `jetbot-043_nano-4gb-jp45` — JetBot 0.4.3, JetPack 4.5 |
| OS | Ubuntu 18.04, **Python 3.6**, CUDA 10.2, TensorRT 7.1 |
| Zugang | Jupyter im Browser, `http://<jetbot-ip>:8888`, Nutzer/Passwort `jetbot` |

> **Python 3.6 ist bindend.** Keine dataclasses (3.7), kein Walrus-Operator (3.8),
> kein `ultralytics`. Der Stack ist bewusst eingefroren — Updates sind für diese
> Hardware nicht verfügbar, siehe Entscheidung D-008 im Workspace.

## Was hier entsteht

1. **Steuerung** — kommt aus dem Image mit (`teleoperation`, `basic_motion`).
2. **Aufnahme** — Bilder in einen Ordner schreiben, benannt nach Zeitstempel.
3. **Objekterkennung** — vortrainiertes SSD-MobileNet über `jetson-inference`,
   Erkennungen pro Bild mitschreiben. Die Zuordnung zu 3D-Koordinaten passiert
   **nicht hier**, sondern auf dem Mac aus den COLMAP-Posen.

## Stand

Roboter ist aufgebaut und geflasht, sonst nichts. Nächster Schritt: booten, ins WLAN
bringen, `teleoperation`-Notebook öffnen.

## Grenzen

- Kein Radencoder, keine IMU — der Roboter kann seinen eigenen Weg nicht zuverlässig
  mitführen. Die Kamerabahn kommt aus der Rekonstruktion auf dem Mac.
- Rolling-Shutter-Kamera: Bilder während der Fahrt werden im Innenraum unscharf.
- Keine Sicherheitsupdates mehr. Gehört ins Heimnetz, nicht ins offene WLAN.

Planung, Begründungen und offene Fragen liegen nicht hier, sondern im Truss-Workspace eine Ebene höher.

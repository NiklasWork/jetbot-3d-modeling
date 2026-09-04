# JetBot 3D Modeling — Vision

> Strategischer Anker. Headings sind strukturgebend.

## Problem

Für ein Uni-Robotik-Projekt (Gruppenarbeit, Präsentation vor dem Kurs) braucht es einen funktionierenden Prototyp, der aus Videoaufnahmen eines Innenraums ein begehbares 3D-Modell (3D Gaussian Splatting) erzeugt. Der Trainingsfortschritt muss visuell sichtbar sein — das ist der Kern der Präsentation.

## Idea

Ein Waveshare JetBot nimmt Video eines Raums auf. Auf dem MacBook M4 werden daraus Kameraposen geschätzt und ein 3DGS-Modell trainiert — der Trainingsfortschritt ist live sichtbar (Brush --with-viewer). Das fertige Modell wird komprimiert und als interaktiver Web-Viewer bereitgestellt.

Gefahren wird manuell, ein Fahralgorithmus ist optionaler Ausbau (D-006). Staged-Ansatz: Aufnehmen → Übertragen → Verarbeiten (mit sichtbarem Training) → Web-Viewer. Live-Streaming vom JetBot während der Fahrt ist Stretch-Goal, nicht MVP.

## Principles

- Minimal bauen, dann erweitern — erst der funktionierende Prototyp, dann Features
- Visualisierung ist Pflicht — sichtbarer Fortschritt bei jedem Schritt
- Schnelle kleine Erfolge statt langer Planungszyklen
- Spaßprojekt — die Optik zählt: ein Ergebnis, das cool aussieht, schlägt ein vollständiges
- Funktional statt Fassade — nichts vorführen, was nicht wirklich läuft

## Constraints

- Hardware: Waveshare JetBot (Jetson Nano 4GB, IMX219 160° Kamera, aufgebaut und geflasht), MacBook Air M4 24GB (kein Lüfter), Lenovo-Homeserver 35GB RAM CPU-only mit Coolify — entfernt, hohe Latenz, ~9 MBit/s Upload
- Kein NVIDIA-GPU-Server — alle ML-Workloads müssen auf Apple Silicon / Metal laufen
- Team arbeitet via Agentic Engineering (AI-gestützte Entwicklung über diesen Kanal)
- Keine feste Deadline — Uni-Gruppenarbeit
- Thermal Throttling auf dem MacBook Air bei Dauerlast >15 min zu erwarten

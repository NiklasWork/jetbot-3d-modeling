# pipeline-3d

Aus einem Ordner mit Bildern eines Innenraums ein 3D-Gaussian-Splatting-Modell erzeugen und anzeigen.
Läuft vollständig auf dem MacBook (Apple Silicon). Braucht den Roboter nicht — jeder Ordner mit
überlappenden Fotos funktioniert.

## Was hier passiert

```
Bilder/  →  COLMAP  →  Brush  →  splat-transform  →  SuperSplat
            Posen +    Training   .ply → .sog        Viewer im
            Entzerrung (sichtbar) (15-20× kleiner)   Browser
```

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| Posen schätzen und entzerren | COLMAP | `sparse/` + entzerrte Pinhole-Bilder |
| Modell trainieren | Brush | `.ply`, live mitzusehen |
| Komprimieren | `npx splat-transform` | `.sog` |
| Anzeigen | SuperSplat | Browser-Viewer |

## Voraussetzungen

```bash
brew install colmap ffmpeg
# Brush: Rust-Toolchain vorhanden (cargo), Bau nach Anleitung des Projekts
```

## Stand

Noch nichts gebaut. Nächster Schritt ist Stufe 0: Brush mit einem öffentlichen Datensatz
trainieren und die echte Laufzeit auf dem M4 messen.

## Grenzen

- Eingangsbilder auf höchstens 1080p herunterrechnen — darüber bricht Brush mit `BufferTooBig` ab.
- Training auf 7.000–10.000 Schritte begrenzen: das MacBook Air hat keinen Lüfter.
- Unscharfe Bilder sind nicht reparierbar. Was hier hineingeht, entscheidet das Ergebnis.

Planung, Begründungen und offene Fragen liegen nicht hier, sondern im Truss-Workspace eine Ebene höher.

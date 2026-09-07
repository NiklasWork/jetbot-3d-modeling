# pipeline-3d

Create and display a 3D Gaussian splatting model from a folder of images of an indoor space.
Runs entirely on the MacBook (Apple Silicon). Does not need the robot — any folder with
overlapping photos works.

```bash
./pipeline.sh ~/photos/my-room
```

Six and a half minutes later, `runs/my-room/model.html` opens in a browser and you can
orbit the room. That is the whole thing.

## What happens

```
images/  →  COLMAP  →  Brush  →  splat-transform  →  model.html
            poses +    training   .ply → .sog        SuperSplat viewer,
            undistortion (visible) (8× smaller)      model inlined
```

| Stage | Tool | Writes | 251 images |
|---|---|---|---:|
| `sfm` | COLMAP | `undistorted/` — pinhole images + poses | 99 s |
| `train` | Brush | `model.ply` | 254 s |
| `compress` | splat-transform | `model.sog`, `model.html` | 27 s |

Each stage skips itself if its output already exists, so a re-run continues where it
stopped. `--force` recomputes.

## Install

```bash
brew install colmap
```

Brush is built from source — clone `ArthurBrussee/brush`, `cargo build --release`
(about 14 min), and either leave the binary at `~/tools/brush/target/release/brush`
or point `BRUSH=` at it. `splat-transform` needs no install; the script pulls the
pinned version through `npx`.

## Options

| | |
|---|---|
| `--preset fast\|full` | `fast` is the default: 5000 steps, 400 k splats, 800 px. `full` is 8000 steps at 1 M splats and takes about four times as long for roughly 0.7 dB. |
| `--matcher sequential\|exhaustive` | `sequential` assumes consecutive filenames are consecutive viewpoints. Right for a drive or a video, wrong for handheld stills — see below. |
| `--mapper incremental\|global` | `incremental` is faster and more accurate on a good match graph. `global` registers more images off a thin one, but constrains them badly. |
| `--camera MODEL` | COLMAP camera model. `OPENCV` for a normal lens, `OPENCV_FISHEYE` for the JetBot's 160° camera. |
| `--viewer` | Brush's live training viewer — the model assembling itself, which is the point of the presentation. |
| `--probe` | Verdict only, into `runs/<name>-probe`: the same images at 1000 px, poses only, no undistortion, no training. Answers *will this reconstruct?* for a fraction of the cost. Resolution is the lever, never image count — dropping images would destroy the overlap the probe exists to measure. A probe that passes means the real run passes; a probe that fails means look closer, not start over. Nothing it computes is reused, so on a capture method that already works it is pure overhead. |
| `--stop-after sfm\|train\|compress` | |
| `--out DIR` | Default `runs/<folder name>`. |

## When it fails

The script stops before training if fewer than 70 % of the images register, or if the
scene breaks into more than three fragments. Both mean the same thing: **the images do
not overlap enough for COLMAP to connect them.**

Try, in this order:

1. `--matcher exhaustive`. Matching every pair instead of neighbouring ones is the fix
   about as often as not. It costs roughly 14 minutes for 260 images, so it is not the
   default, but it is what reproduces the published reconstructions.
2. Capture again with more overlap. 70–80 % between neighbouring shots, loops rather
   than straight lines, plenty of light.
3. `--mapper global` last. It will register images a thin graph cannot support — the
   count looks better and the model does not.

A failure here is a capture problem. No setting downstream repairs it.

## Limitations

- **Blurry images are not repairable.** What goes in decides the result.
- Textureless white walls give COLMAP nothing to match. Light, angles and loops help;
  tool choice does not.
- The MacBook Air has no fan. `full` at 8000 steps runs about 16 minutes under load —
  measured as safe on an open, ventilated machine, not in a bag.
- Indoor scenes come out hazy: large translucent splats in front of the geometry, with
  the viewer's opening camera inside them. `--filter-floaters` does not remove these.
- `model.html` inlines the model, so it grows with it: 12 MiB for a 400 k-splat scene.
  For anything larger, serve `model.sog` next to a viewer instead.

Planning, rationales and open questions belong not here, but in the Truss workspace one
level higher — runtimes and their conditions are in `context/measurements.md`.

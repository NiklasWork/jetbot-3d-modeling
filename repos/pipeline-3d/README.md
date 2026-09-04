# pipeline-3d

Create and display a 3D Gaussian splatting model from a folder of images of an indoor space.
Runs entirely on the MacBook (Apple Silicon). Does not need the robot — any folder with
overlapping photos works.

## What happens here

```
Images/  →  COLMAP  →  Brush  →  splat-transform  →  SuperSplat
            poses +    training   .ply → .sog        viewer in
            undistortion (visible) (15-20× smaller)   browser
```

| Step | Tool | Result |
|---|---|---|
| Estimate poses and undistort | COLMAP | `sparse/` + undistorted pinhole images |
| Train model | Brush | `.ply`, visible live |
| Compress | `npx splat-transform` | `.sog` |
| Display | SuperSplat | browser viewer |

## Prerequisites

```bash
brew install colmap ffmpeg
# Brush: Rust toolchain available (cargo), build according to the project's instructions
```

## Status

Nothing built yet. Next step is stage 0: train Brush with a public dataset
and measure the true runtime on the M4.

## Limitations

- Downscale input images to at most 1080p — above that Brush aborts with `BufferTooBig`.
- Limit training to 7,000–10,000 steps: the MacBook Air has no fan.
- Blurry images are not repairable. What goes in here decides the result.

Planning, rationales and open questions belong not here, but in the Truss workspace one level higher.

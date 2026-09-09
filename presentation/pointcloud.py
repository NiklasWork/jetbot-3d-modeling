#!/usr/bin/env python3
"""Write presentation/assets/pointcloud.json from a run's own sparse model.

The deck's opening slide rotates this cloud behind the headline. It is the same
scene as the embedded viewer, one stage earlier: what COLMAP recovered before
Brush grew a dense model out of it.

    python3 presentation/pointcloud.py [<run>]        # default: drjohnson

**The gravity rotation is not optional**, for the same reason the viewer recipe
carries it (context/presentation.md, L-004): COLMAP anchors its world frame to
the first registered camera, so a reconstruction lands at an arbitrary attitude
and drjohnson lands 14.3° off level. The viewer is steered out of that by
`splat-transform -r`; this canvas has no such control, so the rotation is baked
into the written file here. Drop it and the room hangs off its axis with no
visible error anywhere.

The angles come from `repos/pipeline-3d/gravity.mjs`, in the same
splat-transform convention it prints: R = Rz(+ez)·Ry(-ey)·Rx(-ex).
"""

import json
import math
import os
import random
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "assets", "pointcloud.json")

# Four times the density of the first build, and still cheap enough that the
# canvas holds 60 fps while a laptop is also driving a projector.
KEEP = 24000
SEED = 20260909


def read_points(path):
    """COLMAP points3D.bin: count, then id · xyz · rgb · error · track."""
    pts = []
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            f.read(8)
            x, y, z = struct.unpack("<3d", f.read(24))
            r, g, b = struct.unpack("<3B", f.read(3))
            f.read(8)
            (track,) = struct.unpack("<Q", f.read(8))
            f.read(8 * track)
            pts.append((x, y, z, r, g, b))
    return pts


def gravity_matrix(images_bin):
    out = subprocess.run(
        ["node", os.path.join(ROOT, "repos/pipeline-3d/gravity.mjs"), images_bin],
        capture_output=True, text=True, check=True,
    )
    ex, ey, ez = (float(v) for v in out.stdout.strip().split(","))
    sys.stderr.write(out.stderr)
    a, b, c = math.radians(-ex), math.radians(-ey), math.radians(ez)
    ca, sa, cb, sb, cc, sc = (math.cos(a), math.sin(a), math.cos(b),
                              math.sin(b), math.cos(c), math.sin(c))
    rx = ((1, 0, 0), (0, ca, -sa), (0, sa, ca))
    ry = ((cb, 0, sb), (0, 1, 0), (-sb, 0, cb))
    rz = ((cc, -sc, 0), (sc, cc, 0), (0, 0, 1))
    mul = lambda A, B: tuple(tuple(sum(A[i][k] * B[k][j] for k in range(3))
                                   for j in range(3)) for i in range(3))
    return mul(mul(rz, ry), rx)


def percentile(values, q):
    s = sorted(values)
    return s[max(0, min(len(s) - 1, int(q * (len(s) - 1))))]


def main():
    run = sys.argv[1] if len(sys.argv) > 1 else "drjohnson"
    base = os.path.join(ROOT, "repos/pipeline-3d/runs", run, "undistorted/sparse")
    pts = read_points(os.path.join(base, "points3D.bin"))
    R = gravity_matrix(os.path.join(base, "images.bin"))
    print("read %d points from %s" % (len(pts), run))

    rot = [(R[0][0] * x + R[0][1] * y + R[0][2] * z,
            R[1][0] * x + R[1][1] * y + R[1][2] * z,
            R[2][0] * x + R[2][1] * y + R[2][2] * z, r, g, b)
           for x, y, z, r, g, b in pts]

    # Centre on the median and scale off the 2nd/98th percentile span, not the
    # extremes: a handful of stray triangulations sit metres outside the room
    # and would shrink everything else to a dot.
    centre = [percentile([p[i] for p in rot], 0.5) for i in range(3)]
    span = max(percentile([p[i] for p in rot], 0.98)
               - percentile([p[i] for p in rot], 0.02) for i in range(3))
    scale = 2.0 / span

    keep = []
    for x, y, z, r, g, b in rot:
        v = [(c - centre[i]) * scale for i, c in enumerate((x, y, z))]
        if max(abs(c) for c in v) > 1.2:
            continue
        keep.append([round(v[0], 3), round(v[1], 3), round(v[2], 3), r, g, b])

    if len(keep) > KEEP:
        random.seed(SEED)
        keep = random.sample(keep, KEEP)

    with open(OUT, "w") as f:
        json.dump(keep, f, separators=(",", ":"))
    print("wrote %s · %d points · %.0f KB"
          % (os.path.relpath(OUT, os.getcwd()), len(keep),
             os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()

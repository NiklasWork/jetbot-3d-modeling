#!/usr/bin/env python3
"""Write the two clouds the deck draws, from one run's own output.

    python3 presentation/pointcloud.py [<run>]        # default: drjohnson

Two files, because two slides make two different claims and each has to show
what it claims:

  assets/pointcloud.json   COLMAP's sparse cloud, from undistorted/sparse/
                           points3D.bin. Drawn small on the open-source slide,
                           under the COLMAP card. That card says what COLMAP
                           produced, so it must not be fed Brush's output.

  assets/splats.json       the centres of the *trained* Gaussians, from
                           model.ply. Drawn large behind the opening headline.
                           The sparse cloud was there before and could not be
                           made to read as a room, because it is not one: it is
                           a few tens of thousands of separately triangulated
                           feature points. This is the finished model, which is
                           also what the headline promises.

**Neither cloud may be written unlevelled.** COLMAP anchors its world frame to
the first registered camera, so a reconstruction lands at an arbitrary
attitude — drjohnson lands about 14° off. The viewer is steered out of that by
`splat-transform -r` (see context/presentation.md, L-004); a 2D canvas has no
such control, so the rotation is baked into the files written here. Drop it and
the room hangs off its axis with no visible error anywhere.

Both clouds are levelled with the same physical up direction, and finding that
out took measuring rather than reading. `gravity.mjs` reads the up vector out
of the COLMAP camera poses and reports `up -0.133,-0.969,+0.209`. Brush writes
its own answer into the ply header as `Vertical axis: -0.144,-0.964,-0.224`.
Same direction, opposite sign in z, so one of the two had to be expressed in a
different frame than the points it belongs to — and guessing which would have
tilted a floor by twice the error, silently and with nothing to see.

Measured, not guessed: the ply's vertex positions want the header comment's
vector **with z negated**, which is then the same direction gravity.mjs reports
from the poses. The header comment's z is flipped relative to the vertices it
describes. So the two sources do agree, and the viewer's `splat-transform -r`
angles are consistent with what is written here.

That is a conclusion about one Brush version, so this file does not rely on it.
Every cloud is levelled with both candidate axes, both results are measured,
the sharper one is used, and the numbers are printed. The measure is how
tightly the floor concentrates in a histogram of the vertical axis: a levelled
room drops a large share of its points into one thin horizontal slab, a tilted
one smears that slab across many bins. If a future run flips a winner, the
output says so instead of quietly leaning the room.
"""

import base64
import json
import math
import os
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(HERE, "assets")

KEEP_SPARSE = 24000       # the small card: more than this is one solid block

# The hero cloud is capped, not targeted: what actually limits it is how many
# splats survive the two filters below, and for drjohnson that is about 189 000
# of 400 000. Packed at 12 bytes per splat (see write_packed), 200 000 costs
# 2.4 MB — a third of what the same points cost as JSON numbers, which is why
# the count could go up and the page get smaller at the same time.
#
# **The binding limit is frame time, not bytes.** Measured 2026-09-10 in the
# browser at 189 000 points on a 768x830 canvas, the size the opening cloud
# gets on a 1920 projector: 15.2 ms median, 16.3 ms worst, against a 60 fps
# budget of 16.7. That is with points spread at random, which is the expensive
# case; the real cloud clips about half of them behind the camera. The budget
# is nevertheless almost spent, so raising this number trades frames for
# density. If the deck ever stutters at a podium, this constant is the fix.
KEEP_DENSE = 200000
SEED = 20260910

# Splats below this opacity are the haze a 3DGS model wraps itself in. They are
# most of why the first attempt read as fog: they cover the geometry without
# describing any of it. Dropping them is the single biggest legibility win.
MIN_OPACITY = 0.28
# And the giant ones are the same problem from the other side — a handful of
# metre-wide blobs standing in for "somewhere over there". Keep the small ones,
# which are the ones that sit on surfaces.
SCALE_PERCENTILE = 0.80

SH_C0 = 0.28209479177387814

# How far out of the room's centre a point may sit before it is dropped, in
# units of the normalised half-span. Shared by `normalise` and `write_packed`:
# the packer quantises against exactly this range, so the two drifting apart
# would clip the room or waste half the int16 range on empty space.
CLIP = 1.2


# ── reading ────────────────────────────────────────────────────────────────

def read_sparse(path):
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


def read_ply(path):
    """Brush's 3DGS ply. Returns (points, vertical_axis_from_header).

    The header is parsed rather than assumed: the property list fixes both the
    stride and the offset of every field, and a future Brush that adds or
    reorders properties would otherwise be read as garbage without failing.
    """
    with open(path, "rb") as f:
        head = b""
        while b"end_header\n" not in head:
            chunk = f.read(4096)
            if not chunk:
                raise SystemExit("pointcloud: %s has no end_header" % path)
            head += chunk
        split = head.index(b"end_header\n") + len(b"end_header\n")
        text = head[:split].decode("ascii", "replace")
        body = head[split:] + f.read()

    count = None
    props = []
    axis = None
    for line in text.splitlines():
        if line.startswith("element vertex"):
            count = int(line.split()[2])
        elif line.startswith("property float"):
            props.append(line.split()[2])
        elif line.startswith("property "):
            raise SystemExit("pointcloud: non-float property %r — the fixed "
                             "stride below would be wrong" % line)
        elif line.startswith("comment Vertical axis:"):
            axis = tuple(float(v) for v in line.split(":")[1].split())

    if count is None or not props:
        raise SystemExit("pointcloud: could not read the ply header")
    stride = 4 * len(props)
    if len(body) < count * stride:
        raise SystemExit("pointcloud: %s is short — %d bytes for %d vertices "
                         "of %d" % (path, len(body), count, stride))

    idx = {name: 4 * props.index(name) for name in props}
    o_xyz = idx["x"]
    o_scale = idx["scale_0"]
    o_opac = idx["opacity"]
    o_dc = idx["f_dc_0"]
    f3 = struct.Struct("<3f")
    f1 = struct.Struct("<f")

    raw = []
    for i in range(count):
        base = i * stride
        x, y, z = f3.unpack_from(body, base + o_xyz)
        s0, s1, s2 = f3.unpack_from(body, base + o_scale)
        (op,) = f1.unpack_from(body, base + o_opac)
        d0, d1, d2 = f3.unpack_from(body, base + o_dc)
        # opacity and scale are stored pre-activation, exactly as the optimiser
        # held them: logit and log. Undo both before comparing to a threshold.
        alpha = 1.0 / (1.0 + math.exp(-op)) if -40 < op < 40 else (0.0 if op < 0 else 1.0)
        size = (math.exp(s0) + math.exp(s1) + math.exp(s2)) / 3.0
        raw.append((x, y, z, d0, d1, d2, alpha, size))
    return raw, axis, count


# ── levelling ──────────────────────────────────────────────────────────────

def rotation_to_down(up):
    """The shortest rotation taking `up` onto (0,-1,0).

    Axis-angle rather than three Euler angles on purpose: an Euler triple only
    means something once its order and sign convention are also agreed, and
    that convention is precisely what the two sources here disagree about.
    A rotation that carries one measured vector onto one chosen vector needs no
    convention at all.
    """
    n = math.sqrt(sum(c * c for c in up)) or 1.0
    u = [c / n for c in up]
    t = (0.0, -1.0, 0.0)
    dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(u, t))))
    ax = (u[1] * t[2] - u[2] * t[1],
          u[2] * t[0] - u[0] * t[2],
          u[0] * t[1] - u[1] * t[0])
    s = math.sqrt(sum(c * c for c in ax))
    if s < 1e-9:                       # already aligned, or exactly opposed
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1)) if dot > 0 else \
               ((1, 0, 0), (0, -1, 0), (0, 0, -1))
    k = [c / s for c in ax]
    ang = math.acos(dot)
    c, si, t1 = math.cos(ang), math.sin(ang), 1.0 - math.cos(ang)
    return (
        (c + k[0]*k[0]*t1,      k[0]*k[1]*t1 - k[2]*si, k[0]*k[2]*t1 + k[1]*si),
        (k[1]*k[0]*t1 + k[2]*si, c + k[1]*k[1]*t1,      k[1]*k[2]*t1 - k[0]*si),
        (k[2]*k[0]*t1 - k[1]*si, k[2]*k[1]*t1 + k[0]*si, c + k[2]*k[2]*t1),
    )


def apply(R, x, y, z):
    return (R[0][0]*x + R[0][1]*y + R[0][2]*z,
            R[1][0]*x + R[1][1]*y + R[1][2]*z,
            R[2][0]*x + R[2][1]*y + R[2][2]*z)


def floor_sharpness(ys, bins=400):
    """How much of the cloud lands in its single fullest horizontal slab.

    A levelled room has a floor, and a floor is a lot of points at one height.
    Tilt it and those points spread over many bins, so this number drops. It is
    a relative score for comparing two candidate rotations of the same cloud,
    nothing more — it is not calibrated and means nothing on its own.
    """
    lo, hi = percentile(ys, 0.01), percentile(ys, 0.99)
    if hi - lo < 1e-9:
        return 0.0
    hist = [0] * bins
    span = hi - lo
    for y in ys:
        b = int((y - lo) / span * (bins - 1))
        if 0 <= b < bins:
            hist[b] += 1
    return max(hist) / float(len(ys))


def percentile(values, q):
    s = sorted(values)
    return s[max(0, min(len(s) - 1, int(q * (len(s) - 1))))]


def pick_axis(points, candidates, label, expect):
    """Level with whichever candidate axis measurably flattens the floor best.

    `candidates` is (name, up) pairs and `expect` is the name this file's
    docstring predicts. The prediction is reported against the measurement and
    never overrides it: the winner is the one the points vote for.
    """
    scored = []
    for name, up in candidates:
        R = rotation_to_down(up)
        ys = [apply(R, p[0], p[1], p[2])[1] for p in points]
        scored.append((floor_sharpness(ys), name, R))
    scored.sort(reverse=True)
    print("  %s floor sharpness: %s" % (label, " · ".join(
        "%s %.4f" % (n, sc) for sc, n, _ in
        sorted(scored, key=lambda t: t[1]))))
    best, win, R = scored[0]
    runner = scored[1][0] if len(scored) > 1 else 0.0
    if win != expect:
        print("  !! %s: expected %r to win, %r did (%.4f against %.4f).\n"
              "     Using the measured winner. Read this file's docstring — the\n"
              "     frame assumption recorded there no longer holds."
              % (label, expect, win, best, runner))
    elif best < runner * 1.15:
        print("  !! %s: %r wins by less than 15%%. The floor test cannot tell\n"
              "     these apart, so the levelling is not trustworthy here."
              % (label, win))
    else:
        print("  %s levelled with %r, %.1fx sharper than the alternative"
              % (label, win, best / runner if runner else float("inf")))
    return R


# ── normalising ────────────────────────────────────────────────────────────

def normalise(rot, clip=CLIP):
    """Centre on the median, scale off the 2nd/98th percentile span.

    Not the extremes: a handful of stray splats sit metres outside the room and
    would shrink everything else to a dot in the middle of an empty canvas.
    """
    centre = [percentile([p[i] for p in rot], 0.5) for i in range(3)]
    span = max(percentile([p[i] for p in rot], 0.98)
               - percentile([p[i] for p in rot], 0.02) for i in range(3))
    scale = 2.0 / span
    keep = []
    for p in rot:
        v = [(p[i] - centre[i]) * scale for i in range(3)]
        if max(abs(c) for c in v) > clip:
            continue
        keep.append([round(v[0], 3), round(v[1], 3), round(v[2], 3),
                     p[3], p[4], p[5]])
    return keep


def thin(rows, want):
    """Keep `want` rows, evenly spaced through the list.

    A fixed stride rather than random sampling: the result is reproducible
    without a seed, and for a cloud in no meaningful order it thins just as
    evenly. What matters is that it is not the *first* n, which in a ply is a
    spatially clustered prefix.
    """
    if len(rows) <= want:
        return rows
    step = len(rows) / float(want)
    return [rows[int(i * step)] for i in range(want)]


def write(name, rows, note):
    path = os.path.join(ASSETS, name)
    with open(path, "w") as f:
        json.dump(rows, f, separators=(",", ":"))
    print("  wrote %s · %d points · %.0f KB   (%s)"
          % (name, len(rows), os.path.getsize(path) / 1024.0, note))


def write_packed(name, rows, note, clip=CLIP):
    """Write the dense cloud as two base64 blocks instead of JSON numbers.

    A splat as `[-0.123,-0.456,0.789,123,45,67]` costs about 30 bytes of text.
    The same splat as three int16 and three uint8 costs 9 bytes, 12 once base64
    has padded it out — so the page can carry half again as many points in two
    thirds of the space. That is the whole reason the opening cloud could go
    from 120 000 points to every one that survives filtering.

    Quantisation is not a loss here: `normalise` clips to +/-CLIP, so an int16
    step is CLIP/32767, about 4e-5 of the room. The JSON it replaces rounded to
    three decimals, 1e-3. This is the *more* precise of the two.

    Endianness is the platform's, on both ends: struct writes little-endian and
    `Int16Array` reads whatever the CPU is. Every browser this will ever open in
    runs on x86 or ARM, both little-endian. Written down because the failure
    mode on a big-endian machine would be a room turned to confetti with
    nothing in the console.
    """
    q = 32767.0 / clip
    pos = bytearray()
    col = bytearray()
    for r in rows:
        pos += struct.pack("<3h",
                           int(round(max(-clip, min(clip, r[0])) * q)),
                           int(round(max(-clip, min(clip, r[1])) * q)),
                           int(round(max(-clip, min(clip, r[2])) * q)))
        col += bytes(bytearray((r[3], r[4], r[5])))
    blob = {"n": len(rows), "clip": clip,
            "pos": base64.b64encode(bytes(pos)).decode("ascii"),
            "col": base64.b64encode(bytes(col)).decode("ascii")}
    path = os.path.join(ASSETS, name)
    with open(path, "w") as f:
        json.dump(blob, f, separators=(",", ":"))
    print("  wrote %s · %d points · %.0f KB   (%s)"
          % (name, len(rows), os.path.getsize(path) / 1024.0, note))


# ── main ───────────────────────────────────────────────────────────────────

def main():
    run = sys.argv[1] if len(sys.argv) > 1 else "drjohnson"
    base = os.path.join(ROOT, "repos/pipeline-3d/runs", run)
    sparse_dir = os.path.join(base, "undistorted/sparse")

    out = subprocess.run(
        ["node", os.path.join(ROOT, "repos/pipeline-3d/gravity.mjs"),
         os.path.join(sparse_dir, "images.bin")],
        capture_output=True, text=True, check=True)
    sys.stderr.write(out.stderr)
    up_colmap = None
    for line in out.stderr.splitlines():
        if " up " in line:
            up_colmap = tuple(float(v) for v in
                              line.split(" up ")[1].split(" ")[0].split(","))
    if up_colmap is None:
        raise SystemExit("pointcloud: gravity.mjs printed no up vector")
    print("run %s · colmap up %s" % (run, ",".join("%.3f" % c for c in up_colmap)))

    # ── the sparse cloud, in COLMAP's frame ───────────────────────────────
    sparse = read_sparse(os.path.join(sparse_dir, "points3D.bin"))
    print("sparse: %d points" % len(sparse))
    R = pick_axis(sparse, (("poses", up_colmap),
                           ("poses-zflip", (up_colmap[0], up_colmap[1],
                                            -up_colmap[2]))),
                  "sparse", "poses")
    rot = [apply(R, p[0], p[1], p[2]) + (p[3], p[4], p[5]) for p in sparse]
    write("pointcloud.json", thin(normalise(rot), KEEP_SPARSE),
          "COLMAP's own output, for the open-source slide")

    # ── the trained model, in Brush's frame ───────────────────────────────
    raw, up_ply, total = read_ply(os.path.join(base, "model.ply"))
    if up_ply is None:
        raise SystemExit("pointcloud: model.ply carries no 'Vertical axis' "
                         "comment — see this file's docstring, the rotation "
                         "cannot be taken from gravity.mjs instead")
    print("dense: %d gaussians · ply up %s"
          % (total, ",".join("%.3f" % c for c in up_ply)))

    solid = [p for p in raw if p[6] >= MIN_OPACITY]
    cut = percentile([p[7] for p in solid], SCALE_PERCENTILE) if solid else 0.0
    solid = [p for p in solid if p[7] <= cut]
    print("  %d of %d survive opacity >= %.2f and size <= %.4f (%.0f%%)"
          % (len(solid), total, MIN_OPACITY, cut, 100.0 * len(solid) / total))
    if len(solid) > KEEP_DENSE:
        print("  !! %d survivors, more than the %d cap — the opening cloud is "
              "being thinned. Raise KEEP_DENSE only after checking what it does "
              "to the page size that build.py prints." % (len(solid), KEEP_DENSE))

    R = pick_axis(solid, (("header-zflip", (up_ply[0], up_ply[1], -up_ply[2])),
                          ("header", up_ply)),
                  "dense ", "header-zflip")
    rot = []
    for p in solid:
        x, y, z = apply(R, p[0], p[1], p[2])
        rgb = []
        for dc in (p[3], p[4], p[5]):
            v = 0.5 + SH_C0 * dc
            rgb.append(int(max(0.0, min(1.0, v)) * 255 + 0.5))
        rot.append((x, y, z, rgb[0], rgb[1], rgb[2]))
    write_packed("splats.json", thin(normalise(rot), KEEP_DENSE),
                 "the trained model, for the opening slide")


if __name__ == "__main__":
    main()

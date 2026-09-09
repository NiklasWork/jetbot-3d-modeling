#!/usr/bin/env python3
"""Assemble presentation/deck.html from the template and the assets beside it.

The deck is one self-contained file: the SuperSplat viewer, the sparse point
cloud and the photographs all travel inside it, because the Artifact CSP
blocks every external image and media host.

    python3 presentation/build.py

Regenerating the two generated assets after a new pipeline run:

    python3 presentation/pointcloud.py <run>          # writes assets/pointcloud.json

    splat-transform <run>/filtered.sog \
      -r $(node repos/pipeline-3d/gravity.mjs <run>/undistorted/sparse/images.bin) \
      -H 0 -F -d 40% /tmp/x.ply
    splat-transform /tmp/x.ply presentation/assets/room.html

**The `-r` is not optional.** COLMAP anchors its world frame to the first
registered camera, so a reconstruction lands at an arbitrary attitude and
drjohnson lands 14.3 degrees off level. The SuperSplat viewer assumes +Y is up
and cannot be steered out of a lean. `pointcloud.py` applies the same rotation
to the sparse cloud itself, for the same reason.
"""

import base64
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
TEMPLATE = os.path.join(HERE, "deck.template.html")
OUT = os.path.join(HERE, "deck.html")

# The viewer is injected into a <script type="text/plain"> block, so the only
# byte sequence that can break out of it is a closing script tag. Swap it for a
# sentinel the page restores at runtime; unlike base64 this costs no size.
SENTINEL = "__ENDSCRIPT__"


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def data_uri(name, mime):
    path = os.path.join(ASSETS, name)
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def main():
    html = read(TEMPLATE)

    room = read(os.path.join(ASSETS, "room.html"))
    if SENTINEL in room:
        sys.exit("error: the viewer already contains %s — pick another sentinel" % SENTINEL)
    room = room.replace("</script", SENTINEL)

    subs = {
        "__ROOM_HTML__": room,
        "__POINTCLOUD__": read(os.path.join(ASSETS, "pointcloud.json")),
        "__IMG_F6320__": data_uri("f6320.jpg", "image/jpeg"),
        "__IMG_DETECTNET__": data_uri("detectnet.jpg", "image/jpeg"),
    }
    # Scan the template, never the result: the viewer bundle carries its own
    # __PURE__ annotations and would trip a scan of the finished page.
    known = set(subs) | {SENTINEL}
    unknown = sorted(set(re.findall(r"__[A-Z0-9_]+__", html)) - known)
    if unknown:
        sys.exit("error: unknown placeholders in the template: %s" % ", ".join(unknown))

    for key, value in subs.items():
        if key not in html:
            sys.exit("error: placeholder %s is not in the template" % key)
        html = html.replace(key, value)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(OUT)
    print("wrote %s" % os.path.relpath(OUT, os.getcwd()))
    print("  %.2f MB of a 16 MB budget" % (size / 1048576.0))
    for name, value in sorted(subs.items()):
        print("  %-18s %7.2f MB" % (name.strip("_").lower(), len(value) / 1048576.0))
    if size > 16 * 1048576:
        sys.exit("error: over the 16 MB artifact limit")


if __name__ == "__main__":
    main()

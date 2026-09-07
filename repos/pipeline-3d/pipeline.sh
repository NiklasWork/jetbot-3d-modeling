#!/usr/bin/env bash
# pipeline.sh — a folder of overlapping photos becomes a navigable 3D model.
#
#   ./pipeline.sh <image-dir> [options]
#
# Three stages, each resumable: sfm (COLMAP) → train (Brush) → compress
# (splat-transform). Runtimes and the reasoning behind the presets are in the
# Truss workspace, context/measurements.md.

set -euo pipefail

# ── defaults ────────────────────────────────────────────────────────────────
BRUSH="${BRUSH:-$HOME/tools/brush/target/release/brush}"
SPLAT_TRANSFORM_VERSION="3.3.3"   # pinned — D-004
PRESET="fast"
CAMERA="OPENCV"                   # OPENCV_FISHEYE for the JetBot's 160° lens (D-010)
MATCHER="sequential"   # correct for a stop-and-go drive; exhaustive for handheld stills
MAPPER="incremental"
STOP_AFTER="compress"
VIEWER=0
FORCE=0
PROBE=0
OUT=""

die(){ echo "pipeline: $*" >&2; exit 1; }
say(){ printf '\n\033[1m▸ %-9s\033[0m %s   %s\n' "$1" "$2" "$(date +%H:%M:%S)"; }

usage(){ sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

Options
  --out DIR           where to write (default: runs/<image-dir-name>)
  --preset fast|full  Brush settings; fast is the measured default
  --camera MODEL      COLMAP camera model (OPENCV, OPENCV_FISHEYE, ...)
  --matcher sequential|exhaustive
                      sequential assumes consecutive filenames are consecutive
                      viewpoints — right for a drive, wrong for handheld stills
  --mapper incremental|global   COLMAP reconstruction (default: incremental)
  --stop-after sfm|train|compress
  --viewer            open Brush's live viewer during training
  --force             recompute stages whose output already exists
  --probe             verdict only, into runs/<name>-probe: the same images at
                      1000 px, poses only, no undistortion, no training. Answers
                      "will this dataset reconstruct?" for a fraction of the
                      cost. A probe that passes means the real run passes; a
                      probe that fails means look closer, not start over
EOF
exit 0; }

# ── arguments ───────────────────────────────────────────────────────────────
[ $# -ge 1 ] || usage
case "$1" in -h|--help) usage;; -*) die "first argument must be the image directory";; esac
IMAGES="${1%/}"; shift

while [ $# -gt 0 ]; do
  case "$1" in
    --out)        OUT="$2"; shift 2;;
    --preset)     PRESET="$2"; shift 2;;
    --camera)     CAMERA="$2"; shift 2;;
    --matcher)    MATCHER="$2"; shift 2;;
    --mapper)     MAPPER="$2"; shift 2;;
    --stop-after) STOP_AFTER="$2"; shift 2;;
    --viewer)     VIEWER=1; shift;;
    --force)      FORCE=1; shift;;
    --probe)      PROBE=1; shift;;
    -h|--help)    usage;;
    *)            die "unknown option: $1";;
  esac
done

[ -d "$IMAGES" ] || die "not a directory: $IMAGES"
IMAGES="$(cd "$IMAGES" && pwd)"
NIMG=$(find "$IMAGES" -type f \
       \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | wc -l | tr -d ' ')
[ "$NIMG" -ge 20 ] || die "found $NIMG images in $IMAGES — reconstruction needs at least ~20"

case "$PRESET" in
  fast) ITERS=5000; BRUSH_ARGS=(--max-resolution 800 --max-splats 400000 --sh-degree 2);;
  full) ITERS=8000; BRUSH_ARGS=(--max-resolution 1920 --max-splats 1000000 --sh-degree 3);;
  *)    die "unknown preset: $PRESET (fast|full)";;
esac
case "$MATCHER" in
  sequential) MATCHER_CMD=sequential_matcher;;
  exhaustive) MATCHER_CMD=exhaustive_matcher;;
  *)          die "unknown matcher: $MATCHER (sequential|exhaustive)";;
esac
case "$MAPPER" in
  global)      MAPPER_CMD=global_mapper;;
  incremental) MAPPER_CMD=mapper;;
  *)           die "unknown mapper: $MAPPER (global|incremental)";;
esac
case "$STOP_AFTER" in sfm|train|compress) ;; *) die "unknown stage: $STOP_AFTER";; esac

for t in colmap npx "$BRUSH"; do
  command -v "$t" >/dev/null 2>&1 || [ -x "$t" ] || die "not executable: $t"
done

NAME="$(basename "$IMAGES")"
case "$NAME" in
  images|imgs|input|photos) NAME="$(basename "$(dirname "$IMAGES")")";;
esac
if [ "$PROBE" -eq 1 ]; then NAME="$NAME-probe"; fi
OUT="${OUT:-runs/$NAME}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
if [ "$FORCE" -eq 1 ]; then rm -rf "$OUT/colmap" "$OUT/undistorted" "$OUT/model.ply" \
                                "$OUT/model.sog" "$OUT/model.html"; fi

LOG="$OUT/pipeline.log"
exec > >(tee -a "$LOG") 2>&1
echo "════ $(date '+%F %T')  $NIMG images  preset=$PRESET  matcher=$MATCHER  mapper=$MAPPER  camera=$CAMERA"
echo "     in:  $IMAGES"
echo "     out: $OUT"
START=$(date +%s)

# ── stage 1: structure from motion ──────────────────────────────────────────
if [ ! -d "$OUT/undistorted/sparse" ]; then
  say "sfm" "COLMAP: features → $MATCHER_CMD → $MAPPER_CMD → undistort"
  mkdir -p "$OUT/colmap"

  # Features depend only on the images, so they survive a retry.
  # A probe trades feature count for time. Resolution is the only honest lever
  # here: dropping images would destroy the very overlap the probe measures.
  SIFT_ARGS=()
  if [ "$PROBE" -eq 1 ]; then
    SIFT_ARGS=(--SiftExtraction.max_image_size 1000 --SiftExtraction.max_num_features 4096)
  fi
  if [ ! -f "$OUT/colmap/db.db" ]; then
    colmap feature_extractor \
      --database_path "$OUT/colmap/db.db" --image_path "$IMAGES" \
      --ImageReader.single_camera 1 --ImageReader.camera_model "$CAMERA" \
      "${SIFT_ARGS[@]}"
  fi

  # Matching always runs: retrying a thin graph with --matcher exhaustive is the
  # documented recovery, and skipping it here would silently reuse the matches
  # that just failed. COLMAP skips pairs it already holds, so this only adds.
  colmap "$MATCHER_CMD" --database_path "$OUT/colmap/db.db"

  # Start the reconstruction from an empty directory — otherwise a retry reads
  # the fragments of the attempt before it and reports them as its own.
  rm -rf "$OUT/colmap/sparse"; mkdir -p "$OUT/colmap/sparse"
  colmap "$MAPPER_CMD" \
    --database_path "$OUT/colmap/db.db" --image_path "$IMAGES" \
    --output_path "$OUT/colmap/sparse"

  # A thin match graph makes COLMAP emit several disconnected models
  # (sparse/0, sparse/1, ...) that share no coordinate frame. Take the largest.
  registered(){ colmap model_analyzer --path "$1" 2>&1 \
                | grep -oE 'Registered images: [0-9]+' | grep -oE '[0-9]+' | head -1; }
  MODEL=""; REG=0; NSUB=0
  for m in "$OUT"/colmap/sparse/*/; do
    [ -f "$m/cameras.bin" ] || continue
    NSUB=$(( NSUB + 1 )); r=$(registered "$m"); r="${r:-0}"
    [ "$r" -gt "$REG" ] && { REG="$r"; MODEL="${m%/}"; }
  done
  [ -n "$MODEL" ] || die "$MAPPER_CMD produced no reconstruction — see $LOG"
  echo "     registered $REG of $NIMG images ($(( REG * 100 / NIMG ))%) in the largest of $NSUB model(s)"
  if [ "$NSUB" -gt 1 ]; then echo "     warning: the scene broke into $NSUB fragments; only the largest is used"; fi
  if [ "$REG" -lt $(( NIMG * 70 / 100 )) ] || [ "$NSUB" -gt 3 ]; then
    PROBE_NOTE=""
    if [ "$PROBE" -eq 1 ]; then
      PROBE_NOTE="
     This was a probe at 1000 px, which has fewer features to match than the
     real thing — a probe can fail on a dataset that reconstructs fine. Rerun
     without --probe before concluding the images are bad."
    fi
    die "$REG of $NIMG images registered across $NSUB model(s) — the match graph is too thin.$PROBE_NOTE
     A thin graph is a matching problem, not a mapper problem: retry with
     --matcher exhaustive (slow: ~14 min for 263 images, but it is what
     reproduces the published reconstructions), and only then --mapper global,
     which registers more images off a thin graph but constrains them badly."
  fi

  if [ "$PROBE" -eq 1 ]; then
    cat <<EOF

════ probe passed in $(( ($(date +%s) - START) / 60 )) min $(( ($(date +%s) - START) % 60 )) s
     $REG of $NIMG images registered at 1000 px, in $NSUB model(s).
     Full resolution has more features to work with, so the real run will do at
     least this well. Nothing here is reused — run it for real:
       ./pipeline.sh $IMAGES --viewer
EOF
    exit 0
  fi

  colmap image_undistorter \
    --image_path "$IMAGES" --input_path "$MODEL" \
    --output_path "$OUT/undistorted" --output_type COLMAP
else
  echo "▸ sfm      skipped, $OUT/undistorted exists (--force to redo)"
fi
if [ "$STOP_AFTER" = sfm ]; then echo "stopped after sfm"; exit 0; fi

# ── stage 2: training ───────────────────────────────────────────────────────
if [ ! -f "$OUT/model.ply" ]; then
  say "train" "Brush, preset $PRESET"
  VIEW=(); if [ "$VIEWER" -eq 1 ]; then VIEW=(--with-viewer); fi
  RUST_LOG=info "$BRUSH" "$OUT/undistorted" --total-train-iters "$ITERS" "${BRUSH_ARGS[@]}" "${VIEW[@]}" \
    --export-every "$ITERS" --export-path "$OUT/" --export-name "model.ply" \
    2>&1 | grep -Ev 'autotune|screen_size iter|splat_dist iter'
  [ -f "$OUT/model.ply" ] || die "Brush wrote no model.ply — see $LOG"
else
  echo "▸ train    skipped, model.ply exists (--force to redo)"
fi
if [ "$STOP_AFTER" = train ]; then echo "stopped after train"; exit 0; fi

# ── stage 3: compress and package a viewer ──────────────────────────────────
say "compress" "splat-transform: .sog, then a self-contained .html"
npx -y "@playcanvas/splat-transform@$SPLAT_TRANSFORM_VERSION" \
    "$OUT/model.ply" --morton-order "$OUT/model.sog" --overwrite
npx -y "@playcanvas/splat-transform@$SPLAT_TRANSFORM_VERSION" \
    "$OUT/model.sog" "$OUT/model.html" --overwrite

# ── report ──────────────────────────────────────────────────────────────────
h(){ [ -f "$1" ] && du -h "$1" | cut -f1 || echo "—"; }
cat <<EOF

════ done in $(( ($(date +%s) - START) / 60 )) min $(( ($(date +%s) - START) % 60 )) s
     model.ply   $(h "$OUT/model.ply")
     model.sog   $(h "$OUT/model.sog")   → for hosting next to a viewer later
     model.html  $(h "$OUT/model.html")  → open it, that is the whole viewer
EOF

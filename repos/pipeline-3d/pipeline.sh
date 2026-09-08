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
VERBOSE=0
OUT=""

die(){ echo "pipeline: $*" >&2; exit 1; }
say(){ printf '\n\033[1m▸ %-9s\033[0m %s   %s\n' "$1" "$2" "$(date +%H:%M:%S)"; }

# ── progress ────────────────────────────────────────────────────────────────
# Every tool in this pipeline already counts out loud, so a progress bar needs
# a parser, not a model. These counters were read off real runs in
# runs/*/pipeline.log, not guessed:
#
#   features    Processed file [7/372]
#   match       Processing image [11/372]                   sequential
#               Matching block [1/3, 2/3]                   exhaustive
#   mapper      Registering image #226 (num_reg_frames=23)
#   undistort   Undistorting image [3/330]
#   train       Refine iter 3801, 400000 splats.
#   compress    splat-transform stays silent until it is done — elapsed only,
#               which is the point: one measured run spent 15 min 21 s here
#
# The log keeps every line either way; only the terminal goes quiet, and
# --verbose brings the flood back. ETA is measured inside the run
# (elapsed / done × remaining) and never modelled — that holds for 4032 px
# phone stills and 1280×960 robot frames alike, which no table of constants
# would.
#
# A run-wide estimate starts at the training stage and not before, because
# context/measurements.md refutes the stage weights an earlier one would need:
# SfM was 26 % of one measured run and 50 % of another.

PROGRESS=0        # 1 once stdout is a terminal and --verbose is off
STAGE_NO=0
NSTAGES=3
RUN_TAIL=0        # seconds still to come after this stage; 0 = do not guess
COLS=100

hms(){ if [ "$1" -ge 3600 ]; then printf '%dh%02dm' $(( $1 / 3600 )) $(( $1 % 3600 / 60 ))
       else                       printf '%dm%02ds' $(( $1 / 60 ))   $(( $1 % 60 )); fi; }

bar(){ local i s='' n=$(( $1 * 18 / 100 ))
       for (( i = 0; i < 18; i++ )); do
         if [ "$i" -lt "$n" ]; then s="${s}█"; else s="${s}░"; fi
       done
       printf '%s' "$s"; }

# One line, repainted in place on the real terminal (fd 3) — never into the log.
paint(){ # label done total elapsed terminator
  local label="$1" d="$2" t="$3" e="$4" end="$5" pct=0 left=0 msg
  if [ "$t" -gt 0 ] && [ "$d" -gt 0 ]; then
    pct=$(( d * 100 / t ))
    if [ "$pct" -gt 100 ]; then pct=100; fi
    msg=$(printf '  [%d/%d] %-9s %s %3d%%  %s/%s  %s' \
                 "$STAGE_NO" "$NSTAGES" "$label" "$(bar "$pct")" "$pct" "$d" "$t" "$(hms "$e")")
    if [ "$d" -lt "$t" ] && [ "$e" -ge 3 ]; then
      left=$(( e * (t - d) / d ))
      msg="$msg  ~$(hms "$left")"
      if [ "$RUN_TAIL" -gt 0 ]; then msg="$msg  · model ~$(hms $(( left + RUN_TAIL )))"; fi
    fi
  else
    msg=$(printf '  [%d/%d] %-9s running, %s' "$STAGE_NO" "$NSTAGES" "$label" "$(hms "$e")")
  fi
  printf '\r\033[K%s%s' "${msg:0:$(( COLS - 1 ))}" "$end" >&3
}

# Read a tool's output: every line verbatim into the log, one status line onto
# the terminal. Without a terminal, or with --verbose, this is a plain cat —
# exactly what the script did before.
track(){
  local label="$1" total="${2:-0}"
  if [ "$PROGRESS" -eq 0 ]; then cat; return; fi
  local line n done_=0 total_="$total" painted=-1
  SECONDS=0
  while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in
      *"Processed file ["*|*"Processing image ["*|*"Undistorting image ["*)
        if [[ $line =~ \[([0-9]+)/([0-9]+)\] ]]; then
          done_=${BASH_REMATCH[1]}; total_=${BASH_REMATCH[2]}
        fi;;
      *"Matching block ["*)
        # exhaustive matching walks an n × n grid of blocks
        if [[ $line =~ \[([0-9]+)/([0-9]+),\ ([0-9]+)/([0-9]+)\] ]]; then
          done_=$(( (BASH_REMATCH[1] - 1) * BASH_REMATCH[4] + BASH_REMATCH[3] ))
          total_=$(( BASH_REMATCH[2] * BASH_REMATCH[4] ))
        fi;;
      *"num_reg_frames="*)
        # Highest, not latest: off a thin graph the mapper starts a second
        # sub-model back at 1, and a bar that jumps backwards reads as a fault.
        if [[ $line =~ num_reg_frames=([0-9]+) ]]; then
          n=${BASH_REMATCH[1]}
          if [ "$n" -gt "$done_" ]; then done_=$n; fi
        fi;;
      *"Refine iter "*)
        if [[ $line =~ Refine\ iter\ ([0-9]+) ]]; then done_=${BASH_REMATCH[1]}; fi;;
    esac
    if [ "$SECONDS" -ne "$painted" ]; then
      painted=$SECONDS
      paint "$label" "$done_" "$total_" "$SECONDS" ''
    fi
  done >> "$LOG"
  printf '\r\033[K  [%d/%d] %-9s ended after %s\n' \
         "$STAGE_NO" "$NSTAGES" "$label" "$(hms "$SECONDS")" >&3
}

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
  --verbose           print every tool's line to the terminal instead of one
                      progress line; the log holds them either way
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
    --verbose)    VERBOSE=1; shift;;
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
case "$STOP_AFTER" in
  sfm)      NSTAGES=1;;
  train)    NSTAGES=2;;
  compress) NSTAGES=3;;
  *)        die "unknown stage: $STOP_AFTER";;
esac
if [ "$PROBE" -eq 1 ]; then NSTAGES=1; fi   # a probe stops at the verdict

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
# fd 3 is the terminal itself. It has to be claimed before the line below hands
# stdout to tee, because from there on "the terminal" and "the log" are one
# stream, and the status line must reach only the first of them.
if [ "$VERBOSE" -eq 0 ] && [ -t 1 ]; then
  PROGRESS=1
  exec 3>&1
  COLS=$(tput cols 2>/dev/null || echo 100)
  [ "$COLS" -ge 40 ] 2>/dev/null || COLS=100
fi
exec > >(tee -a "$LOG") 2>&1
echo "════ $(date '+%F %T')  $NIMG images  preset=$PRESET  matcher=$MATCHER  mapper=$MAPPER  camera=$CAMERA"
echo "     in:  $IMAGES"
echo "     out: $OUT"
START=$(date +%s)

# ── stage 1: structure from motion ──────────────────────────────────────────
# The completion marker is the model file, not the directory: COLMAP creates
# undistorted/sparse/ when it starts and writes the model into it when it
# finishes. Testing the directory made an interrupted undistortion look like a
# finished one, and the next run handed Brush a dataset with no poses in it.
if [ ! -f "$OUT/undistorted/sparse/cameras.bin" ]; then
  STAGE_NO=1
  say "sfm" "COLMAP: features → $MATCHER_CMD → $MAPPER_CMD → undistort"
  mkdir -p "$OUT/colmap"

  # Features depend only on the images, so they survive a retry.
  # A probe trades feature count for time. Resolution is the only honest lever
  # here: dropping images would destroy the very overlap the probe measures.
  SIFT_ARGS=()
  if [ "$PROBE" -eq 1 ]; then
    SIFT_ARGS=(--FeatureExtraction.max_image_size 1000 --SiftExtraction.max_num_features 4096)
  fi
  if [ ! -f "$OUT/colmap/db.db" ]; then
    colmap feature_extractor \
      --database_path "$OUT/colmap/db.db" --image_path "$IMAGES" \
      --ImageReader.single_camera 1 --ImageReader.camera_model "$CAMERA" \
      "${SIFT_ARGS[@]}" 2>&1 | track features "$NIMG"
  fi

  # Matching always runs: retrying a thin graph with --matcher exhaustive is the
  # documented recovery, and skipping it here would silently reuse the matches
  # that just failed. COLMAP skips pairs it already holds, so this only adds.
  colmap "$MATCHER_CMD" --database_path "$OUT/colmap/db.db" 2>&1 | track match "$NIMG"

  # Start the reconstruction from an empty directory — otherwise a retry reads
  # the fragments of the attempt before it and reports them as its own.
  rm -rf "$OUT/colmap/sparse"; mkdir -p "$OUT/colmap/sparse"
  colmap "$MAPPER_CMD" \
    --database_path "$OUT/colmap/db.db" --image_path "$IMAGES" \
    --output_path "$OUT/colmap/sparse" 2>&1 | track mapper "$NIMG"

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

  rm -rf "$OUT/undistorted"
  colmap image_undistorter \
    --image_path "$IMAGES" --input_path "$MODEL" \
    --output_path "$OUT/undistorted" --output_type COLMAP 2>&1 | track undistort "$REG"
  [ -f "$OUT/undistorted/sparse/cameras.bin" ] || die "image_undistorter wrote no model — see $LOG"
else
  echo "▸ sfm      skipped, $OUT/undistorted/sparse holds a model (--force to redo)"
fi
if [ "$STOP_AFTER" = sfm ]; then echo "stopped after sfm"; exit 0; fi

# ── stage 2: training ───────────────────────────────────────────────────────
if [ ! -f "$OUT/model.ply" ]; then
  STAGE_NO=2
  # From here the remaining stage is measurable, so the status line can name a
  # time for the whole run. 60 s is the compress stage's measured cost twice
  # over (27 s on truck, 31 s on drjohnson) — it is a round-up, not a model,
  # and the run that spent 15 min 21 s there is why compress shows its own
  # elapsed time rather than trusting this number.
  if [ "$STOP_AFTER" = compress ]; then RUN_TAIL=60; fi
  say "train" "Brush, preset $PRESET"
  VIEW=(); if [ "$VIEWER" -eq 1 ]; then VIEW=(--with-viewer); fi
  # --line-buffered, or grep hands the tracker 4 KB at a time and the bar jumps.
  RUST_LOG=info "$BRUSH" "$OUT/undistorted" --total-train-iters "$ITERS" "${BRUSH_ARGS[@]}" "${VIEW[@]}" \
    --export-every "$ITERS" --export-path "$OUT/" --export-name "model.ply" \
    2>&1 | grep --line-buffered -Ev 'autotune|screen_size iter|splat_dist iter' \
         | track train "$ITERS"
  [ -f "$OUT/model.ply" ] || die "Brush wrote no model.ply — see $LOG"
else
  echo "▸ train    skipped, model.ply exists (--force to redo)"
fi
if [ "$STOP_AFTER" = train ]; then echo "stopped after train"; exit 0; fi

# ── stage 3: compress and package a viewer ──────────────────────────────────
STAGE_NO=3; RUN_TAIL=0
say "compress" "splat-transform: .sog, then a self-contained .html"
# No counter to read: splat-transform's own bar only reaches the log once it
# has finished. Elapsed time is all there is — and it is what matters here,
# because this stage is the one that has run away (15 min 21 s once).
npx -y "@playcanvas/splat-transform@$SPLAT_TRANSFORM_VERSION" \
    "$OUT/model.ply" --morton-order "$OUT/model.sog" --overwrite 2>&1 | track ".sog"
npx -y "@playcanvas/splat-transform@$SPLAT_TRANSFORM_VERSION" \
    "$OUT/model.sog" "$OUT/model.html" --overwrite 2>&1 | track ".html"

# ── report ──────────────────────────────────────────────────────────────────
h(){ [ -f "$1" ] && du -h "$1" | cut -f1 || echo "—"; }
cat <<EOF

════ done in $(( ($(date +%s) - START) / 60 )) min $(( ($(date +%s) - START) % 60 )) s
     model.ply   $(h "$OUT/model.ply")
     model.sog   $(h "$OUT/model.sog")   → for hosting next to a viewer later
     model.html  $(h "$OUT/model.html")  → open it, that is the whole viewer
EOF

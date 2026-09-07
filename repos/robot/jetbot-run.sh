#!/usr/bin/env bash
# jetbot-run.sh — one command: fetch a capture off the robot and reconstruct it.
#
#   ./jetbot-run.sh                          # newest capture on the robot
#   ./jetbot-run.sh wohnzimmer               # that one
#   ./jetbot-run.sh wohnzimmer --preset full --matcher exhaustive
#
# Runs on the Mac, not on the JetBot. Copies jetbot:~/captures/<name>/ over
# with rsync and hands the folder to pipeline-3d's pipeline.sh with the two
# presets this hardware needs — OPENCV_FISHEYE for the 160° lens (D-010) and
# the live viewer, which is the point of the presentation — then opens the
# finished model.html.

set -euo pipefail

# ── defaults, all overridable from the environment ──────────────────────────
JETBOT_HOST="${JETBOT_HOST:-jetbot}"          # a ~/.ssh/config entry, not an IP
JETBOT_REMOTE_DIR="${JETBOT_REMOTE_DIR:-captures}"   # relative to the robot's home
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JETBOT_CAPTURES="${JETBOT_CAPTURES:-$REPO_ROOT/captures}"  # in the repo, git-ignored
JETBOT_CAMERA="${JETBOT_CAMERA:-OPENCV_FISHEYE}"     # D-010
RSYNC="${RSYNC:-rsync}"
SSH_OPTS="${SSH_OPTS:--o BatchMode=yes -o ConnectTimeout=8}"

NAME=""; DEST=""; VIEWER=1; PASS=()

die(){ echo "jetbot-run: $*" >&2; exit 1; }
say(){ printf '\n\033[1m▸ %-9s\033[0m %s   %s\n' "$1" "$2" "$(date +%H:%M:%S)"; }

usage(){ sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

Options handled here
  --dest DIR          where to put the fetched images
                      (default: $JETBOT_CAPTURES/<name>)
  --no-viewer         do not pass --viewer to pipeline.sh
  -h, --help          this text

Everything else is passed straight through to pipeline.sh — --preset,
--matcher, --mapper, --stop-after, --out, --force, and an explicit --camera
overrides the OPENCV_FISHEYE default.

Environment
  JETBOT_HOST         ssh target             (default: jetbot)
  JETBOT_PIPELINE     path to pipeline.sh    (default: pipeline.sh on $PATH)
  JETBOT_CAPTURES     local capture root     (default: <repo>/captures)
  JETBOT_CAMERA       COLMAP camera model    (default: OPENCV_FISHEYE)
  JETBOT_REMOTE_DIR   capture dir on the robot, relative to its home
  RSYNC               rsync binary to use    (default: rsync)
EOF
exit 0; }

# ── arguments ───────────────────────────────────────────────────────────────
# The capture name, if given at all, is the first argument. Everything after it
# belongs to pipeline.sh — which is why we do not try to be clever about
# option values: "--preset full" must arrive there intact.
if [ $# -gt 0 ]; then
  case "$1" in
    -h|--help) usage;;
    -*)        ;;                       # no name — the rest is options
    *)         NAME="$1"; shift;;
  esac
fi
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)   usage;;
    --no-viewer) VIEWER=0; shift;;
    --dest)      [ $# -ge 2 ] || die "--dest needs a directory"; DEST="$2"; shift 2;;
    *)           PASS+=("$1"); shift;;
  esac
done

# What did the caller already decide for pipeline.sh? We need to know so we do
# not add a second --camera, and so we can find model.html afterwards.
HAVE_CAMERA=0; OUT_ARG=""; STOP_AFTER="compress"; PROBE=0
i=0; n=${#PASS[@]}
while [ "$i" -lt "$n" ]; do
  case "${PASS[$i]}" in
    --camera)     HAVE_CAMERA=1;;
    --out)        OUT_ARG="${PASS[$((i+1))]:-}";;
    --stop-after) STOP_AFTER="${PASS[$((i+1))]:-compress}";;
    --probe)      PROBE=1;;
  esac
  i=$((i+1))
done

# ── locate pipeline.sh ──────────────────────────────────────────────────────
# Not hard-wired to ../pipeline-3d/: D-011 keeps both repos runnable on their
# own, and a relative path baked in here would quietly make this one depend on
# a sibling checkout it is not allowed to require.
PIPE="${JETBOT_PIPELINE:-}"
if [ -n "$PIPE" ]; then
  [ -x "$PIPE" ] || die "JETBOT_PIPELINE is set but not executable: $PIPE"
else
  PIPE="$(command -v pipeline.sh 2>/dev/null || true)"
  [ -n "$PIPE" ] || die "cannot find pipeline.sh.
     This repo does not know where pipeline-3d lives (D-011: both repos stay
     independent). Point at it once, e.g. in ~/.zshrc:
       export JETBOT_PIPELINE=\"\$HOME/path/to/repos/pipeline-3d/pipeline.sh\"
     or put pipeline.sh on your PATH."
fi
PIPE_DIR="$(cd "$(dirname "$PIPE")" && pwd)"
PIPE="$PIPE_DIR/$(basename "$PIPE")"

command -v "$RSYNC" >/dev/null 2>&1 || die "not found: $RSYNC"

# ── reach the robot ─────────────────────────────────────────────────────────
say "robot" "$JETBOT_HOST"
# shellcheck disable=SC2086  # SSH_OPTS is meant to word-split
ssh $SSH_OPTS "$JETBOT_HOST" true 2>/dev/null || die "cannot reach '$JETBOT_HOST' over ssh.
     Check that the robot is powered and on the network, and that
     ~/.ssh/config has a Host entry for it — or set JETBOT_HOST to something
     else (JETBOT_HOST=192.168.1.42 $0 ...)."

if [ -z "$NAME" ]; then
  # shellcheck disable=SC2086
  NAME="$(ssh $SSH_OPTS "$JETBOT_HOST" \
          "cd '$JETBOT_REMOTE_DIR' 2>/dev/null && ls -1td -- */ 2>/dev/null | head -1" \
          || true)"
  NAME="${NAME%/}"; NAME="${NAME%$'\r'}"
  [ -n "$NAME" ] || die "no capture found in $JETBOT_HOST:~/$JETBOT_REMOTE_DIR/.
     Either nothing has been recorded yet — run 'python3 capture.py <name>' on
     the robot — or the folder lives elsewhere (set JETBOT_REMOTE_DIR)."
  echo "     newest capture: $NAME"
fi

# shellcheck disable=SC2086
NREMOTE="$(ssh $SSH_OPTS "$JETBOT_HOST" \
           "ls -1 '$JETBOT_REMOTE_DIR/$NAME'/*.jpg 2>/dev/null | wc -l" || true)"
NREMOTE="$(printf '%s' "$NREMOTE" | tr -cd '0-9')"
[ -n "$NREMOTE" ] || NREMOTE=0
[ "$NREMOTE" -gt 0 ] || die "$JETBOT_HOST:~/$JETBOT_REMOTE_DIR/$NAME holds no .jpg files.
     Wrong name, or the capture drive wrote nothing."

# ── fetch ───────────────────────────────────────────────────────────────────
DEST="${DEST:-$JETBOT_CAPTURES/$NAME}"
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
say "fetch" "$NREMOTE image(s)  →  $DEST"
"$RSYNC" -a --partial --progress \
    "$JETBOT_HOST:$JETBOT_REMOTE_DIR/$NAME/" "$DEST/" \
  || die "rsync failed.
     macOS ships openrsync, which does not always talk to the GNU rsync on the
     robot. Retry with a GNU one:
       RSYNC=/opt/homebrew/bin/rsync $0 $NAME"

NLOCAL=$(find "$DEST" -type f \
         \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | wc -l | tr -d ' ')
[ "$NLOCAL" -ge 20 ] || die "only $NLOCAL image(s) in $DEST — reconstruction needs at least ~20.
     Drive further before reconstructing; a resumed capture keeps counting up,
     so 'python3 capture.py $NAME' on the robot simply adds to this folder."

# ── reconstruct ─────────────────────────────────────────────────────────────
ARGS=("$DEST")
if [ "$HAVE_CAMERA" -eq 0 ]; then ARGS+=(--camera "$JETBOT_CAMERA"); fi
if [ "$VIEWER" -eq 1 ]; then ARGS+=(--viewer); fi
ARGS+=(${PASS[@]+"${PASS[@]}"})

say "pipeline" "$PIPE ${ARGS[*]}"
# Run from pipeline-3d's own directory so its default runs/<name> lands next to
# it, the way its README describes, and not wherever this was called from.
rc=0
( cd "$PIPE_DIR" && "$PIPE" "${ARGS[@]}" ) || rc=$?

if [ "$rc" -ne 0 ]; then
  cat >&2 <<EOF

jetbot-run: pipeline.sh exited $rc.
     If it stopped at the registration gate ("the match graph is too thin"),
     that is a matching problem, and the documented recovery is to match every
     pair instead of neighbouring ones — about 14 min for 260 images:

       $0 $NAME --matcher exhaustive

     The images are already on this machine, so the retry re-uses them; COLMAP
     keeps the features it extracted and only re-runs the matching.
     If that does not help either, the capture itself is too thin: more
     overlap, loops instead of straight lines, more light. Log:
     $PIPE_DIR/runs/$(basename "$DEST")/pipeline.log
EOF
  exit "$rc"
fi

# A probe writes runs/<name>-probe and stops at the verdict by design. Looking
# for model.html after one turns a successful probe into a reported failure.
if [ "$PROBE" -eq 1 ]; then
  echo; echo "jetbot-run: probe finished — verdict above, no model built."
  echo "            run it for real:  $0 $NAME"
  exit 0
fi

if [ "$STOP_AFTER" != compress ]; then
  echo; echo "jetbot-run: stopped after $STOP_AFTER — no model.html to open."
  exit 0
fi

# ── open the model ──────────────────────────────────────────────────────────
OUT="${OUT_ARG:-runs/$(basename "$DEST")}"
case "$OUT" in /*) ;; *) OUT="$PIPE_DIR/$OUT";; esac
[ -f "$OUT/model.html" ] || die "pipeline.sh finished but $OUT/model.html is missing.
     See $OUT/pipeline.log"
say "open" "$OUT/model.html"
open "$OUT/model.html"

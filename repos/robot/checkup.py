#!/usr/bin/env python3
# checkup.py - bring-up check for the JetBot camera and SD card.
#
#   python3 checkup.py                 # target resolution, 20 frames
#   python3 checkup.py --frames 60     # longer burst
#   python3 checkup.py --all-modes     # walk every candidate resolution
#
# Answers the two questions that gate package 3 and cannot be answered from
# the Mac:
#
#   1. Does the camera really deliver >= 1280x960? Every JetBot notebook builds
#      it at 224x224, so the resolution this pipeline actually reaches has to
#      be measured rather than requested. capture.py builds its own GStreamer
#      pipeline and lets Argus pick the sensor mode from the caps.
#   2. Does the SD card keep up? capture.py stores one JPEG per step; if encode
#      plus write costs more than the settle wait, the drive stalls.
#
# It imports capture.py rather than rebuilding the camera: what is measured
# here has to be the same code path the capture drive runs, not a copy of it.
#
# Python 3.6 only (JetPack 4.5 / Ubuntu 18.04). Read-only towards the robot -
# it drives no motors and touches no capture folder.
#
# THIS FILE HAS NEVER BEEN EXECUTED EITHER. It is meant to be the first thing
# that runs on the device, so it reports rather than concludes: every number it
# prints is a measurement, and the three verdict lines at the end are the only
# interpretation. If a number and a verdict disagree, trust the number.

from __future__ import print_function

import argparse
import os
import sys
import time

try:
    import capture
except ImportError as exc:
    sys.stderr.write("checkup: cannot import capture.py ({0}). Run this from "
                     "the directory that holds both files.\n".format(exc))
    raise SystemExit(1)

# Candidate resolutions, best first. Walked when the target fails, or fully
# with --all-modes. sensor-mode=3 on the IMX219 is natively 1640x1232, so the
# entries below are "what mode 3 can be asked for", not free choices.
#
#   out_w, out_h, cap_w, cap_h, fps, why
CANDIDATES = [
    (1280, 960, 1640, 1232, 21, "target: mode 3 native, scaled on the GPU"),
    (1640, 1232, 1640, 1232, 21, "mode 3 native, no scaling at all"),
    (1280, 960, 1280, 960, 21, "non-native caps - does Argus accept them?"),
    (1280, 720, 1280, 720, 30, "16:9, the smallest size 3DGS can still use"),
    (224, 224, 816, 616, 21, "the JetBot notebooks' own default - baseline"),
]

# The floor 3DGS needs (D-013). A candidate that starts but delivers less than
# this has not answered the question - the walk keeps going.
TARGET_W = capture.DEFAULT_WIDTH
TARGET_H = capture.DEFAULT_HEIGHT

# capture.py takes one shot per keypress and waits DEFAULT_SETTLE before it,
# so this is roughly the time budget one frame has in the real drive.
FRAME_BUDGET = capture.DEFAULT_SETTLE + capture.DEFAULT_DRIVE_TIME

CHECKUP_FMT = "checkup_%04d.jpg"   # deliberately not frame_*.jpg: jetbot-run.sh
                                   # picks the newest folder of captures, and
                                   # this must never look like one


def _pixels(size):
    return size[0] * size[1]


def _good_enough(size):
    return size[0] >= TARGET_W and size[1] >= TARGET_H


# A dark frame at maximum sensor gain is not a picture of anything, and the
# blur metric cannot tell you that: Laplacian variance measures local contrast,
# and amplified sensor noise has plenty. Measured 2026-09-10 on twenty frames
# taken with the lens seeing nothing, the median score was 60 and the highest
# 2017 - numbers that read as a well focused scene and would have produced a
# --min-sharpness that passes noise and rejects real frames.
#
# The discriminator is scale. Noise is uncorrelated between neighbouring
# pixels, so averaging the frame down to a sixteenth flattens it; a real scene
# keeps its contrast, because walls and furniture are larger than a pixel. So
# the standard deviation of the shrunk frame separates the two where the blur
# metric cannot.
SCENE_MIN_LEVEL = 12.0      # mean grey, 0-255. Below this the frame is black
SCENE_MIN_STRUCTURE = 6.0   # std of the 16x shrunk frame. Below this it is noise


def _scene(cv2, gray):
    """Return (mean level, coarse structure) for one greyscale frame."""
    height, width = gray.shape[0], gray.shape[1]
    small = cv2.resize(gray, (max(1, width // 16), max(1, height // 16)),
                       interpolation=cv2.INTER_AREA)
    mean, std = cv2.meanStdDev(small)
    return float(mean[0][0]), float(std[0][0])


def _median(values):
    ordered = sorted(values)
    count = len(ordered)
    if not count:
        return 0.0
    middle = count // 2
    if count % 2:
        return float(ordered[middle])
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _mb(num_bytes):
    return num_bytes / (1024.0 * 1024.0)


def _free_bytes(path):
    stat = os.statvfs(path)
    return stat.f_bavail * stat.f_frsize


def _try_camera(spec, settle, pos=""):
    """Open one candidate, report what came out, close it again.

    Returns (delivered_w, delivered_h) or None. Never raises: a candidate that
    cannot start is a result, not an error.

    `pos` is the "[2/5] " counter. Starting a candidate costs the settle wait
    plus however long nvargus-daemon takes, and a build that fights the caps
    can sit there for seconds - without the counter there is no way to tell a
    slow candidate from a hung one.
    """
    out_w, out_h, cap_w, cap_h, fps, why = spec
    print("  {0}{1}x{2} from {3}x{4} @{5}  - {6}"
          .format(pos, out_w, out_h, cap_w, cap_h, fps, why))
    camera = None
    try:
        camera = capture.open_camera(out_w, out_h, cap_w, cap_h, fps)
        frame = capture._grab(camera, 1)
        if frame is None or not hasattr(frame, "shape"):
            print("      started but delivered no frame")
            return None
        got_h, got_w = frame.shape[0], frame.shape[1]
        note = "ok" if (got_w, got_h) == (out_w, out_h) else \
               "MISMATCH - the caps did not reach the pipeline"
        print("      delivers {0}x{1}  ({2})".format(got_w, got_h, note))
        return (got_w, got_h)
    except ImportError as exc:
        print("      cannot import cv2 ({0}) - this runs on the robot, "
              "not on the Mac".format(exc))
        raise SystemExit(1)
    except Exception as exc:
        print("      will not start: {0}".format(exc))
        return None
    finally:
        if camera is not None:
            try:
                camera.stop()
            except Exception:
                pass
        # nvargus-daemon needs a moment before it hands the sensor over again;
        # opening back to back is a reliable way to get a bogus failure on the
        # next candidate.
        time.sleep(settle)


def _burst(cv2, camera, outdir, frames, quality, max_w, max_h):
    """Write `frames` JPEGs back to back and time every part of it.

    Back to back is harsher than the real drive on purpose - it is the load
    the SD card sees if the settle wait ever goes to zero.
    """
    jpeg_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    grabs, resizes, blurs, writes, sizes, scores = [], [], [], [], [], []
    levels, structures = [], []
    written = []

    total_start = time.time()
    for index in range(1, frames + 1):
        t0 = time.time()
        frame = capture._grab(camera, 1)
        t1 = time.time()
        if frame is None or not hasattr(frame, "shape"):
            sys.stderr.write("checkup: no frame at {0}, stopping the burst\n"
                             .format(index))
            break
        frame = capture._downscale(cv2, frame, max_w, max_h)
        t2 = time.time()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        scores.append(capture._sharpness(cv2, gray))
        level, structure = _scene(cv2, gray)
        levels.append(level)
        structures.append(structure)
        t3 = time.time()
        path = os.path.join(outdir, CHECKUP_FMT % index)
        if not cv2.imwrite(path, frame, jpeg_params):
            sys.stderr.write("checkup: could not write {0} - card full or "
                             "read-only?\n".format(path))
            break
        t4 = time.time()

        grabs.append(t1 - t0)
        resizes.append(t2 - t1)
        blurs.append(t3 - t2)
        writes.append(t4 - t3)
        sizes.append(os.path.getsize(path))
        written.append(path)
    loop_seconds = time.time() - total_start

    # Without this the numbers are fiction: 20 frames are ~6 MB and the Nano
    # has 4 GB of RAM, so every write above landed in the page cache and the
    # card may not have been touched at all yet.
    sync_start = time.time()
    try:
        os.sync()
    except AttributeError:                       # not on this platform
        pass
    sync_seconds = time.time() - sync_start

    return {
        "written": written, "sizes": sizes, "scores": scores,
        "levels": levels, "structures": structures,
        "grabs": grabs, "resizes": resizes, "blurs": blurs, "writes": writes,
        "loop_seconds": loop_seconds, "sync_seconds": sync_seconds,
    }


def _report(result, delivered, spec, frames, quality, outdir, free_before):
    count = len(result["written"])
    if not count:
        print("\nnothing was written - see the errors above")
        return 1

    sizes = result["sizes"]
    total_bytes = sum(sizes)
    wall = result["loop_seconds"] + result["sync_seconds"]
    sync = result["sync_seconds"]
    per_frame = wall / count
    out_w, out_h, cap_w, cap_h, fps, _ = spec
    resize_median = _median(result["resizes"])

    print("")
    print("  camera     {0}x{1} delivered   (asked {2}x{3} from {4}x{5} @{6})"
          .format(delivered[0], delivered[1], out_w, out_h, cap_w, cap_h, fps))
    print("  frames     {0} of {1} written to {2}".format(count, frames, outdir))
    print("  size       min {0:.0f} kB - median {1:.0f} kB - max {2:.0f} kB - "
          "total {3:.1f} MB"
          .format(min(sizes) / 1024.0, _median(sizes) / 1024.0,
                  max(sizes) / 1024.0, _mb(total_bytes)))
    grab_median = _median(result["grabs"])
    expected_grab = 1.0 / fps if fps else 0.0
    print("  grab       median {0:.3f} s   waiting for a fresh frame; expect "
          "~{1:.3f} s at {2} fps".format(grab_median, expected_grab, fps))
    if expected_grab and grab_median < expected_grab / 4.0:
        print("             WARNING - far too fast to be a fresh frame. _grab()")
        print("             counts new frames by object identity, so if the")
        print("             camera overwrote .value in place instead of")
        print("             replacing it, the check passes instantly and returns")
        print("             a stale frame. capture.py's whole settle wait (D-013)")
        print("             then buys nothing. Verify before trusting a drive.")
    print("  resize     median {0:.3f} s   {1}"
          .format(resize_median,
                  "0 means the GPU already delivered the right size"
                  if resize_median < 0.001
                  else "NOT zero - the CPU is rescaling every frame"))
    print("  blur check median {0:.3f} s   Laplacian variance; capture.py pays "
          "this once per shot, and again per --sharpness-retries"
          .format(_median(result["blurs"])))
    print("  encode     median {0:.3f} s   JPEG q{1}, into the page cache"
          .format(_median(result["writes"]), quality))
    if sync > 0.001:
        print("  flush      {0:.2f} s for {1:.1f} MB  ->  {2:.1f} MB/s actually "
              "reaching the card".format(sync, _mb(total_bytes),
                                         _mb(total_bytes) / sync))
    else:
        print("  flush      {0:.2f} s - too fast to measure; the card kept up "
              "on its own".format(sync))
    print("  per frame  {0:.3f} s all in, including its share of the flush"
          .format(per_frame))
    if result.get("levels"):
        print("  scene      brightness {0:.1f}/255 - coarse structure {1:.1f}  "
              "{2}".format(_median(result["levels"]), _median(result["structures"]),
                           "ok, there is something in front of the lens"
                           if (_median(result["levels"]) >= SCENE_MIN_LEVEL and
                               _median(result["structures"]) >= SCENE_MIN_STRUCTURE)
                           else "NOTHING IN FRAME - dark, or the lens is covered"))
    if result["scores"]:
        print("  sharpness  min {0:.0f} - median {1:.0f} - max {2:.0f}   "
              "standing still, this scene, at {3}x{4}"
              .format(min(result["scores"]), _median(result["scores"]),
                      max(result["scores"]), delivered[0], delivered[1]))
    free_after = _free_bytes(outdir)
    median_size = _median(sizes)
    room = int(free_after / median_size) if median_size else 0
    print("  disk       {0:.1f} GB free -> room for about {1} more frames"
          .format(free_after / (1024.0 ** 3), room))
    if free_before - free_after > 4 * total_bytes:
        print("             note: more space vanished than these frames "
              "explain - something else is writing to this card")

    print("")
    print("  verdict")
    if delivered[0] >= 1280 and delivered[1] >= 960:
        print("    resolution  ok - {0}x{1} is what 3DGS needs"
              .format(delivered[0], delivered[1]))
    elif delivered == (224, 224):
        print("    resolution  FAILED - 224x224 is the notebook default, so the "
              "traitlets kwargs never reached the GStreamer pipeline.")
        print("                Run --all-modes, then switch to jetcam's "
              "CSICamera - see open_camera() in capture.py.")
    else:
        print("    resolution  TOO SMALL - {0}x{1}. Anything below 1280x960 "
              "costs reconstruction detail; --all-modes shows what this build "
              "will give.".format(delivered[0], delivered[1]))

    if per_frame < 0.3 * FRAME_BUDGET:
        print("    card        ok - {0:.3f} s per frame against the ~{1:.2f} s "
              "a capture step has".format(per_frame, FRAME_BUDGET))
    elif per_frame < FRAME_BUDGET:
        print("    card        tight - {0:.3f} s per frame against ~{1:.2f} s "
              "per capture step. It fits, but lower capture.py's --quality if "
              "the drive feels laggy.".format(per_frame, FRAME_BUDGET))
    else:
        print("    card        TOO SLOW - {0:.3f} s per frame exceeds the "
              "~{1:.2f} s a capture step has. Lower --quality, or raise "
              "--settle so the wait absorbs it."
              .format(per_frame, FRAME_BUDGET))

    blind = (result.get("levels") and
             (_median(result["levels"]) < SCENE_MIN_LEVEL or
              _median(result["structures"]) < SCENE_MIN_STRUCTURE))
    if blind:
        print("    sharpness   NO THRESHOLD - the camera did not photograph a "
              "scene. Median brightness {0:.1f} of 255 and coarse structure "
              "{1:.1f}; below {2:.0f} and {3:.0f} the frame is darkness with "
              "the gain wound up, which the blur metric happily scores as "
              "sharp. Uncover the lens or turn a light on and run this again "
              "before trusting any sharpness number."
              .format(_median(result["levels"]), _median(result["structures"]),
                      SCENE_MIN_LEVEL, SCENE_MIN_STRUCTURE))
    elif result["scores"] and _good_enough(delivered):
        print("    sharpness   for the next drive try  --min-sharpness {0:.0f}  "
              "- half the median here. These frames were taken standing still, "
              "so this is the optimistic end of the scale."
              .format(_median(result["scores"]) / 2.0))
    elif result["scores"]:
        print("    sharpness   no threshold suggested - Laplacian variance "
              "scales with resolution, so a number measured at {0}x{1} would "
              "be wrong for capture.py. Fix the resolution first."
              .format(delivered[0], delivered[1]))
    return 0


def _cleanup(paths, outdir, created):
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass
    if created:
        try:
            os.rmdir(outdir)          # only if our frames were all it held
        except OSError:
            pass


def _parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Camera and SD-card bring-up check for the JetBot.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--frames", type=int, default=20,
                        help="JPEGs to write back to back")
    parser.add_argument("--quality", type=int, default=capture.DEFAULT_QUALITY,
                        help="JPEG quality, as capture.py would use it")
    parser.add_argument("--outdir", default="~/checkup",
                        help="where the test frames go; must be on the SD "
                             "card, and deliberately not under ~/captures")
    parser.add_argument("--keep", action="store_true",
                        help="do not delete the test frames afterwards")
    parser.add_argument("--all-modes", action="store_true",
                        help="probe every candidate resolution, not just until "
                             "one works")
    parser.add_argument("--probe-only", action="store_true",
                        help="only ask the camera what it delivers; write "
                             "nothing")
    parser.add_argument("--settle", type=float, default=1.0,
                        help="seconds between closing one camera and opening "
                             "the next")
    parser.add_argument("--width", type=int, help="test exactly this output "
                                                  "width instead of the candidate list")
    parser.add_argument("--height", type=int)
    parser.add_argument("--capture-width", type=int)
    parser.add_argument("--capture-height", type=int)
    parser.add_argument("--fps", type=int)
    args = parser.parse_args(argv)
    if args.frames < 1:
        parser.error("--frames must be >= 1")
    if not 1 <= args.quality <= 100:
        parser.error("--quality must be in 1..100")
    if bool(args.width) != bool(args.height):
        parser.error("--width and --height go together")
    return args


def _candidates(args):
    if args.width and args.height:
        return [(args.width, args.height,
                 args.capture_width or capture.DEFAULT_CAPTURE_WIDTH,
                 args.capture_height or capture.DEFAULT_CAPTURE_HEIGHT,
                 args.fps or capture.DEFAULT_FPS,
                 "requested on the command line")]
    return CANDIDATES


def main(argv=None):
    args = _parse_args(argv)

    try:
        import cv2
    except ImportError as exc:
        sys.stderr.write("checkup: cannot import cv2 ({0}). This runs on the "
                         "robot, not on the Mac.\n".format(exc))
        return 1

    print("checkup: camera and SD card, before anything is trusted")
    print("")
    print("1. what resolutions does this build actually give?")

    # Keep the largest frame any candidate actually delivered, not the first
    # one that merely started: a camera that answers a 1280x960 request with
    # 224x224 has started fine and still failed the check.
    working = None
    candidates = _candidates(args)
    for number, spec in enumerate(candidates, 1):
        delivered = _try_camera(spec, args.settle,
                                "[{0}/{1}] ".format(number, len(candidates)))
        if not delivered:
            continue
        if working is None or _pixels(delivered) > _pixels(working[1]):
            working = (spec, delivered)
        if _good_enough(delivered) and not args.all_modes:
            break

    if working is not None and not _good_enough(working[1]):
        print("")
        print("  no candidate reached {0}x{1}. Continuing with the largest that "
              "worked, {2}x{3}, so the card measurement below is still real - "
              "but the resolution question is answered NO."
              .format(TARGET_W, TARGET_H, working[1][0], working[1][1]))

    if working is None:
        print("\nno candidate resolution started. The camera is either held by "
              "something else - close the Jupyter notebooks, then\n"
              "  sudo systemctl restart nvargus-daemon\n"
              "- or the ribbon cable is loose. Check with:\n"
              "  ls /dev/video0 && gst-inspect-1.0 nvarguscamerasrc")
        return 1

    spec, delivered = working
    if args.probe_only:
        print("\n--probe-only: nothing written.")
        return 0

    outdir = os.path.expanduser(args.outdir)
    created = not os.path.isdir(outdir)
    try:
        if created:
            os.makedirs(outdir)
    except OSError as exc:
        sys.stderr.write("checkup: cannot create {0}: {1}\n".format(outdir, exc))
        return 1
    free_before = _free_bytes(outdir)

    print("")
    print("2. {0} frames back to back at {1}x{2}, JPEG q{3}"
          .format(args.frames, delivered[0], delivered[1], args.quality))

    camera = None
    result = None
    try:
        camera = capture.open_camera(spec[0], spec[1], spec[2], spec[3], spec[4])
        result = _burst(cv2, camera, outdir, args.frames, args.quality,
                        spec[0], spec[1])
    except KeyboardInterrupt:
        print("\ncheckup: interrupted")
    except Exception as exc:
        sys.stderr.write("checkup: burst failed: {0}\n".format(exc))
    finally:
        if camera is not None:
            try:
                camera.stop()
            except Exception as exc:
                sys.stderr.write("checkup: could not release the camera: {0}\n"
                                 .format(exc))

    if result is None:
        return 1

    status = _report(result, delivered, spec, args.frames, args.quality,
                     outdir, free_before)

    if args.keep:
        print("")
        print("  frames kept in {0} - look at a few before trusting the "
              "sharpness numbers".format(outdir))
    else:
        _cleanup(result["written"], outdir, created)
        print("")
        print("  test frames removed (--keep to inspect them)")
    return status


if __name__ == "__main__":
    raise SystemExit(main())

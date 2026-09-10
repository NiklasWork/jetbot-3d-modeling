#!/usr/bin/env python3
# capture.py - stop-and-go capture drive on the JetBot.
#
#   python3 capture.py <name> [options]
#
# Drive a bit, stop, wait the chassis out, take one sharp frame, repeat, while
# the human steers with the keyboard over SSH - one key per step, or one key
# for a whole manoeuvre. Writes ~/captures/<name>/ as
# frame_0001.jpg, frame_0002.jpg, ... which is exactly what pipeline-3d's
# sequential_matcher expects: neighbouring filenames are neighbouring views.
#
# Python 3.6 only (JetPack 4.5 / Ubuntu 18.04). No f-strings with '=', no
# dataclasses, no walrus. Nothing here needs Jupyter - it runs over plain SSH.
#
# NOTHING IN THIS FILE HAS EVER BEEN EXECUTED ON THE ROBOT. See the README
# section "First run on the device" for what to check before trusting it.

from __future__ import print_function

import argparse
import atexit
import errno
import os
import re
import select
import signal
import sys
import time

# --- defaults -------------------------------------------------------------
#
# SETTLE is the knob. The rolling-shutter camera is why this script exists
# (D-013): a frame taken while the chassis is still rocking is sheared and
# blurred, and neither COLMAP nor Brush can repair that. 0.7 s sits in the
# middle of the 0.5-1.0 s range we expect to need - long enough for the mount
# to stop ringing and for the ISP's auto-exposure to re-converge after the
# motion, short enough that 200 frames cost only ~2.5 min of pure waiting.
# It is a guess. Raise it until randomly checked frames are sharp, then stop.
DEFAULT_SETTLE = 0.7

# Speed and step length are the second knob. pipeline-3d wants 70-80 % overlap
# between neighbouring shots; too long a step and COLMAP loses the track.
# 0.30 is above the motor deadband (~0.15-0.20) and slow enough to stop short.
DEFAULT_SPEED = 0.30
DEFAULT_DRIVE_TIME = 0.30
DEFAULT_TURN_TIME = 0.25

# Turning: a/d drive an arc, not a spin. A pure rotation gives COLMAP no
# parallax, so nothing can be triangulated from it - a spin-only sequence
# reconstructs badly however sharp the frames are. The inner wheel keeps
# turning forward at this fraction of the outer one. A/D still spin in place
# for a single step, for corners that leave no room for an arc.
DEFAULT_TURN_INNER = 0.2

# Manoeuvres: one key, a sequence of the single steps above, a shot after each
# (context/plan-driving.md, package 1). The human still picks where to stand;
# the robot only performs the motion, which is the part a keyboard is bad at.
#
# These three counts are guesses, and they are the one thing package 2 exists
# to replace: how far a step may go follows from the field of view COLMAP's
# fisheye undistortion actually leaves (D-010), and no real frame has been
# measured yet. For now they say only "a handful of steps, not one". Eight
# spins close a panorama only if one spin step turns about 45 deg, which is
# equally unmeasured - it is not built to close.
DEFAULT_ORBIT_STEPS = 12
DEFAULT_PASS_STEPS = 10
DEFAULT_PANORAMA_STEPS = 8

# Resolution. Every JetBot notebook builds the camera at 224x224 (the ResNet
# training size); 3DGS needs at least 1280x960, so both the sensor caps and
# the output caps have to be raised - see _open_camera().
DEFAULT_WIDTH = 1280
DEFAULT_HEIGHT = 960
DEFAULT_CAPTURE_WIDTH = 1640
DEFAULT_CAPTURE_HEIGHT = 1232
DEFAULT_FPS = 21

DEFAULT_QUALITY = 92
DEFAULT_FLUSH = 2      # frames to discard after the settle wait, see _grab()

# Quality gates, borrowed from javieryu/nerf_bridge: do not store a soft frame,
# and do not let a stalled robot fill the folder with the same view.
#
# --min-sharpness is OFF by default and that is deliberate. Laplacian variance
# has no absolute scale: it depends on the scene's texture, the resolution and
# the exposure, so any number picked here without ever having run the robot
# would either reject every frame or none. The value is printed for every shot
# instead - do one drive, look at the numbers, then set the threshold to about
# half the typical sharp value. Below it the script re-settles and re-grabs
# rather than dropping the frame: a hole in the sequence doubles the baseline
# between two neighbouring filenames, which is exactly what sequential_matcher
# cannot absorb.
DEFAULT_MIN_SHARPNESS = 0.0
DEFAULT_SHARPNESS_RETRIES = 2

# --min-change is on. A stalled robot - wheels blocked, battery sagging, driven
# into a wall - produces frames that differ only by sensor noise, which is
# roughly 0.5-2 grey levels of mean absolute difference. 1.0 rejects the
# standing-still case without touching a real step. It is loud when it rejects,
# so a false positive is visible immediately; set 0 to switch it off.
DEFAULT_MIN_CHANGE = 1.0

DEFAULT_ROOT = "~/captures"

FRAME_RE = re.compile(r"^frame_(\d+)\.jpg$")
FRAME_FMT = "frame_%04d.jpg"
MAX_INDEX = 9999          # beyond this %04d stops sorting correctly

# Coverage, not progress. Nobody knows how long a hand-steered drive is, so
# there is no percentage to show and none is faked. What can be shown is how
# far the folder is from the two counts that mean something: pipeline-3d
# refuses to reconstruct below MIN_IMAGES, and every dataset measured in
# context/measurements.md sat in the MEASURED range. Each is announced once,
# when it is crossed.
MIN_IMAGES = 20
MEASURED_LOW = 225


def _elapsed(seconds):
    seconds = int(seconds)
    return "{0}m{1:02d}s".format(seconds // 60, seconds % 60)

KEY_HELP = """  w / s      step forward / backward, then shoot
  a / d      arc left / right, then shoot
  A / D      spin left / right in place, then shoot
  space      shoot without moving

  o / O      orbit left / right    - arc steps around what you stand beside
  f          wall pass             - forward steps along a wall you drive past
  p / P      panorama left / right - spins in place. Ties neighbouring views
                                     together for the matcher; a spin gives no
                                     parallax, so it is never the depth source
  any key    stops a running manoeuvre

  ?          repeat this list
  q          stop and quit  (Ctrl-C does the same)
"""


def die(msg):
    sys.stderr.write("capture: " + msg + "\n")
    raise SystemExit(1)


# --- camera ---------------------------------------------------------------

class GstCamera(object):
    """The CSI camera, read straight through GStreamer.

    This used to be `jetbot.Camera` and cannot be, on this robot. Measured
    2026-09-10: the `jetbot` package is not installed on the host at all - it
    lives only inside the Docker container Jupyter runs in, and `~/jetbot` is
    just the git clone, which Python picks up as an empty namespace package so
    that `import jetbot` *succeeds* and yields nothing. Putting the real
    package on the path does not help either: its `__init__` imports
    `ipywidgets`, because the package assumes a Jupyter kernel. That is 49 apt
    packages, plus 10 more for the compiler `Robot`'s dependency chain needs,
    on a shared robot with 1.5 GB free - to satisfy imports of `Heartbeat` and
    `ObjectDetector` we never call. See repos/robot/README.md, Our footprint.

    The interface is the one the rest of this file already expects: `.value`
    holds the most recent frame and is *replaced*, never written in place, so
    `_grab()` can count fresh frames by object identity. `.stop()` releases the
    sensor.

    On the pipeline: the IMX219 is the 160 deg module on this robot (D-010).
    `sensor-mode` is deliberately **not** pinned. jetbot 0.4.3 hard-coded
    `sensor-mode=3` and this file used to carry a note that the documented way
    out was jetcam, which passes `sensor-id` and lets Argus choose whichever
    mode fits the requested caps. Building the pipeline here gets that for
    free: ask for the capture size and Argus picks the mode.

    Aspect note, unchanged: 1640/1232 = 1.331 against 1280/960 = 1.333. The
    0.2 % anisotropic stretch is harmless, COLMAP's OPENCV_FISHEYE model
    estimates fx and fy separately anyway.
    """

    PIPELINE = ("nvarguscamerasrc sensor-id={sensor} ! "
                "video/x-raw(memory:NVMM),width={cw},height={ch},"
                "framerate={fps}/1,format=NV12 ! "
                "nvvidconv ! video/x-raw,width={w},height={h},format=BGRx ! "
                "videoconvert ! video/x-raw,format=BGR ! "
                "appsink drop=true max-buffers=1 sync=false")

    def __init__(self, width, height, capture_width, capture_height, fps,
                 sensor=0):
        import cv2
        import threading
        self._cv2 = cv2
        pipeline = self.PIPELINE.format(sensor=sensor, cw=capture_width,
                                        ch=capture_height, fps=fps,
                                        w=width, h=height)
        self._cap = cv2.VideoCapture(pipeline, cv2.CAP_GSTREAMER)
        if not self._cap.isOpened():
            self._cap.release()
            raise RuntimeError("GStreamer would not open the pipeline: "
                               + pipeline)
        ok, frame = self._cap.read()
        if not ok or frame is None:
            self._cap.release()
            raise RuntimeError("pipeline opened but delivered no first frame")
        self.value = frame
        self._running = True
        # Daemon thread: the reader must never be the reason the process
        # refuses to exit. `.stop()` is what shuts it down cleanly.
        self._thread = threading.Thread(target=self._loop)
        self._thread.daemon = True
        self._thread.start()

    def _loop(self):
        while self._running:
            ok, frame = self._cap.read()
            if ok and frame is not None:
                self.value = frame          # replace, never write in place
            else:
                time.sleep(0.005)

    def stop(self):
        self._running = False
        thread = getattr(self, "_thread", None)
        if thread is not None:
            thread.join(timeout=2.0)
        try:
            self._cap.release()
        except Exception:
            pass


def open_camera(width, height, capture_width, capture_height, fps):
    """Open the camera at a resolution 3DGS can use.

    Raises instead of exiting, so checkup.py can walk a list of candidate
    resolutions; _open_camera() below is the variant that gives up with advice.
    """
    return GstCamera(width, height, capture_width, capture_height, fps)


def _open_camera(args):
    """open_camera() for the capture drive: one resolution, or a hard stop."""
    try:
        return open_camera(args.width, args.height, args.capture_width,
                           args.capture_height, args.fps)
    except ImportError as exc:
        die("cannot import cv2 ({0}). This script runs on the robot, "
            "not on the Mac.".format(exc))
    except Exception as exc:
        die("camera would not start at {0}x{1} (capture {2}x{3}, {4} fps): {5}\n"
            "     Common causes: something else holds the camera - close the\n"
            "     Jupyter notebooks, then 'sudo systemctl restart nvargus-daemon'\n"
            "     (ask first, it kills whatever else was using the sensor); or no\n"
            "     sensor mode offers this capture size - lower\n"
            "     --capture-width/--capture-height."
            .format(args.width, args.height, args.capture_width,
                    args.capture_height, args.fps, exc))


def _motor_pair_class():
    """The two drive motors, without the jetbot package.

    This mirrors `jetbot/motor.py` and `jetbot/robot.py` from jetbot 0.4.3
    deliberately and line for line in behaviour, including the part that looks
    wrong: a *negative* mapped value runs the motor FORWARD. That is what the
    delivered code does, it matches how these motors are wired, and this file
    is in no position to correct it - see the warning below.

    Why not the package: `jetbot/__init__.py` needs ipywidgets, and getting
    `Robot` importable on this host costs about sixty apt packages for imports
    we never call (README.md, Our footprint). `Adafruit_MotorHAT` is the
    library jetbot's own motor.py is built on, it is pure Python, and it is
    installed. The HAT answers on i2c-1 at 0x60, confirmed with i2cdetect.

    *** NO PART OF THIS HAS EVER DRIVEN A MOTOR. *** It was written while the
    robot was explicitly not to be moved, so it is checked for imports and for
    the arithmetic below, and for nothing else. Before the first drive, put the
    robot on a stand with its wheels off the ground and confirm that a positive
    value turns both wheels forwards. If it does not, the direction constants
    here are the place to fix it, not the manoeuvre tables above.
    """
    from Adafruit_MotorHAT import Adafruit_MotorHAT

    class _Motor(object):
        def __init__(self, driver, channel, alpha=1.0, beta=0.0):
            self._motor = driver.getMotor(channel)
            self._alpha = alpha
            self._beta = beta
            atexit.register(self._release)

        def set(self, value):
            mapped = int(255.0 * (self._alpha * value + self._beta))
            speed = min(max(abs(mapped), 0), 255)
            self._motor.setSpeed(speed)
            if mapped < 0:
                self._motor.run(Adafruit_MotorHAT.FORWARD)
            else:
                self._motor.run(Adafruit_MotorHAT.BACKWARD)

        def _release(self):
            try:
                self._motor.run(Adafruit_MotorHAT.RELEASE)
            except Exception:
                pass

    class _MotorPair(object):
        """The slice of jetbot's Robot that capture.py actually calls."""

        def __init__(self, i2c_bus=1, addr=0x60, left_channel=1,
                     right_channel=2):
            self._driver = Adafruit_MotorHAT(addr=addr, i2c_bus=i2c_bus)
            self.left_motor = _Motor(self._driver, left_channel)
            self.right_motor = _Motor(self._driver, right_channel)

        def set_motors(self, left_speed, right_speed):
            self.left_motor.set(left_speed)
            self.right_motor.set(right_speed)

        def stop(self):
            self.set_motors(0.0, 0.0)

    return _MotorPair


def _grab(camera, flush, timeout=3.0):
    """Return a frame captured after this call, not one buffered before it.

    Camera.value is written by a background thread that never stops reading,
    so the frame sitting there when the wheels stop may well have been exposed
    while they were still turning - the settle wait would then buy nothing.
    Discard `flush` frames first; each assignment replaces the object, so
    identity is enough to count them.
    """
    last = camera.value
    seen = 0
    deadline = time.time() + timeout
    while seen < flush and time.time() < deadline:
        current = camera.value
        if current is not last:
            last = current
            seen += 1
        else:
            time.sleep(0.005)
    if seen < flush:
        sys.stderr.write("capture: warning - no fresh frame within {0:.1f} s; "
                         "the stored image may be stale\n".format(timeout))
    return last


def _downscale(cv2, frame, max_w, max_h):
    height, width = frame.shape[0], frame.shape[1]
    if width <= max_w and height <= max_h:
        return frame
    scale = min(float(max_w) / width, float(max_h) / height)
    size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
    return cv2.resize(frame, size, interpolation=cv2.INTER_AREA)


def _sharpness(cv2, gray):
    """Variance of the Laplacian - the standard cheap blur score."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


# --- output directory -----------------------------------------------------

def _prepare_dir(root, name):
    if os.sep in name or name in (".", "..") or name.startswith("-"):
        die("bad capture name: {0!r}".format(name))
    outdir = os.path.join(os.path.expanduser(root), name)
    try:
        os.makedirs(outdir)
        resumed = False
    except OSError as exc:
        if exc.errno != errno.EEXIST:
            die("cannot create {0}: {1}".format(outdir, exc))
        if not os.path.isdir(outdir):
            die("not a directory: {0}".format(outdir))
        resumed = True
    return outdir, resumed


def _next_index(outdir):
    """Continue the numbering; never overwrite what is already there."""
    highest = 0
    for entry in os.listdir(outdir):
        match = FRAME_RE.match(entry)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


# --- keyboard over SSH ----------------------------------------------------
#
# Keyboard, not gamepad. The template notebook
# (road_following/data_collection_gamepad.ipynb) drives an ipywidgets
# Controller, which is the *browser's* Gamepad API bridged through a Jupyter
# kernel - it cannot work over SSH at all, and it needs a browser tab open next
# to the robot for the whole drive. Keyboard needs no extra hardware, no kernel
# and no tab; the same 'python3 capture.py room' works from any shell. The cost
# is SSH keystroke latency (a step starts a few tens of ms late, irrelevant for
# stop-and-go) and having to put the terminal into cbreak mode and restore it.
#
# cbreak, not raw: it turns off echo and line buffering but leaves ISIG on, so
# Ctrl-C still raises KeyboardInterrupt and still reaches the motor stop. A
# robot that keeps driving after a crash is the failure worth designing around.

class Keyboard(object):
    def __init__(self):
        self.fd = None
        self.saved = None

    def __enter__(self):
        import termios
        import tty
        if not sys.stdin.isatty():
            die("stdin is not a terminal - this script is steered by hand.\n"
                "     Run it in an interactive SSH session, not under nohup or a pipe.")
        self.fd = sys.stdin.fileno()
        self.saved = termios.tcgetattr(self.fd)
        atexit.register(self.restore)
        tty.setcbreak(self.fd)
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.restore()
        return False

    def restore(self):
        if self.saved is None:
            return
        import termios
        try:
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.saved)
        except Exception:
            pass
        self.saved = None

    def read(self, timeout=0.2):
        """One keystroke, or None if nothing arrived within `timeout`."""
        try:
            ready, _, _ = select.select([sys.stdin], [], [], timeout)
        except select.error:            # interrupted by a signal
            return None
        if not ready:
            return None
        char = sys.stdin.read(1)
        return char if char else None


# --- driving --------------------------------------------------------------

def _motion_for(key, args):
    """(left, right, seconds, label), or None if the key does not move."""
    speed = args.speed
    inner = args.turn_inner * speed
    table = {
        "w": (speed, speed, args.drive_time, "forward"),
        "s": (-speed, -speed, args.drive_time, "backward"),
        "a": (inner, speed, args.turn_time, "arc left"),
        "d": (speed, inner, args.turn_time, "arc right"),
        "A": (-speed, speed, args.turn_time, "spin left"),
        "D": (speed, -speed, args.turn_time, "spin right"),
    }
    return table.get(key)


def _drive(robot, motion, keys=None):
    """Run one motion to its end, or until a keystroke cuts it short.

    Returns the interrupting key, or None if the step ran its full time. The
    wheels stop either way, including when something raises.

    Only manoeuvres pass `keys`. A single manual step is deliberately not
    interruptible: keystrokes queue up over SSH, and a buffered 'w' that
    truncated the step before it would quietly shorten the baseline between two
    neighbouring frames - the quantity the whole overlap budget rests on.
    Nothing is queued on purpose while a manoeuvre runs, so there a keypress
    means stop, and the wheels must not run out their remaining tenths first.
    """
    left, right, seconds, _ = motion
    interrupt = None
    robot.set_motors(left, right)
    try:
        if keys is None:
            time.sleep(seconds)
        else:
            deadline = time.time() + seconds
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                interrupt = keys.read(min(remaining, 0.05))
                if interrupt is not None:
                    break
    finally:
        robot.stop()
    return interrupt


def _drain(keys):
    """Swallow what was typed while a manoeuvre was running.

    Somebody stopping a manoeuvre hits the key more than once. Without this the
    extra presses would run as single steps the moment it ends.
    """
    while keys.read(0) is not None:
        pass


# A manoeuvre repeats one of the single steps above, so the motor values stay
# in _motion_for() and exist exactly once. Direction is the case of the key:
# w/a/s/d already spend their case on arc-versus-spin, so o/O and p/P cannot
# follow that rule and mean left/right instead - KEY_HELP spells it out.
MANOEUVRES = {
    "o": ("a", "orbit_steps", "orbit left", "orbit"),
    "O": ("d", "orbit_steps", "orbit right", "orbit"),
    "f": ("w", "pass_steps", "wall pass", "pass"),
    "p": ("A", "panorama_steps", "panorama left", "pano"),
    "P": ("D", "panorama_steps", "panorama right", "pano"),
}


def _manoeuvre_for(key, args):
    """(motion, steps, label, tag), or None if the key starts no manoeuvre."""
    entry = MANOEUVRES.get(key)
    if entry is None:
        return None
    step_key, count_attr, label, tag = entry
    return _motion_for(step_key, args), getattr(args, count_attr), label, tag


def _parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Stop-and-go capture drive on the JetBot (D-013).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("name", help="capture name; writes <root>/<name>/")
    parser.add_argument("--root", default=DEFAULT_ROOT,
                        help="where capture folders live")
    parser.add_argument("--settle", type=float, default=DEFAULT_SETTLE,
                        help="seconds to wait after stopping, before the shot")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED,
                        help="motor value 0..1 for one step")
    parser.add_argument("--drive-time", type=float, default=DEFAULT_DRIVE_TIME,
                        help="seconds the motors run per forward/backward step")
    parser.add_argument("--turn-time", type=float, default=DEFAULT_TURN_TIME,
                        help="seconds the motors run per turn step")
    parser.add_argument("--turn-inner", type=float, default=DEFAULT_TURN_INNER,
                        help="inner wheel as a fraction of the outer one on "
                             "a/d; -1.0 makes them spin in place")
    parser.add_argument("--orbit-steps", type=int, default=DEFAULT_ORBIT_STEPS,
                        help="arc steps in one orbit (o/O)")
    parser.add_argument("--pass-steps", type=int, default=DEFAULT_PASS_STEPS,
                        help="forward steps in one wall pass (f)")
    parser.add_argument("--panorama-steps", type=int,
                        default=DEFAULT_PANORAMA_STEPS,
                        help="spin steps in one panorama (p/P)")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH,
                        help="stored image width")
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT,
                        help="stored image height")
    parser.add_argument("--capture-width", type=int, default=DEFAULT_CAPTURE_WIDTH,
                        help="sensor capture width (IMX219 mode 3 is 1640x1232)")
    parser.add_argument("--capture-height", type=int, default=DEFAULT_CAPTURE_HEIGHT,
                        help="sensor capture height")
    parser.add_argument("--fps", type=int, default=DEFAULT_FPS,
                        help="camera framerate; changes only how fast a fresh "
                             "frame arrives, not the stored image")
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY,
                        help="JPEG quality 1..100")
    parser.add_argument("--flush-frames", type=int, default=DEFAULT_FLUSH,
                        help="frames to discard after the settle wait, so the "
                             "stored one was exposed standing still")
    parser.add_argument("--min-sharpness", type=float, default=DEFAULT_MIN_SHARPNESS,
                        help="reject frames below this Laplacian variance and "
                             "re-shoot; 0 measures without rejecting")
    parser.add_argument("--sharpness-retries", type=int,
                        default=DEFAULT_SHARPNESS_RETRIES,
                        help="extra settle-and-regrab attempts for a soft frame")
    parser.add_argument("--min-change", type=float, default=DEFAULT_MIN_CHANGE,
                        help="skip a frame whose mean absolute difference to "
                             "the last stored one is below this; 0 disables")
    args = parser.parse_args(argv)

    if args.settle < 0:
        die("--settle must be >= 0")
    if args.drive_time <= 0 or args.turn_time <= 0:
        die("--drive-time and --turn-time must be > 0")
    if not 0.0 < args.speed <= 1.0:
        die("--speed must be in (0, 1]")
    if not -1.0 <= args.turn_inner <= 1.0:
        die("--turn-inner must be in [-1.0, 1.0] - it is a fraction of --speed, "
            "and anything past 1.0 drives the inner wheel harder than the outer")
    if min(args.orbit_steps, args.pass_steps, args.panorama_steps) < 1:
        die("--orbit-steps, --pass-steps and --panorama-steps must be >= 1")
    if not 1 <= args.quality <= 100:
        die("--quality must be in 1..100")
    if args.width < 1 or args.height < 1:
        die("--width and --height must be >= 1")
    if args.flush_frames < 0 or args.sharpness_retries < 0:
        die("--flush-frames and --sharpness-retries must be >= 0")
    return args


def main(argv=None):
    args = _parse_args(argv)
    outdir, resumed = _prepare_dir(args.root, args.name)
    index = _next_index(outdir)

    try:
        import cv2
    except ImportError as exc:
        die("cannot import cv2 ({0}). This script runs on the robot.".format(exc))
    try:
        Robot = _motor_pair_class()
    except ImportError as exc:
        die("cannot import Adafruit_MotorHAT ({0}). Install it on the robot "
            "with 'sudo pip3 install --no-deps Adafruit-MotorHAT'; see "
            "README.md, Our footprint.".format(exc))

    print("capture: {0}".format(outdir))
    print("         {0}, continuing at frame {1:04d}"
          .format("folder exists" if resumed else "new folder", index))

    robot = Robot()
    atexit.register(robot.stop)

    def _on_term(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, _on_term)

    camera = None
    written = 0
    jpeg_params = [int(cv2.IMWRITE_JPEG_QUALITY), args.quality]
    prev_gray = None

    def shoot():
        """Wait the chassis out and return (frame, grey, sharpness).

        Retries a soft frame with another settle period instead of dropping it:
        a hole in the sequence doubles the baseline between two neighbouring
        filenames, and that is precisely what sequential_matcher cannot absorb.
        The sharpest attempt is kept even if none clears the threshold.
        """
        time.sleep(args.settle)
        best = None
        best_gray = None
        best_score = -1.0
        for attempt in range(args.sharpness_retries + 1):
            if attempt:
                time.sleep(args.settle)
            frame = _grab(camera, args.flush_frames)
            if frame is None or not hasattr(frame, "shape"):
                sys.stderr.write("capture: warning - no frame, skipping\n")
                return None, None, 0.0
            frame = _downscale(cv2, frame, args.width, args.height)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            score = _sharpness(cv2, gray)
            if score > best_score:
                best, best_gray, best_score = frame, gray, score
            if args.min_sharpness <= 0 or score >= args.min_sharpness:
                break
            sys.stderr.write("capture: soft frame (sharpness {0:.0f} < {1:.0f}), "
                             "re-settling\n".format(score, args.min_sharpness))
        return best, best_gray, best_score

    def step(motion, label, keys=None):
        """One stop-and-go step: drive, settle, shoot, gate, write, count.

        This is the whole body of the keyboard loop, lifted out so a manoeuvre
        can run it N times without a second copy of it. Returns what happened -
        "wrote", "stalled" (the frame repeats the last one), "noframe", or
        "aborted" when `keys` was given and a keystroke cut the drive short.
        """
        nonlocal index, prev_gray, written

        if motion is not None and _drive(robot, motion, keys) is not None:
            return "aborted"

        frame, gray, score = shoot()
        if frame is None:
            return "noframe"

        change = None
        if prev_gray is not None and prev_gray.shape == gray.shape:
            change = float(cv2.absdiff(gray, prev_gray).mean())
            if args.min_change > 0 and change < args.min_change:
                print("  skipped  {0:<12} nearly identical to the last frame "
                      "(change {1:.2f} < {2:.2f}) - is the robot stuck?"
                      .format(label, change, args.min_change))
                return "stalled"

        if index > MAX_INDEX:
            sys.stderr.write(
                "capture: warning - past frame_{0:04d}; wider numbers no "
                "longer sort next to each other and sequential_matcher "
                "will pair the wrong images. Start a new capture.\n"
                .format(MAX_INDEX))

        path = os.path.join(outdir, FRAME_FMT % index)
        if not cv2.imwrite(path, frame, jpeg_params):
            die("could not write {0} - SD card full or read-only?".format(path))

        prev_gray = gray
        written += 1
        index += 1
        total = index - 1
        print("  {0:<8} {1:<12} sharpness {2:>7.0f}{3}   {4} frames, {5}"
              .format(os.path.basename(path), label, score,
                      "" if change is None else "  change {0:.2f}".format(change),
                      total, _elapsed(time.time() - run_start)))
        # The folder count is what the two thresholds are about, so a resumed
        # capture crosses them at the right moment, not at the right moment of
        # this run.
        if total == MIN_IMAGES:
            print("           {0} frames - past the minimum pipeline-3d "
                  "will reconstruct".format(MIN_IMAGES))
        elif total == MEASURED_LOW:
            print("           {0} frames - as many as the datasets whose "
                  "runtimes are measured".format(MEASURED_LOW))
        return "wrote"

    def run_manoeuvre(motion, steps, label, tag, keys):
        """Drive one manoeuvre: `steps` identical steps, a shot after each.

        It ends on the first step that stores nothing. A stall ends the whole
        run here rather than skipping one frame, as it does under manual
        control: two identical frames in a row are what a robot pushing against
        furniture produces, and the next step would push again.
        """
        print("  {0}, {1} steps - any key stops it".format(label, steps))
        for number in range(1, steps + 1):
            if keys.read(0) is not None:
                _drain(keys)
                print("  {0} stopped by hand after {1}/{2}"
                      .format(label, number - 1, steps))
                return
            outcome = step(motion, "{0} {1}/{2}".format(tag, number, steps), keys)
            if outcome == "aborted":
                _drain(keys)
                print("  {0} stopped by hand after {1}/{2}"
                      .format(label, number - 1, steps))
                return
            if outcome != "wrote":
                print("  {0} gave up after {1}/{2} - {3}"
                      .format(label, number - 1, steps,
                              "the view stopped changing, so something is in "
                              "the way" if outcome == "stalled"
                              else "the camera returned no frame"))
                return
        print("  {0} done, {1} steps".format(label, steps))

    try:
        camera = _open_camera(args)
        atexit.register(camera.stop)

        probe = _grab(camera, 1)
        if probe is None or not hasattr(probe, "shape"):
            die("camera started but delivered no frame")
        print("         camera delivers {0}x{1}; stored at most {2}x{3}, JPEG q{4}"
              .format(probe.shape[1], probe.shape[0], args.width, args.height,
                      args.quality))
        if probe.shape[1] > args.width or probe.shape[0] > args.height:
            print("         note: camera delivers more than requested - frames "
                  "are resized on the CPU, which costs time per shot")
        elif probe.shape[1] < args.width or probe.shape[0] < args.height:
            # Nothing upscales: _downscale() passes a too-small frame straight
            # through. Saying "gets resized" here would be a lie in the one case
            # that ruins a whole drive - the 224x224 fallback every JetBot
            # notebook defaults to.
            sys.stderr.write(
                "capture: WARNING - the camera delivers {0}x{1}, SMALLER than the "
                "requested {2}x{3}.\n"
                "     Nothing upscales it: every frame will be stored at {0}x{1},\n"
                "     which is below what 3DGS can use. Stop now and fix the camera\n"
                "     (see _open_camera) rather than driving a whole capture at this\n"
                "     size.\n"
                .format(probe.shape[1], probe.shape[0], args.width, args.height))
        print("         settle {0:.2f} s, step {1:.2f} s at speed {2:.2f}"
              .format(args.settle, args.drive_time, args.speed))
        if args.min_change <= 0:
            print("         note: --min-change is off, so nothing notices that "
                  "a manoeuvre has stopped moving")
        print("")
        print(KEY_HELP)

        run_start = time.time()
        with Keyboard() as keys:
            while True:
                key = keys.read(0.2)
                if key is None:
                    continue
                if key in ("q", "Q"):
                    break
                if key == "?":
                    print(KEY_HELP)
                    continue

                plan = _manoeuvre_for(key, args)
                if plan is not None:
                    motion, steps, label, tag = plan
                    run_manoeuvre(motion, steps, label, tag, keys)
                    continue

                motion = _motion_for(key, args)
                if motion is None and key != " ":
                    continue
                step(motion, "in place" if motion is None else motion[3])

    except KeyboardInterrupt:
        print("\ncapture: interrupted")
    finally:
        # Order matters: wheels first, always, even if the camera teardown
        # throws. Both are also registered with atexit, so an exception that
        # escapes this block still stops the robot.
        try:
            robot.stop()
        except Exception as exc:
            sys.stderr.write("capture: could not stop the motors: {0}\n".format(exc))
        if camera is not None:
            try:
                camera.stop()
            except Exception as exc:
                sys.stderr.write("capture: could not release the camera: {0}\n".format(exc))

    print("capture: {0} image(s) written this run, folder now holds {1}"
          .format(written, _next_index(outdir) - 1))
    print("         {0}".format(outdir))
    print("         fetch and reconstruct from the Mac:  ./jetbot-run.sh {0}"
          .format(args.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

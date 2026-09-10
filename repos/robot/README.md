# roboter

Everything that runs on the JetBot: drive, capture, later detect objects.
Generates the image folder that `pipeline-3d` processes further — and works without it.

## Target system

| | |
|---|---|
| Device | Waveshare JetBot, Jetson Nano 4GB |
| Image | `jetbot-043_nano-4gb-jp45` — JetBot 0.4.3, JetPack 4.5 |
| OS | Ubuntu 18.04, **Python 3.6**, CUDA 10.2, TensorRT 7.1 |
| Access | Jupyter in the browser, `http://<jetbot-ip>:8888`, user/password `jetbot` |

> **Python 3.6 is binding.** No dataclasses (3.7), no walrus operator (3.8),
> no `ultralytics`. The stack is deliberately frozen — updates are not available for this
> hardware, see decision D-008 in the workspace.

## What is built here

1. **Control** — comes with the image (`teleoperation`, `basic_motion`).
2. **Capture** — `capture.py`, writes images into a folder, numbered in drive order.
3. **Object detection** — pre-trained SSD-MobileNet via `jetson-inference`,
   log detections per image. The mapping to 3D coordinates happens
   **not here**, but on the Mac from the COLMAP poses.

## The scripts

> **None of them has ever run.** They were written against the jetbot 0.4.3
> sources while the robot was still offline. See *First run on the device*
> below — start with `checkup.py`, it exists to be the first thing executed.
> One exception in kind: `capture.py`'s manoeuvres were driven end to end against
> a stand-in robot and camera, so what is unverified *there* is the hardware, not
> the sequencing, the abort or the stall detection.

### `checkup.py` — on the robot, before anything else

```bash
python3 checkup.py                     # target resolution, 20 frames
python3 checkup.py --all-modes --keep  # every candidate, keep the frames
```

Drives nothing and writes into `~/checkup`, not into a capture folder. It
answers the two questions that block `capture.py` and cannot be answered from
the Mac:

1. **Does the camera deliver ≥1280×960?** It walks a list of candidate
   resolutions and prints what each one actually returns. A configuration that
   starts but hands back 224×224 counts as failed, and the walk continues —
   otherwise the check would report success for exactly the trap it exists to
   find.
2. **Does the SD card keep up?** It writes N JPEGs back to back — harsher than
   the real drive, which has ~1 s between shots — and calls `os.sync()` before
   reporting throughput. Without that flush the numbers are page cache, not
   card: 20 frames are ~6 MB against 4 GB of RAM.

It also prints the Laplacian sharpness of every frame and suggests a
`--min-sharpness` for `capture.py`, but only if the resolution check passed —
the score scales with resolution, so a threshold read off a 224×224 frame would
be wrong for the drive.

`--probe-only` asks the camera and writes nothing. `--keep` leaves the frames
so you can look at them; without it they are removed.

### `capture.py` — on the robot

```bash
python3 capture.py wohnzimmer          # → ~/captures/wohnzimmer/frame_0001.jpg …
```

An interactive SSH session, not a notebook. Steer with the keyboard: `w`/`s`
step forward and back, `a`/`d` drive an arc (not a spin — a pure rotation gives
COLMAP no parallax), `A`/`D` spin in place anyway, space shoots without moving,
`q` quits. Every command drives for a moment, stops, waits the chassis out and
then stores one frame. Ctrl-C and a crash both stop the motors and release the
camera.

Five keys drive a whole **manoeuvre** instead of a single step — the same step
several times over with a frame after each, so you pick the standpoint and the
robot performs the motion: `o`/`O` orbit left or right, `f` a wall pass, `p`/`P`
a panorama. Any key stops a running manoeuvre, mid-step while the wheels are
still turning. It also stops itself when two frames in a row come out identical,
which is what a robot pushing against furniture produces — `--min-change` skips
one frame under manual control and ends the whole manoeuvre here.

A panorama is glue for the matcher, never the depth source: a spin on the spot
gives no parallax, so nothing seen only in those frames can be triangulated. The
wall pass is the opposite and the reason the manoeuvres exist — driving *past* a
surface is what produces the baseline 3DGS needs, driving *at* it produces none
(context/plan-driving.md).

Files are numbered, not timestamped, and the numbering is the interface:
`pipeline.sh` matches neighbouring filenames as neighbouring viewpoints. Re-running
with the same name continues the count instead of overwriting.

Each shot prints its sharpness, how many frames the folder now holds and how long
the drive has been going. No percentage: nobody knows in advance how long a
hand-steered drive is, so none is invented. The two counts that do mean something
are announced as they are crossed — 20 frames, below which `pipeline.sh` refuses
to reconstruct at all, and 225, the smallest dataset whose runtimes are measured.

The parameters you actually turn:

| | |
|---|---|
| `--settle 0.7` | seconds between stopping and the shot. **The one to tune.** Too short and the frame is sheared by the still-rocking mount; too long and a 200-frame drive crawls. Raise it until spot-checked frames are sharp. |
| `--speed 0.30` `--drive-time 0.30` `--turn-time 0.25` | how far one step goes. Shorter steps mean more overlap — the pipeline wants 70–80 % between neighbours. |
| `--turn-inner 0.2` | inner wheel on `a`/`d` as a fraction of the outer. `-1.0` turns them into spins. |
| `--min-sharpness 0` | Laplacian variance below which a frame is re-shot instead of stored. Off by default because the scale depends on the scene **and on the resolution** — the value is printed for every frame, so run `checkup.py` or drive once, look, then set it to about half the typical number. Changing `--width/--height` later invalidates the threshold. |
| `--min-change 1.0` | mean pixel difference to the previous frame below which the shot is skipped. Catches a stalled robot filling the folder with one view — and it is the whole stop condition for a manoeuvre, so switching it off leaves one running blind. |
| `--orbit-steps 12` `--pass-steps 10` `--panorama-steps 8` | how many steps one manoeuvre drives. Guesses: the honest number follows from the field of view left after COLMAP's fisheye undistortion, and no real frame has been measured yet. Eight spins close a circle only if one spin turns ~45°. |
| `--width 1280 --height 960` `--capture-width 1640 --capture-height 1232` | resolution. The defaults are deliberate: jetbot's camera class hard-codes `sensor-mode=3`, which on the IMX219 is natively 1640×1232, and 1280×960 is the largest size worth keeping (D-013). |

### `jetbot-run.sh` — on the Mac

```bash
./jetbot-run.sh                        # newest capture on the robot
./jetbot-run.sh wohnzimmer             # that one
./jetbot-run.sh wohnzimmer --preset full --matcher exhaustive
```

Fetches the folder with `rsync`, hands it to `pipeline-3d`'s `pipeline.sh` with
`--camera OPENCV_FISHEYE` (the 160° lens, D-010) and `--viewer`, and opens
`model.html`. Unknown flags go straight through; an explicit `--camera`
replaces the default and `--no-viewer` drops the viewer.

`pipeline.sh` is **not** wired in by a relative path — this repo has to stay
runnable without `pipeline-3d` next to it. Point at it once:

```bash
export JETBOT_PIPELINE="$HOME/…/repos/pipeline-3d/pipeline.sh"
```

Also settable: `JETBOT_HOST` (default `jetbot`, meant to be a `~/.ssh/config`
entry so no IP is pinned here), `JETBOT_CAPTURES` (default `<repo>/captures`),
`JETBOT_CAMERA`, `JETBOT_REMOTE_DIR`, `RSYNC`.

## Our footprint on the robot

Other projects run on this device. Everything we put on it stays inside the three
paths below, and anything outside them is somebody else's — that is the whole rule
(VISION.md, *Leave the robot as we found it*).

| Path | Written by | What it is |
|---|---|---|
| `~/jetbot-3d/` | you, by hand | where these scripts live. One folder, no installer |
| `~/captures/<name>/` | `capture.py` | `frame_NNNN.jpg` per drive; `--root` moves it |
| `~/checkup/` | `checkup.py` | its burst frames; `--outdir` moves it. It deletes its own frames afterwards and removes the folder again if it was the one that created it — `--keep` is what stops that |
| `/usr/local/lib/python3.6/dist-packages/` | `pip3`, 2026-09-10 | `Adafruit_MotorHAT` 1.4.0 and its I2C layer `Adafruit_PureIO` 1.1.11, both pure Python. This directory was **empty** on the delivered image, so everything in it is ours and `sudo pip3 uninstall Adafruit-MotorHAT Adafruit-PureIO` puts it back |

Two apt packages went on as well, and no others: `python3-pip` and `python-pip-whl`,
installed with `--no-install-recommends` so the toolchain and the system Python were
left alone. One side effect that cannot be undone: apt refreshed
`python3-pkg-resources` from 39.0.1-2 to 39.0.1-2ubuntu0.1, the security point
release of the same version. No systemd unit, no file under `/etc`, no change to the
JetBot notebooks.

### Why the scripts do not import `jetbot`

They used to, and on this device that cannot work. Measured 2026-09-10:

- The `jetbot` package is **not installed** on the host. It exists only as the git
  clone at `/home/jetbot/jetbot/`, and only inside the Docker container Jupyter runs
  in. Worse, `import jetbot` from the home directory *succeeds* and yields nothing —
  `~/jetbot` is picked up as an empty namespace package, so the failure surfaces
  later as `cannot import name 'Camera'` rather than as a missing module.
- Put the real package on the path and it still will not load on the host.
  `jetbot/__init__.py` imports `heartbeat`, which imports **`ipywidgets`**: the
  package assumes a Jupyter kernel. Installing that is 49 apt packages. `Robot`
  additionally wants `Adafruit_MotorHAT`, whose PyPI dependency chain needs a C
  compiler for `spidev`, another 10.

Roughly sixty packages on a shared robot with 1.5 GB free, to satisfy imports of
`Heartbeat` and `ObjectDetector` that we never call. So the scripts take the two
things they actually need directly:

- **Camera** — `cv2.VideoCapture(<nvarguscamerasrc pipeline>, cv2.CAP_GSTREAMER)`.
  `cv2` 4.1.1 and GStreamer are both on the delivered image. This is the path that
  produced `captures/mount-check-2026-09-10/`.
- **Motors** — `from Adafruit_MotorHAT import Adafruit_MotorHAT`, the same library
  `jetbot/motor.py` itself is built on, installed with `pip3 --no-deps` so none of
  the `spidev` chain comes with it. The HAT answers on i2c-1 at **`0x60`**, confirmed
  by `i2cdetect -y -r 1` (the bus also carries `0x3c` OLED, `0x41` power monitor,
  `0x70` PCA9685 all-call).

This is not a departure from D-008. The delivered stack stays exactly as delivered;
we simply stop routing through a package that was never installed outside its
container.

Three things are shared and cannot be made private, so they need a word before a drive:

- **The camera is exclusive.** While `capture.py` or `checkup.py` runs, nothing else
  gets a frame — and the reverse holds, which is why the first troubleshooting step
  is closing the Jupyter notebooks.
- **`sudo systemctl restart nvargus-daemon` is the one command here that reaches
  outside our own files.** It is the documented remedy when the camera will not
  start, and it kills whatever else was holding the sensor. Ask before running it on
  a robot someone else is using.
- **The SD card is one card.** A drive is hundreds of megabytes. `checkup.py`
  reports the free space it measured; fetch a capture to the Mac with
  `jetbot-run.sh` and delete it on the robot rather than letting drives pile up.

## First run on the device

Nothing below could be tested from the Mac. Check it in this order — the first
step is a script, the rest is judgement.

1. **Camera and card.** Close the Jupyter notebooks first: they hold the camera,
   and a second opener gets nothing. Then

   ```bash
   python3 checkup.py --keep
   ```

   Read its three verdict lines, then look at a few of the kept frames.
   - Resolution FAILED at 224×224 → the traitlets kwargs never reached the
     GStreamer pipeline. Try `--all-modes`; if nothing reaches 1280×960,
     switch to `jetcam`'s `CSICamera` — see `open_camera()` in `capture.py`.
   - Nothing starts at all → `sudo systemctl restart nvargus-daemon`, then
     check `ls /dev/video0` and the ribbon cable.
   - Card TOO SLOW → lower `capture.py`'s `--quality`, or raise `--settle` so
     the wait absorbs the write.
   - Note the suggested `--min-sharpness`; it is measured standing still, so
     treat it as the optimistic end.
2. **Sharpness under motion.** Drive with `capture.py`, spot-check frames, and
   raise `--settle` until they are sharp. Only now is `--min-sharpness` worth
   switching on — `checkup.py` never moved the robot, so it cannot tell you
   what the mount does after a step.
3. **Motor deadband and step length.** `--speed 0.30` is a guess; if the robot
   does not move, raise it. Then check the overlap between two frames — the
   pipeline wants 70–80 %.
4. **Manoeuvres.** In clear space, `f` with `--pass-steps 3`. The three steps
   must be the same length as three hand-typed `w` steps, and a key pressed
   mid-run must stop the wheels at once. Then drive one into an obstacle on
   purpose: it has to end itself rather than keep pushing.
5. **Stop on crash.** Ctrl-C mid-drive, and kill the process from a second
   shell — the wheels must stop both times.
6. **rsync.** macOS ships `openrsync`, which does not always speak to the GNU
   `rsync` on the robot. If the transfer fails, `RSYNC=/opt/homebrew/bin/rsync`.

## Status

Robot is built and flashed; `checkup.py`, `capture.py` and `jetbot-run.sh` are
written but unrun. Next step: boot, connect to WiFi, open the `teleoperation`
notebook, then `checkup.py`.

## Limitations

- No wheel encoders, no IMU — the robot cannot reliably track its own path.
  The camera trajectory comes from the reconstruction on the Mac.
- Rolling shutter camera: images during the drive become blurry indoors.
- No more security updates. Belongs in the home network, not in open WiFi.

Planning, rationales and open questions belong not here, but in the Truss workspace one level higher.

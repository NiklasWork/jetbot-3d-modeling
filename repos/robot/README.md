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

## The two scripts

> **Neither has ever run.** They were written against the jetbot 0.4.3 sources
> while the robot was still offline. See *First run on the device* below.

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

Files are numbered, not timestamped, and the numbering is the interface:
`pipeline.sh` matches neighbouring filenames as neighbouring viewpoints. Re-running
with the same name continues the count instead of overwriting.

The parameters you actually turn:

| | |
|---|---|
| `--settle 0.7` | seconds between stopping and the shot. **The one to tune.** Too short and the frame is sheared by the still-rocking mount; too long and a 200-frame drive crawls. Raise it until spot-checked frames are sharp. |
| `--speed 0.30` `--drive-time 0.30` `--turn-time 0.25` | how far one step goes. Shorter steps mean more overlap — the pipeline wants 70–80 % between neighbours. |
| `--turn-inner 0.2` | inner wheel on `a`/`d` as a fraction of the outer. `-1.0` turns them into spins. |
| `--min-sharpness 0` | Laplacian variance below which a frame is re-shot instead of stored. Off by default because the scale depends on the scene — the value is printed for every frame, so drive once, look, then set it to about half the typical number. |
| `--min-change 1.0` | mean pixel difference to the previous frame below which the shot is skipped. Catches a stalled robot filling the folder with one view. |
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
entry so no IP is pinned here), `JETBOT_CAPTURES` (default `~/captures`),
`JETBOT_CAMERA`, `JETBOT_REMOTE_DIR`, `RSYNC`.

## First run on the device

Nothing below could be tested from the Mac. Check it in this order:

1. **Camera resolution.** Start `capture.py` and read the line it prints: it
   reports what the camera actually delivered. If it is 224×224, the traitlets
   kwargs did not reach the GStreamer pipeline; if `nvarguscamerasrc` complains
   about the sensor mode, lower `--capture-width/--capture-height` or switch to
   `jetcam`'s `CSICamera` — see the comment in `_open_camera()`.
2. **Sharpness.** Spot-check frames, then tune `--settle`. Note the printed
   sharpness numbers and set `--min-sharpness` for the next drive.
3. **Frame rate to SD card.** One shot writes ~300 kB. If storing lags behind
   the driving, lower `--quality`.
4. **Motor deadband and step length.** `--speed 0.30` is a guess; if the robot
   does not move, raise it. Then check the overlap between two frames.
5. **Stop on crash.** Ctrl-C mid-drive, and kill the process from a second
   shell — the wheels must stop both times.
6. **rsync.** macOS ships `openrsync`, which does not always speak to the GNU
   `rsync` on the robot. If the transfer fails, `RSYNC=/opt/homebrew/bin/rsync`.

## Status

Robot is built and flashed; `capture.py` and `jetbot-run.sh` are written but
unrun. Next step: boot, connect to WiFi, open `teleoperation` notebook.

## Limitations

- No wheel encoders, no IMU — the robot cannot reliably track its own path.
  The camera trajectory comes from the reconstruction on the Mac.
- Rolling shutter camera: images during the drive become blurry indoors.
- No more security updates. Belongs in the home network, not in open WiFi.

Planning, rationales and open questions belong not here, but in the Truss workspace one level higher.

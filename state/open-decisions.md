# Open Decisions

> Briefings for undecided questions that block or shape work — including a challenge to a recorded decision (AGENTS.md §3).
> On decision → `D-NNN` in state/decisions/ with `Closes: OD-NNN`, then remove the entry here; no "DECIDED" tombstones. Empty is the correct state of a project with nothing undecided — never delete this file.
> `OD-NNN` sequential, never reused: the next free number is one above the highest `OD-NNN` here **or** in a `Closes:` line under state/decisions/.
> The entry shape below is a machine contract — `doctor`'s SY-03 parses the option lines, so keep it. Full grammar: docs/conventions.md.

<!-- Entry template — an OD is a briefing the human can decide from without reconstructing your analysis.

## OD-NNN — [question title]

Opened: YYYY-MM-DD
Context: [why this matters now, and what it blocks]
Options:
- A: [short label] — [what choosing it means] +[upside] / –[downside]
- B: [short label] (recommended) — [what choosing it means] +[upside] / –[downside]
- C: [short label] — [what choosing it means] +[upside] / –[downside]
- …: as many as the question actually has — two is the minimum, not the format
Trade-offs: [cross-cutting: cost, reversibility — only what the option lines don't carry]
Leaning: [which option and why, one line · or "none" plus what input would decide it]
Needed from human: [the decision or input you need]

Option lines are keyed (A:/B:/C:/…), label before the ` — `, then upside after `+` and
downside after `–`, separated by ` / `. There is no upper limit: list every option
that the question actually has — forcing a true three-way choice into a yes/no
hides the exact possibility that the human would have chosen. Mark at most one
option `(recommended)`, and only if `Leaning:` agrees. Keep the label short — it is
the click target. -->

## OD-004 — Collision data for walk mode, against the one-file promise

Opened: 2026-09-09
Context: The viewer only offers walk mode when it is handed voxel collision data; without it `isWalkAllowed` stays false and the mode's button is hidden, leaving orbit and fly. Fly's strafe sits behind pointer lock, which a viewer embedded in an iframe (the deck, an artifact) never gets — so on room-niklas there was no way to walk at all. `splat-transform --voxel-external-fill` writes the data in 5 s and, verified in the browser, walk mode then appears and click-to-walk works without pointer lock. The catch: it writes *two* files (`model.voxel.json` + a 3.4 MB `.bin`) and the viewer takes them by URL (`?collision=`), so `model.html` stops being the single file the README promises.
Options:
- A: leave it — the pipeline keeps emitting one self-contained file, walk mode stays unavailable +nothing to explain, nothing to carry / –the model can only be orbited and flown, and in an embed only rotated
- B: emit the voxel files beside the model (recommended) — one more `splat-transform` call in the compress stage, `model.html?collision=model.voxel.json` walks +cheap, reversible, no new machinery / –three files where the README promises one, and the plain `model.html` link silently has no walk mode
- C: inline the collision into the HTML — post-process the generated bootstrap JSON with a data URI, as presentation/build.py already does for the deck +one file *and* walk mode / –new machinery in the pipeline, +3.4 MB per model, and it edits a generated file the tool owns
Trade-offs: All three are reversible; B and C cost ~5 s of build time. C is the only one that keeps the demo's "one file, opened in a browser" claim true while making the room walkable, and it is also the only one that would give the university deck walk mode.
Leaning: B for the pipeline, because it changes nothing that exists; C only if the deck itself should become walkable — that is a presentation decision, not a pipeline one.
Needed from human: whether the pipeline emits collision data at all, and whether the deck's viewer should walk.

## OD-005 — The robot sees the room from 10 cm, and nobody looks at a room from there

Opened: 2026-09-10
Context: Raised by the human on 2026-09-10, and it is the sharper version of the camera-angle problem. Height, not tilt, is the issue: at about 10 cm every horizontal surface above the lens — table tops, desks, shelves, counters, seats — is photographed from underneath or edge-on. A surface never photographed cannot be rebuilt, so those tops come out absent or smeared, and they are exactly what makes a room read as a room. The second half is worse and less obvious: 3DGS optimises its gaussians for the views it trained on, so rendering from an eye-height camera the robot never occupied degrades *everything*, not only the missing tops. The viewer on the deck's last slide opens at human height by default. This shapes what the first capture drive is even for, so it wants deciding before that drive is planned.
**Photographed 2026-09-10, and it is not a theory any more.** `captures/checkup-lit-2026-09-10/` holds 20 frames taken with the robot on the floor of a lit room: tables are seen from underneath, chair seats edge on, and 62.5 % of every frame is bare floor with the entire room compressed into the top 37.5 %. Nothing standing on a table appears at all.
Options:
- A: raise the camera — a removable mast bringing the lens to 40-80 cm, so table tops go from invisible to grazing +the single biggest change to what the model can contain; no code / –a physical change to shared hardware, raises the centre of gravity on a small chassis, and needs the human's hands (HT)
- B: constrain the viewer to the robot's height (recommended) — the walkthrough camera stays at the height the robot actually drove +free, and it makes every rendered view fall inside the training distribution, so the model looks right everywhere it is allowed to go / –the room is then only ever seen from 10 cm, which is a deliberate product, not a room tour
- C: choose rooms that suit the sensor — corridors, bookshelves, sofas, pictures on walls; large vertical surfaces rather than tables +honest engineering, costs nothing / –does not scale past the demo, and rules out the obvious rooms
- D: second pass by hand — a human phone set at eye height, registered into the same COLMAP reconstruction and trained together +fills the gap completely / –the robot is then no longer the thing that captured the room, and the deck would have to say so
- E: change the use case — sell the viewpoint instead of apologising for it: what is under furniture, floor and cable inspection, clearance and accessibility surveys, or a robot-height model fed back to the driving algorithm as the map it actually needs +turns the defect into the reason the robot exists, and E-as-navigation-map connects straight to the open slot in the driving plan / –a different project from the one VISION.md describes
Trade-offs: A and B are not alternatives and the pair is the cheap answer — A improves what the data contains, B stops the viewer wandering into views the data cannot support. C and D are per-drive choices, reversible, and can wait. E is the only one that changes what the project is; it is also the only one that makes the low viewpoint an advantage rather than a cost.
Leaning: B now, because it costs nothing and is reversible; A next if the human is willing to put a mast on shared hardware. E is worth keeping in view because the driving branch would consume exactly that model.
Needed from human: whether a removable mast on the JetBot is acceptable, and whether the viewer should be pinned to robot height.

## OD-006 — How the robot pulls the code, when the repo it pulls is a fork of jetbot

Opened: 2026-09-11
Context: D-015 makes `github.com/janniskrn/robotic-jetbot` the code repo, and the scripts move into it later. The repo is an unmodified fork of `NVIDIA-AI-IOT/jetbot`: 169 MB, of which 73 MB is history, and its working tree contains the `jetbot` package, the notebooks and the docker setup. Cloning that on the device costs 169 MB of the 1.5 GB free (`df` over SSH 2026-09-11: 22 of 24 GB used, 94 %), puts a second copy of the package tree beside the existing `/home/jetbot/jetbot/`, and re-creates the trap `repos/robot/README.md` documents — a directory named `jetbot/` next to the working directory makes `import jetbot` succeed and yield nothing. It also breaks VISION.md's "leave the robot as we found it" by two orders of magnitude over the three files we actually run. Blocks the first `git pull` on the robot, not the clone on the Mac.
Options:
- A: clone it whole on the robot — `git clone` into `~/jetbot-3d/`, live with the tree +one repo, one command, nothing to explain / –169 MB, a duplicate `jetbot/` package directory, and the namespace trap back in the path
- B: strip the fork, then shallow-clone (recommended) — delete NVIDIA's tree on `master` so the repo holds only our scripts, then `git clone --depth 1` on the robot +the device gets three files and no `jetbot/` directory; history stays on GitHub if it is ever wanted / –the fork keeps pointing at NVIDIA, so a PR still defaults there and the repo is public
- C: sparse checkout — keep the fork whole and check out only our paths on the device +nothing thrown away / –the robot has git 2.17.1 (verified over SSH 2026-09-11), which has only the pre-cone `core.sparseCheckout`; fiddly to set up by hand and easy to lose on the next clone
- D: no clone on the robot — keep pushing from the Mac with rsync +zero footprint, works today / –exactly the manual step D-015 exists to remove
Trade-offs: All four are reversible. B is the only one that gives the pull-based workflow at a footprint the device can carry; its cost is cosmetic (fork relation, visibility) where A's is operational. The public-fork question is separate and also settled by a fresh non-fork repo, which stays available until the scripts have moved.
Leaning: B, and do the strip before the scripts move in rather than after — a repo that never carried our code next to NVIDIA's is cleaner than one that did.
Needed from human: whether the fork gets stripped down to our code, and whether our code being public is acceptable.

## OD-007 — How the Mac reaches the robot from outside the home network

Opened: 2026-09-12
Context: Raised by the human on 2026-09-12, asking whether ngrok could expose the robot with a fixed address on every boot. Most of the answer already exists and was verified this session: the Lenovo is a Tailscale subnet router for `192.168.178.0/24` (approved) and the Mac has `RouteAll: true`, so with Tailscale up the Mac sits inside the home network from anywhere — the robot is reachable with **nothing installed on it**. What breaks outside is only host resolution: `jetbot-host.sh` finds the robot in the Mac's own ARP table, and layer 2 ends at the router, so from a foreign network it finds nothing. Exposing the robot itself is the part that should not happen: Jupyter on 8888 carries the image's published default password `jetbot`, the OS gets no security updates, and SSH password login is deliberately still open (repos/robot/README.md).
Options:
- A: DHCP reservation in the Fritz!Box (recommended) — the robot keeps one address, `ssh jetbot@192.168.178.x` works over the subnet route and `jetbot-host.sh` becomes unnecessary +the "fixed address" the question asked for, at zero footprint on the robot / –needs the human at the router once, and pins an address the script was written to avoid
- B: resolve over the Lenovo — `jetbot-host.sh` falls back to running the ARP lookup on `lenovo`, which is on the same segment +no router access and no robot change; the MAC stays the identity / –one more hop and a second machine in the path of every `ssh jetbot`
- C: ngrok on the robot — agent, authtoken and a systemd unit on the device, tunnelling 8888 and/or 22 +works without Lenovo or router / –puts an unpatched robot with a known Jupyter password on the public internet, costs disk on a card with 1.5 GB free, and the free tier gives a static *domain* for HTTP only — TCP endpoints for SSH get a new address every start, which is the one property the question asked for
- D: nothing — remote work waits until someone is in the home network +zero cost / –no access to the device from the university or the office
Trade-offs: A and B are alternatives to each other and both free; either can be added later without undoing the other. C is the only option that changes the robot and the only one with an exposure cost. A public viewer for an audience is a separate question and belongs on the Lenovo behind `cloudflared`, not on the robot. Independent of all four: remote *driving* wants someone in the room — the kill switch runs over the same link that may be the thing failing, and the motor layer has never turned a wheel.
Leaning: A if the human is willing to touch the router, B otherwise; C in no variant.
Needed from human: whether a DHCP reservation is acceptable, and whether remote access is for development only or also for showing the robot to people outside the tailnet.

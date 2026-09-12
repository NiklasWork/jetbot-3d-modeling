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

## OD-007 — How the Mac reaches the robot, when the robot lives on the university network

Opened: 2026-09-12
Context: Raised by the human on 2026-09-12. The first version of this briefing assumed the robot sat in the home network and was answered by the Lenovo's approved Tailscale subnet route for `192.168.178.0/24`; the human corrected the premise the same day — **the robot stands on the university network** (context/architecture.md). That kills both cheap answers: the Lenovo routes the wrong subnet, and a DHCP reservation needs a router nobody here administers. What is left is a network we do not control, behind NAT, possibly with client isolation and egress filtering, so nothing can reach in. Only an outbound connection the robot itself opens can work. D-008's consequence clause sets the boundary on which kind: the image gets no security updates and "the robot does not belong on the open web" — Jupyter on 8888 still carries the image's published default password `jetbot`, and SSH password login is deliberately open.
Options:
- A: Tailscale on the robot (recommended) — outbound-only daemon; the device gets a `100.x` address and a stable name that survive every boot and every network +exactly the fixed address the question asked for, reachable only from our own devices and never from the internet; `jetbot-host.sh` and its ARP lookup can then be deleted rather than extended / –a permanent daemon on shared hardware, which is the same footprint objection that stopped us enabling avahi, plus a third-party coordination service and ~35 MB of the 1.5 GB free
- B: Cloudflare Tunnel on the robot — same outbound shape, stable hostname, Cloudflare Access in front; the `cloudflared` role on the Lenovo means the tooling is already known here +the only option that lets someone without a tailnet account open a link, so it is the one that serves a demo / –fronts HTTP, which pulls Jupyter towards the web and leans on Access being configured correctly every time; more client-side steps for SSH than A
- C: ngrok on the robot — the option the question started from +works from any network, one binary / –publishes an unpatched device with a known Jupyter password to the public internet, against D-008; and the free tier's static address is an HTTP *domain* only — TCP endpoints for SSH get a new address on every start, so the one property asked for is the one missing
- D: nothing on the robot — work on campus, fetch over rsync while there +zero footprint, zero policy exposure, matches VISION's leave-it-as-we-found-it exactly / –every `checkup` run, every capture and every failed experiment needs a trip to the device
- E: reverse SSH to a rendezvous host — a systemd unit and openssh, which is already on the device, so the smallest footprint of all +no third-party binary and no new provider / –needs a publicly reachable host to dial into, and the Lenovo's own rules forbid putting port 22 on the internet; only viable if that is revisited
Trade-offs: A, B, C and E are all the same shape — the robot dials out, because nothing dials in — and they differ only in who ends up able to reach it: our devices (A), anyone with a link and an Access login (B), anyone at all (C), whoever holds the rendezvous host (E). Client isolation on the campus WLAN, if it is on, breaks nothing here: an outbound tunnel does not care. Two physical facts decide this before the tunnel does, and neither is ours to settle: the robot runs on a 3S battery pack, so it is reachable only while someone on site has switched it on and left it powered — remote access to a device nobody turns on is worth nothing; and a permanent tunnel out of a university network is the network owner's call, not ours.
Leaning: A, if the robot has permanent power and the network's owner has no objection — it is the only option that gives the fixed address without putting the device on the web, and it removes a script instead of adding one. D is the honest fallback and costs nothing to stay on. C in no variant.
Needed from human: whether the robot is permanently powered or switched on per session; which network it is on (eduroam with personal credentials, or a lab/device net); and whether a permanent outbound tunnel is acceptable to whoever runs that network.

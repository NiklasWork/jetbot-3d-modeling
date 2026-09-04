# Human Todos

> Only what an agent cannot execute: access it lacks, acting under the human's identity, a physical or legal act, or a sign-off the protocol reserves. Everything else belongs in `state/current.md` `next:` or the owning file; a judgment call is an OD. Settled `[x]` entries move to `archive/human-todos.md`.

- [ ] HT-001 — **Backup JetBot SD card in factory state**

  1. Shut down JetBot, remove SD card, plug it into the Mac via card reader.
  2. Identify card device: `diskutil list` — looking for the device with ~64 GB and the partition `JETSON-NANO` or `system-boot`.
  3. Unmount card (do not eject): `diskutil unmountDisk /dev/diskN`
  4. Create image and compress it immediately: `sudo dd if=/dev/rdiskN bs=4m | gzip > ~/jetbot-auslieferung.img.gz` (rdiskN with r, that is many times faster).
  5. Put card back into the JetBot.

  **Done when:** `~/jetbot-auslieferung.img.gz` exists and is several GB in size.

  **Background:** The stack remains frozen (D-008) and the JetBot notebooks are modified during work; without an image, a broken state costs a 13.6 GB download plus rebuild.

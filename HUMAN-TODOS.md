# Human Todos

> Only what an agent cannot execute: access it lacks, acting under the human's identity, a physical or legal act, or a sign-off the protocol reserves. Everything else belongs in `state/current.md` `next:` or the owning file; a judgment call is an OD. Settled `[x]` entries move to `archive/human-todos.md`.

- [ ] HT-001 — **SD-Karte des JetBot im Auslieferungszustand sichern**

  1. JetBot herunterfahren, SD-Karte entnehmen, per Kartenleser an den Mac stecken.
  2. Kartengerät ermitteln: `diskutil list` — gesucht ist das Gerät mit ~64 GB und der Partition `JETSON-NANO` oder `system-boot`.
  3. Karte aushängen (nicht auswerfen): `diskutil unmountDisk /dev/diskN`
  4. Abbild ziehen und gleich komprimieren: `sudo dd if=/dev/rdiskN bs=4m | gzip > ~/jetbot-auslieferung.img.gz` (rdiskN mit r, das ist um ein Vielfaches schneller).
  5. Karte zurück in den JetBot.

  **Done when:** `~/jetbot-auslieferung.img.gz` existiert und ist mehrere GB groß.

  **Background:** Der Stack bleibt eingefroren (D-008) und die JetBot-Notebooks werden beim Arbeiten verändert; ohne Abbild kostet ein kaputtgespielter Zustand einen 13,6-GB-Download plus Neuaufbau.

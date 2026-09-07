# Human Todos — archive

> Settled entries, with the note that invalidated them. Kept so a later session
> does not re-open a question the human already closed.

- [x] HT-001 — **Backup JetBot SD card in factory state** — cancelled 2026-09-07.

  The entry justified itself with the cost of losing the image: "13.6 GB download
  plus rebuild". That reason did not hold. The delivery image
  `jetbot-043_nano-4gb-jp45.zip` was still on the Mac, so a `dd` copy of the
  untouched card would have been byte-for-byte the same thing, twice.

  The human then decided to delete the zip for disk space and to keep no backup
  at all. Recovery from a broken card is therefore: re-download from NVIDIA Box
  (`https://nvidia.box.com/shared/static/mhtefkijy2c267rbuux6mhelj7ynjohz.zip`,
  13 GB, verified live 2026-09-07) and re-flash. Accepted cost, deliberately.

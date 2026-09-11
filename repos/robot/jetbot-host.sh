#!/bin/sh
# jetbot-host.sh — find the robot on the LAN by MAC address and connect to it.
#
# Runs on the Mac as the ProxyCommand behind `Host jetbot` in ~/.ssh/config, so
# `ssh jetbot`, `rsync` and `jetbot-run.sh` keep working when DHCP hands the
# robot a different address. Nothing is pinned: the MAC is the identity, the
# address is looked up on every connection.
#
#   ./jetbot-host.sh --print     # print the address it found, connect to nothing
#   ./jetbot-host.sh 22          # wire stdin/stdout to that address (what ssh calls)
#
# Why not a hostname: `jetbot.local` does not resolve, and now we know why —
# `avahi-daemon` is installed on the robot but **inactive** (checked over SSH
# 2026-09-11). Enabling it would make the hostname work and this script
# pointless, but that means a systemd unit on a shared robot, which our
# footprint rule forbids without asking. Until someone decides that, or sets a
# DHCP reservation on the router, this needs no change on robot or router.
#
# POSIX sh on purpose: Homebrew's bash 5 returns an empty `arp` table under a
# sandboxed agent session, which would make this silently find nothing there.
#
# If the robot's WiFi module is ever swapped, or it moves to Ethernet, the MAC
# changes with it — override once with JETBOT_MAC=… or edit the default here.

set -eu

MAC="${JETBOT_MAC:-84:5c:f3:27:04:57}"
PORT="${1:-22}"

# macOS prints ARP entries with leading zeros stripped (4:57, not 04:57), so
# both sides are normalised before they are compared.
norm() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | awk -F: \
    '{s="";for(i=1;i<=NF;i++){v=$i;sub(/^0+/,"",v);if(v=="")v="0";s=s (i>1?":":"") v}print s}'
}

WANT="$(norm "$MAC")"

lookup() {
  arp -an | awk -v want="$WANT" '{
    gsub(/[()]/,"",$2); got="";
    parts=split($4,o,":");
    for(i=1;i<=parts;i++){v=o[i];sub(/^0+/,"",v);if(v=="")v="0";got=got (i>1?":":"") v}
    if(got==want && $2 ~ /^[0-9]+\./){print $2; exit}
  }'
}

IP="$(lookup)"

# Cold ARP cache: wake every host on the interface's /24, then look again.
if [ -z "$IP" ]; then
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  SELF="$(ipconfig getifaddr "${IFACE:-en0}" 2>/dev/null || true)"
  if [ -n "$SELF" ]; then
    i=1
    while [ "$i" -le 254 ]; do
      ping -c1 -t1 "${SELF%.*}.$i" >/dev/null 2>&1 &
      i=$((i + 1))
    done
    wait
    IP="$(lookup)"
  fi
fi

if [ -z "$IP" ]; then
  echo "jetbot-host: no host with MAC $MAC on this network — is the robot on, and on this WiFi?" >&2
  exit 1
fi

if [ "${1:-}" = "--print" ]; then
  echo "$IP"
else
  exec nc "$IP" "$PORT"
fi

#!/usr/bin/env sh
# Prints the primary non-loopback IPv4 address of this machine.
# Dev and CI LiveKit advertise it as node_ip because Firefox rejects loopback ICE candidates.
set -eu
if [ -n "${LIVEKIT_NODE_IP:-}" ]; then
  echo "$LIVEKIT_NODE_IP"
  exit 0
fi
ip=""
case "$(uname -s)" in
  Darwin)
    # The default route may point at a VPN tunnel (utunN) without an IPv4 address; fall back to Wi-Fi/Ethernet.
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    for candidate in "$iface" en0 en1 en2; do
      [ -n "$candidate" ] || continue
      ip=$(ipconfig getifaddr "$candidate" 2>/dev/null || true)
      [ -n "$ip" ] && break
    done
    ;;
  Linux)
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
    ;;
esac
if [ -z "$ip" ]; then
  echo "detect-ip: could not determine a LAN IPv4 address; set LIVEKIT_NODE_IP explicitly" >&2
  exit 1
fi
echo "$ip"

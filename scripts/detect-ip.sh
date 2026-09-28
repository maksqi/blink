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
    # The source address of the default route: eth0 on GitHub's runners.
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
    # No default route (offline): the first global address that is not a Docker bridge.
    if [ -z "$ip" ]; then
      ip=$(ip -4 -o addr show scope global 2>/dev/null |
        awk '$2 !~ /^(docker|br-|veth)/ { split($4, address, "/"); print address[1]; exit }' || true)
    fi
    ;;
esac
case "$ip" in
  *[!0-9.]* | '')
    echo "detect-ip: could not determine a LAN IPv4 address; set LIVEKIT_NODE_IP explicitly" >&2
    exit 1
    ;;
esac
echo "$ip"

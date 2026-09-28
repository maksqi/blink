/**
 * Client IP resolution and limiter keys (server-core).
 *
 * - `getClientIp(event)`: the app listens on loopback behind Caddy, so `X-Forwarded-For` is trusted only when the
 *   socket peer is loopback; then its first entry wins (Caddy replaces client-sent values with the real peer)
 *   (decision). Otherwise, or when the header is missing or invalid, the socket address is used.
 * - `normalizeIp(raw)`: canonical form (IPv4-mapped IPv6 → IPv4, RFC 5952 IPv6), strips ports, brackets, zones.
 * - `limiterKeysForIp(ip)`: `{ ip: 'ip:<address>', net }`; `net` is the aggregation key for per-IP limits:
 *   `ip:<address>` for IPv4, `net:<prefix>/64` for IPv6 (docs/API.md §1.2).
 * - `isLoopbackIp(ip)`.
 */
import { isIP } from 'node:net'
import { getRequestHeader, type H3Event } from 'h3'

export function getClientIp(event: H3Event): string | null {
  const peer = normalizeIp(event.node.req.socket?.remoteAddress)
  if (peer && isLoopbackIp(peer)) {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')
    const ip = normalizeIp(forwarded?.split(',')[0])
    if (ip) return ip
  }
  return peer
}

export function isLoopbackIp(ip: string): boolean {
  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

export interface IpLimiterKeys {
  /** Exact address. */
  ip: string
  /** Aggregation key for per-IP limits: the IPv4 address, or the IPv6 /64. */
  net: string
}

export function limiterKeysForIp(ip: string | null): IpLimiterKeys {
  const normalized = normalizeIp(ip)
  if (!normalized) return { ip: 'ip:unknown', net: 'ip:unknown' }
  if (isIP(normalized) === 4) return { ip: `ip:${normalized}`, net: `ip:${normalized}` }
  const groups = parseIpv6(normalized)!
  return { ip: `ip:${normalized}`, net: `net:${formatIpv6([...groups.slice(0, 4), 0, 0, 0, 0])}/64` }
}

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim()
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) value = bracketed[1]!
  const v4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (v4WithPort) value = v4WithPort[1]!
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  const kind = isIP(value)
  if (kind === 4) return value
  if (kind !== 6) return null
  const groups = parseIpv6(value)
  if (!groups) return null
  // IPv4-mapped (::ffff:a.b.c.d) addresses are IPv4 clients of a dual-stack socket.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.')
  }
  return formatIpv6(groups)
}

/** Eight 16-bit groups, or null. Accepts `::` compression and a trailing dotted IPv4 part. */
function parseIpv6(value: string): number[] | null {
  let text = value.toLowerCase()
  const dotted = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (dotted) {
    const b = dotted.slice(1, 5).map(Number)
    if (b.some((n) => n > 255)) return null
    const hi = ((b[0]! << 8) | b[1]!).toString(16)
    const lo = ((b[2]! << 8) | b[3]!).toString(16)
    text = `${text.slice(0, dotted.index)}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => Number.parseInt(g, 16)))
  const head = parse(halves[0]!)
  const tail = halves.length === 2 ? parse(halves[1]!) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array<number>(Math.max(missing, 0)).fill(0), ...tail]
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** RFC 5952: lowercase, no leading zeros, the longest run (≥ 2) of zero groups compressed, leftmost on ties. */
function formatIpv6(groups: number[]): string {
  let bestStart = -1
  let bestLength = 1
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLength) {
      bestStart = i
      bestLength = j - i
    }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestStart === -1) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`
}

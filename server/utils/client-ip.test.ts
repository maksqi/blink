import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'
import { getClientIp, isLoopbackIp, limiterKeysForIp, normalizeIp } from './client-ip'

function eventFrom(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress })
  const req = new IncomingMessage(socket)
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return createEvent(req, new ServerResponse(req))
}

describe('normalizeIp', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    [' 1.2.3.4 ', '1.2.3.4'],
    ['1.2.3.4:5678', '1.2.3.4'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['::FFFF:7f00:1', '127.0.0.1'],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:0db8:0000:0000:0001:0000:0000:0001', '2001:db8::1:0:0:1'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['::1', '::1'],
    ['::', '::'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2:3:4:5:6'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected)
  })

  it.each([undefined, null, '', 'unknown', '1.2.3', '256.1.1.1', '2001:db8::1::2', 'example.com', '1.2.3.4, 5.6.7.8'])(
    'rejects %s',
    (raw) => {
      expect(normalizeIp(raw)).toBeNull()
    },
  )
})

describe('isLoopbackIp', () => {
  it('recognizes IPv4 and IPv6 loopback only', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true)
    expect(isLoopbackIp('127.1.2.3')).toBe(true)
    expect(isLoopbackIp('::1')).toBe(true)
    expect(isLoopbackIp('10.0.0.1')).toBe(false)
    expect(isLoopbackIp('::2')).toBe(false)
  })
})

describe('getClientIp', () => {
  it('trusts the first X-Forwarded-For entry from a loopback peer', () => {
    expect(getClientIp(eventFrom('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(eventFrom('::1', { 'x-forwarded-for': '2001:db8::5, 10.0.0.1' }))).toBe('2001:db8::5')
    expect(getClientIp(eventFrom('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.9' }))).toBe('198.51.100.9')
  })

  it('ignores X-Forwarded-For from non-loopback peers', () => {
    expect(getClientIp(eventFrom('192.0.2.10', { 'x-forwarded-for': '203.0.113.7' }))).toBe('192.0.2.10')
  })

  it('falls back to the socket address when the header is missing or invalid', () => {
    expect(getClientIp(eventFrom('127.0.0.1'))).toBe('127.0.0.1')
    expect(getClientIp(eventFrom('127.0.0.1', { 'x-forwarded-for': 'garbage' }))).toBe('127.0.0.1')
    expect(getClientIp(eventFrom(undefined))).toBeNull()
  })
})

describe('limiterKeysForIp', () => {
  it('keys IPv4 by address', () => {
    expect(limiterKeysForIp('203.0.113.7')).toEqual({ ip: 'ip:203.0.113.7', net: 'ip:203.0.113.7' })
  })

  it('aggregates IPv6 to its /64', () => {
    const a = limiterKeysForIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    const b = limiterKeysForIp('2001:db8:1:2::1')
    expect(a.net).toBe('net:2001:db8:1:2::/64')
    expect(b.net).toBe(a.net)
    expect(a.ip).not.toBe(b.ip)
    expect(limiterKeysForIp('2001:db8::1').net).toBe('net:2001:db8::/64')
  })

  it('maps IPv4-mapped IPv6 to the IPv4 key and handles unknown peers', () => {
    expect(limiterKeysForIp('::ffff:203.0.113.7').net).toBe('ip:203.0.113.7')
    expect(limiterKeysForIp(null)).toEqual({ ip: 'ip:unknown', net: 'ip:unknown' })
  })
})

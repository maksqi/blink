import { randomBytes, randomUUID } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import { expect, test } from '@playwright/test'
import { connectTls, rawRequest, smoke } from './support'

const TWO_MB = Buffer.alloc(2 * 1024 * 1024, 'a')

// A same-origin browser request (the app refuses cross-site POSTs with 403 before routing).
const SAME_ORIGIN = { origin: smoke.baseURL, 'sec-fetch-site': 'same-origin' }

test('LiveKit webhooks and RoomService are not reachable from outside', async ({ request }) => {
  for (const method of ['GET', 'POST'] as const) {
    const webhook = await request.fetch('/api/webhooks/livekit', {
      method,
      headers: SAME_ORIGIN,
      data: method === 'POST' ? '{}' : undefined,
    })
    expect(webhook.status(), `${method} /api/webhooks/livekit`).toBe(404)
  }
  // Caddy never proxies /twirp to LiveKit: the request reaches the app (its CSP header shows it), which has no such
  // route. LiveKit itself would answer with a Twirp error such as {"code":"unauthenticated"}.
  for (const method of ['GET', 'POST'] as const) {
    const twirp = await request.fetch('/twirp/livekit.RoomService/ListRooms', {
      method,
      headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
      data: method === 'POST' ? '{}' : undefined,
    })
    expect(twirp.status(), `${method} /twirp/livekit.RoomService/ListRooms`).toBe(404)
    expect(twirp.headers()['content-security-policy'], 'answered by the app').toBeTruthy()
    expect(await twirp.text()).not.toMatch(
      /"code"\s*:\s*"(unauthenticated|permission_denied|malformed|bad_route|not_found)"/,
    )
  }
})

test('request bodies over 1 MB are refused with 413', async () => {
  // Content-Length is declared: whichever answers first (Caddy counting the bytes, or the app's own size check), the
  // answer is 413. Same-origin headers, as a browser sends them, so the CSRF check does not answer 403 first.
  const response = await rawRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN },
    body: TWO_MB,
  })
  expect(response.status).toBe(413)
})

test('a chunked body without Content-Length is limited by Caddy', async () => {
  // The app's own size check sees only Content-Length; Caddy counts the bytes while the handler reads the body.
  const response = await rawRequest({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'content-type': 'application/json', ...SAME_ORIGIN },
    body: TWO_MB,
    chunked: true,
  })
  // A handler that answers before reading (the W0a stub) can beat Caddy to it; the real login handler reads the body.
  test.skip(response.status === 501, '/api/auth/login is still a stub that answers before reading the body (Stage 02)')
  expect(response.status).toBe(413)
  // Refused by Caddy itself: the app's headers (CSP) are missing, Caddy's HSTS is not.
  expect(response.headers['content-security-policy']).toBeUndefined()
  expect(response.headers['strict-transport-security']).toBeTruthy()
})

test('recording chunks may be larger than 1 MB', async () => {
  const response = await rawRequest({
    method: 'PUT',
    path: `/api/recordings/${randomUUID()}/chunks/0`,
    headers: { 'content-type': 'application/octet-stream', ...SAME_ORIGIN },
    body: TWO_MB,
  })
  // Whatever the app answers (no session, unknown recording): Caddy's 20 MB limit applies here, not the 1 MB one.
  expect(response.status).not.toBe(413)
})

test('DOMAIN serves a certificate from the configured CA', async () => {
  const socket = await connectTls(smoke.domain)
  try {
    expect(socket.authorized).toBe(true)
    expect(socket.getPeerCertificate().subjectaltname).toContain(`DNS:${smoke.domain}`)
  } finally {
    socket.destroy()
  }
})

test('TURN_DOMAIN serves its own certificate and reaches LiveKit TURN with PROXY protocol, never HTTP', async () => {
  const turnDomain = smoke.turnDomain()

  // STUN Binding over TLS on port 443: Caddy's layer4 route terminates TLS and forwards to LiveKit's TURN listener
  // with PROXY protocol v2. The mapped address LiveKit reports is this very socket, so PROXY protocol carried it.
  const socket = await connectTls(turnDomain)
  try {
    expect(socket.authorized).toBe(true)
    expect(socket.getPeerCertificate().subjectaltname).toContain(`DNS:${turnDomain}`)
    const mapped = await stunBinding(socket)
    expect(mapped).toEqual({ address: socket.localAddress?.replace(/^::ffff:/, ''), port: socket.localPort })
  } finally {
    socket.destroy()
  }

  // An HTTP request with the TURN name gets no HTTP response (the bytes go to TURN, which drops them).
  const http = await connectTls(turnDomain)
  try {
    const reply = await readUntilClosed(
      http,
      `GET / HTTP/1.1\r\nHost: ${turnDomain}\r\nConnection: close\r\n\r\n`,
      3_000,
    )
    expect(reply.startsWith('HTTP/'), `unexpected HTTP answer: ${reply.slice(0, 80)}`).toBe(false)
  } finally {
    http.destroy()
  }
})

const MAGIC_COOKIE = 0x2112a442

/** Sends a STUN Binding request (RFC 8489) and returns the XOR-MAPPED-ADDRESS of the success response. */
function stunBinding(socket: TLSSocket): Promise<{ address: string; port: number }> {
  const transactionId = randomBytes(12)
  const request = Buffer.alloc(20)
  request.writeUInt16BE(0x0001, 0) // Binding request
  request.writeUInt16BE(0, 2)
  request.writeUInt32BE(MAGIC_COOKIE, 4)
  transactionId.copy(request, 8)

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => reject(new Error('no STUN response within 5 s')), 5_000)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < 20 || buffer.length < 20 + buffer.readUInt16BE(2)) return
      clearTimeout(timer)
      if (buffer.readUInt16BE(0) !== 0x0101 || !buffer.subarray(8, 20).equals(transactionId)) {
        reject(
          new Error(`not a Binding success response for this transaction: ${buffer.subarray(0, 20).toString('hex')}`),
        )
        return
      }
      for (let offset = 20; offset + 4 <= buffer.length;) {
        const type = buffer.readUInt16BE(offset)
        const length = buffer.readUInt16BE(offset + 2)
        const value = buffer.subarray(offset + 4, offset + 4 + length)
        if (type === 0x0020 && value[1] === 0x01) {
          const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16)
          const ip = (value.readUInt32BE(4) ^ MAGIC_COOKIE) >>> 0
          resolve({ address: [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'), port })
          return
        }
        offset += 4 + Math.ceil(length / 4) * 4
      }
      reject(new Error('the Binding response has no IPv4 XOR-MAPPED-ADDRESS'))
    })
    socket.once('error', reject)
    socket.write(request)
  })
}

/** Writes `data` and collects everything the server sends until it closes the connection or `ms` pass. */
function readUntilClosed(socket: TLSSocket, data: string, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let reply = ''
    const done = () => resolve(reply)
    const timer = setTimeout(done, ms)
    socket.on('data', (chunk: Buffer) => {
      reply += chunk.toString('latin1')
    })
    socket.once('close', () => {
      clearTimeout(timer)
      done()
    })
    socket.once('error', () => {})
    socket.write(data)
  })
}

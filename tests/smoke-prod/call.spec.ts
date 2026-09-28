import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect, firefox, test, type Browser, type Page } from '@playwright/test'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { smoke } from './support'

/**
 * Transport-level call (decision, until the /m/[slug] UI exists; Stage 10 switches this to the real UI flow): the room
 * is created through RoomService on loopback, tokens are minted here, and livekit-client's UMD build is injected into
 * a same-origin page. That injection is the only reason this spec (and no other) runs with bypassCSP. Signaling goes
 * through Caddy (wss://DOMAIN/rtc), media straight to LiveKit on the host network.
 */

const LIVEKIT_UMD = readFileSync(
  resolve(process.cwd(), 'node_modules/livekit-client/dist/livekit-client.umd.js'),
  'utf8',
)

interface Received {
  videoBytes: number
  framesDecoded: number
  audioBytes: number
}

interface Candidate {
  address: string
  port: number
  protocol: string
  candidateType: string
}

test('a Chromium and a Firefox participant exchange audio and video through Caddy and LiveKit', async () => {
  test.setTimeout(150_000)
  const roomName = `smoke-${Date.now()}-${randomBytes(3).toString('hex')}`
  const rooms = new RoomServiceClient(smoke.livekitUrl(), smoke.livekitKey(), smoke.livekitSecret())
  // LiveKit runs with room.auto_create false: an unknown room cannot be joined.
  await rooms.createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: 2 })

  const browsers: Browser[] = []
  try {
    const chrome = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })
    browsers.push(chrome)
    const fox = await firefox.launch({
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
        'media.autoplay.default': 0,
      },
    })
    browsers.push(fox)

    const participants: [string, Page][] = [
      ['chromium', await enterRoom(chrome, 'smoke-chromium', roomName, ['camera', 'microphone'])],
      ['firefox', await enterRoom(fox, 'smoke-firefox', roomName, [])],
    ]

    for (const [name, page] of participants) {
      await expect
        .poll(
          async () => {
            const now = await received(page)
            return now.videoBytes > 0 && now.audioBytes > 0 && now.framesDecoded > 0
          },
          { timeout: 60_000, message: `${name} decodes the other side's video and receives its audio` },
        )
        .toBe(true)
      // Media keeps flowing.
      const before = await received(page)
      await page.waitForTimeout(2_000)
      const after = await received(page)
      expect(after.framesDecoded, `${name}: remote video frames keep arriving`).toBeGreaterThan(before.framesDecoded)
      expect(after.audioBytes, `${name}: remote audio keeps arriving`).toBeGreaterThan(before.audioBytes)
    }

    // What the SFU offered: every IPv4 host candidate is LIVEKIT_NODE_IP (so no Docker bridge address leaks) and every
    // UDP one uses a port from the configured range. LiveKit also offers the host's own IPv6 addresses.
    const [start, end] = smoke.rtcPortRange()
    for (const [name, page] of participants) {
      const { offered, selected } = await sfuCandidates(page)
      const detail = JSON.stringify({ offered, selected })
      test.info().annotations.push({ type: `SFU candidates (${name})`, description: detail })
      const ipv4 = offered.filter((candidate) => /^\d+\.\d+\.\d+\.\d+$/.test(candidate.address))
      expect(ipv4.length, `${name}: the SFU offers IPv4 candidates: ${detail}`).toBeGreaterThan(0)
      for (const candidate of ipv4) {
        expect(candidate.address, `${name}: IPv4 candidates advertise LIVEKIT_NODE_IP: ${detail}`).toBe(smoke.nodeIp())
      }
      for (const candidate of offered.filter((c) => c.protocol === 'udp')) {
        expect(candidate.port, `${name}: UDP media ports are in ${start}-${end}: ${detail}`).toBeGreaterThanOrEqual(
          start,
        )
        expect(candidate.port, `${name}: UDP media ports are in ${start}-${end}: ${detail}`).toBeLessThanOrEqual(end)
      }
      expect(
        selected.length,
        `${name}: every connection to the SFU has a selected candidate pair: ${detail}`,
      ).toBeGreaterThan(0)
    }
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()))
    await rooms.deleteRoom(roomName).catch(() => {})
  }
})

async function token(identity: string, roomName: string): Promise<string> {
  const accessToken = new AccessToken(smoke.livekitKey(), smoke.livekitSecret(), {
    identity,
    name: identity,
    ttl: '10m',
  })
  accessToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })
  return accessToken.toJwt()
}

async function enterRoom(browser: Browser, identity: string, roomName: string, permissions: string[]): Promise<Page> {
  const context = await browser.newContext({
    baseURL: smoke.baseURL,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    permissions,
  })
  const page = await context.newPage()
  // Any page of the app gives the origin; the client library is injected into it.
  await page.goto('/login')
  // Keep a reference to every peer connection, for the full ICE statistics (a receiver reports only its own pair).
  await page.evaluate(() => {
    const connections: RTCPeerConnection[] = []
    const Original = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = class extends Original {
      constructor(configuration?: RTCConfiguration) {
        super(configuration)
        connections.push(this)
      }
    }
    ;(globalThis as unknown as { __smokePeerConnections: RTCPeerConnection[] }).__smokePeerConnections = connections
  })
  await page.addScriptTag({ content: LIVEKIT_UMD })
  await page.evaluate(
    async ({ url, jwt }) => {
      // The part of the UMD global this page uses.
      type Attachable = { attach(): HTMLMediaElement }
      interface Client {
        Room: new () => {
          on(event: string, listener: (track: Attachable) => void): void
          connect(url: string, token: string): Promise<void>
          localParticipant: { enableCameraAndMicrophone(): Promise<void> }
        }
        RoomEvent: { TrackSubscribed: string }
      }
      const client = (globalThis as unknown as { LivekitClient: Client }).LivekitClient
      const room = new client.Room()
      ;(globalThis as unknown as { __smokeRoom: unknown }).__smokeRoom = room
      // Attached elements keep the remote tracks decoding.
      room.on(client.RoomEvent.TrackSubscribed, (track: Attachable) => {
        const element = track.attach()
        element.muted = true
        document.body.append(element)
      })
      await room.connect(url, jwt)
      await room.localParticipant.enableCameraAndMicrophone()
    },
    { url: `wss://${smoke.domain}`, jwt: await token(identity, roomName) },
  )
  return page
}

/** Bytes and frames received from the remote participant's tracks so far. */
function received(page: Page): Promise<Received> {
  return page.evaluate(async () => {
    type Stats = { bytesReceived?: number; framesDecoded?: number } | undefined
    type Publication = { kind: string; track?: { getReceiverStats(): Promise<Stats> } }
    type Room = { remoteParticipants: Map<string, { trackPublications: Map<string, Publication> }> }
    const room = (globalThis as unknown as { __smokeRoom: Room }).__smokeRoom
    const result = { videoBytes: 0, framesDecoded: 0, audioBytes: 0 }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const stats = await publication.track?.getReceiverStats()
        if (publication.kind === 'video') {
          result.videoBytes += stats?.bytesReceived ?? 0
          result.framesDecoded += stats?.framesDecoded ?? 0
        } else if (publication.kind === 'audio') {
          result.audioBytes += stats?.bytesReceived ?? 0
        }
      }
    }
    return result
  })
}

/**
 * The SFU's side of every peer connection of the page (publisher and subscriber): the host candidates it offered and
 * the remote candidate of each selected pair.
 */
function sfuCandidates(page: Page): Promise<{ offered: Candidate[]; selected: Candidate[] }> {
  return page.evaluate(async () => {
    type Stat = Record<string, unknown>
    const toCandidate = (stat: Stat) => ({
      address: String(stat.address ?? stat.ip),
      port: Number(stat.port),
      protocol: String(stat.protocol),
      candidateType: String(stat.candidateType),
    })
    const connections = (globalThis as unknown as { __smokePeerConnections: RTCPeerConnection[] })
      .__smokePeerConnections
    const offered: Candidate[] = []
    const selected: Candidate[] = []
    for (const connection of connections) {
      if (connection.connectionState !== 'connected') continue
      const report = await connection.getStats()
      const stats = [...report.values()] as Stat[]
      offered.push(...stats.filter((s) => s.type === 'remote-candidate' && s.candidateType === 'host').map(toCandidate))
      // Chromium names the selected pair on the transport; Firefox flags it.
      const transport = stats.find((s) => s.type === 'transport' && typeof s.selectedCandidatePairId === 'string')
      const pair = transport
        ? (report.get(transport.selectedCandidatePairId as string) as Stat | undefined)
        : stats.find((s) => s.type === 'candidate-pair' && s.selected === true)
      const remote = pair ? (report.get(pair.remoteCandidateId as string) as Stat | undefined) : undefined
      if (remote) selected.push(toCandidate(remote))
    }
    return { offered, selected }
  })
}

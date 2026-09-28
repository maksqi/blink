/**
 * DB-backed join fixture (owner: rooms-backend, Stage 04): real rooms, invites and joins through the real API, so
 * in-call endpoints and webhooks see real `call_participants` rows.
 *
 *   test('host admits a guest', async ({ rooms, browser }) => {
 *     const host = await rooms.createUser()
 *     const room = await rooms.createRoom(host, { waitingRoom: true })
 *     const hostJoin = await rooms.join(room, host)                         // 200: the meeting starts
 *     const guest = await rooms.join(room, { guest: 'Grace' }, { inviteToken: await rooms.createInvite(room, host) })
 *     await rooms.admit(room, host, guest.requestId!)                        // or the host UI does it
 *     const grant = await rooms.waitForAdmission(guest)                      // reads the waiting-room SSE
 *     const context = await browser.newContext()
 *     await rooms.useIdentity(context, guest)                                // guest cookie for in-call APIs
 *     await (await context.newPage()).goto(rooms.harnessPath(room, grant, 'Grace'))
 *   })
 *
 * - Users and their sessions are rows written straight to the E2E database (`DATABASE_URL`); rooms, co-hosts, invites
 *   and joins go through `POST /api/rooms`, `/cohosts`, `/invites` and `/api/join/:slug`.
 * - API calls go to the app directly (`127.0.0.1:$E2E_APP_PORT`, else the public origin) with `Origin` = the public
 *   origin and a unique `X-Forwarded-For` per actor, so per-IP join limits never leak between tests.
 * - Room keys, proofs, invite and LiveKit tokens and session cookies are registered with `secrets.track()`.
 * - `harnessPath(room, grant, name)`: the call-core harness `/dev/call#url=…&token=…&k=…&epoch=…&slug=…&name=…`.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildRoomLink } from '../../../app/lib/e2ee/fragment'
import { deriveJoinProof, encodeRoomKey, generateRoomKey, generateSlug, type RoomKey } from '../../../app/lib/e2ee/keys'
import { sessions, users } from '../../../server/database/schema'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import { test as guarded } from './base'

const DAY = 24 * 3_600_000

export interface E2eUser {
  id: string
  email: string
  displayName: string
  /** Session cookie of this user (name and raw token). */
  cookie: { name: string; value: string }
  /** Unique client IP of this actor (`X-Forwarded-For`). */
  ip: string
}

export interface E2eGuest {
  guest: string
  ip?: string
}

export interface E2eRoom {
  id: string
  slug: string
  name: string
  /** base64url room key K (as in `#k=`). */
  key: string
  keyBytes: RoomKey
  proof: string
  /** Host link `${PUBLIC_URL}/m/<slug>#k=<K>`. */
  link: string
}

export interface JoinGrantData {
  token: string
  url: string
  epoch: string
  identity: string
  role: 'host' | 'cohost' | 'participant'
  roomId: string
}

export interface JoinResult {
  status: 'admitted' | 'waiting'
  grant?: JoinGrantData
  requestId?: string
  clientId: string
  /** Session or guest cookie that owns the join (use it for SSE and in-call APIs). */
  cookie: { name: string; value: string }
  ip: string
}

export interface RoomSettingsInput {
  name: string
  waitingRoom: boolean
  allowGuests: boolean
  muteOnJoin: boolean
  allowSelfUnmute: boolean
  screenSharePolicy: 'everyone' | 'hosts'
  chatEnabled: boolean
  maxParticipants: number
  ephemeral: boolean
  password: string
}

export interface JoinOptions {
  inviteToken?: string
  password?: string
  clientId?: string
}

export interface RoomsFixture {
  createUser(options?: { displayName?: string; role?: 'admin' | 'user' }): Promise<E2eUser>
  createRoom(owner: E2eUser, settings?: Partial<RoomSettingsInput>): Promise<E2eRoom>
  addCohost(room: E2eRoom, owner: E2eUser, cohost: E2eUser): Promise<void>
  /** Creates a room invite as `by` (owner or co-host) and returns its token. */
  createInvite(room: E2eRoom, by: E2eUser, options?: { expiresIn?: '1h' | '24h' | '7d' | 'never'; maxUses?: number | null }): Promise<string>
  /** Invite link `${PUBLIC_URL}/m/<slug>#k=<K>&t=<token>`. */
  inviteLink(room: E2eRoom, inviteToken: string): string
  /** `POST /api/join/:slug` as a user or a guest; throws on anything but 200 or 202. */
  join(room: E2eRoom, as: E2eUser | E2eGuest, options?: JoinOptions): Promise<JoinResult>
  /** The raw join response (status and body), for negative cases. */
  tryJoin(room: E2eRoom, as: E2eUser | E2eGuest, options?: JoinOptions): Promise<{ status: number; body: Record<string, unknown> }>
  /** Admits a waiting request as a moderator who is in the meeting. */
  admit(room: E2eRoom, moderator: E2eUser, requestId: string): Promise<void>
  /** Reads the owner's waiting-room SSE until `admitted` (returns the grant); throws on `denied` or `ended`. */
  waitForAdmission(result: JoinResult, timeoutMs?: number): Promise<JoinGrantData>
  /** An in-call API call as the owner of a join, e.g. `callApi(guest, room, 'POST', '/me/hand', { raised: true })`. */
  callApi(who: JoinResult | E2eUser, room: E2eRoom, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>
  /** Puts the session or guest cookie into a browser context (for pages that call the API themselves). */
  useIdentity(context: BrowserContext, who: E2eUser | JoinResult): Promise<void>
  harnessPath(room: E2eRoom, grant: JoinGrantData, name: string): string
}

function publicOrigin(): string {
  return new URL(process.env.PUBLIC_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:8080').origin
}

function apiOrigin(): string {
  const port = process.env.E2E_APP_PORT
  return port ? `http://127.0.0.1:${port}` : publicOrigin()
}

function secureCookies(): boolean {
  return publicOrigin().startsWith('https:')
}

function sessionCookieName(): string {
  return secureCookies() ? '__Host-blinq_session' : 'blinq_session'
}

function guestCookieName(slug: string): string {
  return `${secureCookies() ? '__Host-' : ''}blinq_g_${slug}`
}

/** A documentation-range IPv6 /64 per actor (the app keys per-IP limits by /64). */
function uniqueIp(): string {
  const group = () => randomBytes(2).toString('hex')
  return `2001:db8:${group()}:${group()}::1`
}

function newClientId(): string {
  return randomBytes(16).toString('base64url')
}

interface ApiCall {
  method: string
  path: string
  body?: unknown
  cookie?: { name: string; value: string }
  ip: string
}

async function api(call: ApiCall): Promise<{ status: number; body: Record<string, unknown>; setCookies: string[] }> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-forwarded-for': call.ip }
  if (call.method !== 'GET') headers.origin = publicOrigin()
  if (call.cookie) headers.cookie = `${call.cookie.name}=${call.cookie.value}`
  if (call.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(new URL(call.path, apiOrigin()), {
    method: call.method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
  })
  const text = await res.text()
  const json = text && (res.headers.get('content-type') ?? '').includes('json')
  return { status: res.status, body: json ? (JSON.parse(text) as Record<string, unknown>) : {}, setCookies: res.headers.getSetCookie() }
}

function expectStatus(res: { status: number; body: unknown }, expected: number[], what: string): void {
  if (!expected.includes(res.status)) throw new Error(`${what} answered ${res.status}: ${JSON.stringify(res.body)}`)
}

function isUser(who: E2eUser | E2eGuest): who is E2eUser {
  return 'id' in who
}

function joinBody(room: E2eRoom, as: E2eUser | E2eGuest, clientId: string, options: JoinOptions) {
  return {
    proof: room.proof,
    clientId,
    ...(options.inviteToken ? { inviteToken: options.inviteToken } : {}),
    ...(options.password ? { password: options.password } : {}),
    ...(isUser(as) ? {} : { displayName: as.guest }),
  }
}

/** The value of `event:` and `data:` in one SSE block. */
function parseSseBlock(block: string): { event?: string; data?: string } {
  const out: { event?: string; data?: string } = {}
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) out.event = line.slice(6).trim()
    else if (line.startsWith('data:')) out.data = line.slice(5).trim()
  }
  return out
}

export const test = guarded.extend<{ rooms: RoomsFixture }, { e2eDb: ReturnType<typeof drizzle> }>({
  e2eDb: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here
    async ({}, use) => {
      const url = process.env.DATABASE_URL
      if (!url) throw new Error('DATABASE_URL is not set: run E2E with sh scripts/e2e.sh (docs/TESTING.md §6.2)')
      const client = postgres(url, { max: 2, idle_timeout: 5, onnotice: () => {} })
      await use(drizzle({ client, casing: 'snake_case' }))
      await client.end({ timeout: 5 })
    },
    { scope: 'worker' },
  ],

  rooms: async ({ e2eDb, secrets }, use) => {
    const fixture: RoomsFixture = {
      async createUser(options = {}) {
        const displayName = options.displayName ?? `User ${randomBytes(3).toString('hex')}`
        const [user] = await e2eDb
          .insert(users)
          .values({
            email: `e2e-${randomUUID()}@example.test`,
            displayName,
            role: options.role ?? 'user',
            passwordHash: null,
            emailVerifiedAt: new Date(),
          })
          .returning()
        const token = randomToken()
        const now = new Date()
        await e2eDb.insert(sessions).values({
          id: hashToken(token),
          userId: user!.id,
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + 30 * DAY),
          userAgent: 'e2e-fixture',
        })
        secrets.track(token, 'session token')
        return { id: user!.id, email: user!.email, displayName, cookie: { name: sessionCookieName(), value: token }, ip: uniqueIp() }
      },

      async createRoom(owner, settings = {}) {
        const keyBytes = generateRoomKey()
        const slug = generateSlug()
        const proof = await deriveJoinProof(keyBytes, slug)
        const key = encodeRoomKey(keyBytes)
        secrets.track(key, 'room key')
        secrets.track(proof, 'join proof')
        const { name, ...rest } = settings
        const res = await api({
          method: 'POST',
          path: '/api/rooms',
          body: { slug, name: name ?? `E2E room ${randomBytes(3).toString('hex')}`, proof, ...rest },
          cookie: owner.cookie,
          ip: owner.ip,
        })
        expectStatus(res, [201], 'POST /api/rooms')
        const room = res.body.room as { id: string; name: string }
        return { id: room.id, slug, name: room.name, key, keyBytes, proof, link: buildRoomLink(publicOrigin(), slug, keyBytes) }
      },

      async addCohost(room, owner, cohost) {
        const res = await api({
          method: 'POST',
          path: `/api/rooms/${room.id}/cohosts`,
          body: { userId: cohost.id },
          cookie: owner.cookie,
          ip: owner.ip,
        })
        expectStatus(res, [200], 'POST /api/rooms/:id/cohosts')
      },

      async createInvite(room, by, options = {}) {
        const res = await api({
          method: 'POST',
          path: `/api/rooms/${room.id}/invites`,
          body: { expiresIn: options.expiresIn ?? '24h', maxUses: options.maxUses ?? null },
          cookie: by.cookie,
          ip: by.ip,
        })
        expectStatus(res, [201], 'POST /api/rooms/:id/invites')
        const token = (res.body.invite as { token: string }).token
        secrets.track(token, 'room invite token')
        return token
      },

      inviteLink(room, inviteToken) {
        return buildRoomLink(publicOrigin(), room.slug, room.keyBytes, inviteToken)
      },

      async tryJoin(room, as, options = {}) {
        const res = await api({
          method: 'POST',
          path: `/api/join/${room.slug}`,
          body: joinBody(room, as, options.clientId ?? newClientId(), options),
          cookie: isUser(as) ? as.cookie : undefined,
          ip: isUser(as) ? as.ip : (as.ip ?? uniqueIp()),
        })
        return { status: res.status, body: res.body }
      },

      async join(room, as, options = {}) {
        const ip = isUser(as) ? as.ip : (as.ip ?? uniqueIp())
        const clientId = options.clientId ?? newClientId()
        const res = await api({
          method: 'POST',
          path: `/api/join/${room.slug}`,
          body: joinBody(room, as, clientId, options),
          cookie: isUser(as) ? as.cookie : undefined,
          ip,
        })
        expectStatus(res, [200, 202], `POST /api/join/${room.slug}`)
        let cookie = isUser(as) ? as.cookie : undefined
        if (!cookie) {
          const name = guestCookieName(room.slug)
          const header = res.setCookies.find((value) => value.startsWith(`${name}=`))
          if (!header) throw new Error('the join response set no guest cookie')
          cookie = { name, value: header.slice(name.length + 1).split(';')[0]! }
          secrets.track(cookie.value, 'guest session token')
        }
        if (res.status === 200) {
          const { status: _status, ...grant } = res.body as unknown as JoinGrantData & { status: string }
          secrets.track(grant.token, 'LiveKit token')
          return { status: 'admitted', grant, clientId, cookie, ip }
        }
        return { status: 'waiting', requestId: res.body.requestId as string, clientId, cookie, ip }
      },

      async admit(room, moderator, requestId) {
        const res = await api({
          method: 'POST',
          path: `/api/calls/${room.id}/lobby/${requestId}/admit`,
          cookie: moderator.cookie,
          ip: moderator.ip,
        })
        expectStatus(res, [204], 'POST /api/calls/:roomId/lobby/:requestId/admit')
      },

      async waitForAdmission(result, timeoutMs = 15_000) {
        if (result.grant) return result.grant
        if (!result.requestId) throw new Error('not a waiting join')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetch(new URL(`/api/join/requests/${result.requestId}/events`, apiOrigin()), {
            headers: {
              accept: 'text/event-stream',
              cookie: `${result.cookie.name}=${result.cookie.value}`,
              'x-forwarded-for': result.ip,
            },
            signal: controller.signal,
          })
          if (res.status !== 200 || !res.body) throw new Error(`waiting-room SSE answered ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) throw new Error('the waiting-room stream closed without a decision')
            buffer += decoder.decode(value, { stream: true })
            let end: number
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const { event, data } = parseSseBlock(buffer.slice(0, end))
              buffer = buffer.slice(end + 2)
              if (event === 'admitted' && data) {
                const grant = JSON.parse(data) as JoinGrantData
                secrets.track(grant.token, 'LiveKit token')
                result.grant = grant
                result.status = 'admitted'
                await reader.cancel()
                return grant
              }
              if (event === 'denied' || event === 'ended') throw new Error(`the join request ended with ${event} ${data ?? ''}`)
            }
          }
        } finally {
          clearTimeout(timer)
        }
      },

      async callApi(who, room, method, path, body) {
        const res = await api({ method, path: `/api/calls/${room.id}${path}`, body, cookie: who.cookie, ip: who.ip })
        return { status: res.status, body: res.body }
      },

      async useIdentity(context, who) {
        await context.addCookies([
          {
            name: who.cookie.name,
            value: who.cookie.value,
            url: publicOrigin(),
            httpOnly: true,
            sameSite: 'Lax',
            secure: secureCookies(),
          },
        ])
      },

      harnessPath(room, grant, name) {
        const fragment = new URLSearchParams({ url: grant.url, token: grant.token, k: room.key, epoch: grant.epoch, slug: room.slug, name })
        return `/dev/call#${fragment.toString()}`
      },
    }
    await use(fixture)
  },
})

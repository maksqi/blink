/**
 * Shared helpers for the rooms, join, calls and webhooks API tests (rooms-backend). Built on the server-core harness.
 *
 * - `newClientId()`: a per-tab client id.
 * - `usesFakeLivekit()`: the harness server runs against the in-memory fake (`LIVEKIT_URL=fake://local`).
 * - `livekitCalls(roomId)`: the fake adapter's calls about one room (`GET /api/__test/livekit-calls?room=`).
 * - `joinBody(room, extra)`, `join(api, room, extra)`: `POST /api/join/:slug` with the room's real proof.
 * - `startMeeting(room, owner)`: the owner joins through the API, so the meeting and the (fake) LiveKit room exist.
 * - `joinUser(room, options)` / `joinGuest(room, options)`: a new user or guest joins with a fresh invite; returns the
 *   client (holding its session or guest cookie), the response and the participant row.
 * - `participantRow(identity)`, `sendWebhook(event, room, participant?, options?)`, `setSetting(key, value)`.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { WebhookEvent } from 'livekit-server-sdk'
import { expect } from 'vitest'
import { callParticipants, settings } from '../../../server/database/schema'
import {
  type ApiClient,
  type ApiResponse,
  createClient,
  createRoomInvite,
  createUser,
  loginAs,
  serverEnv,
  signWebhook,
  type TestRoom,
  type TestUser,
  testDb,
  uniqueName,
} from '../_harness'

export interface FakeCall {
  method: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[]
  at: string
}

export function newClientId(): string {
  return randomBytes(16).toString('base64url')
}

export function usesFakeLivekit(): boolean {
  return (serverEnv().LIVEKIT_URL ?? '').startsWith('fake://')
}

export async function livekitCalls(roomId: string, method?: string): Promise<FakeCall[]> {
  const res = await createClient().get('/api/__test/livekit-calls', { query: { room: roomId } })
  expect(res.status, res.text).toBe(200)
  const calls = res.body as FakeCall[]
  return method ? calls.filter((call) => call.method === method) : calls
}

export function joinBody(room: Pick<TestRoom, 'proof'>, extra: Record<string, unknown> = {}) {
  return { proof: room.proof, clientId: newClientId(), ...extra }
}

export function join(api: ApiClient, room: Pick<TestRoom, 'slug' | 'proof'>, extra: Record<string, unknown> = {}) {
  return api.post(`/api/join/${room.slug}`, { body: joinBody(room, extra) })
}

export async function participantRow(identity: string) {
  const [row] = await testDb().select().from(callParticipants).where(eq(callParticipants.lkIdentity, identity))
  return row
}

export async function requestRow(requestId: string) {
  const [row] = await testDb().select().from(callParticipants).where(eq(callParticipants.id, requestId))
  return row
}

export interface Joined {
  api: ApiClient
  user?: TestUser
  res: ApiResponse
  identity: string
  clientId: string
}

function joined(api: ApiClient, res: ApiResponse, clientId: string, user?: TestUser): Joined {
  return { api, user, res, identity: res.body?.identity, clientId }
}

export async function startMeeting(room: TestRoom, owner: TestUser): Promise<Joined> {
  const api = await loginAs(owner)
  const clientId = newClientId()
  const res = await join(api, room, { clientId })
  expect(res.status, res.text).toBe(200)
  return joined(api, res, clientId, owner)
}

export async function joinUser(
  room: TestRoom,
  options: { user?: TestUser; invite?: boolean; extra?: Record<string, unknown>; expectStatus?: number } = {},
): Promise<Joined> {
  const user = options.user ?? (await createUser())
  const api = await loginAs(user)
  const clientId = newClientId()
  const inviteToken = options.invite === false ? undefined : (await createRoomInvite(room)).token
  const res = await join(api, room, { clientId, inviteToken, ...options.extra })
  if (options.expectStatus !== undefined) expect(res.status, res.text).toBe(options.expectStatus)
  return joined(api, res, clientId, user)
}

export async function joinGuest(
  room: TestRoom,
  options: { api?: ApiClient; name?: string; invite?: boolean; extra?: Record<string, unknown>; expectStatus?: number } = {},
): Promise<Joined> {
  const api = options.api ?? createClient()
  const clientId = newClientId()
  const inviteToken = options.invite === false ? undefined : (await createRoomInvite(room)).token
  const res = await join(api, room, { clientId, inviteToken, displayName: options.name ?? uniqueName('Guest'), ...options.extra })
  if (options.expectStatus !== undefined) expect(res.status, res.text).toBe(options.expectStatus)
  return joined(api, res, clientId)
}

export async function sendWebhook(
  event: 'participant_joined' | 'participant_left' | 'room_started' | 'room_finished' | 'track_published',
  room: { id: string; sid?: string },
  participant?: { identity: string; joinedAtMs?: number },
  options: { id?: string; apiSecret?: string; tamper?: boolean } = {},
): Promise<ApiResponse> {
  const webhook = new WebhookEvent({
    id: options.id ?? `EV_${randomUUID()}`,
    createdAt: BigInt(Math.floor(Date.now() / 1000)),
    room: { name: room.id, sid: room.sid ?? '' },
    participant: participant
      ? {
          identity: participant.identity,
          sid: `PA_${randomBytes(4).toString('hex')}`,
          joinedAtMs: BigInt(participant.joinedAtMs ?? Date.now()),
          joinedAt: BigInt(Math.floor((participant.joinedAtMs ?? Date.now()) / 1000)),
        }
      : undefined,
  })
  // The SDK's WebhookEvent constructor drops `event` (a subclass field initializer resets it): assign it afterwards.
  webhook.event = event
  const body = webhook.toJsonString()
  const authorization = await signWebhook(body, undefined, options.apiSecret)
  return createClient().post('/api/webhooks/livekit', {
    raw: options.tamper ? body.replace(room.id, randomUUID()) : body,
    origin: null,
    headers: { 'content-type': 'application/webhook+json', authorization },
  })
}

/**
 * Writes an admin setting straight to the database and waits until the server's settings cache (≤ 5 s) shows it
 * through GET /api/config. Pass `null` to restore the default.
 */
export async function setSetting(key: 'guests.allowed', value: boolean | null): Promise<void> {
  const db = testDb()
  if (value === null) await db.delete(settings).where(eq(settings.key, key))
  else {
    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
  }
  const expected = value ?? true
  const deadline = Date.now() + 10_000
  for (;;) {
    const config = await createClient().get('/api/config')
    if (config.body?.guestsAllowed === expected) return
    if (Date.now() > deadline) throw new Error(`setting ${key} did not reach the server`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

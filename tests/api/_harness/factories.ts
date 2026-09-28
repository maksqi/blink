/**
 * Test data factories. They write straight to the test database (unique data per call) and mirror the server's
 * storage rules: sha256 of opaque tokens (`hashToken`), argon2id passwords (cheap test cost), join proofs derived with
 * app/lib/e2ee from a known room key, room invite tokens per docs/API.md §14.
 *
 * - `createUser(options)`, `createAdmin(options)` → `TestUser` (with its plain `password`)
 * - `createSession(userId, times?)` → `{ id, token, cookieName, cookie }`; `loginAs(user, client?)` → client holding it
 * - `createRoom(owner, options)` → room row + `key`, `keyBytes`, `proof`, `link`
 * - `createRoomInvite(room, options)` → `{ id, token, row }`; `createInvite(options)` (account invite) → `{ id, token, row }`
 * - `createMeeting(room, options)`, `createGuestSession(room, options)`, `createParticipant(options)`
 * The server caches validated sessions for 30 s: age or revoke rows before the first request that uses them.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { buildRoomLink, deriveJoinProof, encodeRoomKey, generateRoomKey, generateSlug } from '../../../app/lib/e2ee'
import {
  callParticipants,
  guestSessions,
  meetings,
  roomInvites,
  rooms,
  sessions,
  userInvites,
  users,
} from '../../../server/database/schema'
import { guestCookieName, sessionCookieName } from '../../../server/utils/cookies'
import {
  deriveRoomInviteKey,
  encodeRoomInviteToken,
  hashToken,
  randomToken,
} from '../../../server/utils/crypto'
import { hashPassword } from '../../../server/utils/password'
import { type ApiClient, createClient } from './client'
import { apiBaseUrl, serverEnv } from './context'
import { testDb } from './database'

const DAY = 24 * 3_600_000
const FAST_ARGON2 = { testParams: { memoryCost: 1024, timeCost: 1 } }
const secure = () => new URL(apiBaseUrl()).protocol === 'https:'

export function uniqueEmail(prefix = 'u'): string {
  return `${prefix}-${randomUUID()}@example.test`
}

export function uniqueName(prefix = 'Test'): string {
  return `${prefix} ${randomBytes(4).toString('hex')}`
}

// ---- Users and sessions ---------------------------------------------------------------------------------------------

export interface TestUser {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'user'
  password: string
}

export interface CreateUserOptions {
  email?: string
  displayName?: string
  role?: 'admin' | 'user'
  password?: string
  mustChangePassword?: boolean
  emailVerified?: boolean
  disabled?: boolean
}

export async function createUser(options: CreateUserOptions = {}): Promise<TestUser> {
  const email = (options.email ?? uniqueEmail()).toLowerCase()
  const password = options.password ?? `pw-${randomBytes(9).toString('base64url')}`
  const [row] = await testDb()
    .insert(users)
    .values({
      email,
      displayName: options.displayName ?? uniqueName('User'),
      role: options.role ?? 'user',
      passwordHash: await hashPassword(password, FAST_ARGON2),
      mustChangePassword: options.mustChangePassword ?? false,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
      disabledAt: options.disabled ? new Date() : null,
    })
    .returning()
  return { id: row!.id, email: row!.email, displayName: row!.displayName, role: row!.role, password }
}

export function createAdmin(options: Omit<CreateUserOptions, 'role'> = {}): Promise<TestUser> {
  return createUser({ ...options, role: 'admin' })
}

export interface TestSession {
  id: string
  token: string
  cookieName: string
  /** Ready-made `Cookie` header value. */
  cookie: string
}

export async function createSession(
  userId: string,
  times: { createdAt?: Date; lastSeenAt?: Date; expiresAt?: Date; ip?: string | null } = {},
): Promise<TestSession> {
  const token = randomToken()
  const createdAt = times.createdAt ?? new Date()
  await testDb()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt,
      lastSeenAt: times.lastSeenAt ?? createdAt,
      expiresAt: times.expiresAt ?? new Date(createdAt.getTime() + 30 * DAY),
      ip: times.ip ?? null,
      userAgent: 'api-test',
    })
  const cookieName = sessionCookieName(secure())
  return { id: hashToken(token), token, cookieName, cookie: `${cookieName}=${token}` }
}

/** A client (new unless given) that holds a fresh session cookie for `user`. */
export async function loginAs(user: { id: string }, client: ApiClient = createClient()): Promise<ApiClient> {
  const session = await createSession(user.id)
  client.setCookie(session.cookieName, session.token)
  client.session = { id: session.id, token: session.token }
  return client
}

// ---- Rooms, invites, meetings, guests -------------------------------------------------------------------------------

type RoomInsert = typeof rooms.$inferInsert

export type TestRoom = typeof rooms.$inferSelect & {
  /** base64url room key K, as in the `#k=` fragment. */
  key: string
  keyBytes: Uint8Array<ArrayBuffer>
  /** Join proof P for this key and slug. */
  proof: string
  /** Host link `${PUBLIC_URL}/m/<slug>#k=<K>`. */
  link: string
}

export async function createRoom(
  owner: { id: string },
  options: Partial<Omit<RoomInsert, 'ownerId' | 'joinProofHash' | 'passwordHash'>> & { password?: string } = {},
): Promise<TestRoom> {
  const { password, ...columns } = options
  const keyBytes = generateRoomKey()
  const slug = columns.slug ?? generateSlug()
  const proof = await deriveJoinProof(keyBytes, slug)
  const [row] = await testDb()
    .insert(rooms)
    .values({
      name: uniqueName('Room'),
      ...columns,
      slug,
      ownerId: owner.id,
      joinProofHash: hashToken(proof),
      passwordHash: password ? await hashPassword(password, FAST_ARGON2) : null,
    })
    .returning()
  return { ...row!, key: encodeRoomKey(keyBytes), keyBytes, proof, link: buildRoomLink(apiBaseUrl(), slug, keyBytes) }
}

export async function createRoomInvite(
  room: { id: string },
  options: { label?: string; expiresAt?: Date | null; maxUses?: number | null; useCount?: number; revoked?: boolean; createdBy?: string } = {},
) {
  const [row] = await testDb()
    .insert(roomInvites)
    .values({
      roomId: room.id,
      label: options.label ?? null,
      createdBy: options.createdBy ?? null,
      expiresAt: options.expiresAt === undefined ? new Date(Date.now() + DAY) : options.expiresAt,
      maxUses: options.maxUses ?? null,
      useCount: options.useCount ?? 0,
      revokedAt: options.revoked ? new Date() : null,
    })
    .returning()
  const token = encodeRoomInviteToken(row!.id, deriveRoomInviteKey(serverEnv().APP_SECRET!))
  return { id: row!.id, token, row: row! }
}

/** Account invite (`/invite#<token>`). */
export async function createInvite(
  options: { email?: string | null; role?: 'admin' | 'user'; expiresAt?: Date; createdBy?: string; used?: boolean; revoked?: boolean } = {},
) {
  const token = randomToken()
  const [row] = await testDb()
    .insert(userInvites)
    .values({
      tokenHash: hashToken(token),
      email: options.email ? options.email.toLowerCase() : null,
      role: options.role ?? 'user',
      createdBy: options.createdBy ?? null,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * DAY),
      usedAt: options.used ? new Date() : null,
      revokedAt: options.revoked ? new Date() : null,
    })
    .returning()
  return { id: row!.id, token, row: row! }
}

export async function createMeeting(room: { id: string }, options: { endedAt?: Date | null; startedAt?: Date } = {}) {
  const [row] = await testDb()
    .insert(meetings)
    .values({
      roomId: room.id,
      epoch: randomBytes(16).toString('base64url'),
      startedAt: options.startedAt ?? new Date(),
      endedAt: options.endedAt ?? null,
    })
    .returning()
  return row!
}

export async function createGuestSession(
  room: { id: string; slug: string },
  options: { displayName?: string; expiresAt?: Date } = {},
) {
  const token = randomToken()
  const [row] = await testDb()
    .insert(guestSessions)
    .values({
      id: hashToken(token),
      roomId: room.id,
      displayName: options.displayName ?? uniqueName('Guest'),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 12 * 3_600_000),
    })
    .returning()
  const cookieName = guestCookieName(room.slug, secure())
  return { ...row!, token, cookieName, cookie: `${cookieName}=${token}` }
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function randomIdentity(): string {
  return `p_${Array.from({ length: 16 }, () => BASE62[randomInt(BASE62.length)]).join('')}`
}

export async function createParticipant(options: {
  room: { id: string }
  meeting: { id: string } | null
  userId?: string
  guestSessionId?: string
  role?: 'host' | 'cohost' | 'participant'
  status?: 'waiting' | 'admitted' | 'joined' | 'left' | 'denied' | 'removed'
  displayName?: string
  clientId?: string
}) {
  const status = options.status ?? 'joined'
  const now = new Date()
  const [row] = await testDb()
    .insert(callParticipants)
    .values({
      lkIdentity: randomIdentity(),
      roomId: options.room.id,
      meetingId: options.meeting?.id ?? null,
      userId: options.userId ?? null,
      guestSessionId: options.guestSessionId ?? null,
      clientId: options.clientId ?? randomBytes(16).toString('base64url'),
      displayName: options.displayName ?? uniqueName('Participant'),
      roomRole: options.role ?? 'participant',
      status,
      admittedAt: status === 'waiting' ? null : now,
      joinedAt: status === 'joined' ? now : null,
    })
    .returning()
  return row!
}

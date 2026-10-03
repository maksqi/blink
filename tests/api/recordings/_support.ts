/**
 * Helpers for the recording API tests (not a test file).
 *
 * - `mediaFixtures()`: runs tests/fixtures/media/generate.sh once per script version (cached in the OS temp dir).
 * - `startProcessingServer(label)`: a second test server with RECORDING_ALLOW_DISK_WORKDIR=true. The harness server
 *   runs with NODE_ENV=production and therefore refuses to transcode outside a tmpfs (macOS, CI runners); this one is
 *   identical otherwise (same database, recordings dir and keys).
 * - `liveCall(baseUrl)`: owner + room + a signed-in client; the owner joins through the join API on that server, which
 *   starts the meeting (and its LiveKit room) and creates the host row.
 * - `joinAs(...)`: another participant row (user or guest) in that meeting, with its own client.
 * - `startServerRecording`, `uploadChunks`, `waitForRecording`, `downloadFile`.
 * - `seedReadyRecording(...)`: a `ready` row whose BLQ1 file is written directly (file and access tests).
 * - `setSetting(key, value)` / `resetSetting(key)`: writes the settings table and waits until the server sees it.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { expect } from 'vitest'
import { type callParticipants, meetings, recordings, settings } from '../../../server/database/schema'
import { encryptBuffer, recordingInfo } from '../../../server/services/recordings/blq1'
import {
  createClient,
  createGuestSession,
  createParticipant,
  createRoom,
  createUser,
  loginAs,
  REPO_ROOT,
  serverEnv,
  startTestServer,
  testDb,
  type ApiClient,
  type TestServer,
  type TestUser,
} from '../_harness'
import { join as joinRoom, participantRow } from '../rooms/_support'

export const GENERATE_SCRIPT = join(REPO_ROOT, 'tests/fixtures/media/generate.sh')

export function mediaFixtures(): string {
  const script = readFileSync(GENERATE_SCRIPT)
  const dir = join(tmpdir(), `blinq-media-fixtures-${createHash('sha256').update(script).digest('hex').slice(0, 12)}`)
  if (existsSync(join(dir, '.complete'))) return dir
  const staging = `${dir}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  execFileSync('sh', [GENERATE_SCRIPT, staging], { stdio: 'pipe', env: { PATH: process.env.PATH ?? '' } })
  try {
    renameSync(staging, dir)
  } catch {
    // Another run finished first; its copy is identical.
    rmSync(staging, { recursive: true, force: true })
  }
  return dir
}

export function fixture(name: string): Buffer {
  return readFileSync(join(mediaFixtures(), name))
}

export function startProcessingServer(label: string): Promise<TestServer> {
  return startTestServer(
    { ...serverEnv(), RECORDING_ALLOW_DISK_WORKDIR: 'true' },
    { logFile: join(REPO_ROOT, 'test-results', `api-recordings-${label}.log`) },
  )
}

export function recordingsDir(): string {
  return serverEnv().RECORDINGS_DIR!
}

export function masterKey(): Buffer {
  return Buffer.from(serverEnv().RECORDING_ENCRYPTION_KEY!, 'base64')
}

export interface LiveCall {
  owner: TestUser
  room: Awaited<ReturnType<typeof createRoom>>
  meeting: typeof meetings.$inferSelect
  host: typeof callParticipants.$inferSelect
  client: ApiClient
}

/**
 * The owner joins through `POST /api/join/:slug` on `baseUrl` (default: the harness server), the way production starts
 * a meeting: the meeting row, the LiveKit room in that server's (fake) RoomService and the admitted host row. Rows
 * written by factories alone would leave the RoomService without the room, so publishRoomState (the REC indicator)
 * would fail.
 */
export async function liveCall(baseUrl?: string): Promise<LiveCall> {
  const owner = await createUser()
  const room = await createRoom(owner)
  const client = await loginAs(owner, createClient({ baseUrl }))
  const joined = await joinRoom(client, room)
  expect(joined.status, joined.text).toBe(200)
  const host = await participantRow(joined.body.identity)
  expect(host).toMatchObject({ roomId: room.id, userId: owner.id, roomRole: 'host', status: 'admitted' })
  const [meeting] = await testDb().select().from(meetings).where(eq(meetings.id, host!.meetingId!))
  return { owner, room, meeting: meeting!, host: host!, client }
}

/** Another person in the call: a user (default) or a guest, with the given role. */
export async function joinAs(
  call: LiveCall,
  options: { role: 'host' | 'cohost' | 'participant'; kind?: 'user' | 'guest'; baseUrl?: string },
) {
  const client = createClient({ baseUrl: options.baseUrl })
  if (options.kind === 'guest') {
    const guest = await createGuestSession(call.room)
    client.setCookie(guest.cookieName, guest.token)
    const row = await createParticipant({ room: call.room, meeting: call.meeting, guestSessionId: guest.id, role: options.role })
    return { client, row, user: null }
  }
  const user = await createUser()
  await loginAs(user, client)
  const row = await createParticipant({ room: call.room, meeting: call.meeting, userId: user.id, role: options.role })
  return { client, row, user }
}

export async function startServerRecording(client: ApiClient, roomId: string, mimeType = 'video/webm;codecs=vp9,opus') {
  const res = await client.post(`/api/calls/${roomId}/recording/start`, { body: { mode: 'server', mimeType, width: 1280, height: 720 } })
  expect(res.status, res.text).toBe(201)
  return res.body.recordingId as string
}

export function splitInto(data: Buffer, parts: number): Buffer[] {
  const size = Math.ceil(data.length / parts)
  return Array.from({ length: parts }, (_, i) => data.subarray(i * size, (i + 1) * size)).filter((part) => part.length > 0)
}

export function putChunk(client: ApiClient, id: string, seq: number, data: Uint8Array) {
  return client.put(`/api/recordings/${id}/chunks/${seq}`, {
    raw: new Uint8Array(data),
    headers: { 'content-type': 'application/octet-stream' },
  })
}

export async function uploadChunks(client: ApiClient, id: string, chunks: Buffer[]) {
  for (const [seq, chunk] of chunks.entries()) {
    const res = await putChunk(client, id, seq, chunk)
    expect(res.status, res.text).toBe(204)
  }
}

export async function completeUpload(client: ApiClient, id: string, chunkCount: number, durationMs = 3000) {
  const res = await client.post(`/api/recordings/${id}/complete`, { body: { chunkCount, durationMs } })
  expect(res.status, res.text).toBe(202)
  expect(res.body).toEqual({ status: 'processing' })
}

export async function waitForRecording(
  client: ApiClient,
  id: string,
  done: (recording: { status: string }) => boolean = (r) => r.status === 'ready' || r.status === 'failed',
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const res = await client.get(`/api/recordings/${id}`)
    expect(res.status, res.text).toBe(200)
    if (done(res.body.recording)) return res.body.recording
    if (Date.now() > deadline) throw new Error(`recording ${id} still ${res.body.recording.status}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

export async function downloadFile(client: ApiClient, id: string): Promise<Buffer> {
  const res = await fetch(new URL(`/api/recordings/${id}/file?download=1`, client.baseUrl), {
    headers: { cookie: client.cookieHeader(), 'x-forwarded-for': client.ip },
  })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

export async function recordingRow(id: string) {
  const [row] = await testDb().select().from(recordings).where(eq(recordings.id, id))
  return row
}

export interface SeededRecording {
  id: string
  plaintext: Buffer
  path: string
}

export async function seedReadyRecording(options: {
  createdBy: string
  roomId: string
  plaintext?: Buffer
  segmentSize?: number
  startedAt?: Date
  expiresAt?: Date | null
}): Promise<SeededRecording> {
  const id = randomUUID()
  const plaintext = options.plaintext ?? randomBytes(3000)
  const dir = join(recordingsDir(), id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'recording.blq1')
  writeFileSync(path, encryptBuffer(plaintext, { masterKey: masterKey(), info: recordingInfo(id), segmentSize: options.segmentSize }))
  const startedAt = options.startedAt ?? new Date()
  await testDb()
    .insert(recordings)
    .values({
      id,
      roomId: options.roomId,
      createdBy: options.createdBy,
      mode: 'server',
      status: 'ready',
      sourceMime: 'video/webm',
      storageKey: `${id}/recording.blq1`,
      sizeBytes: plaintext.length,
      durationMs: 3000,
      width: 320,
      height: 240,
      startedAt,
      endedAt: startedAt,
      processedAt: startedAt,
      expiresAt: options.expiresAt === undefined ? new Date(startedAt.getTime() + 30 * 86_400_000) : options.expiresAt,
    })
  return { id, plaintext, path }
}

type PublicRecordingConfig = { enabled: boolean; maxDurationMinutes: number; maxResolution: '720p' | '1080p' }

async function waitForConfig(check: (recording: PublicRecordingConfig) => boolean, baseUrl?: string) {
  const client = createClient({ baseUrl })
  const deadline = Date.now() + 15_000
  while (true) {
    const res = await client.get('/api/config')
    if (res.status === 200 && check(res.body.recording)) return
    if (Date.now() > deadline) throw new Error('the server did not pick up the settings change')
    await new Promise((r) => setTimeout(r, 250))
  }
}

/**
 * Stores public recording settings (`undefined` restores the default) and waits until the server's settings cache
 * (≤ 5 s) shows them.
 */
export async function setRecordingSettings(
  values: { enabled?: boolean; maxResolution?: '720p' | '1080p' },
  baseUrl?: string,
): Promise<void> {
  const entries = [
    ['recording.enabled', values.enabled, true],
    ['recording.maxResolution', values.maxResolution, '1080p'],
  ] as const
  for (const [key, value, fallback] of entries) {
    if (value === undefined || value === fallback) await testDb().delete(settings).where(eq(settings.key, key))
    else {
      await testDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } })
    }
  }
  await waitForConfig(
    (recording) => recording.enabled === (values.enabled ?? true) && recording.maxResolution === (values.maxResolution ?? '1080p'),
    baseUrl,
  )
}

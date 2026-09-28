/**
 * A live meeting with one row per role, for the in-call API tests: the host joins through the API (so the meeting and
 * the fake LiveKit room exist); the others are rows in that meeting with their own session or guest cookie.
 */
import { randomBytes } from 'node:crypto'
import { roomMembers } from '../../../server/database/schema'
import {
  type ApiClient,
  createClient,
  createGuestSession,
  createParticipant,
  createRoom,
  createUser,
  loginAs,
  testDb,
  type TestRoom,
} from '../_harness'
import { participantRow, startMeeting } from '../rooms/_support'

export type ActorName = 'host' | 'cohost' | 'participant' | 'guest'

export interface Member {
  api: ApiClient
  identity: string
  rowId: string
  role: 'host' | 'cohost' | 'participant'
  kind: 'user' | 'guest'
  userId: string | null
}

export interface Meeting {
  room: TestRoom
  meetingId: string
  host: Member
  cohost: Member
  /** A second co-host: the target for co-host actors. */
  cohost2: Member
  participant: Member
  /** A second participant: the target for participant actors. */
  participant2: Member
  guest: Member
}

async function userMember(room: TestRoom, meetingId: string, role: 'cohost' | 'participant'): Promise<Member> {
  const user = await createUser()
  if (role === 'cohost') await testDb().insert(roomMembers).values({ roomId: room.id, userId: user.id })
  const row = await createParticipant({ room, meeting: { id: meetingId }, userId: user.id, role, status: 'joined', displayName: user.displayName })
  return { api: await loginAs(user), identity: row.lkIdentity, rowId: row.id, role, kind: 'user', userId: user.id }
}

export async function guestMember(room: TestRoom, meetingId: string, role: 'cohost' | 'participant' = 'participant'): Promise<Member> {
  const session = await createGuestSession(room)
  const row = await createParticipant({ room, meeting: { id: meetingId }, guestSessionId: session.id, role, status: 'joined', displayName: session.displayName })
  const api = createClient().setCookie(session.cookieName, session.token)
  return { api, identity: row.lkIdentity, rowId: row.id, role, kind: 'guest', userId: null }
}

export async function liveMeeting(options: { waitingRoom?: boolean } = {}): Promise<Meeting> {
  const owner = await createUser()
  const room = await createRoom(owner, { waitingRoom: options.waitingRoom ?? false })
  const joined = await startMeeting(room, owner)
  const hostRow = await participantRow(joined.identity)
  const meetingId = hostRow!.meetingId!
  const [cohost, cohost2, participant, participant2, guest] = await Promise.all([
    userMember(room, meetingId, 'cohost'),
    userMember(room, meetingId, 'cohost'),
    userMember(room, meetingId, 'participant'),
    userMember(room, meetingId, 'participant'),
    guestMember(room, meetingId),
  ])
  const host: Member = { api: joined.api, identity: joined.identity, rowId: hostRow!.id, role: 'host', kind: 'user', userId: owner.id }
  return { room, meetingId, host, cohost: cohost!, cohost2: cohost2!, participant: participant!, participant2: participant2!, guest: guest! }
}

export async function waitingRequest(meeting: Meeting): Promise<string> {
  const session = await createGuestSession(meeting.room)
  const row = await createParticipant({ room: meeting.room, meeting: { id: meeting.meetingId }, guestSessionId: session.id, status: 'waiting' })
  return row.id
}

export function unknownIdentity(): string {
  return `p_${randomBytes(12).toString('base64url').replace(/[-_]/g, 'x').slice(0, 16)}`
}

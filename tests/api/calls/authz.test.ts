/**
 * Authorization matrix for every in-call route (docs/API.md §7, docs/SECURITY.md §10): every route × caller role ×
 * target. Expectations come from the permission matrix (`canPerform`): a role that can never perform the action gets
 * 403 CALL_FORBIDDEN before any target lookup, an unknown target 404 NOT_FOUND, acting on the host or yourself 403
 * CALL_FORBIDDEN, and anyone without a live row 403 CALL_NOT_PARTICIPANT. Allowed cases run in a fresh meeting each.
 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { canPerform, type CallAction, type CallActor } from '#shared/utils/permissions'
import { callParticipants } from '../../../server/database/schema'
import { createClient, createUser, expectApiError, loginAs, testDb } from '../_harness'
import { type ActorName, guestMember, liveMeeting, type Meeting, type Member, unknownIdentity, waitingRequest } from './_meeting'

interface Route {
  name: string
  method: 'GET' | 'POST' | 'PATCH'
  path: (roomId: string, extra: { identity?: string; requestId?: string }) => string
  action: CallAction | null
  targeted?: boolean
  lobby?: boolean
  body?: unknown
  success: number
}

const base = (roomId: string) => `/api/calls/${roomId}`
const target = (name: string, action: CallAction, body?: unknown): Route => ({
  name: `POST participants/:identity/${name}`,
  method: 'POST',
  path: (roomId, { identity }) => `${base(roomId)}/participants/${identity}/${name}`,
  action,
  targeted: true,
  body,
  success: 204,
})

const ROUTES: Route[] = [
  { name: 'POST me/name', method: 'POST', path: (r) => `${base(r)}/me/name`, action: 'self.rename', body: { displayName: 'Renamed' }, success: 204 },
  { name: 'POST me/hand', method: 'POST', path: (r) => `${base(r)}/me/hand`, action: 'self.hand', body: { raised: true }, success: 204 },
  { name: 'GET participants', method: 'GET', path: (r) => `${base(r)}/participants`, action: null, success: 200 },
  { name: 'GET lobby', method: 'GET', path: (r) => `${base(r)}/lobby`, action: 'lobby.view', success: 200 },
  { name: 'POST lobby/:id/admit', method: 'POST', path: (r, x) => `${base(r)}/lobby/${x.requestId}/admit`, action: 'lobby.admit', lobby: true, success: 204 },
  { name: 'POST lobby/:id/deny', method: 'POST', path: (r, x) => `${base(r)}/lobby/${x.requestId}/deny`, action: 'lobby.deny', lobby: true, success: 204 },
  { name: 'POST lobby/admit-all', method: 'POST', path: (r) => `${base(r)}/lobby/admit-all`, action: 'lobby.admit', success: 200 },
  target('mute', 'participant.mute', { source: 'microphone' }),
  target('permissions', 'participant.permissions', { microphone: false }),
  target('ask-unmute', 'participant.askUnmute'),
  target('volume', 'participant.volume', { level: 40 }),
  target('remove', 'participant.remove'),
  target('role', 'participant.role', { role: 'cohost' }),
  target('name', 'participant.rename', { displayName: 'Moderated' }),
  target('lower-hand', 'participant.lowerHand'),
  { name: 'POST mute-all', method: 'POST', path: (r) => `${base(r)}/mute-all`, action: 'call.muteAll', body: { preventSelfUnmute: true }, success: 204 },
  { name: 'PATCH settings (locked)', method: 'PATCH', path: (r) => `${base(r)}/settings`, action: 'call.lock', body: { locked: true }, success: 200 },
  { name: 'PATCH settings (host settings)', method: 'PATCH', path: (r) => `${base(r)}/settings`, action: 'call.settings', body: { waitingRoom: true, chatEnabled: false }, success: 200 },
  { name: 'POST end', method: 'POST', path: (r) => `${base(r)}/end`, action: 'call.end', success: 204 },
]

const ACTORS: ActorName[] = ['host', 'cohost', 'participant', 'guest']
const TARGETS = ['host', 'cohost', 'participant', 'self', 'unknown'] as const
type TargetName = (typeof TARGETS)[number]

const ACTOR_SHAPE: Record<ActorName, Omit<CallActor, 'identity'>> = {
  host: { role: 'host', kind: 'user' },
  cohost: { role: 'cohost', kind: 'user' },
  participant: { role: 'participant', kind: 'user' },
  guest: { role: 'participant', kind: 'guest' },
}

type Expected = 'ok' | 'forbidden' | 'not_found'

function expectedFor(route: Route, actorName: ActorName, targetName: TargetName | null): Expected {
  if (!route.action) return 'ok'
  const actor: CallActor = { identity: 'p_actor00000000000', ...ACTOR_SHAPE[actorName] }
  if (!canPerform(actor, route.action, { identity: 'p_someoneelse00000', role: 'participant' })) return 'forbidden'
  if (!route.targeted) return 'ok'
  if (targetName === 'unknown') return 'not_found'
  const t =
    targetName === 'self'
      ? { identity: actor.identity, role: actor.role }
      : { identity: `p_${targetName}`, role: targetName as 'host' | 'cohost' | 'participant' }
  return canPerform(actor, route.action, t) ? 'ok' : 'forbidden'
}

function targetOf(meeting: Meeting, actor: ActorName, name: TargetName): Member | null {
  switch (name) {
    case 'host':
      return meeting.host
    case 'cohost':
      return actor === 'cohost' ? meeting.cohost2 : meeting.cohost
    case 'participant':
      return actor === 'participant' ? meeting.participant2 : meeting.participant
    case 'self':
      return meeting[actor]
    default:
      return null
  }
}

const cases = ROUTES.flatMap((route) =>
  ACTORS.flatMap((actor) =>
    (route.targeted ? TARGETS : [null]).map((targetName) => ({
      label: `${route.name} as ${actor}${targetName ? ` on ${targetName}` : ''}`,
      route,
      actor,
      targetName,
      expected: expectedFor(route, actor, targetName),
    })),
  ),
)

describe('in-call authorization matrix', () => {
  let shared: Meeting
  let sharedRequest: string
  beforeAll(async () => {
    shared = await liveMeeting()
    sharedRequest = await waitingRequest(shared)
  })

  it('covers every documented in-call route except recording', () => {
    expect(ROUTES.map((route) => route.action).filter(Boolean)).toEqual(
      expect.arrayContaining(['self.rename', 'self.hand', 'lobby.view', 'lobby.admit', 'lobby.deny', 'call.muteAll', 'call.lock', 'call.settings', 'call.end']),
    )
    expect(cases.length).toBeGreaterThan(200)
  })

  it.each(cases)('$label → $expected', async ({ route, actor, targetName, expected }) => {
    const meeting = expected === 'ok' ? await liveMeeting() : shared
    const member = meeting[actor]
    const identity = targetName === 'unknown' ? unknownIdentity() : targetName ? targetOf(meeting, actor, targetName)!.identity : undefined
    const requestId = route.lobby ? (expected === 'ok' ? await waitingRequest(meeting) : sharedRequest) : undefined
    const res = await member.api.request(route.method, route.path(meeting.room.id, { identity, requestId }), route.body ? { body: route.body } : {})
    if (expected === 'ok') expect(res.status, res.text).toBe(route.success)
    else if (expected === 'forbidden') expectApiError(res, 403, 'CALL_FORBIDDEN')
    else expectApiError(res, 404, 'NOT_FOUND')
  })

  it('left the shared meeting untouched by rejected requests', async () => {
    const rows = await testDb().select().from(callParticipants).where(eq(callParticipants.meetingId, shared.meetingId))
    expect(rows.filter((row) => row.status === 'joined' || row.status === 'admitted')).toHaveLength(6)
    expect(rows.find((row) => row.id === sharedRequest)?.status).toBe('waiting')
  })
})

describe('callers without a live row', () => {
  let meeting: Meeting
  const outsiders: Record<string, () => Promise<ReturnType<typeof createClient>>> = {
    anonymous: async () => createClient(),
    'signed-in stranger': async () => loginAs(await createUser()),
    'guest of another room': async () => {
      const other = await liveMeeting()
      return (await guestMember(other.room, other.meetingId)).api
    },
  }
  beforeAll(async () => {
    meeting = await liveMeeting()
  })

  for (const [who, make] of Object.entries(outsiders)) {
    it(`answers CALL_NOT_PARTICIPANT to a ${who} on every route`, async () => {
      const api = await make()
      for (const route of ROUTES) {
        const res = await api.request(
          route.method,
          route.path(meeting.room.id, { identity: meeting.participant.identity, requestId: '0192d2f4-7a3b-7cde-8f01-23456789abcd' }),
          route.body ? { body: route.body } : {},
        )
        expectApiError(res, 403, 'CALL_NOT_PARTICIPANT')
      }
    })
  }

  it('answers CALL_NOT_PARTICIPANT once the caller left or was removed, and for malformed room ids', async () => {
    const fresh = await liveMeeting()
    await testDb().update(callParticipants).set({ status: 'left' }).where(eq(callParticipants.id, fresh.participant.rowId))
    await testDb().update(callParticipants).set({ status: 'removed' }).where(eq(callParticipants.id, fresh.guest.rowId))
    expectApiError(await fresh.participant.api.get(`/api/calls/${fresh.room.id}/participants`), 403, 'CALL_NOT_PARTICIPANT')
    expectApiError(await fresh.guest.api.post(`/api/calls/${fresh.room.id}/me/hand`, { body: { raised: true } }), 403, 'CALL_NOT_PARTICIPANT')
    expectApiError(await fresh.host.api.get('/api/calls/not-a-room/participants'), 403, 'CALL_NOT_PARTICIPANT')
  })

  it('rejects a co-host request that mixes lock and host-only settings', async () => {
    const fresh = await liveMeeting()
    expectApiError(
      await fresh.cohost.api.patch(`/api/calls/${fresh.room.id}/settings`, { body: { locked: true, chatEnabled: false } }),
      403,
      'CALL_FORBIDDEN',
    )
    expect((await fresh.host.api.patch(`/api/calls/${fresh.room.id}/settings`, { body: { locked: true, chatEnabled: false } })).status).toBe(200)
  })

  it('answers 404 for lobby decisions on unknown or decided requests', async () => {
    const fresh = await liveMeeting()
    expectApiError(await fresh.host.api.post(`/api/calls/${fresh.room.id}/lobby/0192d2f4-7a3b-7cde-8f01-23456789abcd/admit`), 404, 'NOT_FOUND')
    const requestId = await waitingRequest(fresh)
    expect((await fresh.cohost.api.post(`/api/calls/${fresh.room.id}/lobby/${requestId}/deny`)).status).toBe(204)
    expectApiError(await fresh.host.api.post(`/api/calls/${fresh.room.id}/lobby/${requestId}/admit`), 404, 'NOT_FOUND')
  })
})

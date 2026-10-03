/**
 * Who sees what: list scope (own recordings and rooms I own), 404 for everyone else on get/file/delete (no IDOR, no
 * existence oracle), the admin list and admin delete, and the audit trail of admin playback (debounced).
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditLog, recordings } from '../../../server/database/schema'
import { createAdmin, createClient, createRoom, createUser, expectApiError, loginAs, testDb, uniqueName } from '../_harness'
import { liveCall, recordingRow, seedReadyRecording } from './_support'

async function audits(action: string, targetId: string) {
  return testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)))
}

async function world() {
  const owner = await createUser()
  const recorder = await createUser()
  const stranger = await createUser()
  const room = await createRoom(owner, { name: uniqueName('Scope') })
  const otherRoom = await createRoom(recorder, { name: uniqueName('Own') })
  // The recorder (a co-host) records in the owner's room and in their own room.
  const inOwnersRoom = await seedReadyRecording({ createdBy: recorder.id, roomId: room.id, startedAt: new Date(Date.now() - 60_000) })
  const inOwnRoom = await seedReadyRecording({ createdBy: recorder.id, roomId: otherRoom.id })
  return {
    owner,
    recorder,
    stranger,
    room,
    otherRoom,
    inOwnersRoom,
    inOwnRoom,
    ownerClient: await loginAs(owner),
    recorderClient: await loginAs(recorder),
    strangerClient: await loginAs(stranger),
  }
}

describe('recording access', () => {
  it('lists own recordings and recordings of owned rooms, newest first', async () => {
    const w = await world()
    const mine = await w.recorderClient.get('/api/recordings')
    expect(mine.status, mine.text).toBe(200)
    expect(mine.body).toMatchObject({ page: 1, pageSize: 25, total: 2 })
    expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([w.inOwnRoom.id, w.inOwnersRoom.id])
    expect(mine.body.items[0]).toEqual({
      id: w.inOwnRoom.id,
      roomId: w.otherRoom.id,
      roomName: w.otherRoom.name,
      mode: 'server',
      status: 'ready',
      partial: false,
      title: null,
      durationMs: 3000,
      sizeBytes: w.inOwnRoom.plaintext.length,
      width: 320,
      height: 240,
      createdBy: { id: w.recorder.id, displayName: w.recorder.displayName },
      startedAt: expect.any(String),
      expiresAt: expect.any(String),
    })

    const owners = await w.ownerClient.get('/api/recordings')
    expect(owners.body.items.map((r: { id: string }) => r.id)).toEqual([w.inOwnersRoom.id])
    const strangers = await w.strangerClient.get('/api/recordings')
    expect(strangers.body).toMatchObject({ items: [], total: 0 })

    const searched = await w.recorderClient.get('/api/recordings', { query: { q: w.otherRoom.name.slice(-8) } })
    expect(searched.body.items.map((r: { id: string }) => r.id)).toEqual([w.inOwnRoom.id])
    const paged = await w.recorderClient.get('/api/recordings', { query: { page: 2, pageSize: 1 } })
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 2 })
    expect(paged.body.items.map((r: { id: string }) => r.id)).toEqual([w.inOwnersRoom.id])
    expectApiError(await w.recorderClient.get('/api/recordings', { query: { pageSize: 500 } }), 400, 'VALIDATION_FAILED')
    expectApiError(await createClient().get('/api/recordings'), 401, 'UNAUTHENTICATED')
  })

  it('answers 404 to everyone but recorder, room owner and admins on get, file and delete', async () => {
    const w = await world()
    const id = w.inOwnersRoom.id
    for (const client of [w.recorderClient, w.ownerClient, await loginAs(await createAdmin())]) {
      const res = await client.get(`/api/recordings/${id}`)
      expect(res.status, res.text).toBe(200)
      expect(res.body.recording.id).toBe(id)
    }
    expectApiError(await w.strangerClient.get(`/api/recordings/${id}`), 404, 'NOT_FOUND')
    expectApiError(await w.strangerClient.get(`/api/recordings/${id}/file`), 404, 'NOT_FOUND')
    expectApiError(await w.strangerClient.delete(`/api/recordings/${id}`), 404, 'NOT_FOUND')
    // The owner of a room sees recordings made there, but not the recorder's other recordings.
    expectApiError(await w.ownerClient.get(`/api/recordings/${w.inOwnRoom.id}`), 404, 'NOT_FOUND')
    // Unknown and malformed ids look the same.
    expectApiError(await w.strangerClient.get('/api/recordings/0199a3b4-0000-7000-8000-00000000beef'), 404, 'NOT_FOUND')
    expectApiError(await w.strangerClient.get('/api/recordings/not-an-id'), 404, 'NOT_FOUND')
    expect(await recordingRow(id)).toBeDefined()
  })

  it('lets the recorder or the room owner delete a finished recording (204, audited), never a busy one', async () => {
    const w = await world()
    await testDb().update(recordings).set({ status: 'processing' }).where(eq(recordings.id, w.inOwnersRoom.id))
    const busy = await w.ownerClient.delete(`/api/recordings/${w.inOwnersRoom.id}`)
    expectApiError(busy, 409, 'CONFLICT')
    await testDb().update(recordings).set({ status: 'ready' }).where(eq(recordings.id, w.inOwnersRoom.id))
    expect((await w.ownerClient.delete(`/api/recordings/${w.inOwnersRoom.id}`)).status).toBe(204)
    expect(await recordingRow(w.inOwnersRoom.id)).toBeUndefined()
    expect(await audits('recording.deleted', w.inOwnersRoom.id)).toMatchObject([{ actorUserId: w.owner.id }])
    expectApiError(await w.recorderClient.get(`/api/recordings/${w.inOwnersRoom.id}/file`), 404, 'NOT_FOUND')
    expect((await w.recorderClient.delete(`/api/recordings/${w.inOwnRoom.id}`)).status).toBe(204)
  })

  it('shows admins every recording and audits their playback once per kind per 10 minutes', async () => {
    const w = await world()
    const admin = await loginAs(await createAdmin())
    const listed = await admin.get('/api/admin/recordings', { query: { q: w.room.name } })
    expect(listed.status, listed.text).toBe(200)
    expect(listed.body.items.map((r: { id: string }) => r.id)).toEqual([w.inOwnersRoom.id])
    const byCreator = await admin.get('/api/admin/recordings', { query: { q: w.recorder.email } })
    expect(byCreator.body.items.map((r: { id: string }) => r.id).sort()).toEqual([w.inOwnRoom.id, w.inOwnersRoom.id].sort())
    expectApiError(await w.recorderClient.get('/api/admin/recordings'), 403, 'FORBIDDEN')
    expectApiError(await createClient().get('/api/admin/recordings'), 401, 'UNAUTHENTICATED')

    const id = w.inOwnersRoom.id
    const play = (range: string, query = '') =>
      fetch(new URL(`/api/recordings/${id}/file${query}`, admin.baseUrl), {
        headers: { cookie: admin.cookieHeader(), 'x-forwarded-for': admin.ip, range },
      })
    for (const range of ['bytes=0-99', 'bytes=100-', 'bytes=0-']) {
      const res = await play(range)
      expect(res.status).toBe(206)
      await res.arrayBuffer()
    }
    const download = await play('bytes=0-', '?download=1')
    await download.arrayBuffer()
    const playback = await audits('recording.admin_playback', id)
    expect(playback).toHaveLength(1)
    expect(playback[0]).toMatchObject({ targetType: 'recording', details: { roomId: w.room.id, createdBy: w.recorder.id } })
    expect(await audits('recording.admin_download', id)).toHaveLength(1)

    // The recorder and the room owner are not audited for their own recordings.
    for (const client of [w.recorderClient, w.ownerClient]) {
      const res = await fetch(new URL(`/api/recordings/${id}/file`, client.baseUrl), {
        headers: { cookie: client.cookieHeader(), 'x-forwarded-for': client.ip },
      })
      await res.arrayBuffer()
    }
    expect(await audits('recording.admin_playback', id)).toHaveLength(1)
  })

  it('lets admins delete in any state, including an active recording (audited)', async () => {
    const call = await liveCall()
    const started = await call.client.post(`/api/calls/${call.room.id}/recording/start`, {
      body: { mode: 'server', mimeType: 'video/webm' },
    })
    expect(started.status, started.text).toBe(201)
    const id = started.body.recordingId as string
    const adminUser = await createAdmin()
    const admin = await loginAs(adminUser)
    expectApiError(await call.client.delete(`/api/admin/recordings/${id}`), 403, 'FORBIDDEN')
    expect((await admin.delete(`/api/admin/recordings/${id}`)).status).toBe(204)
    expect(await recordingRow(id)).toBeUndefined()
    expect(await audits('admin.recording_deleted', id)).toMatchObject([{ actorUserId: adminUser.id, details: { status: 'recording' } }])
    expectApiError(await admin.delete(`/api/admin/recordings/${id}`), 404, 'NOT_FOUND')
    // Nothing is active any more: a new recording can start right away.
    const again = await call.client.post(`/api/calls/${call.room.id}/recording/start`, { body: { mode: 'local' } })
    expect(again.status, again.text).toBe(201)
  })
})

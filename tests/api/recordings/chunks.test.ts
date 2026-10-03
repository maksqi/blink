/**
 * PUT /api/recordings/:id/chunks/:seq and POST /api/recordings/:id/complete: recorder only, ordering and retries,
 * the streamed size limit (also without Content-Length), quota, and that stored chunks are BLQ1 ciphertext.
 */
import { request } from 'node:http'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { recordings } from '../../../server/database/schema'
import { ingestChunk } from '../../../server/services/recordings/ingest'
import { apiBaseUrl, createClient, createUser, expectApiError, fakeEvent, loginAs, testDb, useServerEnvInProcess } from '../_harness'
import {
  fixture,
  joinAs,
  liveCall,
  putChunk,
  recordingRow,
  recordingsDir,
  seedReadyRecording,
  splitInto,
  startServerRecording,
} from './_support'

useServerEnvInProcess()

const MIB = 1024 * 1024
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
const created: string[] = []

afterAll(async () => {
  // Nothing from this file should be picked up by a processing server later in the run.
  if (created.length) await testDb().delete(recordings).where(inArray(recordings.id, created))
})

async function newRecording(mimeType?: string) {
  const call = await liveCall()
  const id = await startServerRecording(call.client, call.room.id, mimeType)
  created.push(id)
  return { ...call, id }
}

function chunkFiles(id: string): string[] {
  const dir = join(recordingsDir(), id)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

/** A chunked (no Content-Length) upload of `total` bytes, written in 1 MiB pieces; resolves with the status. */
function streamUpload(path: string, cookie: string, ip: string, total: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiBaseUrl())
    const req = request(url, {
      method: 'PUT',
      headers: {
        cookie,
        origin: url.origin,
        'x-forwarded-for': ip,
        'content-type': 'application/octet-stream',
        'transfer-encoding': 'chunked',
      },
    })
    req.on('response', (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (part: string) => (body += part))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    const piece = Buffer.alloc(MIB, 7)
    let sent = 0
    const pump = () => {
      while (sent < total) {
        const size = Math.min(piece.length, total - sent)
        sent += size
        if (!req.write(piece.subarray(0, size))) return void req.once('drain', pump)
      }
      req.end()
    }
    pump()
  })
}

describe('chunk upload', () => {
  it('stores every chunk as its own BLQ1 file without ftyp or EBML magic', async () => {
    for (const [name, mime] of [
      ['vp9-opus.webm', 'video/webm;codecs=vp9,opus'],
      ['h264-aac.mp4', 'video/mp4;codecs=avc1.64001F,mp4a.40.2'],
    ] as const) {
      const media = fixture(name)
      expect(media.includes(name.endsWith('.webm') ? EBML_MAGIC : Buffer.from('ftyp'))).toBe(true)
      const rec = await newRecording(mime)
      const parts = splitInto(media, 2)
      for (const [seq, part] of parts.entries()) expect((await putChunk(rec.client, rec.id, seq, part)).status).toBe(204)
      expect(chunkFiles(rec.id)).toEqual(['chunk-000000.blq1', 'chunk-000001.blq1'])
      for (const file of chunkFiles(rec.id)) {
        const stored = readFileSync(join(recordingsDir(), rec.id, file))
        expect(stored.subarray(0, 4).toString('ascii')).toBe('BLQ1')
        expect(stored.includes(EBML_MAGIC)).toBe(false)
        expect(stored.includes(Buffer.from('ftyp'))).toBe(false)
      }
      const row = await recordingRow(rec.id)
      expect(row).toMatchObject({ chunkCount: 2, uploadedBytes: media.length })
      expect(row!.lastChunkAt).toBeInstanceOf(Date)
    }
  })

  it('accepts only the recorder (403 otherwise, 401 anonymous)', async () => {
    const rec = await newRecording()
    const cohost = await joinAs(rec, { role: 'cohost' })
    const stranger = await loginAs(await createUser())
    const data = Buffer.from('chunk')
    expectApiError(await putChunk(cohost.client, rec.id, 0, data), 403, 'FORBIDDEN')
    expectApiError(await putChunk(stranger, rec.id, 0, data), 403, 'FORBIDDEN')
    expectApiError(await putChunk(stranger, '0199a3b4-0000-7000-8000-00000000abcd', 0, data), 403, 'FORBIDDEN')
    expectApiError(await putChunk(createClient(), rec.id, 0, data), 401, 'UNAUTHENTICATED')
    expect(chunkFiles(rec.id)).toEqual([])
  })

  it('keeps chunks in order: gaps are refused (409), retries replace the stored chunk (204)', async () => {
    const rec = await newRecording()
    const gap = await putChunk(rec.client, rec.id, 1, Buffer.from('second'))
    expectApiError(gap, 409, 'CONFLICT')
    expect(gap.body.data.details).toMatchObject({ reason: 'chunk_gap', expected: 0 })
    expect((await putChunk(rec.client, rec.id, 0, Buffer.from('first attempt'))).status).toBe(204)
    expect((await putChunk(rec.client, rec.id, 0, Buffer.from('retry'))).status).toBe(204)
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 1, uploadedBytes: 5 })
    expect((await putChunk(rec.client, rec.id, 1, Buffer.from('second'))).status).toBe(204)
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 2, uploadedBytes: 11 })
    expectApiError(await putChunk(rec.client, rec.id, 5, Buffer.from('x')), 409, 'CONFLICT')
    expectApiError(await putChunk(rec.client, rec.id, -1, Buffer.from('x')), 400, 'VALIDATION_FAILED')
  })

  it('requires application/octet-stream and a non-empty body', async () => {
    const rec = await newRecording()
    const wrongType = await rec.client.put(`/api/recordings/${rec.id}/chunks/0`, {
      raw: new Uint8Array([1, 2, 3]),
      headers: { 'content-type': 'video/webm' },
    })
    expectApiError(wrongType, 400, 'VALIDATION_FAILED')
    expectApiError(await putChunk(rec.client, rec.id, 0, new Uint8Array(0)), 400, 'VALIDATION_FAILED')
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 0, uploadedBytes: 0 })
  })

  it('rejects a chunk over 16 MiB sent with chunked transfer and no Content-Length (413), storing nothing', async () => {
    const rec = await newRecording()
    const res = await streamUpload(`/api/recordings/${rec.id}/chunks/0`, rec.client.cookieHeader(), rec.client.ip, 16 * MIB + 1)
    expect(res.status, res.body).toBe(413)
    expect(JSON.parse(res.body)).toMatchObject({ statusCode: 413, data: { code: 'RECORDING_TOO_LARGE' } })
    expect(chunkFiles(rec.id)).toEqual([])
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 0, uploadedBytes: 0 })
    // Exactly the limit is fine.
    const ok = await streamUpload(`/api/recordings/${rec.id}/chunks/0`, rec.client.cookieHeader(), rec.client.ip, 16 * MIB)
    expect(ok.status, ok.body).toBe(204)
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 1, uploadedBytes: 16 * MIB })
  })

  it('rejects a declared Content-Length over the limit (413)', async () => {
    const rec = await newRecording()
    const res = await putChunk(rec.client, rec.id, 0, Buffer.alloc(16 * MIB + 10))
    expectApiError(res, 413, 'RECORDING_TOO_LARGE')
    expect(chunkFiles(rec.id)).toEqual([])
  })

  it('refuses chunks once the quota is used up (409 RECORDING_QUOTA_EXCEEDED)', async () => {
    const rec = await newRecording()
    expect((await putChunk(rec.client, rec.id, 0, Buffer.from('before'))).status).toBe(204)
    const seeded = await seedReadyRecording({ createdBy: rec.owner.id, roomId: rec.room.id })
    created.push(seeded.id)
    await testDb().update(recordings).set({ sizeBytes: 20 * 1024 ** 3 }).where(eq(recordings.id, seeded.id))
    expectApiError(await putChunk(rec.client, rec.id, 1, Buffer.from('after')), 409, 'RECORDING_QUOTA_EXCEEDED')
    expect(await recordingRow(rec.id)).toMatchObject({ chunkCount: 1 })
  })

  it('refuses chunks later than startedAt + maxDuration + 2 min (413)', async () => {
    const rec = await newRecording()
    await testDb()
      .update(recordings)
      .set({ startedAt: new Date(Date.now() - (240 + 3) * 60_000) })
      .where(eq(recordings.id, rec.id))
    expectApiError(await putChunk(rec.client, rec.id, 0, Buffer.from('late')), 413, 'RECORDING_TOO_LARGE')
  })

  it('answers 503 while RECORDINGS_DIR has less than 2 GiB free (in-process, injected free space)', async () => {
    const rec = await newRecording()
    const event = fakeEvent({ cookie: rec.client.cookieHeader(), method: 'PUT', headers: { 'content-type': 'application/octet-stream' } })
    const deps = { clock: { now: () => new Date() }, freeBytes: async () => 2 * 1024 ** 3 - 1 }
    await expect(ingestChunk(event, { id: rec.owner.id }, rec.id, '0', deps)).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'SERVICE_UNAVAILABLE' },
    })
    expect(chunkFiles(rec.id)).toEqual([])
  })

  it('refuses chunks for local recordings and after completion (409 not_recording), accepts them after stop', async () => {
    const call = await liveCall()
    const local = await call.client.post(`/api/calls/${call.room.id}/recording/start`, { body: { mode: 'local' } })
    expect(local.status, local.text).toBe(201)
    created.push(local.body.recordingId)
    const refused = await putChunk(call.client, local.body.recordingId, 0, Buffer.from('x'))
    expectApiError(refused, 409, 'CONFLICT')
    expect(refused.body.data.details).toEqual({ reason: 'not_recording' })
    await call.client.post(`/api/calls/${call.room.id}/recording/stop`)

    const rec = await newRecording()
    expect((await putChunk(rec.client, rec.id, 0, fixture('vp9-opus.webm'))).status).toBe(204)
    expect((await rec.client.post(`/api/calls/${rec.room.id}/recording/stop`)).status).toBe(204)
    // Stopped, not completed: the last chunks still arrive.
    expect((await putChunk(rec.client, rec.id, 1, Buffer.from('tail'))).status).toBe(204)
    await rec.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 2, durationMs: 3000 } })
    expectApiError(await putChunk(rec.client, rec.id, 2, Buffer.from('late')), 409, 'CONFLICT')
  })
})

describe('complete', () => {
  it('needs the recorder and the exact chunk count, then moves to processing (202, idempotent)', async () => {
    const rec = await newRecording()
    const cohost = await joinAs(rec, { role: 'cohost' })
    const media = splitInto(fixture('vp9-opus.webm'), 2)
    for (const [seq, part] of media.entries()) await putChunk(rec.client, rec.id, seq, part)

    expectApiError(await cohost.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 2, durationMs: 3000 } }), 403, 'FORBIDDEN')
    const mismatch = await rec.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 3, durationMs: 3000 } })
    expectApiError(mismatch, 409, 'CONFLICT')
    expect(mismatch.body.data.details).toMatchObject({ stored: 2 })
    expectApiError(await rec.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 0, durationMs: 1 } }), 400, 'VALIDATION_FAILED')

    const done = await rec.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 2, durationMs: 3000 } })
    expect(done.status, done.text).toBe(202)
    expect(done.body).toEqual({ status: 'processing' })
    const row = await recordingRow(rec.id)
    expect(row).toMatchObject({ status: 'processing', partial: false, durationMs: 3000 })
    expect(row!.endedAt).toBeInstanceOf(Date)
    // A retry of the same completion is harmless.
    expect((await rec.client.post(`/api/recordings/${rec.id}/complete`, { body: { chunkCount: 2, durationMs: 3000 } })).status).toBe(202)
  })
})

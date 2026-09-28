/**
 * Malicious or unsupported uploads fail as `invalid_media` in the ffprobe allowlist, before ffmpeg ever starts: a
 * container that does not match the declared MIME type, HLS and ffconcat text files, 8192×8192 frames, audio only
 * and a codec outside the allowlist. A valid upload in the same run proves the "ffmpeg started" log line exists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from '../_harness'
import {
  completeUpload,
  fixture,
  liveCall,
  mediaFixtures,
  recordingRow,
  recordingsDir,
  splitInto,
  startProcessingServer,
  startServerRecording,
  uploadChunks,
  waitForRecording,
} from './_support'

let server: TestServer

beforeAll(async () => {
  mediaFixtures()
  server = await startProcessingServer('malicious')
})

afterAll(async () => {
  await server?.stop()
})

/** Recording ids for which the server logged that it started ffmpeg. */
function transcodesStarted(): Set<string> {
  const ids = new Set<string>()
  for (const line of readFileSync(server.logFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue
    const record = JSON.parse(line) as { msg?: string; recordingId?: string }
    if (record.msg === 'recording transcode started' && record.recordingId) ids.add(record.recordingId)
  }
  return ids
}

async function upload(name: string, mime: string) {
  const call = await liveCall(server.baseUrl)
  const id = await startServerRecording(call.client, call.room.id, mime)
  const chunks = splitInto(fixture(name), 2)
  await uploadChunks(call.client, id, chunks)
  await completeUpload(call.client, id, chunks.length)
  return { call, id, recording: await waitForRecording(call.client, id) }
}

describe('malicious and unsupported media', () => {
  it.each([
    ['a WebM file declared as MP4', 'vp9-opus.webm', 'video/mp4;codecs=avc1,opus'],
    ['an MP4 file declared as WebM', 'h264-aac.mp4', 'video/webm;codecs=vp9,opus'],
    ['an HLS playlist declared as WebM', 'playlist.m3u8', 'video/webm'],
    ['an HLS playlist declared as MP4', 'playlist.m3u8', 'video/mp4'],
    ['an ffconcat script declared as MP4', 'list.ffconcat', 'video/mp4'],
    ['8192×8192 frames', 'huge.webm', 'video/webm;codecs=vp8'],
    ['audio without video', 'audio-only.webm', 'video/webm;codecs=opus'],
    ['Motion JPEG video', 'mjpeg.mkv', 'video/webm'],
  ])('rejects %s without starting ffmpeg', async (_label, name, mime) => {
    const { call, id, recording } = await upload(name, mime)
    expect(recording.status).toBe('failed')
    const row = await recordingRow(id)
    expect(row).toMatchObject({ status: 'failed', error: 'invalid_media', storageKey: null })
    expect(transcodesStarted().has(id)).toBe(false)
    // Failed uploads are never served, and their chunks are gone.
    const file = await call.client.get(`/api/recordings/${id}/file`)
    expect(file.status).toBe(404)
    const dir = join(recordingsDir(), id)
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([])
  })

  it('still processes a valid upload (control for the log check above)', async () => {
    const { id, recording } = await upload('vp8-opus.webm', 'video/webm;codecs=vp8,opus')
    expect(recording.status).toBe('ready')
    expect(transcodesStarted().has(id)).toBe(true)
  })
})

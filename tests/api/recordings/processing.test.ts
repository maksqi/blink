/**
 * The processing pipeline with real ffmpeg/ffprobe: WebM (VP9/Opus, VP8/Opus) and fragmented MP4 (H.264/AAC,
 * H.264/Opus) uploaded in chunks become faststart H.264/AAC MP4 files without input metadata, chapters, subtitle or
 * data streams; audio survives (volumedetect); only BLQ1 files ever exist below RECORDINGS_DIR.
 * Runs against a second server that may transcode outside a tmpfs (see _support.ts).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from '../_harness'
import {
  completeUpload,
  downloadFile,
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
const scratch = mkdtempSync(join(tmpdir(), 'blinq-processing-'))

beforeAll(async () => {
  mediaFixtures()
  server = await startProcessingServer('processing')
})

afterAll(async () => {
  await server?.stop()
  rmSync(scratch, { recursive: true, force: true })
})

interface Probe {
  streams: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }>
  chapters: unknown[]
  format: { format_name: string; duration: string; tags?: Record<string, string> }
}

function probe(file: string): Probe {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=format_name,duration:format_tags', '-show_chapters', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  return JSON.parse(out) as Probe
}

function meanVolume(file: string): number {
  // volumedetect reports on stderr.
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  const match = run.stderr.match(/mean_volume: (-?[\d.]+) dB/)
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY
}

/** Top-level MP4 box types in file order. */
function topLevelBoxes(data: Buffer): string[] {
  const boxes: string[] = []
  let offset = 0
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset)
    const type = data.toString('latin1', offset + 4, offset + 8)
    if (size === 1) size = Number(data.readBigUInt64BE(offset + 8))
    if (size === 0) size = data.length - offset
    if (size < 8) break
    boxes.push(type)
    offset += size
  }
  return boxes
}

/** Every file below the recording's directory, with its first four bytes. */
function storedFiles(id: string): Array<{ name: string; magic: string }> {
  const dir = join(recordingsDir(), id)
  if (!existsSync(dir)) return []
  return readdirSync(dir).map((name) => ({ name, magic: readFileSync(join(dir, name)).subarray(0, 4).toString('latin1') }))
}

async function record(name: string, mime: string, parts = 3) {
  const call = await liveCall(server.baseUrl)
  const id = await startServerRecording(call.client, call.room.id, mime)
  const chunks = splitInto(fixture(name), parts)
  await uploadChunks(call.client, id, chunks)
  await completeUpload(call.client, id, chunks.length)
  const whileProcessing = storedFiles(id)
  const recording = await waitForRecording(call.client, id)
  return { call, id, recording, whileProcessing }
}

describe('processing', () => {
  it.each([
    ['vp9-opus.webm', 'video/webm;codecs=vp9,opus'],
    ['vp8-opus.webm', 'video/webm;codecs=vp8,opus'],
    ['h264-aac.mp4', 'video/mp4;codecs=avc1.64001F,mp4a.40.2'],
    ['h264-opus.mp4', 'video/mp4;codecs=avc1,opus'],
  ])('turns %s (%s) into a faststart H.264/AAC MP4 with audible audio', async (name, mime) => {
    const { call, id, recording, whileProcessing } = await record(name, mime)
    expect(recording).toMatchObject({ status: 'ready', partial: false, width: 320, height: 240, mode: 'server' })
    expect(recording.durationMs).toBeGreaterThan(2_500)
    expect(recording.durationMs).toBeLessThan(3_600)

    // Nothing but BLQ1 ciphertext below RECORDINGS_DIR, while processing and afterwards.
    console.log(`files below RECORDINGS_DIR/${id} right after complete:`, JSON.stringify(whileProcessing))
    for (const file of whileProcessing) {
      expect(file.name).toMatch(/\.blq1$/)
      expect(file.magic).toBe('BLQ1')
    }
    expect(storedFiles(id)).toEqual([{ name: 'recording.blq1', magic: 'BLQ1' }])

    const row = await recordingRow(id)
    expect(row).toMatchObject({ status: 'ready', error: null, storageKey: `${id}/recording.blq1`, chunkCount: 3 })
    expect(row!.expiresAt!.getTime() - row!.processedAt!.getTime()).toBe(30 * 86_400_000)

    const mp4 = await downloadFile(call.client, id)
    expect(mp4.length).toBe(recording.sizeBytes)
    const boxes = topLevelBoxes(mp4)
    expect(boxes[0]).toBe('ftyp')
    expect(boxes.indexOf('moov')).toBeGreaterThan(-1)
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'))

    const file = join(scratch, `${id}.mp4`)
    writeFileSync(file, mp4)
    const info = probe(file)
    expect(info.streams.map((s) => `${s.codec_type}:${s.codec_name}`)).toEqual(['video:h264', 'audio:aac'])
    expect(Number(info.format.duration)).toBeGreaterThan(2.5)
    expect(Number(info.format.duration)).toBeLessThan(3.6)
    // Digital silence reads about -91 dB; the 440 Hz fixture tone is around -24 dB.
    expect(meanVolume(file)).toBeGreaterThan(-50)
  })

  it.each([
    ['extras.mkv', 'video/webm'],
    ['extras.mov', 'video/mp4'],
  ])('drops metadata, chapters, subtitle and data streams of %s', async (name, mime) => {
    const input = join(mediaFixtures(), name)
    const before = probe(input)
    expect(before.chapters.length).toBe(2)
    expect(before.streams.some((s) => s.codec_type === 'subtitle')).toBe(true)
    expect(JSON.stringify(before.format.tags)).toContain('blinq-fixture-title')

    const { call, id, recording } = await record(name, mime, 2)
    expect(recording.status).toBe('ready')
    const file = join(scratch, `${id}.mp4`)
    writeFileSync(file, await downloadFile(call.client, id))
    const after = probe(file)
    expect(after.streams.map((s) => `${s.codec_type}:${s.codec_name}`)).toEqual(['video:h264', 'audio:aac'])
    expect(after.chapters).toEqual([])
    const tags = JSON.stringify(after.format.tags ?? {})
    expect(tags).not.toContain('blinq-fixture')
    expect(tags.toLowerCase()).not.toContain('comment')
  })
})

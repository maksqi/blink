/**
 * Recording storage layout and file-system helpers.
 *
 *   RECORDINGS_DIR/<id>/chunk-000000.blq1 …   uploaded chunks, each its own BLQ1 file (chunkInfo)
 *   RECORDINGS_DIR/<id>/recording.blq1        the final MP4 (recordingInfo); `storageKey` = "<id>/recording.blq1"
 *   RECORDINGS_DIR/<id>/tmp-<random>.blq1     files being written (renamed into place when complete)
 *   RECORDING_WORK_DIR/<id>/out.mp4           plaintext transcode output (tmpfs in production), wiped after every job
 *
 * Only BLQ1 files are ever written below RECORDINGS_DIR. Ids are validated uuids before they reach a path.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, open, readdir, realpath, rename, rm, stat, statfs } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { env } from '../../utils/env'
import { BLQ1_HEADER_SIZE, layoutForFileSize, parseHeader } from './blq1'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const FINAL_FILE = 'recording.blq1'
/** Uploads are refused below this much free space on RECORDINGS_DIR (decision). */
export const MIN_FREE_BYTES = 2 * 1024 ** 3

export function isRecordingId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function assertId(id: string) {
  if (!isRecordingId(id)) throw new TypeError('Invalid recording id')
}

export function recordingsRoot(): string {
  return resolve(env().RECORDINGS_DIR)
}

export function workRoot(): string {
  return resolve(env().RECORDING_WORK_DIR)
}

export function recordingDir(id: string): string {
  assertId(id)
  return join(recordingsRoot(), id.toLowerCase())
}

export function chunkFileName(seq: number): string {
  return `chunk-${String(seq).padStart(6, '0')}.blq1`
}

export function chunkPath(id: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) throw new RangeError('Invalid chunk sequence number')
  return join(recordingDir(id), chunkFileName(seq))
}

export function storageKeyFor(id: string): string {
  assertId(id)
  return `${id.toLowerCase()}/${FINAL_FILE}`
}

/** Absolute path of a stored final file; refuses keys that would leave RECORDINGS_DIR. */
export function pathForStorageKey(key: string): string {
  const root = recordingsRoot()
  const path = resolve(root, key)
  if (!path.startsWith(root + sep)) throw new Error('storage key outside RECORDINGS_DIR')
  return path
}

export function tempPath(id: string): string {
  return join(recordingDir(id), `tmp-${randomBytes(8).toString('hex')}.blq1`)
}

export function workDir(id: string): string {
  assertId(id)
  return join(workRoot(), id.toLowerCase())
}

export async function ensureRecordingDir(id: string): Promise<string> {
  const dir = recordingDir(id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Renames a finished temp file into place and makes both the file and the rename durable. */
export async function commitFile(temp: string, target: string): Promise<void> {
  await rename(temp, target)
  await fsyncDir(dirname(target))
}

async function fsyncDir(dir: string): Promise<void> {
  let handle
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is not supported everywhere (the rename itself already happened).
  } finally {
    await handle?.close()
  }
}

export async function removeRecordingFiles(id: string): Promise<void> {
  await rm(recordingDir(id), { recursive: true, force: true })
}

export async function removeChunkFiles(id: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(recordingDir(id))
  } catch {
    return
  }
  await Promise.all(
    names.filter((name) => name !== FINAL_FILE).map((name) => rm(join(recordingDir(id), name), { force: true })),
  )
}

export async function removeWorkDir(id: string): Promise<void> {
  await rm(workDir(id), { recursive: true, force: true })
}

/** Plaintext bytes stored in an existing BLQ1 file (from its size and header), or null when it does not exist. */
export async function storedPlaintextSize(path: string): Promise<number | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await handle.stat()
    const header = Buffer.alloc(BLQ1_HEADER_SIZE)
    await handle.read(header, 0, BLQ1_HEADER_SIZE, 0)
    return layoutForFileSize(size, parseHeader(header).segmentSize).plaintextSize
  } finally {
    await handle.close()
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Free bytes for unprivileged writers on the file system holding `path` (created if missing). */
export async function freeBytes(path: string): Promise<number> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await statfs(path)
  return Number(info.bavail) * Number(info.bsize)
}

// ---- tmpfs detection --------------------------------------------------------------------------------------------

export interface MountEntry {
  mountPoint: string
  fsType: string
}

/** `/proc/self/mounts` lines → entries (octal escapes such as `\040` decoded). */
export function parseMounts(text: string): MountEntry[] {
  const unescape = (value: string) => value.replace(/\\([0-7]{3})/g, (_m, octal: string) => String.fromCharCode(parseInt(octal, 8)))
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 3)
    .map((fields) => ({ mountPoint: unescape(fields[1]!), fsType: fields[2]! }))
}

/** File system type of the mount that holds `path` (longest matching mount point), or null. */
export function fsTypeFor(path: string, mounts: MountEntry[]): string | null {
  let best: MountEntry | null = null
  for (const mount of mounts) {
    const point = mount.mountPoint
    const matches = path === point || path.startsWith(point.endsWith('/') ? point : `${point}/`)
    if (matches && (!best || point.length >= best.mountPoint.length)) best = mount
  }
  return best?.fsType ?? null
}

/** True when `path` lives on a tmpfs (Linux; false where /proc/self/mounts does not exist). */
export async function isTmpfs(path: string): Promise<boolean> {
  let text: string
  try {
    text = readFileSync('/proc/self/mounts', 'utf8')
  } catch {
    return false
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  return fsTypeFor(await realpath(path), parseMounts(text)) === 'tmpfs'
}

// ---- Keys -----------------------------------------------------------------------------------------------------------

/** RECORDING_ENCRYPTION_KEY as raw bytes. */
export function masterKey(): Buffer {
  return Buffer.from(env().RECORDING_ENCRYPTION_KEY, 'base64')
}

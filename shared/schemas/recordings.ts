import { z } from 'zod'

export const recordingModeSchema = z.enum(['server', 'local'])

/** POST /api/calls/:roomId/recording/start */
export const startRecordingSchema = z.object({
  mode: recordingModeSchema,
  /** MediaRecorder MIME type actually chosen by the browser (server mode only). */
  mimeType: z
    .string()
    .max(100)
    .regex(/^video\/(mp4|webm)(;.*)?$/)
    .optional(),
  width: z.number().int().min(320).max(1920).optional(),
  height: z.number().int().min(180).max(1080).optional(),
})

/** POST /api/recordings/:id/complete */
export const completeRecordingSchema = z.object({
  chunkCount: z.number().int().min(1).max(100_000),
  durationMs: z.number().int().min(0).max(24 * 3600 * 1000),
})

/** Max bytes per uploaded chunk (PUT /api/recordings/:id/chunks/:seq); the handler counts streamed bytes. */
export const RECORDING_CHUNK_MAX_BYTES = 16 * 1024 * 1024

export interface StartRecordingResponse {
  recordingId: string
  maxDurationMs: number
  chunkMaxBytes: number
}

export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed'

export interface RecordingSummary {
  id: string
  roomId: string
  roomName: string
  mode: 'server' | 'local'
  status: RecordingStatus
  partial: boolean
  title: string | null
  durationMs: number | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  createdBy: { id: string; displayName: string }
  startedAt: string
  expiresAt: string | null
}

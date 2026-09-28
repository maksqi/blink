/**
 * Entry points of the recording service for other workstreams (explicit imports only):
 *
 * - `finalizeRecording(id, reason)`: idempotently finalizes a recording that is still `recording` (partial
 *   `processing`, `failed` without chunks, local → `ready`) and turns its REC indicator off.
 * - `handleRecordingChanged(event)`: what the `recording.changed` bus event triggers (server/plugins/recordings.ts).
 * - `deleteRecordingsForUser(userId)`: deletes files, jobs and rows of everything the user recorded or owns; Stage 03
 *   calls it before deleting the user (the database would cascade the rows but not the files).
 * - `resumeProcessing()`: enqueues every `processing` row (boot).
 */
export { deleteRecordingsForUser } from './access'
export { resumeProcessing, recordingQueue } from './jobs'
export { cancelRecordingTimers, finalizeRecording, handleRecordingChanged, type FinalizeReason } from './lifecycle'

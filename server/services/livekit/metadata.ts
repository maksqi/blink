/**
 * Room metadata builder (rooms-backend, docs/API.md §12). Pure: `publishRoomState` and `createRoom` both call it, so
 * the metadata LiveKit holds is always a function of the database.
 */
import type { RoomMetadata } from '#shared/schemas/livekit'

export interface MetadataRoom {
  locked: boolean
  waitingRoom: boolean
  screenSharePolicy: 'everyone' | 'hosts'
  allowSelfUnmute: boolean
  chatEnabled: boolean
}

export interface MetadataRecording {
  mode: 'server' | 'local'
  by: string
  startedAt: Date
}

export function buildRoomMetadata(
  room: MetadataRoom,
  meeting: { epoch: string },
  recording: MetadataRecording | null,
): RoomMetadata {
  return {
    v: 1,
    epoch: meeting.epoch,
    locked: room.locked,
    waitingRoom: room.waitingRoom,
    screenSharePolicy: room.screenSharePolicy,
    allowSelfUnmute: room.allowSelfUnmute,
    chatEnabled: room.chatEnabled,
    recording: recording
      ? { mode: recording.mode, by: recording.by, startedAt: recording.startedAt.toISOString() }
      : null,
  }
}

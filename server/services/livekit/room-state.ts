import type { PublishRoomState } from '../../contracts'

/**
 * Single writer of LiveKit room metadata (see server/contracts PublishRoomState).
 * W0a stub — rooms-backend (Stage 04) replaces the body; keep the export name and signature.
 * recording-server (Stage 08) calls it after starting/stopping a recording.
 */
export const publishRoomState: PublishRoomState = async () => null

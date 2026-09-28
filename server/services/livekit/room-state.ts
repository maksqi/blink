/**
 * Single writer of LiveKit room metadata (see server/contracts PublishRoomState). The implementation lives in
 * publish-room-state.ts; this path is kept for callers that import it from here (recording-server).
 */
export { publishRoomState } from './publish-room-state'

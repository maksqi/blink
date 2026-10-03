/** The room settings page of rooms-ui, where the host rotates the room key (only while no meeting is live). */
export function roomSettingsPath(roomId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}`
}

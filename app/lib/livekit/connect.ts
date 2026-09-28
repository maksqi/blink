/**
 * Connect flow. The order is security-relevant:
 *   1. the per-meeting media key goes into the key provider,
 *   2. `setE2EEEnabled(true)` runs BEFORE `connect()`, or the first packets would leave unencrypted,
 *   3. `connect(url, token, { autoSubscribe: false })`: nothing is subscribed until the SubscriptionManager has checked
 *      each publication's encryption.
 * Publishing the pre-join tracks and applying subscriptions happen afterwards, in parallel (session.ts).
 */
import type { ExternalE2EEKeyProvider, Room } from 'livekit-client'

export interface ConnectInput {
  room: Room
  url: string
  token: string
  /** False only for the test-only unencrypted harness client. */
  e2ee: boolean
  keyProvider: ExternalE2EEKeyProvider | null
  mediaKey: ArrayBuffer | null
}

export class E2EESetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'E2EESetupError'
  }
}

export async function connectRoom({ room, url, token, e2ee, keyProvider, mediaKey }: ConnectInput): Promise<void> {
  if (e2ee) {
    if (!keyProvider || !mediaKey) throw new E2EESetupError('The meeting key is missing')
    await keyProvider.setKey(mediaKey)
    await room.setE2EEEnabled(true)
  }
  await room.connect(url, token, { autoSubscribe: false })
}

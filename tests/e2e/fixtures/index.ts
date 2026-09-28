import { mergeTests } from '@playwright/test'
import { expect, test as baseTest } from './base'
import { test as livekitTest } from './livekit'
import { test as mediaTest } from './media'
import { test as recordingTest } from './recording'

/**
 * Single entry point for E2E specs: `import { test, expect } from '../fixtures'`.
 * base (devops-ci): CSP/console/secret guards · livekit (call-core, rooms-backend): join helpers ·
 * media (media-fx): processor helpers · recording (recording-client): recording helpers. Owners edit only their own fixture file.
 */
export const test = mergeTests(baseTest, livekitTest, mediaTest, recordingTest)
export { expect }

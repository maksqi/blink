import { mergeTests } from '@playwright/test'
import { expect, test as baseTest } from './base'
import { test as flowsTest } from './flows'
import { test as joinTest } from './join'
import { test as livekitTest } from './livekit'
import { test as mediaTest } from './media'
import { test as recordingTest } from './recording'

/**
 * Single entry point for E2E specs: `import { test, expect } from '../fixtures'`.
 * base (devops-ci): CSP/console/secret guards · livekit (call-core): harness join helpers · join (rooms-backend):
 * DB-backed joins ·
 * media (media-fx): processor helpers · recording (recording-client): recording helpers · flows (e2e): real-flow helpers.
 * Owners edit only their own fixture file.
 */
export const test = mergeTests(baseTest, livekitTest, joinTest, mediaTest, recordingTest, flowsTest)
export { expect }

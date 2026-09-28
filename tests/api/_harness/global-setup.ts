/**
 * Vitest globalSetup for API tests (owned by server-core, Stage 01 W0b).
 * Target behavior: build the server once, start it on a free port against a dedicated test database, expose the
 * base URL via provide('apiBaseUrl'), and stop it on teardown. See docs/TESTING.md.
 */
export default async function setup() {
  // Implemented by server-core.
}

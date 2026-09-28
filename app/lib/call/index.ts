/**
 * Public call API for pages (rooms-ui `/m/[slug]`, the `/dev/call` harness).
 *
 *   const session = createCallSession({ slug, key, media: config.media, publicUrl: config.publicUrl,
 *     livekitUrl: config.livekitUrl, muteOnJoin })            // in setup(); loads SDK + E2EE worker
 *   <CallPrejoin :session="session" :title name-mode="guest" v-model:display-name="name"
 *     :recording-active="info.recordingActive" :joining :error @join="onJoin" />
 *   // onJoin: POST /api/join/:slug (or wait for the SSE `admitted`), then:
 *   await session.connect(grant)                               // JoinGrant; phase → connecting → inCall
 *   <CallView :session="session" :title @rejoin="restart" />   // shows phase screens for left/ended/removed/error
 *   onBeforeUnmount(() => session.dispose())
 *
 * `session.phase` / `session.store.phase` follow `CallPhase`; the host page may set its own phases with
 * `session.setPhase('waiting')`. A session connects once; create a new one to rejoin.
 */
import './zod-jitless'

export { createCallSession, CallSession, type CallSessionOptions } from './session'
export { callRegistry } from './features'
export { default as CallPrejoin } from '~/components/call/core/PreJoin.vue'
export { default as CallView } from '~/components/call/core/CallView.vue'
export { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '../livekit/presets'
export { useCall, useCallSession } from '~/composables/call/useCall'

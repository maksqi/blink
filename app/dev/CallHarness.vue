<script setup lang="ts">
/**
 * `/dev/call` test harness (dev and test builds only; registered by the pages:extend hook in nuxt.config.ts).
 * Runs the real pre-join and call code without the rooms UI:
 *
 *   /dev/call#url=<ws url>&token=<LiveKit token>&k=<room key>&epoch=<meeting epoch>&slug=<slug>&name=<name>
 *            [&e2ee=off] [&mic=0] [&cam=0] [&title=…] [&rec=1] [&muteOnJoin=1] [&nameMode=guest]
 *            [&maxCam=720p|1080p] [&maxShare=720p|1080p] [&shareFps=5|15|30]
 *
 * The fragment is read once and stripped from the address bar right away (like the shell's fragment plugin).
 * `e2ee=off` connects without encryption and exists only for the unencrypted-publisher negative test.
 */
import { onBeforeUnmount } from 'vue'
import CallView from '~/components/call/core/CallView.vue'
import PreJoin from '~/components/call/core/PreJoin.vue'
import { createCallSession, type CallSession } from '~/lib/call/session'
import { testHooks } from '~/lib/contracts/test-hooks'
import { decodeRoomKey, type RoomKey } from '~/lib/e2ee/keys'
import { fromBase64Url, fromUtf8 } from '~/lib/e2ee/encoding'
import { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '~/lib/livekit/presets'
import type { JoinGrant } from '#shared/schemas/join'
import { participantRoleSchema } from '#shared/schemas/livekit'
import { slugSchema } from '#shared/schemas/common'

definePageMeta({ layout: 'call', colorMode: 'dark' })
useHead({ title: 'Call harness' })

interface HarnessParams {
  grant: JoinGrant
  key: RoomKey
  slug: string
  name: string
  title: string
  e2ee: boolean
  camera: boolean
  microphone: boolean
  recording: boolean
  nameMode: 'fixed' | 'guest'
  muteOnJoin: boolean
  media: MediaLimits
}

function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('token')
  return JSON.parse(fromUtf8(fromBase64Url(payload))) as Record<string, unknown>
}

function readParams(hash: string): HarnessParams | string {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const url = params.get('url') ?? ''
  const token = params.get('token') ?? ''
  const epoch = params.get('epoch') ?? ''
  const slug = params.get('slug') ?? ''
  if (!/^wss?:\/\/[^\s]+$/.test(url)) return 'The harness needs #url= with a ws:// or wss:// LiveKit URL.'
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return 'The harness needs #token= with a LiveKit token.'
  if (!/^[A-Za-z0-9_-]{22}$/.test(epoch)) return 'The harness needs #epoch= (16 bytes, base64url).'
  if (!slugSchema.safeParse(slug).success) return 'The harness needs #slug= in the xxx-xxxx-xxx format.'
  let key: RoomKey
  try {
    key = decodeRoomKey(params.get('k') ?? '')
  } catch {
    return 'The harness needs #k= with a 32-byte room key.'
  }
  let claims: Record<string, unknown>
  try {
    claims = tokenClaims(token)
  } catch {
    return 'The token is not a readable LiveKit token.'
  }
  const video = (claims.video ?? {}) as { room?: string }
  const attributes = (claims.attributes ?? {}) as Record<string, string>
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  const fps = Number(params.get('shareFps') ?? DEFAULT_MEDIA_LIMITS.maxScreenShareFps)
  return {
    grant: {
      status: 'admitted',
      token,
      url,
      epoch,
      identity: typeof claims.sub === 'string' ? claims.sub : '',
      role: participantRoleSchema.safeParse(attributes.role).data ?? 'participant',
      roomId: video.room ?? '',
    },
    key,
    slug,
    name: params.get('name') ?? (typeof claims.name === 'string' ? claims.name : ''),
    title: params.get('title') ?? 'Harness meeting',
    e2ee: params.get('e2ee') !== 'off',
    camera: params.get('cam') !== '0',
    microphone: params.get('mic') !== '0',
    recording: params.get('rec') === '1',
    nameMode: params.get('nameMode') === 'guest' ? 'guest' : 'fixed',
    muteOnJoin: params.get('muteOnJoin') === '1',
    media: {
      maxCameraResolution: pick(
        params.get('maxCam'),
        ['720p', '1080p'] as const,
        DEFAULT_MEDIA_LIMITS.maxCameraResolution,
      ),
      maxScreenShareResolution: pick(
        params.get('maxShare'),
        ['720p', '1080p'] as const,
        DEFAULT_MEDIA_LIMITS.maxScreenShareResolution,
      ),
      maxScreenShareFps: [5, 15, 30].includes(fps) ? fps : DEFAULT_MEDIA_LIMITS.maxScreenShareFps,
    },
  }
}

// Read the fragment once and strip it before anything else can pick it up.
const fragment = window.location.hash
const parsed = readParams(fragment)
if (fragment) history.replaceState(history.state, '', window.location.pathname + window.location.search)

const config = typeof parsed === 'string' ? null : parsed
const problem = typeof parsed === 'string' ? parsed : null

const session: CallSession | null = config
  ? createCallSession({
      slug: config.slug,
      key: config.key,
      media: config.media,
      epoch: config.grant.epoch,
      livekitUrl: config.grant.url,
      publicUrl: window.location.origin,
      camera: config.camera,
      microphone: config.microphone,
      muteOnJoin: config.muteOnJoin,
      testOnlyDisableE2EE: !config.e2ee,
    })
  : null

if (__BLINQ_TEST_HOOKS__ && session) {
  const hooks = testHooks()
  if (hooks) {
    hooks.state.harness = {
      identity: config?.grant.identity,
      /** Real reconnect paths of the SDK, for the reconnect banner spec. */
      simulate: (scenario: 'signal-reconnect' | 'resume-reconnect' | 'full-reconnect') =>
        session.room?.simulateScenario(scenario),
      /** Graceful leave, so test teardown does not kill a live connection. */
      leave: () => session.leave(),
      /** The MediaControl media-fx plugs into (processors, mic insert, mic processing). */
      media: session.context.media,
      /** Local publication sids by source: processors must never republish. */
      publications: () =>
        Object.fromEntries(
          [...(session.room?.localParticipant.trackPublications.values() ?? [])].map((p) => [p.source, p.trackSid]),
        ),
    }
  }
}

async function onJoin() {
  if (session && config) await session.connect(config.grant)
}

/** Rejoin = a fresh page with the same parameters (a session connects once). */
function reload() {
  window.location.replace(`${window.location.pathname}${fragment}`)
  window.location.reload()
}

onBeforeUnmount(() => session?.dispose())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="call-harness">
    <div v-if="!session" class="flex flex-1 items-center justify-center p-6">
      <div class="max-w-md rounded-xl bg-card p-6 text-sm ring-1 ring-white/8">
        <h1 class="text-base font-semibold">Call harness</h1>
        <p class="mt-2 text-muted-foreground">{{ problem }}</p>
      </div>
    </div>
    <PreJoin
      v-else-if="session.store.phase === 'prejoin'"
      :session="session"
      :title="config?.title"
      :name-mode="config?.nameMode"
      :display-name="config?.name"
      :recording-active="config?.recording"
      @join="onJoin"
    />
    <CallView v-else :session="session" :title="config?.title" @rejoin="reload" />
  </div>
</template>

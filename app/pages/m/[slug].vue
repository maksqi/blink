<script setup lang="ts">
/**
 * `/m/<slug>` (rooms-ui, Stage 04): the meeting page for hosts, invitees and guests. Client-only (`ssr: false` route
 * rule), so the key is never rendered on the server. The flow (app/composables/rooms/useJoinFlow.ts) finds the key,
 * checks it with the server through the join proof, shows call-core's pre-join, asks for a password and runs the
 * waiting room where needed, then hands over to call-core's `<CallView>`.
 *
 * The call UI (pre-join, waiting room, call view) is loaded on demand: the missing-key, damaged-link and error
 * screens download none of it. Each part is fetched one step ahead (pre-join while the link is checked, the call
 * view and the waiting room once Join is pressed), so no screen waits for its code.
 */
import { LoaderCircleIcon } from '@lucide/vue'
import { defineAsyncComponent, h, type Component } from 'vue'
import DuplicateTab from '@/components/join/DuplicateTab.vue'
import JoinError from '@/components/join/JoinError.vue'
import JoinScreen from '@/components/join/JoinScreen.vue'
import PasswordPrompt from '@/components/join/PasswordPrompt.vue'
import { useJoinFlow } from '~/composables/rooms/useJoinFlow'
import { joinErrorCopy } from '~/lib/join/errors'
import { inCallView, nameModeFor } from '~/lib/join/machine'

definePageMeta({ layout: 'call', colorMode: 'dark' })

const loadPrejoin = () => import('~/components/call/core/PreJoin.vue')
const loadCallView = () => import('~/components/call/core/CallView.vue')
const loadWaitingRoom = () => import('@/components/join/WaitingRoom.vue')

const LOADING = { title: 'Opening the meeting…', description: 'Checking the link and the encryption key.' }
const Loading = () => h(JoinScreen, { icon: LoaderCircleIcon, busy: true, ...LOADING, 'data-testid': 'join-loading' })
/** A part of the call UI that failed to download: the same problem screen as any other unknown failure. */
const LoadFailed = () => h(JoinError, { problem: { code: 'UNKNOWN' }, onRetry: () => window.location.reload() })
const lazy = <T extends Component>(loader: () => Promise<{ default: T }>) =>
  defineAsyncComponent({ loader, loadingComponent: Loading, delay: 0, errorComponent: LoadFailed })

const CallPrejoin = lazy(loadPrejoin)
const CallView = lazy(loadCallView)
const WaitingRoom = lazy(loadWaitingRoom)

const route = useRoute()
// The router ignores letter case (`/M/ABC-…` opens this page); slugs, the join proof and the stored keys are lower case.
const slug = String(route.params.slug ?? '').toLowerCase()
const user = useAuthState()
const flow = useJoinFlow(slug)
const { state, session } = flow

const phase = computed(() => state.value.phase)
const meeting = computed(() => state.value.info?.name)
/** Pre-join comes next, but its call session is still being made (the call code may still be downloading). */
const preparing = computed(() => phase.value === 'prejoin' && !session.value && !state.value.duplicate)
const notice = computed(() => (state.value.notice ? joinErrorCopy(state.value.notice).message : null))
const cancelling = ref(false)

useHead({ title: computed(() => meeting.value ?? 'Meeting') })

async function cancel() {
  cancelling.value = true
  try {
    await flow.cancelWaiting()
  } finally {
    cancelling.value = false
  }
}

function prefetch(...loaders: Array<() => Promise<unknown>>) {
  for (const load of loaders) load().catch(() => {}) // a failure shows up when the part is rendered
}

watch(
  () => [phase.value, state.value.joining] as const,
  ([current, joining]) => {
    if (current === 'info') prefetch(loadPrejoin)
    else if (joining || current === 'password') prefetch(loadCallView, loadWaitingRoom)
  },
)

onMounted(() => void flow.start())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="join-flow" :data-phase="phase">
    <JoinScreen
      v-if="phase === 'loading' || phase === 'info' || preparing"
      :icon="LoaderCircleIcon"
      busy
      :title="LOADING.title"
      :description="LOADING.description"
      data-testid="join-loading"
    />
    <JoinError v-else-if="phase === 'needKey'" :problem="{ code: 'MISSING_KEY' }" />
    <JoinError
      v-else-if="phase === 'error' && state.problem"
      :problem="state.problem"
      :meeting="meeting"
      @retry="flow.reload"
      @signin="flow.signIn"
    />
    <DuplicateTab
      v-else-if="state.duplicate && (phase === 'prejoin' || phase === 'password')"
      :meeting="meeting"
      :busy="flow.takingOver.value"
      @use-here="flow.takeOver"
    />
    <CallPrejoin
      v-else-if="phase === 'prejoin' && session"
      :session="session"
      :title="meeting"
      :name-mode="nameModeFor(state.info)"
      :display-name="state.info?.signedIn ? (user?.displayName ?? '') : (state.displayName ?? '')"
      :recording-active="state.info?.recordingActive"
      :joining="state.joining"
      :join-label="state.info?.waitingRoom ? 'Ask to join' : 'Join now'"
      :error="notice"
      @join="flow.join"
    />
    <PasswordPrompt
      v-else-if="phase === 'password'"
      :meeting="meeting"
      :error="notice"
      :joining="state.joining"
      @submit="flow.submitPassword"
      @back="flow.backFromPassword"
    />
    <WaitingRoom
      v-else-if="phase === 'waiting'"
      :session="session"
      :meeting="meeting"
      :cancelling="cancelling"
      @cancel="cancel"
    />
    <CallView v-else-if="session && inCallView(state)" :session="session" :title="meeting" :on-rejoin="flow.reload" />
  </div>
</template>

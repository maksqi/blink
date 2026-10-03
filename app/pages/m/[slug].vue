<script setup lang="ts">
/**
 * `/m/<slug>` (rooms-ui, Stage 04): the meeting page for hosts, invitees and guests. Client-only (`ssr: false` route
 * rule), so the key is never rendered on the server. The flow (app/composables/rooms/useJoinFlow.ts) finds the key,
 * checks it with the server through the join proof, shows call-core's pre-join, asks for a password and runs the
 * waiting room where needed, then hands over to call-core's `<CallView>`.
 */
import { LoaderCircleIcon } from '@lucide/vue'
import DuplicateTab from '@/components/join/DuplicateTab.vue'
import JoinError from '@/components/join/JoinError.vue'
import JoinScreen from '@/components/join/JoinScreen.vue'
import PasswordPrompt from '@/components/join/PasswordPrompt.vue'
import WaitingRoom from '@/components/join/WaitingRoom.vue'
import CallPrejoin from '~/components/call/core/PreJoin.vue'
import CallView from '~/components/call/core/CallView.vue'
import { useJoinFlow } from '~/composables/rooms/useJoinFlow'
import { joinErrorCopy } from '~/lib/join/errors'
import { inCallView, nameModeFor } from '~/lib/join/machine'

definePageMeta({ layout: 'call', colorMode: 'dark' })

const route = useRoute()
// The router ignores letter case (`/M/ABC-…` opens this page); slugs, the join proof and the stored keys are lower case.
const slug = String(route.params.slug ?? '').toLowerCase()
const user = useAuthState()
const flow = useJoinFlow(slug)
const { state, session } = flow

const phase = computed(() => state.value.phase)
const meeting = computed(() => state.value.info?.name)
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

onMounted(() => void flow.start())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="join-flow" :data-phase="phase">
    <JoinScreen
      v-if="phase === 'loading' || phase === 'info'"
      :icon="LoaderCircleIcon"
      busy
      title="Opening the meeting…"
      description="Checking the link and the encryption key."
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

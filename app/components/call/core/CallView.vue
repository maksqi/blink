<script setup lang="ts">
/**
 * The in-call view (`<CallView :session>`): top bar with the E2EE badge, grid or speaker/presentation stage, side
 * panels and the control bar from the feature registries, reconnect banner, notices and dialogs. Terminal phases
 * show the highest-order registered phase screen. Hotkeys: M, V, Space (push to talk), ?.
 */
import { LoaderCircleIcon, UsersIcon, XIcon } from '@lucide/vue'
import { useIntervalFn, useMediaQuery, useWindowSize } from '@vueuse/core'
import { computed, provide, shallowRef, watch } from 'vue'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import CallNotices from './CallNotices.vue'
import ControlBar from './ControlBar.vue'
import E2EEBadge from './E2EEBadge.vue'
import HotkeyHelp from './HotkeyHelp.vue'
import ReconnectBanner from './ReconnectBanner.vue'
import SafetyCodeDialog from './SafetyCodeDialog.vue'
import SettingsDialog from './SettingsDialog.vue'
import SpeakerView from './SpeakerView.vue'
import UnsupportedBrowser from './UnsupportedBrowser.vue'
import VideoGrid from './VideoGrid.vue'
import { useCallHotkeys } from '~/composables/call/useCallHotkeys'
import { provideCallUi } from '~/composables/call/useCallUi'
import { CALL_SESSION_KEY } from '~/lib/call/context-key'
import { isTerminalPhase } from '~/lib/call/disconnect'
import { callRegistry } from '~/lib/call/features'
import { phaseScreenFor, visibleItems } from '~/lib/call/registry'
import type { CallSession } from '~/lib/call/session'
import { viewportClass } from '~/lib/layout/grid'

const props = defineProps<{
  session: CallSession
  /** Meeting name for the top bar. */
  title?: string
  /** Offer "Rejoin" on the left/error screens (the host page restarts the join). */
  onRejoin?: () => void
}>()

provide(CALL_SESSION_KEY, props.session)
const ui = provideCallUi()
watch(
  () => props.onRejoin,
  (rejoin) => {
    ui.rejoin.value = rejoin ?? null
  },
  { immediate: true },
)

const store = props.session.store
const ctx = props.session.context
const phase = computed(() => store.phase)
const terminal = computed(() => isTerminalPhase(phase.value))
const phaseScreen = computed(() => (terminal.value ? phaseScreenFor(callRegistry, phase.value) : undefined))

const { width, height } = useWindowSize()
const phone = computed(() => viewportClass(width.value, height.value) === 'phone')
const wide = useMediaQuery('(min-width: 1024px)')

const presenting = computed(
  () => store.participants.some((p) => p.screenSharing && !p.isLocal) || store.screenShare.active,
)
const mode = computed(() => (presenting.value || store.pinned ? 'speaker' : store.layout))

const panels = computed(() => visibleItems(callRegistry.panels, ctx))
const openPanel = computed(() => panels.value.find((panel) => panel.id === ui.panel.value) ?? null)
watch(openPanel, (panel) => {
  if (!panel && ui.panel.value) ui.panel.value = null
})

const now = shallowRef(Date.now())
useIntervalFn(() => (now.value = Date.now()), 1000)
const elapsed = computed(() => {
  if (!store.connectedAt) return ''
  const seconds = Math.max(0, Math.floor((now.value - store.connectedAt) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
})

useCallHotkeys({
  enabled: () => phase.value === 'inCall' || phase.value === 'reconnecting',
  micMuted: () => !store.media.micOn,
  onAction: (action) => {
    switch (action) {
      case 'toggle-mic':
        void props.session.toggleMic()
        break
      case 'toggle-camera':
        void props.session.toggleCamera()
        break
      case 'ptt-start':
        void props.session.setMicEnabled(true)
        break
      case 'ptt-end':
        void props.session.setMicEnabled(false)
        break
      case 'help':
        ui.hotkeysOpen.value = true
        break
    }
  },
})
</script>

<template>
  <TooltipProvider>
    <div class="flex min-h-0 flex-1 flex-col" data-testid="call-view" :data-phase="phase">
      <UnsupportedBrowser v-if="!session.support.ok" :message="store.error?.message ?? ''" />

      <component :is="phaseScreen.component" v-else-if="terminal && phaseScreen" />

      <template v-else>
        <header class="flex h-14 shrink-0 items-center gap-2 px-3 sm:gap-3 sm:px-4">
          <E2EEBadge />
          <div class="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 class="truncate text-sm font-medium">{{ title || 'Meeting' }}</h1>
            <span
              v-if="elapsed"
              class="shrink-0 text-xs text-muted-foreground tabular-nums"
              data-testid="call-elapsed"
              >{{ elapsed }}</span
            >
          </div>
          <span
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/85"
            aria-label="Participants"
          >
            <UsersIcon class="size-3.5" aria-hidden="true" />
            <span class="tabular-nums" data-testid="participant-count">{{ store.participants.length }}</span>
          </span>
        </header>

        <div class="relative flex min-h-0 flex-1 gap-2 px-2 sm:px-3">
          <main class="relative min-h-0 min-w-0 flex-1" aria-label="Participants video">
            <div
              v-if="phase === 'connecting'"
              class="flex size-full items-center justify-center"
              data-testid="call-connecting"
            >
              <div class="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <Spinner class="size-6" />
                Joining the meeting…
              </div>
            </div>
            <VideoGrid v-else-if="mode === 'grid'" :participants="store.participants" :phone="phone" />
            <SpeakerView v-else :participants="store.participants" :phone="phone" />
          </main>

          <aside
            v-if="openPanel && wide"
            class="flex w-[22rem] shrink-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-white/6"
            :aria-label="openPanel.title"
            :data-panel="openPanel.id"
          >
            <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
              <h2 class="text-sm font-semibold">{{ openPanel.title }}</h2>
              <button
                type="button"
                class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/8 hover:text-foreground"
                :aria-label="`Close ${openPanel.title}`"
                @click="ui.panel.value = null"
              >
                <XIcon class="size-4" aria-hidden="true" />
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <component :is="openPanel.component" />
            </div>
          </aside>

          <ReconnectBanner />
          <CallNotices />
          <div
            v-if="phase === 'reconnecting'"
            class="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <LoaderCircleIcon class="size-8 text-white/40 motion-safe:animate-spin" aria-hidden="true" />
          </div>
        </div>

        <ControlBar />

        <Sheet
          v-if="!wide"
          :open="Boolean(openPanel)"
          @update:open="(value: boolean) => !value && (ui.panel.value = null)"
        >
          <SheetContent side="right" class="w-full max-w-md p-0 sm:max-w-md">
            <SheetHeader class="border-b">
              <SheetTitle>{{ openPanel?.title }}</SheetTitle>
              <SheetDescription class="sr-only">{{ openPanel?.title }}</SheetDescription>
            </SheetHeader>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <component :is="openPanel.component" v-if="openPanel" />
            </div>
          </SheetContent>
        </Sheet>
      </template>

      <SettingsDialog />
      <HotkeyHelp />
      <SafetyCodeDialog />
    </div>
  </TooltipProvider>
</template>

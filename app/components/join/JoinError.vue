<script setup lang="ts">
/**
 * Full-screen join problem with a clear next step (rooms-ui, Stage 04): every join error code, a key missing or
 * damaged in the link, an unsupported browser and a meeting that ended in the waiting room. Copy comes from
 * app/lib/join/errors.ts, keyed by the stable code (never server text).
 */
import {
  BanIcon,
  CircleAlertIcon,
  DoorClosedIcon,
  KeyRoundIcon,
  LinkIcon,
  LockKeyholeIcon,
  LogInIcon,
  ServerOffIcon,
  ShieldOffIcon,
  TimerIcon,
  UserXIcon,
  UsersIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import { Button } from '@/components/ui/button'
import { joinErrorCopy, type JoinProblem, type JoinProblemCode } from '~/lib/join/errors'
import JoinScreen from './JoinScreen.vue'

const props = defineProps<{ problem: JoinProblem; meeting?: string }>()
const emit = defineEmits<{ retry: []; signin: [] }>()

const ICONS: Partial<Record<JoinProblemCode, Component>> = {
  ROOM_KEY_INVALID: KeyRoundIcon,
  MISSING_KEY: LinkIcon,
  INVALID_LINK: LinkIcon,
  ROOM_NOT_FOUND: DoorClosedIcon,
  ROOM_INVITE_REQUIRED: LinkIcon,
  ROOM_INVITE_INVALID: LinkIcon,
  ROOM_GUESTS_NOT_ALLOWED: LogInIcon,
  ROOM_LOCKED: LockKeyholeIcon,
  ROOM_FULL: UsersIcon,
  LOBBY_FULL: UsersIcon,
  JOIN_REMOVED: UserXIcon,
  JOIN_DENIED: BanIcon,
  RATE_LIMITED: TimerIcon,
  UNSUPPORTED_BROWSER: ShieldOffIcon,
  MEETING_ENDED: DoorClosedIcon,
  SERVICE_UNAVAILABLE: ServerOffIcon,
}

const copy = computed(() => joinErrorCopy(props.problem))
const icon = computed(() => ICONS[props.problem.code] ?? CircleAlertIcon)
</script>

<template>
  <JoinScreen
    :icon="icon"
    :title="copy.title"
    :description="copy.message"
    :meeting="meeting"
    data-testid="join-error"
    :data-code="problem.code"
    role="alert"
  >
    <div class="flex flex-wrap justify-center gap-2">
      <Button v-if="copy.next === 'signin'" data-testid="join-error-signin" @click="emit('signin')">
        <LogInIcon data-icon="inline-start" aria-hidden="true" />
        Sign in
      </Button>
      <Button v-if="copy.next === 'retry'" data-testid="join-error-retry" @click="emit('retry')">Try again</Button>
      <Button :variant="copy.next === 'home' ? 'default' : 'secondary'" as-child>
        <NuxtLink to="/" prefetch-on="interaction">Back to home</NuxtLink>
      </Button>
    </div>
  </JoinScreen>
</template>

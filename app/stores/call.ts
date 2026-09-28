/**
 * Call state (Pinia). One call per page: `createCallSession()` resets the store and becomes its writer; components and
 * features read it (through `useCall()` or directly). LiveKit objects never live here: the session keeps them
 * `markRaw` and projects them into plain values (`ParticipantView`, device lists, flags).
 */
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import type { CallPhase, LayoutMode, ParticipantView } from '~/lib/contracts/call'
import type { RoomMetadata } from '#shared/schemas/livekit'
import { emptyDeviceLists, type DeviceKind, type DeviceLists, type DevicePermission } from '~/lib/call/devices'
import type { LocalMediaStatus } from '~/lib/livekit/local-media'

export type CallErrorReason =
  | 'unsupported-browser'
  | 'unsupported-e2ee'
  | 'connect-failed'
  | 'connection-lost'
  | 'server'
  | 'invalid-key'

export interface CallError {
  reason: CallErrorReason
  message: string
}

export interface PublishPermissions {
  camera: boolean
  microphone: boolean
  screenShare: boolean
  screenShareAudio: boolean
}

export type E2EEBadgeState = 'pending' | 'encrypted' | 'warning' | 'blocked' | 'off'

const ALL_ALLOWED: PublishPermissions = { camera: true, microphone: true, screenShare: true, screenShareAudio: true }

const IDLE_MEDIA: LocalMediaStatus = {
  cameraOn: false,
  micOn: false,
  cameraError: null,
  micError: null,
  cameraBusy: false,
  micBusy: false,
  cameraDeviceId: null,
  micDeviceId: null,
}

export const useCallStore = defineStore('call', () => {
  const sessionId = shallowRef<string | null>(null)
  const phase = shallowRef<CallPhase>('prejoin')
  const phaseHistory = shallowRef<CallPhase[]>([])
  const error = shallowRef<CallError | null>(null)
  const slug = shallowRef<string | null>(null)
  const roomId = shallowRef<string | null>(null)
  const localIdentity = shallowRef<string | null>(null)
  /** Everyone in the call, the local participant first, then by join time. */
  const participants = shallowRef<ParticipantView[]>([])
  const roomState = shallowRef<RoomMetadata | null>(null)
  const layout = shallowRef<LayoutMode>('grid')
  const pinned = shallowRef<string | null>(null)
  /** Last remote participant who spoke (speaker view stage). */
  const activeSpeaker = shallowRef<string | null>(null)
  const media = shallowRef<LocalMediaStatus>({ ...IDLE_MEDIA })
  const screenShare = shallowRef<{ active: boolean; busy: boolean }>({ active: false, busy: false })
  const permissions = shallowRef<PublishPermissions>({ ...ALL_ALLOWED })
  const devices = shallowRef<DeviceLists>(emptyDeviceLists())
  const devicePermissions = shallowRef<Record<'camera' | 'microphone', DevicePermission>>({
    camera: 'unknown',
    microphone: 'unknown',
  })
  const outputDevice = shallowRef<string | null>(null)
  const e2eeEnabled = shallowRef(false)
  const e2eeRequired = shallowRef(true)
  const safetyCode = shallowRef<string | null>(null)
  /** Identities whose publications are unencrypted (their media is blocked). */
  const blocked = shallowRef<string[]>([])
  /** Identities whose media cannot be decrypted with our key. */
  const undecryptable = shallowRef<string[]>([])
  const audioBlocked = shallowRef(false)
  const reconnectedAt = shallowRef<number | null>(null)
  const connectedAt = shallowRef<number | null>(null)
  const localVolumes = shallowRef<Record<string, number>>({})
  const micGain = shallowRef(1)
  const muteOnJoin = shallowRef(false)

  const self = computed(() => participants.value.find((p) => p.isLocal) ?? null)
  const remoteParticipants = computed(() => participants.value.filter((p) => !p.isLocal))
  const role = computed(() => self.value?.role ?? 'participant')
  const isModerator = computed(() => role.value === 'host' || role.value === 'cohost')

  const e2eeBadge = computed<E2EEBadgeState>(() => {
    if (!e2eeRequired.value) return 'off'
    if (!e2eeEnabled.value) return 'pending'
    if (blocked.value.length > 0) return 'blocked'
    if (undecryptable.value.length > 0) return 'warning'
    return 'encrypted'
  })

  function setPhase(next: CallPhase) {
    if (phase.value === next) return
    phase.value = next
    phaseHistory.value = [...phaseHistory.value, next].slice(-50)
  }

  function reset(id: string | null) {
    sessionId.value = id
    phase.value = 'prejoin'
    phaseHistory.value = ['prejoin']
    error.value = null
    slug.value = null
    roomId.value = null
    localIdentity.value = null
    participants.value = []
    roomState.value = null
    layout.value = 'grid'
    pinned.value = null
    activeSpeaker.value = null
    media.value = { ...IDLE_MEDIA }
    screenShare.value = { active: false, busy: false }
    permissions.value = { ...ALL_ALLOWED }
    devices.value = emptyDeviceLists()
    devicePermissions.value = { camera: 'unknown', microphone: 'unknown' }
    outputDevice.value = null
    e2eeEnabled.value = false
    e2eeRequired.value = true
    safetyCode.value = null
    blocked.value = []
    undecryptable.value = []
    audioBlocked.value = false
    reconnectedAt.value = null
    connectedAt.value = null
    localVolumes.value = {}
    micGain.value = 1
    muteOnJoin.value = false
  }

  function selectedDevice(kind: DeviceKind): string | null {
    if (kind === 'videoinput') return media.value.cameraDeviceId
    if (kind === 'audioinput') return media.value.micDeviceId
    return outputDevice.value
  }

  return {
    sessionId,
    phase,
    phaseHistory,
    error,
    slug,
    roomId,
    localIdentity,
    participants,
    roomState,
    layout,
    pinned,
    activeSpeaker,
    media,
    screenShare,
    permissions,
    devices,
    devicePermissions,
    outputDevice,
    e2eeEnabled,
    e2eeRequired,
    safetyCode,
    blocked,
    undecryptable,
    audioBlocked,
    reconnectedAt,
    connectedAt,
    localVolumes,
    micGain,
    muteOnJoin,
    self,
    remoteParticipants,
    role,
    isModerator,
    e2eeBadge,
    setPhase,
    reset,
    selectedDevice,
  }
})

export type CallStore = ReturnType<typeof useCallStore>

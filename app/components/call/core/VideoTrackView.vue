<script setup lang="ts">
/**
 * Renders one LiveKit video track. Remote tracks report their first decoded frame to the join-time metrics
 * (`blinq:join:first-remote-frame`, via requestVideoFrameCallback).
 */
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client'
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { cn } from '@/lib/utils'
import { watchFirstRemoteFrame } from '~/lib/call/metrics'

const props = withDefaults(
  defineProps<{
    track: LocalVideoTrack | RemoteTrack | null
    /** Mirror the local camera like a mirror. */
    mirror?: boolean
    fit?: 'cover' | 'contain'
    remote?: boolean
  }>(),
  { mirror: false, fit: 'cover', remote: false },
)

const video = shallowRef<HTMLVideoElement | null>(null)
let attached: { track: LocalVideoTrack | RemoteTrack; element: HTMLVideoElement } | null = null

function detach() {
  if (!attached) return
  attached.track.detach(attached.element)
  attached = null
}

watch(
  [() => props.track, video],
  ([track, element]) => {
    if (attached && (attached.track !== track || attached.element !== element)) detach()
    if (!track || !element || attached) return
    track.attach(element)
    attached = { track, element }
    if (props.remote) watchFirstRemoteFrame(element)
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(detach)
</script>

<template>
  <video
    ref="video"
    autoplay
    playsinline
    muted
    disablepictureinpicture
    :class="cn('size-full bg-transparent', fit === 'contain' ? 'object-contain' : 'object-cover', mirror && '-scale-x-100')"
  />
</template>

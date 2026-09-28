import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { TileInfo } from '~/lib/call/tile-tracker'
import { useCallSession } from './useCall'

/**
 * Registers a rendered tile with the session's tile tracker, so the subscription policy requests exactly the size it
 * is drawn at and pauses it when it leaves the viewport.
 */
export function useVideoTile(element: Ref<HTMLElement | null | undefined>, info: () => TileInfo): void {
  const session = useCallSession()
  let registration: { update(info: TileInfo): void; unregister(): void } | null = null

  watch(
    element,
    (el) => {
      registration?.unregister()
      registration = el ? session.tiles.register(el, info()) : null
    },
    { immediate: true, flush: 'post' },
  )
  watch(info, (next) => registration?.update(next), { deep: true })
  onBeforeUnmount(() => {
    registration?.unregister()
    registration = null
  })
}

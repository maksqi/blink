/**
 * After a removal: the removed person still holds the room key K until the host rotates it (docs/SECURITY.md §3.5), so
 * the host gets a persistent reminder linking to the room settings, and co-hosts are asked to tell the host. The
 * reminder also stays in the host controls menu (and the end screen) until the call ends.
 */
import { defineComponent, h, markRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { CallContext } from '../../../contracts/call'
import { hostActionsState } from './state'
import RotateKeyLink from '~/components/call/host/RotateKeyLink.vue'

export { roomSettingsPath } from './links'

export const HOST_ROTATE_TEXT =
  "People you remove still know this meeting's key. Rotate it in the room settings after the meeting."
export const COHOST_ROTATE_TEXT = 'Ask the host to rotate the room key after the meeting.'

export function rotateReminderText(role: string | null | undefined): string {
  return role === 'host' ? HOST_ROTATE_TEXT : COHOST_ROTATE_TEXT
}

export function afterRemoval(ctx: CallContext): void {
  const state = hostActionsState(ctx)
  state.removedCount.value++
  const roomId = ctx.roomId.value
  if (ctx.self.value?.role === 'host' && roomId) {
    toast.warning(HOST_ROTATE_TEXT, {
      id: 'blinq-rotate-key',
      position: 'top-center',
      duration: Number.POSITIVE_INFINITY,
      description: markRaw(
        defineComponent({ name: 'RotateKeyToastLink', setup: () => () => h(RotateKeyLink, { roomId }) }),
      ),
    })
  } else {
    toast.info(COHOST_ROTATE_TEXT, { id: 'blinq-rotate-key', position: 'top-center', duration: 10_000 })
  }
}

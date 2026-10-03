/**
 * Copy and share for meeting links, client-side only. Links carry the room key in the fragment; they are never sent
 * to the server.
 */
import { toast } from 'vue-sonner'
import { mailtoHref, shareTitle } from '~/lib/join/share'

export function useLinkSharing() {
  const canShare = shallowRef(false)
  onMounted(() => {
    canShare.value = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  })

  async function copy(link: string, message = 'Link copied'): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(message)
      return true
    } catch {
      toast.error("Couldn't copy the link. Select it and copy it yourself.")
      return false
    }
  }

  async function share(link: string, roomName: string): Promise<void> {
    try {
      await navigator.share({ title: shareTitle(roomName), url: link })
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  return { canShare, copy, share, mailtoHref }
}

/**
 * Chat feature (Stage 06): end-to-end encrypted, text-only chat in a side panel, with the unread count as its badge
 * while the panel is closed. Messages are received from the start of the call, panel open or not.
 */
import { MessageSquareTextIcon } from '@lucide/vue'
import { defineCallFeature } from '../../../contracts/call'
import { chatState } from './useChat'
import ChatPanel from '~/components/call/chat/ChatPanel.vue'

export default defineCallFeature({
  id: 'chat',
  panels: [
    {
      id: 'chat',
      title: 'Chat',
      icon: MessageSquareTextIcon,
      order: 30,
      component: ChatPanel,
      badge: (ctx) => chatState(ctx).unread.value || undefined,
    },
  ],
  setup(ctx) {
    const chat = chatState(ctx)
    return () => chat.dispose()
  },
})

<script setup lang="ts">
/**
 * In-call invite for hosts and co-hosts: creates a 24 h room invite (`POST /api/rooms/:id/invites`) and builds the
 * link with the key in the fragment (`buildRoomLink`). The link is shown and copied client-side only.
 */
import { CheckIcon, CopyIcon, Share2Icon, UserPlusIcon } from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useCallSession } from '~/composables/call'
import { callToast } from '~/lib/call/notify'
import { ApiError } from '~/composables/useApi'

const session = useCallSession()

const open = shallowRef(false)
const link = shallowRef<string | null>(null)
const creating = shallowRef(false)
const copied = shallowRef(false)
const canShare = computed(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function')

async function create() {
  creating.value = true
  try {
    link.value = await session.createInviteLink()
  } catch (error) {
    callToast.error(error instanceof ApiError ? error.message : "The invite link couldn't be created. Try again.")
  } finally {
    creating.value = false
  }
}

async function copy() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    callToast.error("Couldn't copy. Select the link and copy it yourself.")
  }
}

async function share() {
  if (!link.value) return
  try {
    await navigator.share({ title: 'Join my blinq meeting', url: link.value })
  } catch {
    // Dismissed share sheets are not errors.
  }
}

function onOpenChange(value: boolean) {
  open.value = value
  if (value && !link.value && !creating.value) void create()
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <button
        type="button"
        aria-label="Invite people"
        title="Invite people"
        data-control="invite"
        class="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-white/10 px-3 text-white transition-colors hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <UserPlusIcon class="size-5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" :side-offset="10" class="w-[min(24rem,calc(100vw-2rem))]">
      <PopoverHeader>
        <PopoverTitle>Invite people</PopoverTitle>
        <PopoverDescription>
          Anyone with this link can ask to join for the next 24 hours. It contains the meeting key, so share it only
          with people you trust.
        </PopoverDescription>
      </PopoverHeader>
      <div class="mt-3 flex items-center gap-2">
        <Input
          :model-value="link ?? ''"
          readonly
          aria-label="Invite link"
          :placeholder="creating ? 'Creating link…' : ''"
          class="font-mono text-xs"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <Button
          size="icon"
          variant="secondary"
          :disabled="!link"
          :aria-label="copied ? 'Copied' : 'Copy link'"
          @click="copy"
        >
          <Spinner v-if="creating" />
          <CheckIcon v-else-if="copied" />
          <CopyIcon v-else />
        </Button>
        <Button
          v-if="canShare"
          size="icon"
          variant="secondary"
          :disabled="!link"
          aria-label="Share link"
          @click="share"
        >
          <Share2Icon />
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

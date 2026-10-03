<script setup lang="ts">
/**
 * Room invites (owner and co-hosts, rooms-ui Stage 04): create (label, expiry, max uses), list and revoke. The server
 * stores no link: it re-derives each invite token, and this device builds the link with the room key it holds,
 * `buildRoomLink(publicUrl, slug, K, token)`. Links are shared by copy, the share sheet or the mail app; the server
 * never emails them. Without the key on this device no link can be built, and the list says so.
 */
import { CopyIcon, MailIcon, PlusIcon, Share2Icon, TicketIcon, XIcon } from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import { createRoomInviteSchema, type RoomDetails, type RoomInvite } from '#shared/schemas/rooms'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from '@/components/auth/FormAlert.vue'
import { buildRoomLink } from '~/lib/e2ee/fragment'
import type { RoomKey } from '~/lib/e2ee/keys'
import {
  formatRelativeTime,
  INVITE_STATE_LABEL,
  inviteExpiryText,
  inviteState,
  inviteUsesText,
} from '~/lib/join/format'
import { useLinkSharing } from '~/composables/rooms/useLinkSharing'
import { useRoomsApi, type InviteExpiry } from '~/composables/rooms/useRoomsApi'
import { authErrorText, fieldMessages } from '~/composables/useAuth'

const props = defineProps<{ room: RoomDetails; roomKey: RoomKey | null; publicUrl: string }>()

const EXPIRY_OPTIONS: Array<{ value: InviteExpiry; label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: 'never', label: 'Never' },
]
const labelSchema = createRoomInviteSchema.shape.label.unwrap()
const maxUsesSchema = createRoomInviteSchema.shape.maxUses.unwrap().unwrap()

const rooms = useRoomsApi()
const sharing = useLinkSharing()
const invites = shallowRef<RoomInvite[] | null>(null)
const loadError = ref<string | null>(null)
const formError = ref<string | null>(null)
const now = ref(Date.now())
const createdId = ref<string | null>(null)

const sorted = computed(() => {
  const list = [...(invites.value ?? [])]
  const rank = (invite: RoomInvite) => (inviteState(invite, now.value) === 'active' ? 0 : 1)
  return list.sort((a, b) => rank(a) - rank(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
})

function linkFor(invite: RoomInvite): string | null {
  if (!props.roomKey) return null
  return buildRoomLink(props.publicUrl || window.location.origin, props.room.slug, props.roomKey, invite.token)
}

async function load() {
  try {
    invites.value = await rooms.invites(props.room.id)
    now.value = Date.now()
    loadError.value = null
  } catch (error) {
    loadError.value = authErrorText(error)
  }
}

function validateMaxUses({ value }: { value: string }) {
  if (!value.trim()) return undefined
  const result = maxUsesSchema.safeParse(Number(value))
  return result.success ? undefined : 'Enter a whole number from 1 to 1000, or leave it empty'
}

// Submit only once hydrated: a native submission would send the fields to the page URL (F-020).
const hydrated = useHydrated()
const form = useForm({
  defaultValues: { label: '', expiresIn: '24h' as InviteExpiry, maxUses: '' },
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    try {
      const label = value.label.trim()
      const invite = await rooms.createInvite(props.room.id, {
        ...(label ? { label } : {}),
        expiresIn: value.expiresIn,
        maxUses: value.maxUses.trim() ? Number(value.maxUses) : null,
      })
      invites.value = [invite, ...(invites.value ?? [])]
      now.value = Date.now()
      createdId.value = invite.id
      formApi.reset()
      toast.success('Invite created', {
        description: props.roomKey ? 'Copy its link below and send it to the people you invite.' : undefined,
      })
    } catch (error) {
      formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

const revokeTarget = shallowRef<RoomInvite | null>(null)
const revokeOpen = ref(false)
const revoking = ref(false)

function askRevoke(invite: RoomInvite) {
  revokeTarget.value = invite
  revokeOpen.value = true
}

async function confirmRevoke() {
  const invite = revokeTarget.value
  if (!invite) return
  revoking.value = true
  try {
    await rooms.revokeInvite(props.room.id, invite.id)
    invites.value = (invites.value ?? []).map((item) => (item.id === invite.id ? { ...item, revoked: true } : item))
    revokeOpen.value = false
    toast.success('Invite revoked', {
      description: props.room.isOwner
        ? 'People who opened it already know the room key. Rotate the key before the next meeting to lock them out.'
        : 'People who opened it already know the room key. Ask the owner to rotate the key before the next meeting.',
    })
  } catch (error) {
    toast.error("The invite couldn't be revoked", { description: authErrorText(error) })
  } finally {
    revoking.value = false
  }
}

onMounted(() => void load())
watch(
  () => props.room.id,
  () => void load(),
)
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="invite-manager">
    <FormAlert
      v-if="!roomKey"
      tone="info"
      title="Links can't be built on this device"
      :message="
        room.isOwner
          ? 'The room key is not on this device, so invite links cannot be built here. Open this page on the device that has the key, or rotate the key to make a new one here.'
          : 'The room key is not on this device, so invite links cannot be built here. Open the meeting once with a host link on this device.'
      "
    />

    <form
      method="post"
      class="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
      novalidate
      data-testid="invite-form"
      @submit.prevent.stop="form.handleSubmit()"
    >
      <FormAlert class="sm:col-span-3" :message="formError" />
      <form.Field name="label" :validators="{ onSubmit: labelSchema }">
        <template #default="{ field }">
          <Field
            :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
            class="gap-1.5 sm:col-span-3"
          >
            <FieldLabel for="invite-label">Label (optional)</FieldLabel>
            <Input
              id="invite-label"
              :model-value="field.state.value"
              maxlength="80"
              placeholder="Design team"
              autocomplete="off"
              @update:model-value="(value: string | number) => field.handleChange(String(value))"
              @blur="field.handleBlur"
            />
            <FieldError :errors="fieldMessages(field.state.meta.errors)" />
          </Field>
        </template>
      </form.Field>
      <form.Field name="expiresIn">
        <template #default="{ field }">
          <Field class="gap-1.5">
            <FieldLabel for="invite-expiry">Expires after</FieldLabel>
            <Select
              :model-value="field.state.value"
              @update:model-value="(value) => field.handleChange(value as InviteExpiry)"
            >
              <SelectTrigger id="invite-expiry" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in EXPIRY_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </template>
      </form.Field>
      <form.Field name="maxUses" :validators="{ onBlur: validateMaxUses, onSubmit: validateMaxUses }">
        <template #default="{ field }">
          <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined" class="gap-1.5">
            <FieldLabel for="invite-max-uses">Max uses</FieldLabel>
            <Input
              id="invite-max-uses"
              :model-value="field.state.value"
              type="number"
              inputmode="numeric"
              min="1"
              max="1000"
              placeholder="No limit"
              @update:model-value="(value: string | number) => field.handleChange(String(value))"
              @blur="field.handleBlur"
            />
            <FieldError :errors="fieldMessages(field.state.meta.errors)" />
          </Field>
        </template>
      </form.Field>
      <div class="flex sm:pt-[1.375rem]">
        <Button type="submit" class="w-full sm:w-auto" :disabled="submitting || !hydrated" data-testid="invite-create">
          <Spinner v-if="submitting" data-icon="inline-start" />
          <PlusIcon v-else data-icon="inline-start" aria-hidden="true" />
          Create invite
        </Button>
      </div>
      <FieldDescription class="sm:col-span-3">
        Each person who joins with an invite uses it once. Hosts and co-hosts don't need one.
      </FieldDescription>
    </form>

    <div v-if="invites === null && !loadError" class="space-y-2" aria-busy="true" aria-label="Loading invites">
      <Skeleton v-for="i in 2" :key="i" class="h-20 w-full" />
    </div>
    <FormAlert v-else-if="loadError" :message="loadError" title="Invites could not be loaded" />
    <p
      v-else-if="sorted.length === 0"
      class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
      data-testid="invites-empty"
    >
      No invites yet. Create one to let people join.
    </p>
    <ul v-else class="flex flex-col gap-3" aria-label="Invites">
      <li
        v-for="invite in sorted"
        :key="invite.id"
        class="rounded-lg border bg-card p-4"
        :class="createdId === invite.id ? 'ring-2 ring-primary/30' : undefined"
        data-testid="invite-item"
        :data-state="inviteState(invite, now)"
      >
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0">
            <p class="flex items-center gap-2 font-medium">
              <TicketIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="truncate">{{ invite.label || 'Invite' }}</span>
              <Badge :variant="inviteState(invite, now) === 'active' ? 'secondary' : 'outline'">
                {{ INVITE_STATE_LABEL[inviteState(invite, now)] }}
              </Badge>
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              Created {{ formatRelativeTime(invite.createdAt, now) }} · {{ inviteExpiryText(invite, now) }} ·
              {{ inviteUsesText(invite) }}
            </p>
          </div>
          <Button
            v-if="!invite.revoked"
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive"
            data-testid="invite-revoke"
            @click="askRevoke(invite)"
          >
            <XIcon data-icon="inline-start" aria-hidden="true" />
            Revoke
          </Button>
        </div>

        <div
          v-if="inviteState(invite, now) === 'active' && linkFor(invite)"
          class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <Input
            :model-value="linkFor(invite) ?? ''"
            readonly
            class="font-mono text-xs"
            :aria-label="`Invite link${invite.label ? ` for ${invite.label}` : ''}`"
            data-testid="invite-link"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <div class="flex shrink-0 gap-1.5">
            <Button variant="outline" size="sm" data-testid="invite-copy" @click="sharing.copy(linkFor(invite)!)">
              <CopyIcon data-icon="inline-start" aria-hidden="true" />
              Copy
            </Button>
            <Button
              v-if="sharing.canShare.value"
              variant="outline"
              size="icon-sm"
              aria-label="Share the invite link"
              @click="sharing.share(linkFor(invite)!, room.name)"
            >
              <Share2Icon aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon-sm" as-child>
              <a :href="sharing.mailtoHref(linkFor(invite)!, room.name)" aria-label="Email the invite link">
                <MailIcon aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </li>
    </ul>

    <AlertDialog v-model:open="revokeOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
          <AlertDialogDescription>
            Nobody new can join with {{ revokeTarget?.label ? `"${revokeTarget.label}"` : 'this invite' }}. People
            already in a meeting stay in it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="revoking">Cancel</AlertDialogCancel>
          <Button variant="destructive" :disabled="revoking" data-testid="invite-revoke-confirm" @click="confirmRevoke">
            <Spinner v-if="revoking" data-icon="inline-start" />
            Revoke invite
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

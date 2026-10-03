<script setup lang="ts">
/**
 * Room settings (`roomSettingsSchema` fields, `PATCH /api/rooms/:id`, owner only). Co-hosts see them read-only.
 * During a live meeting the server applies the changed live settings to the meeting right away.
 */
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import { roomSettingsSchema, type RoomDetails } from '#shared/schemas/rooms'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import FormAlert from '@/components/auth/FormAlert.vue'
import { useRoomsApi, type RoomUpdate } from '~/composables/rooms/useRoomsApi'
import { apiFieldErrors, authErrorText, fieldMessages } from '~/composables/useAuth'

const props = defineProps<{ room: RoomDetails; editable: boolean; maxParticipantsLimit: number }>()
const emit = defineEmits<{ saved: [room: RoomDetails] }>()

type Toggle = 'waitingRoom' | 'allowGuests' | 'muteOnJoin' | 'allowSelfUnmute' | 'chatEnabled'

const TOGGLES: Array<{ name: Toggle; label: string; description: string }> = [
  { name: 'waitingRoom', label: 'Waiting room', description: 'A host or co-host lets each person in.' },
  {
    name: 'allowGuests',
    label: 'Allow guests',
    description: 'People without an account can join with an invite link.',
  },
  {
    name: 'muteOnJoin',
    label: 'Join muted',
    description: 'Everyone joins with microphone and camera off.',
  },
  {
    name: 'allowSelfUnmute',
    label: 'Let people unmute themselves',
    description: 'When off, a host gives the microphone to each person.',
  },
  { name: 'chatEnabled', label: 'Chat', description: 'Encrypted chat during the meeting.' },
]

const rooms = useRoomsApi()
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

const nameSchema = roomSettingsSchema.shape.name
const maxSchema = computed(() => roomSettingsSchema.shape.maxParticipants.max(props.maxParticipantsLimit))

function validateMax({ value }: { value: string }) {
  const result = maxSchema.value.safeParse(Number(value))
  return result.success ? undefined : `Enter a number from 2 to ${props.maxParticipantsLimit}`
}

function valuesOf(room: RoomDetails) {
  return {
    name: room.name,
    waitingRoom: room.waitingRoom,
    allowGuests: room.allowGuests,
    muteOnJoin: room.muteOnJoin,
    allowSelfUnmute: room.allowSelfUnmute,
    screenSharePolicy: room.screenSharePolicy,
    chatEnabled: room.chatEnabled,
    maxParticipants: String(room.maxParticipants),
  }
}

const form = useForm({
  defaultValues: valuesOf(props.room),
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    serverErrors.value = {}
    const current = valuesOf(props.room)
    const changes: RoomUpdate = {}
    if (value.name.trim() !== current.name) changes.name = value.name.trim()
    for (const toggle of TOGGLES) {
      if (value[toggle.name] !== current[toggle.name]) changes[toggle.name] = value[toggle.name]
    }
    if (value.screenSharePolicy !== current.screenSharePolicy) changes.screenSharePolicy = value.screenSharePolicy
    if (value.maxParticipants !== current.maxParticipants) changes.maxParticipants = Number(value.maxParticipants)
    if (Object.keys(changes).length === 0) return
    try {
      const room = await rooms.update(props.room.id, changes)
      formApi.reset(valuesOf(room))
      emit('saved', room)
      toast.success('Settings saved', room.live ? { description: 'They apply to the meeting in progress too.' } : {})
    } catch (error) {
      const fields = apiFieldErrors(error)
      serverErrors.value = fields
      if (!Object.keys(fields).length) formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
const dirty = form.useStore((state) => state.isDirty)

watch(
  () => props.room,
  (room) => {
    if (!dirty.value) form.reset(valuesOf(room))
  },
)
</script>

<template>
  <form
    method="post"
    class="flex flex-col gap-6"
    novalidate
    data-testid="room-settings-form"
    @submit.prevent.stop="form.handleSubmit()"
  >
    <FormAlert :message="formError" />
    <FormAlert v-if="!editable" tone="info" message="Only the room owner can change these settings." />
    <FieldGroup class="gap-5">
      <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <form.Field name="name" :validators="{ onBlur: nameSchema, onSubmit: nameSchema }">
          <template #default="{ field }">
            <Field :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.name).length > 0 || undefined">
              <FieldLabel for="room-name">Name</FieldLabel>
              <Input
                id="room-name"
                :model-value="field.state.value"
                maxlength="80"
                autocomplete="off"
                class="h-10"
                :disabled="!editable"
                @update:model-value="(value: string | number) => field.handleChange(String(value))"
                @blur="field.handleBlur"
              />
              <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors.name)" />
            </Field>
          </template>
        </form.Field>
        <form.Field name="maxParticipants" :validators="{ onBlur: validateMax, onSubmit: validateMax }">
          <template #default="{ field }">
            <Field
              :data-invalid="
                fieldMessages(field.state.meta.errors, serverErrors.maxParticipants).length > 0 || undefined
              "
            >
              <FieldLabel for="room-max">Max people</FieldLabel>
              <Input
                id="room-max"
                :model-value="field.state.value"
                type="number"
                inputmode="numeric"
                min="2"
                :max="maxParticipantsLimit"
                class="h-10"
                :disabled="!editable"
                @update:model-value="(value: string | number) => field.handleChange(String(value))"
                @blur="field.handleBlur"
              />
              <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors.maxParticipants)" />
            </Field>
          </template>
        </form.Field>
      </div>

      <FieldSeparator />

      <form.Field v-for="toggle in TOGGLES" :key="toggle.name" :name="toggle.name">
        <template #default="{ field }">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel :for="`room-${toggle.name}`">{{ toggle.label }}</FieldLabel>
              <FieldDescription>{{ toggle.description }}</FieldDescription>
            </FieldContent>
            <Switch
              :id="`room-${toggle.name}`"
              :model-value="Boolean(field.state.value)"
              :disabled="!editable"
              @update:model-value="(value: boolean) => field.handleChange(value)"
            />
          </Field>
        </template>
      </form.Field>

      <form.Field name="screenSharePolicy">
        <template #default="{ field }">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="room-screen-share">Screen sharing</FieldLabel>
              <FieldDescription>Who may share their screen.</FieldDescription>
            </FieldContent>
            <Select
              :model-value="field.state.value"
              :disabled="!editable"
              @update:model-value="(value) => field.handleChange(value === 'hosts' ? 'hosts' : 'everyone')"
            >
              <SelectTrigger id="room-screen-share" class="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="everyone">Everyone</SelectItem>
                <SelectItem value="hosts">Hosts and co-hosts</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </template>
      </form.Field>
    </FieldGroup>

    <Button
      v-if="editable"
      type="submit"
      class="w-full sm:w-auto sm:self-start"
      :disabled="submitting || !dirty"
      data-testid="room-settings-save"
    >
      <Spinner v-if="submitting" data-icon="inline-start" />
      Save settings
    </Button>
  </form>
</template>

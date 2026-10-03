<script setup lang="ts">
/**
 * Room password (owner): set or change it (`PATCH { password }`), or remove it (`PATCH { password: null }`). Hosts and
 * co-hosts never need it; everyone else types it after the pre-join screen.
 */
import { LockKeyholeIcon } from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import { createRoomSchema, type RoomDetails } from '#shared/schemas/rooms'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText, fieldMessages } from '~/composables/useAuth'

const props = defineProps<{ room: RoomDetails }>()
const emit = defineEmits<{ saved: [room: RoomDetails] }>()

const passwordSchema = createRoomSchema.shape.password.unwrap()
const rooms = useRoomsApi()
const formError = ref<string | null>(null)
const removing = ref(false)
const editing = ref(false)

const form = useForm({
  defaultValues: { password: '' },
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    try {
      const room = await rooms.update(props.room.id, { password: value.password })
      formApi.reset()
      editing.value = false
      emit('saved', room)
      toast.success(props.room.hasPassword ? 'Password changed' : 'Password set')
    } catch (error) {
      formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

async function removePassword() {
  removing.value = true
  formError.value = null
  try {
    const room = await rooms.update(props.room.id, { password: null })
    emit('saved', room)
    toast.success('Password removed')
  } catch (error) {
    formError.value = authErrorText(error)
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="room-password">
    <FormAlert :message="formError" />
    <div v-if="room.hasPassword && !editing" class="flex flex-wrap items-center justify-between gap-3">
      <p class="flex items-center gap-2 text-sm">
        <LockKeyholeIcon class="size-4 text-muted-foreground" aria-hidden="true" />
        This room has a password.
      </p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" @click="editing = true">Change</Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="removing"
          data-testid="room-password-remove"
          @click="removePassword"
        >
          <Spinner v-if="removing" data-icon="inline-start" />
          Remove
        </Button>
      </div>
    </div>
    <form
      v-else
      class="flex flex-col gap-3 sm:flex-row sm:items-start"
      novalidate
      @submit.prevent.stop="form.handleSubmit()"
    >
      <form.Field name="password" :validators="{ onSubmit: passwordSchema }">
        <template #default="{ field }">
          <Field class="flex-1 gap-1.5" :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
            <FieldLabel for="room-password-input" class="sr-only">New room password</FieldLabel>
            <PasswordInput
              id="room-password-input"
              :model-value="field.state.value"
              name="room-password"
              autocomplete="new-password"
              maxlength="128"
              placeholder="New room password"
              :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
              @update:model-value="(value: string) => field.handleChange(value)"
              @blur="field.handleBlur"
            />
            <FieldError :errors="fieldMessages(field.state.meta.errors)" />
          </Field>
        </template>
      </form.Field>
      <div class="flex gap-2">
        <Button type="submit" :disabled="submitting" data-testid="room-password-save">
          <Spinner v-if="submitting" data-icon="inline-start" />
          {{ room.hasPassword ? 'Change password' : 'Set password' }}
        </Button>
        <Button v-if="editing" type="button" variant="ghost" @click="editing = false">Cancel</Button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
/**
 * "New room": a persistent room whose link keeps working. The browser generates the slug and the key; the room opens
 * right after it is created. More settings live on the room page.
 */
import { useForm } from '@tanstack/vue-form'
import { createRoomSchema, roomSettingsSchema } from '#shared/schemas/rooms'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import { useCreateRoom } from '~/composables/rooms/useCreateRoom'
import { authErrorText, fieldMessages } from '~/composables/useAuth'

const open = defineModel<boolean>('open', { required: true })

const nameSchema = roomSettingsSchema.shape.name
const passwordSchema = createRoomSchema.shape.password.unwrap()
const { createAndOpen } = useCreateRoom()
const formError = ref<string | null>(null)

function validatePassword({ value }: { value: string }) {
  if (!value) return undefined
  const result = passwordSchema.safeParse(value)
  return result.success ? undefined : (result.error.issues[0]?.message ?? 'Check the password')
}

const form = useForm({
  defaultValues: { name: '', waitingRoom: true, allowGuests: true, password: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    try {
      await createAndOpen({
        name: value.name.trim(),
        ephemeral: false,
        waitingRoom: value.waitingRoom,
        allowGuests: value.allowGuests,
        ...(value.password ? { password: value.password } : {}),
      })
      // No "Room created" toast: the meeting page that opens is the confirmation, and a toast carried over to it
      // would sit on top of its Join button (F-014).
      open.value = false
    } catch (error) {
      formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

watch(open, (value) => {
  if (value) {
    form.reset()
    formError.value = null
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg" data-testid="create-room-dialog">
      <DialogHeader>
        <DialogTitle>New room</DialogTitle>
        <DialogDescription>
          A room keeps its link for every meeting. Its encryption key is made on this device and never sent to the
          server.
        </DialogDescription>
      </DialogHeader>

      <form method="post" class="flex flex-col gap-6" novalidate @submit.prevent.stop="form.handleSubmit()">
        <FormAlert :message="formError" />
        <FieldGroup class="gap-5">
          <form.Field name="name" :validators="{ onBlur: nameSchema, onSubmit: nameSchema }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                <FieldLabel for="create-room-name">Name</FieldLabel>
                <Input
                  id="create-room-name"
                  :name="field.name"
                  :model-value="field.state.value"
                  maxlength="80"
                  placeholder="Weekly sync"
                  autocomplete="off"
                  class="h-10"
                  :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <FieldError :errors="fieldMessages(field.state.meta.errors)" />
              </Field>
            </template>
          </form.Field>

          <form.Field name="waitingRoom">
            <template #default="{ field }">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel for="create-room-waiting">Waiting room</FieldLabel>
                  <FieldDescription>A host lets each person in.</FieldDescription>
                </FieldContent>
                <Switch
                  id="create-room-waiting"
                  :model-value="field.state.value"
                  @update:model-value="(value: boolean) => field.handleChange(value)"
                />
              </Field>
            </template>
          </form.Field>

          <form.Field name="allowGuests">
            <template #default="{ field }">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel for="create-room-guests">Allow guests</FieldLabel>
                  <FieldDescription>People without an account can join with an invite link.</FieldDescription>
                </FieldContent>
                <Switch
                  id="create-room-guests"
                  :model-value="field.state.value"
                  @update:model-value="(value: boolean) => field.handleChange(value)"
                />
              </Field>
            </template>
          </form.Field>

          <form.Field name="password" :validators="{ onBlur: validatePassword, onSubmit: validatePassword }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                <FieldLabel for="create-room-password">Password (optional)</FieldLabel>
                <PasswordInput
                  id="create-room-password"
                  :model-value="field.state.value"
                  name="room-password"
                  autocomplete="new-password"
                  maxlength="128"
                  :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                  @update:model-value="(value: string) => field.handleChange(value)"
                  @blur="field.handleBlur"
                />
                <FieldDescription>Everyone except hosts must enter it to join.</FieldDescription>
                <FieldError :errors="fieldMessages(field.state.meta.errors)" />
              </Field>
            </template>
          </form.Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" :disabled="submitting" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting" data-testid="create-room-submit">
            <Spinner v-if="submitting" />
            Create and open
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

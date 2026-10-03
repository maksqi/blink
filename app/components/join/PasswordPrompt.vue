<script setup lang="ts">
/**
 * Room password step of the join flow (after pre-join, when the room has a password). The password goes only into
 * the join request body. Wrong passwords come back as an inline error; repeated ones are slowed down by the server.
 */
import { KeyRoundIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import JoinScreen from './JoinScreen.vue'

const props = defineProps<{
  meeting?: string
  /** A problem from the last attempt (already user-facing text). */
  error?: string | null
  joining?: boolean
}>()
const emit = defineEmits<{ submit: [password: string]; back: [] }>()

const password = ref('')
const fieldError = ref<string | null>(null)

function submit() {
  if (props.joining) return
  if (!password.value) {
    fieldError.value = 'Enter the meeting password'
    return
  }
  if (password.value.length > 128) {
    fieldError.value = 'Meeting passwords have at most 128 characters'
    return
  }
  fieldError.value = null
  emit('submit', password.value)
  // A wrong password comes back as an error; the person then types it again from scratch.
  password.value = ''
}
</script>

<template>
  <JoinScreen
    :icon="KeyRoundIcon"
    :meeting="meeting"
    title="Enter the meeting password"
    description="The host set a password for this meeting."
    data-testid="join-password"
  >
    <form class="flex w-full flex-col gap-4 text-left" novalidate @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="join-password-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <Field :data-invalid="fieldError ? true : undefined">
        <FieldLabel for="join-password-input">Password</FieldLabel>
        <PasswordInput
          id="join-password-input"
          v-model="password"
          name="password"
          autocomplete="off"
          maxlength="128"
          autofocus
          :aria-invalid="fieldError ? true : undefined"
          @update:model-value="fieldError = null"
        />
        <FieldError v-if="fieldError">{{ fieldError }}</FieldError>
      </Field>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" :disabled="joining" @click="emit('back')">Back</Button>
        <Button type="submit" :disabled="joining" data-testid="join-password-submit">
          <Spinner v-if="joining" />
          {{ joining ? 'Joining…' : 'Join' }}
        </Button>
      </div>
    </form>
  </JoinScreen>
</template>

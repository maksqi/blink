<script setup lang="ts">
/**
 * Change the own password (current, new, repeat). Used by `/change-password` (forced or voluntary) and `/settings`.
 * On success the server has signed out every other device and rotated this session; emits `changed`.
 */
import { useForm } from '@tanstack/vue-form'
import { z } from 'zod'
import type { AuthUser } from '#shared/schemas/auth'
import { passwordSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from './FormAlert.vue'
import PasswordInput from './PasswordInput.vue'

const props = withDefaults(defineProps<{ submitLabel?: string; idPrefix?: string; block?: boolean }>(), {
  submitLabel: 'Change password',
  idPrefix: 'password',
  block: false,
})
const emit = defineEmits<{ changed: [user: AuthUser] }>()

const { changePassword } = useAuth()
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})
const currentSchema = z.string().min(1, 'Enter your current password')

const form = useForm({
  defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      const user = await changePassword({ currentPassword: value.currentPassword, newPassword: value.newPassword })
      formApi.reset()
      emit('changed', user)
    } catch (error) {
      if (isApiError(error, 'AUTH_INVALID_CREDENTIALS')) {
        serverErrors.value = { currentPassword: 'This is not your current password.' }
      } else if (weakPasswordText(error)) {
        serverErrors.value = { newPassword: weakPasswordText(error)! }
      } else {
        const fields = apiFieldErrors(error)
        serverErrors.value = fields
        if (!Object.keys(fields).length) formError.value = authErrorText(error)
      }
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

function clearServerError(name: string) {
  if (serverErrors.value[name]) serverErrors.value = { ...serverErrors.value, [name]: '' }
}

function matchesNew({
  value,
  fieldApi,
}: {
  value: string
  fieldApi: { form: { getFieldValue: (name: 'newPassword') => string } }
}) {
  return value === fieldApi.form.getFieldValue('newPassword') ? undefined : 'The passwords do not match.'
}

const id = (name: string) => `${props.idPrefix}-${name}`
</script>

<template>
  <form
    class="flex flex-col gap-6"
    novalidate
    data-testid="change-password-form"
    @submit.prevent.stop="form.handleSubmit()"
  >
    <FormAlert :message="formError" />
    <FieldGroup class="gap-5">
      <form.Field name="currentPassword" :validators="{ onSubmit: currentSchema }">
        <template #default="{ field }">
          <Field
            :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.currentPassword).length > 0 || undefined"
          >
            <FieldLabel :for="id('current')">Current password</FieldLabel>
            <PasswordInput
              :id="id('current')"
              :name="field.name"
              :model-value="field.state.value"
              autocomplete="current-password"
              :aria-invalid="
                fieldMessages(field.state.meta.errors, serverErrors.currentPassword).length > 0 || undefined
              "
              :aria-describedby="`${id('current')}-error`"
              @update:model-value="(value: string) => (field.handleChange(value), clearServerError('currentPassword'))"
              @blur="field.handleBlur"
            />
            <FieldError
              :id="`${id('current')}-error`"
              :errors="fieldMessages(field.state.meta.errors, serverErrors.currentPassword)"
            />
          </Field>
        </template>
      </form.Field>

      <form.Field name="newPassword" :validators="{ onBlur: passwordSchema, onSubmit: passwordSchema }">
        <template #default="{ field }">
          <Field
            :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.newPassword).length > 0 || undefined"
          >
            <FieldLabel :for="id('new')">New password</FieldLabel>
            <PasswordInput
              :id="id('new')"
              :name="field.name"
              :model-value="field.state.value"
              autocomplete="new-password"
              :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.newPassword).length > 0 || undefined"
              :aria-describedby="`${id('new')}-hint ${id('new')}-error`"
              @update:model-value="(value: string) => (field.handleChange(value), clearServerError('newPassword'))"
              @blur="field.handleBlur"
            />
            <FieldDescription :id="`${id('new')}-hint`">
              At least 12 characters. A few unrelated words work well; common passwords are refused.
            </FieldDescription>
            <FieldError
              :id="`${id('new')}-error`"
              :errors="fieldMessages(field.state.meta.errors, serverErrors.newPassword)"
            />
          </Field>
        </template>
      </form.Field>

      <form.Field
        name="confirmPassword"
        :validators="{ onChangeListenTo: ['newPassword'], onBlur: matchesNew, onSubmit: matchesNew }"
      >
        <template #default="{ field }">
          <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
            <FieldLabel :for="id('confirm')">Repeat new password</FieldLabel>
            <PasswordInput
              :id="id('confirm')"
              :name="field.name"
              :model-value="field.state.value"
              autocomplete="new-password"
              :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
              :aria-describedby="`${id('confirm')}-error`"
              @update:model-value="(value: string) => field.handleChange(value)"
              @blur="field.handleBlur"
            />
            <FieldError :id="`${id('confirm')}-error`" :errors="fieldMessages(field.state.meta.errors)" />
          </Field>
        </template>
      </form.Field>
    </FieldGroup>

    <Button type="submit" size="lg" :class="block ? 'w-full' : 'w-full sm:w-auto sm:self-start'" :disabled="submitting">
      <Spinner v-if="submitting" />
      {{ submitLabel }}
    </Button>
  </form>
</template>

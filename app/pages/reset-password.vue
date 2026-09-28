<script setup lang="ts">
/**
 * Choose a new password from a reset link: `/reset-password#<token>`. The token is taken from the captured fragment
 * once; the server spends it only for a password that passes the policy. Every session of the account ends; this
 * page does not sign in.
 */
import { useForm } from '@tanstack/vue-form'
import { opaqueTokenSchema, passwordSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import AuthStatus from '@/components/auth/AuthStatus.vue'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Choose a new password' })

type State = 'loading' | 'ready' | 'done' | 'missing' | 'expired' | 'invalid'

const { confirmPasswordReset } = useAuth()
const state = ref<State>('loading')
let token: string | null = null

onMounted(() => {
  token = useNuxtApp().$fragment.take('/reset-password')
  state.value = token && opaqueTokenSchema.safeParse(token).success ? 'ready' : 'missing'
})

const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

const form = useForm({
  defaultValues: { newPassword: '', confirmPassword: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      await confirmPasswordReset({ token: token!, newPassword: value.newPassword })
      state.value = 'done'
    } catch (error) {
      if (isApiError(error, 'AUTH_TOKEN_EXPIRED')) state.value = 'expired'
      else if (isApiError(error, 'AUTH_TOKEN_INVALID')) state.value = 'invalid'
      else if (weakPasswordText(error)) serverErrors.value = { newPassword: weakPasswordText(error)! }
      else {
        serverErrors.value = apiFieldErrors(error)
        if (!Object.keys(serverErrors.value).length) formError.value = authErrorText(error)
      }
    }
  },
})
const submitting = form.useStore((s) => s.isSubmitting)

function matchesNew({
  value,
  fieldApi,
}: {
  value: string
  fieldApi: { form: { getFieldValue: (name: 'newPassword') => string } }
}) {
  return value === fieldApi.form.getFieldValue('newPassword') ? undefined : 'The passwords do not match.'
}

function clearServerError(name: string) {
  if (serverErrors.value[name]) serverErrors.value = { ...serverErrors.value, [name]: '' }
}
</script>

<template>
  <div class="contents">
    <AuthStatus v-if="state === 'loading'" tone="loading" title="Opening your reset link" />

    <AuthStatus
      v-else-if="state === 'done'"
      tone="success"
      title="Your password was changed"
      description="Sign in with your new password. You were signed out on every device."
    >
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/login">Sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus
      v-else-if="state !== 'ready'"
      tone="error"
      :title="
        state === 'expired'
          ? 'This link has expired'
          : state === 'missing'
            ? 'This link is incomplete'
            : 'This link is not valid'
      "
      :description="
        state === 'expired'
          ? 'Reset links work for 1 hour. Request a new one.'
          : state === 'missing'
            ? 'Open the link from the email again, or request a new one.'
            : 'It may have been used already, or a newer link replaced it. Request a new one.'
      "
    >
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/forgot-password">Request a new link</NuxtLink>
      </Button>
    </AuthStatus>

    <template v-else>
      <CardHeader>
        <CardTitle>
          <h1 class="text-xl font-semibold tracking-tight">Choose a new password</h1>
        </CardTitle>
        <CardDescription>After this, you sign in again on every device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          class="flex flex-col gap-5"
          novalidate
          data-testid="reset-password-form"
          @submit.prevent.stop="form.handleSubmit()"
        >
          <FormAlert :message="formError" />
          <FieldGroup class="gap-4">
            <form.Field name="newPassword" :validators="{ onBlur: passwordSchema, onSubmit: passwordSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="
                    fieldMessages(field.state.meta.errors, serverErrors.newPassword).length > 0 || undefined
                  "
                >
                  <FieldLabel for="reset-new">New password</FieldLabel>
                  <PasswordInput
                    id="reset-new"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="new-password"
                    :aria-invalid="
                      fieldMessages(field.state.meta.errors, serverErrors.newPassword).length > 0 || undefined
                    "
                    aria-describedby="reset-new-hint reset-new-error"
                    @update:model-value="
                      (value: string) => (field.handleChange(value), clearServerError('newPassword'))
                    "
                    @blur="field.handleBlur"
                  />
                  <FieldDescription id="reset-new-hint"
                    >At least 12 characters. Common passwords are refused.</FieldDescription
                  >
                  <FieldError
                    id="reset-new-error"
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
                  <FieldLabel for="reset-confirm">Repeat new password</FieldLabel>
                  <PasswordInput
                    id="reset-confirm"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="new-password"
                    :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                    aria-describedby="reset-confirm-error"
                    @update:model-value="(value: string) => field.handleChange(value)"
                    @blur="field.handleBlur"
                  />
                  <FieldError id="reset-confirm-error" :errors="fieldMessages(field.state.meta.errors)" />
                </Field>
              </template>
            </form.Field>
          </FieldGroup>
          <Button type="submit" size="lg" class="w-full" :disabled="submitting">
            <Spinner v-if="submitting" />
            Save new password
          </Button>
        </form>
      </CardContent>
    </template>
  </div>
</template>

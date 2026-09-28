<script setup lang="ts">
/**
 * Create an account when the server allows it (`registration.mode`): `open` signs in right away, `domain` asks for
 * the email confirmation, `invite_only` shows a closed notice. The mode is read from the server on every visit.
 */
import { useForm } from '@tanstack/vue-form'
import { displayNameSchema, emailSchema, passwordSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import AuthStatus from '@/components/auth/AuthStatus.vue'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Create account' })

const { register } = useAuth()
const { data: config } = await useAuthPageConfig()
const closedByServer = ref(false)
const mode = computed(() => (closedByServer.value ? 'invite_only' : (config.value?.registration.mode ?? 'invite_only')))
const domains = computed(() => config.value?.registration.allowedDomains ?? [])
const sentTo = ref<string | null>(null)

const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

const form = useForm({
  defaultValues: { displayName: '', email: '', password: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      const result = await register(value)
      if ('user' in result) await navigateTo('/dashboard', { replace: true })
      else sentTo.value = value.email.trim().toLowerCase()
    } catch (error) {
      if (isApiError(error, 'REGISTRATION_CLOSED')) closedByServer.value = true
      else if (isApiError(error, 'REGISTRATION_DOMAIN_NOT_ALLOWED')) {
        serverErrors.value = { email: `Use an address at ${domains.value.join(', ') || 'an allowed domain'}.` }
      } else if (isApiError(error, 'CONFLICT')) {
        serverErrors.value = { email: 'An account with this email already exists. Sign in instead.' }
      } else if (weakPasswordText(error)) {
        serverErrors.value = { password: weakPasswordText(error)! }
      } else if (isApiError(error, 'SERVICE_UNAVAILABLE')) {
        formError.value = 'Registration needs email, which this server cannot send right now. Try again later.'
      } else {
        serverErrors.value = apiFieldErrors(error)
        if (!Object.keys(serverErrors.value).length) formError.value = authErrorText(error)
      }
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

function clearServerError(name: string) {
  if (serverErrors.value[name]) serverErrors.value = { ...serverErrors.value, [name]: '' }
}
</script>

<template>
  <div class="contents">
    <AuthStatus
      v-if="mode === 'invite_only'"
      tone="error"
      title="Registration is closed"
      description="Accounts on this server are created by invitation. Ask an administrator for an invite."
    >
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/login">Sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus v-else-if="sentTo" tone="mail" title="Check your email">
      <template #description>
        We sent a confirmation link to <span class="font-medium text-foreground">{{ sentTo }}</span
        >. Open it to finish creating your account. It expires in 24 hours.
      </template>
      <Button as-child variant="outline" size="lg" class="w-full">
        <NuxtLink to="/login">Back to sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <template v-else>
      <CardHeader>
        <CardTitle>
          <h1 class="text-xl font-semibold tracking-tight">Create your account</h1>
        </CardTitle>
        <CardDescription>
          <template v-if="mode === 'domain'">For people with an email address at {{ domains.join(', ') }}.</template>
          <template v-else>It takes a minute. You can start a meeting right after.</template>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          class="flex flex-col gap-5"
          novalidate
          data-testid="register-form"
          @submit.prevent.stop="form.handleSubmit()"
        >
          <FormAlert :message="formError" />
          <FieldGroup class="gap-4">
            <form.Field name="displayName" :validators="{ onBlur: displayNameSchema, onSubmit: displayNameSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="
                    fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined
                  "
                >
                  <FieldLabel for="register-name">Your name</FieldLabel>
                  <Input
                    id="register-name"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="name"
                    maxlength="64"
                    class="h-10"
                    :aria-invalid="
                      fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined
                    "
                    aria-describedby="register-name-error"
                    @update:model-value="
                      (value: string | number) => (field.handleChange(String(value)), clearServerError('displayName'))
                    "
                    @blur="field.handleBlur"
                  />
                  <FieldError
                    id="register-name-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.displayName)"
                  />
                </Field>
              </template>
            </form.Field>

            <form.Field name="email" :validators="{ onBlur: emailSchema, onSubmit: emailSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                >
                  <FieldLabel for="register-email">Email</FieldLabel>
                  <Input
                    id="register-email"
                    :name="field.name"
                    :model-value="field.state.value"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    autocapitalize="off"
                    spellcheck="false"
                    class="h-10"
                    :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                    aria-describedby="register-email-error"
                    @update:model-value="
                      (value: string | number) => (field.handleChange(String(value)), clearServerError('email'))
                    "
                    @blur="field.handleBlur"
                  />
                  <FieldError
                    id="register-email-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.email)"
                  />
                </Field>
              </template>
            </form.Field>

            <form.Field name="password" :validators="{ onBlur: passwordSchema, onSubmit: passwordSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.password).length > 0 || undefined"
                >
                  <FieldLabel for="register-password">Password</FieldLabel>
                  <PasswordInput
                    id="register-password"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="new-password"
                    :aria-invalid="
                      fieldMessages(field.state.meta.errors, serverErrors.password).length > 0 || undefined
                    "
                    aria-describedby="register-password-hint register-password-error"
                    @update:model-value="(value: string) => (field.handleChange(value), clearServerError('password'))"
                    @blur="field.handleBlur"
                  />
                  <FieldDescription id="register-password-hint"
                    >At least 12 characters. Common passwords are refused.</FieldDescription
                  >
                  <FieldError
                    id="register-password-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.password)"
                  />
                </Field>
              </template>
            </form.Field>
          </FieldGroup>

          <Button type="submit" size="lg" class="w-full" :disabled="submitting">
            <Spinner v-if="submitting" />
            Create account
          </Button>
        </form>
      </CardContent>

      <CardFooter class="border-t pt-6 text-sm text-muted-foreground">
        <p>
          Already have an account?
          <NuxtLink to="/login" class="font-medium text-foreground underline-offset-4 hover:underline"
            >Sign in</NuxtLink
          >
        </p>
      </CardFooter>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Sign in. After success: `/change-password` while a password change is pending, else `?next` (safe relative paths
 * only) or `/dashboard`. "Forgot password" appears only when the server can send email.
 */
import { useForm } from '@tanstack/vue-form'
import { z } from 'zod'
import { emailSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import { safeRedirectPath } from '~/lib/shell/redirect'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Sign in' })

const route = useRoute()
const { login } = useAuth()
const { data: config } = await useAuthPageConfig()
const smtpEnabled = computed(() => config.value?.smtpEnabled === true)
const registrationOpen = computed(() => (config.value?.registration.mode ?? 'invite_only') !== 'invite_only')

const formError = ref<string | null>(null)
const passwordRequired = z.string().min(1, 'Enter your password')

// Submit only once hydrated: a native submission would send the fields to the page URL (F-020).
const hydrated = useHydrated()
const form = useForm({
  defaultValues: { email: '', password: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    try {
      const user = await login({ email: value.email, password: value.password })
      await navigateTo(user.mustChangePassword ? '/change-password' : safeRedirectPath(route.query.next), {
        replace: true,
      })
    } catch (error) {
      formError.value = isApiError(error, 'AUTH_EMAIL_NOT_VERIFIED')
        ? 'Confirm your email address first: open the link we emailed you. A new link is sent at most every 10 minutes.'
        : authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
</script>

<template>
  <div class="contents">
    <CardHeader>
      <CardTitle>
        <h1 class="text-xl font-semibold tracking-tight">Sign in</h1>
      </CardTitle>
      <CardDescription>Welcome back. Sign in to start or join a meeting.</CardDescription>
    </CardHeader>

    <CardContent>
      <form method="post" class="flex flex-col gap-5" novalidate data-testid="login-form" @submit.prevent.stop="form.handleSubmit()">
        <FormAlert :message="formError" />
        <FieldGroup class="gap-4">
          <form.Field name="email" :validators="{ onBlur: emailSchema, onSubmit: emailSchema }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                <FieldLabel for="login-email">Email</FieldLabel>
                <Input
                  id="login-email"
                  :name="field.name"
                  :model-value="field.state.value"
                  type="email"
                  inputmode="email"
                  autocomplete="username"
                  autocapitalize="off"
                  spellcheck="false"
                  class="h-10"
                  :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                  aria-describedby="login-email-error"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <FieldError id="login-email-error" :errors="fieldMessages(field.state.meta.errors)" />
              </Field>
            </template>
          </form.Field>

          <form.Field name="password" :validators="{ onSubmit: passwordRequired }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                <div class="flex items-center justify-between gap-3">
                  <FieldLabel for="login-password">Password</FieldLabel>
                  <NuxtLink
                    v-if="smtpEnabled"
                    to="/forgot-password"
                    class="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </NuxtLink>
                </div>
                <PasswordInput
                  id="login-password"
                  :name="field.name"
                  :model-value="field.state.value"
                  autocomplete="current-password"
                  :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                  aria-describedby="login-password-error"
                  @update:model-value="(value: string) => field.handleChange(value)"
                  @blur="field.handleBlur"
                />
                <FieldError id="login-password-error" :errors="fieldMessages(field.state.meta.errors)" />
              </Field>
            </template>
          </form.Field>
        </FieldGroup>

        <Button type="submit" size="lg" class="w-full" :disabled="submitting || !hydrated">
          <Spinner v-if="submitting" />
          Sign in
        </Button>
      </form>
    </CardContent>

    <CardFooter class="flex-col items-start gap-2 border-t pt-6 text-sm text-muted-foreground">
      <p v-if="!smtpEnabled">Forgot your password? Ask an administrator to reset it.</p>
      <p v-if="registrationOpen">
        New here?
        <NuxtLink to="/register" class="font-medium text-foreground underline-offset-4 hover:underline"
          >Create an account</NuxtLink
        >
      </p>
      <p v-else>Accounts are invite-only. Ask an administrator for an invite.</p>
    </CardFooter>
  </div>
</template>

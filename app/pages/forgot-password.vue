<script setup lang="ts">
/**
 * Request a password reset link. The answer never says whether the address has an account. Servers without SMTP
 * explain that an administrator has to reset the password.
 */
import { useForm } from '@tanstack/vue-form'
import { emailSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import AuthStatus from '@/components/auth/AuthStatus.vue'
import FormAlert from '@/components/auth/FormAlert.vue'

definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Forgot password' })

const { requestPasswordReset } = useAuth()
const { data: config } = await useAuthPageConfig()
const unavailable = ref(false)
const smtpEnabled = computed(() => config.value?.smtpEnabled === true && !unavailable.value)
const sentTo = ref<string | null>(null)
const formError = ref<string | null>(null)

const form = useForm({
  defaultValues: { email: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    try {
      await requestPasswordReset(value.email)
      sentTo.value = value.email.trim().toLowerCase()
    } catch (error) {
      if (isApiError(error, 'SERVICE_UNAVAILABLE')) unavailable.value = true
      else formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
</script>

<template>
  <div class="contents">
    <AuthStatus
      v-if="!smtpEnabled"
      tone="error"
      title="Password reset by email is not available"
      description="This server cannot send email. Ask an administrator to reset your password."
    >
      <Button as-child variant="outline" size="lg" class="w-full">
        <NuxtLink to="/login">Back to sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus v-else-if="sentTo" tone="mail" title="Check your email">
      <template #description>
        If <span class="font-medium text-foreground">{{ sentTo }}</span> has an account, we sent it a link to choose a
        new password. The link works once and expires in 1 hour.
      </template>
      <Button as-child variant="outline" size="lg" class="w-full">
        <NuxtLink to="/login">Back to sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <template v-else>
      <CardHeader>
        <CardTitle>
          <h1 class="text-xl font-semibold tracking-tight">Forgot your password?</h1>
        </CardTitle>
        <CardDescription>Enter your email address and we will send you a link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          class="flex flex-col gap-5"
          novalidate
          data-testid="forgot-password-form"
          @submit.prevent.stop="form.handleSubmit()"
        >
          <FormAlert :message="formError" />
          <FieldGroup>
            <form.Field name="email" :validators="{ onBlur: emailSchema, onSubmit: emailSchema }">
              <template #default="{ field }">
                <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                  <FieldLabel for="forgot-email">Email</FieldLabel>
                  <Input
                    id="forgot-email"
                    :name="field.name"
                    :model-value="field.state.value"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    autocapitalize="off"
                    spellcheck="false"
                    class="h-10"
                    :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                    aria-describedby="forgot-email-error"
                    @update:model-value="(value: string | number) => field.handleChange(String(value))"
                    @blur="field.handleBlur"
                  />
                  <FieldError id="forgot-email-error" :errors="fieldMessages(field.state.meta.errors)" />
                </Field>
              </template>
            </form.Field>
          </FieldGroup>
          <Button type="submit" size="lg" class="w-full" :disabled="submitting">
            <Spinner v-if="submitting" />
            Send reset link
          </Button>
        </form>
      </CardContent>
      <CardFooter class="border-t pt-6 text-sm text-muted-foreground">
        <p>
          Remembered it?
          <NuxtLink to="/login" class="font-medium text-foreground underline-offset-4 hover:underline"
            >Sign in</NuxtLink
          >
        </p>
      </CardFooter>
    </template>
  </div>
</template>

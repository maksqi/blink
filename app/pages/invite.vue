<script setup lang="ts">
/**
 * Accept an account invite: `/invite#<token>`. The fragment plugin moved the token into sessionStorage before any
 * code saw the URL; this page takes it once, previews the invite, then creates the account and signs it in. A bound
 * invite shows its email read-only. Signed-in visitors are asked to sign out first.
 */
import { ShieldCheckIcon } from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import type { InvitePreview } from '#shared/schemas/auth'
import { displayNameSchema, emailSchema, opaqueTokenSchema, passwordSchema } from '#shared/schemas/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import AuthStatus from '@/components/auth/AuthStatus.vue'
import FormAlert from '@/components/auth/FormAlert.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Accept invite' })

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'signed-in' }
  | { kind: 'unusable'; code: 'INVITE_INVALID' | 'INVITE_EXPIRED' | 'INVITE_USED' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: InvitePreview }

const { user, previewInvite, acceptInvite, logout } = useAuth()
const state = ref<State>({ kind: 'loading' })
let token: string | null = null

const UNUSABLE = {
  INVITE_INVALID: {
    title: 'This invite is not valid',
    text: 'It may have been revoked. Ask your administrator for a new invite.',
  },
  INVITE_EXPIRED: { title: 'This invite has expired', text: 'Ask your administrator for a new invite.' },
  INVITE_USED: { title: 'This invite was already used', text: 'If you created your account with it, sign in.' },
} as const

function unusable(error: unknown): State | null {
  for (const code of ['INVITE_INVALID', 'INVITE_EXPIRED', 'INVITE_USED'] as const) {
    if (isApiError(error, code)) return { kind: 'unusable', code }
  }
  return null
}

async function loadPreview() {
  state.value = { kind: 'loading' }
  try {
    state.value = { kind: 'ready', preview: await previewInvite(token!) }
  } catch (error) {
    state.value = unusable(error) ?? { kind: 'error', message: authErrorText(error) }
  }
}

onMounted(async () => {
  token = useNuxtApp().$fragment.take('/invite')
  if (!token || !opaqueTokenSchema.safeParse(token).success) {
    state.value = { kind: 'missing' }
    return
  }
  if (user.value) {
    state.value = { kind: 'signed-in' }
    return
  }
  await loadPreview()
})

const signingOut = ref(false)
async function signOutAndContinue() {
  signingOut.value = true
  try {
    await logout({ redirect: false })
    await loadPreview()
  } finally {
    signingOut.value = false
  }
}

const preview = computed(() => (state.value.kind === 'ready' ? state.value.preview : null))
const expires = computed(() =>
  preview.value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(preview.value.expiresAt),
      )
    : '',
)

const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

// Submit only once hydrated: a native submission would send the fields to the page URL (F-020).
const hydrated = useHydrated()
const form = useForm({
  defaultValues: { email: '', displayName: '', password: '' },
  onSubmit: async ({ value }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      await acceptInvite({
        token: token!,
        ...(preview.value?.email ? {} : { email: value.email }),
        displayName: value.displayName,
        password: value.password,
      })
      await navigateTo('/dashboard', { replace: true })
    } catch (error) {
      const next = unusable(error)
      if (next) state.value = next
      else if (isApiError(error, 'CONFLICT')) {
        if (preview.value?.email) formError.value = 'An account with this email already exists. Sign in instead.'
        else serverErrors.value = { email: 'An account with this email already exists. Sign in instead.' }
      } else if (weakPasswordText(error)) serverErrors.value = { password: weakPasswordText(error)! }
      else {
        serverErrors.value = apiFieldErrors(error)
        if (!Object.keys(serverErrors.value).length) formError.value = authErrorText(error)
      }
    }
  },
})
const submitting = form.useStore((s) => s.isSubmitting)

const emailRule = ({ value }: { value: string }) => {
  if (preview.value?.email) return undefined
  const parsed = emailSchema.safeParse(value)
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a valid email address')
}

function clearServerError(name: string) {
  if (serverErrors.value[name]) serverErrors.value = { ...serverErrors.value, [name]: '' }
}
</script>

<template>
  <div class="contents">
    <AuthStatus v-if="state.kind === 'loading'" tone="loading" title="Checking your invite" />

    <AuthStatus
      v-else-if="state.kind === 'missing'"
      tone="error"
      title="This invite link is incomplete"
      description="Open the link from your invite email again, or ask your administrator for a new invite."
    >
      <Button as-child variant="outline" size="lg" class="w-full">
        <NuxtLink to="/login">Go to sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus v-else-if="state.kind === 'signed-in'" tone="error" title="You are already signed in">
      <template #description>
        You are signed in as <span class="font-medium text-foreground">{{ user?.email }}</span
        >. Sign out to create a new account with this invite.
      </template>
      <Button size="lg" class="w-full" :disabled="signingOut" @click="signOutAndContinue">
        <Spinner v-if="signingOut" />
        Sign out and continue
      </Button>
      <Button as-child variant="ghost" size="lg" class="w-full">
        <NuxtLink to="/dashboard">Keep my current account</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus
      v-else-if="state.kind === 'unusable'"
      tone="error"
      :title="UNUSABLE[state.code].title"
      :description="UNUSABLE[state.code].text"
    >
      <Button as-child :variant="state.code === 'INVITE_USED' ? 'default' : 'outline'" size="lg" class="w-full">
        <NuxtLink to="/login">Sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus
      v-else-if="state.kind === 'error'"
      tone="error"
      title="The invite could not be checked"
      :description="state.message"
    >
      <Button size="lg" class="w-full" @click="loadPreview">Try again</Button>
    </AuthStatus>

    <template v-else-if="preview">
      <CardHeader>
        <CardTitle>
          <h1 class="text-xl font-semibold tracking-tight">Accept your invite</h1>
        </CardTitle>
        <CardDescription class="flex flex-col gap-2">
          <span>Choose your name and password to create your account.</span>
          <span class="flex flex-wrap items-center gap-2 text-xs">
            <Badge v-if="preview.role === 'admin'" variant="secondary" data-testid="invite-admin">
              <ShieldCheckIcon aria-hidden="true" />
              Administrator
            </Badge>
            <span>Valid until {{ expires }}</span>
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          method="post"
          class="flex flex-col gap-5"
          novalidate
          data-testid="invite-form"
          @submit.prevent.stop="form.handleSubmit()"
        >
          <FormAlert :message="formError" />
          <FieldGroup class="gap-4">
            <Field v-if="preview.email">
              <FieldLabel for="invite-email">Email</FieldLabel>
              <Input
                id="invite-email"
                :model-value="preview.email"
                type="email"
                class="h-10"
                readonly
                aria-describedby="invite-email-hint"
              />
              <FieldDescription id="invite-email-hint">This invite is for this address.</FieldDescription>
            </Field>
            <form.Field v-else name="email" :validators="{ onBlur: emailRule, onSubmit: emailRule }">
              <template #default="{ field }">
                <Field
                  :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                >
                  <FieldLabel for="invite-email">Email</FieldLabel>
                  <Input
                    id="invite-email"
                    :name="field.name"
                    :model-value="field.state.value"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    autocapitalize="off"
                    spellcheck="false"
                    class="h-10"
                    :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                    aria-describedby="invite-email-error"
                    @update:model-value="
                      (value: string | number) => (field.handleChange(String(value)), clearServerError('email'))
                    "
                    @blur="field.handleBlur"
                  />
                  <FieldError
                    id="invite-email-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.email)"
                  />
                </Field>
              </template>
            </form.Field>

            <form.Field name="displayName" :validators="{ onBlur: displayNameSchema, onSubmit: displayNameSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="
                    fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined
                  "
                >
                  <FieldLabel for="invite-name">Your name</FieldLabel>
                  <Input
                    id="invite-name"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="name"
                    maxlength="64"
                    class="h-10"
                    :aria-invalid="
                      fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined
                    "
                    aria-describedby="invite-name-error"
                    @update:model-value="
                      (value: string | number) => (field.handleChange(String(value)), clearServerError('displayName'))
                    "
                    @blur="field.handleBlur"
                  />
                  <FieldError
                    id="invite-name-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.displayName)"
                  />
                </Field>
              </template>
            </form.Field>

            <form.Field name="password" :validators="{ onBlur: passwordSchema, onSubmit: passwordSchema }">
              <template #default="{ field }">
                <Field
                  :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.password).length > 0 || undefined"
                >
                  <FieldLabel for="invite-password">Password</FieldLabel>
                  <PasswordInput
                    id="invite-password"
                    :name="field.name"
                    :model-value="field.state.value"
                    autocomplete="new-password"
                    :aria-invalid="
                      fieldMessages(field.state.meta.errors, serverErrors.password).length > 0 || undefined
                    "
                    aria-describedby="invite-password-hint invite-password-error"
                    @update:model-value="(value: string) => (field.handleChange(value), clearServerError('password'))"
                    @blur="field.handleBlur"
                  />
                  <FieldDescription id="invite-password-hint"
                    >At least 12 characters. Common passwords are refused.</FieldDescription
                  >
                  <FieldError
                    id="invite-password-error"
                    :errors="fieldMessages(field.state.meta.errors, serverErrors.password)"
                  />
                </Field>
              </template>
            </form.Field>
          </FieldGroup>

          <Button type="submit" size="lg" class="w-full" :disabled="submitting || !hydrated">
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

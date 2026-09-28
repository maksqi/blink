<script setup lang="ts">
/**
 * Confirm an email address: `/verify-email#<token>`. The token is taken from the captured fragment once and sent in the
 * request body. Expired links: signing in (in domain mode) sends a new one.
 */
import { opaqueTokenSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import AuthStatus from '@/components/auth/AuthStatus.vue'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Confirm email' })

type State = 'loading' | 'done' | 'missing' | 'expired' | 'invalid' | 'error'

const { user, verifyEmail } = useAuth()
const state = ref<State>('loading')
const message = ref('')
let token: string | null = null

async function run() {
  state.value = 'loading'
  try {
    await verifyEmail(token!)
    state.value = 'done'
  } catch (error) {
    if (isApiError(error, 'AUTH_TOKEN_EXPIRED')) state.value = 'expired'
    else if (isApiError(error, 'AUTH_TOKEN_INVALID')) state.value = 'invalid'
    else {
      message.value = authErrorText(error)
      state.value = 'error'
    }
  }
}

onMounted(() => {
  token = useNuxtApp().$fragment.take('/verify-email')
  if (!token || !opaqueTokenSchema.safeParse(token).success) state.value = 'missing'
  else void run()
})
</script>

<template>
  <div class="contents">
    <AuthStatus v-if="state === 'loading'" tone="loading" title="Confirming your email address" />

    <AuthStatus
      v-else-if="state === 'done'"
      tone="success"
      title="Email address confirmed"
      :description="user ? 'Thanks. Your account is ready.' : 'Thanks. You can sign in now.'"
    >
      <Button as-child size="lg" class="w-full">
        <NuxtLink :to="user ? '/dashboard' : '/login'">{{ user ? 'Continue' : 'Sign in' }}</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus
      v-else-if="state === 'expired'"
      tone="error"
      title="This link has expired"
      description="Confirmation links work for 24 hours. Sign in to get a new one by email."
    >
      <Button as-child size="lg" class="w-full">
        <NuxtLink to="/login">Sign in</NuxtLink>
      </Button>
    </AuthStatus>

    <AuthStatus
      v-else-if="state === 'error'"
      tone="error"
      title="Your email address could not be confirmed"
      :description="message"
    >
      <Button size="lg" class="w-full" @click="run">Try again</Button>
    </AuthStatus>

    <AuthStatus
      v-else
      tone="error"
      :title="state === 'missing' ? 'This link is incomplete' : 'This link is not valid'"
      :description="
        state === 'missing'
          ? 'Open the link from the email again. It must be complete, including everything after the #.'
          : 'It may have been used already. Try signing in.'
      "
    >
      <Button as-child variant="outline" size="lg" class="w-full">
        <NuxtLink to="/login">Go to sign in</NuxtLink>
      </Button>
    </AuthStatus>
  </div>
</template>

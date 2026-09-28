<script setup lang="ts">
/**
 * Renderless sign-out: `<SignOutAction v-slot="{ signOut, pending }">`. Shared by the user menu and the mobile
 * menu so both behave the same (logic in app/lib/shell/sign-out.ts).
 */
import { toast } from 'vue-sonner'
import { signOut as runSignOut } from '~/lib/shell/sign-out'

defineSlots<{ default(props: { signOut: () => Promise<void>; pending: boolean }): unknown }>()

const api = useApi()
const user = useAuthState()
const pending = ref(false)

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

async function signOut() {
  if (pending.value) return
  pending.value = true
  try {
    await runSignOut({
      logout: () => api('/api/auth/logout', { method: 'POST' }),
      clearUser: () => {
        user.value = null
      },
      navigate: () => navigateTo('/login'),
      onError: () =>
        toast.error('The server did not confirm the sign-out', {
          description: 'Your session may still be active. Try signing out again later.',
        }),
      vault: localStorageOrNull(),
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <slot :sign-out="signOut" :pending="pending" />
</template>

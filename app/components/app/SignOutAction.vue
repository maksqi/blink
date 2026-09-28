<script setup lang="ts">
/**
 * Renderless sign-out: `<SignOutAction v-slot="{ signOut, pending }">`. Shared by the user menu and the mobile
 * menu so both behave the same: `useAuth().logout()` (server sign-out, key vault cleared, then `/login`).
 */
import { toast } from 'vue-sonner'

defineSlots<{ default(props: { signOut: () => Promise<void>; pending: boolean }): unknown }>()

const { logout } = useAuth()
const pending = ref(false)

async function signOut() {
  if (pending.value) return
  pending.value = true
  try {
    await logout({
      onError: () =>
        toast.error('The server did not confirm the sign-out', {
          description: 'Your session may still be active. Try signing out again later.',
        }),
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <slot :sign-out="signOut" :pending="pending" />
</template>

<script setup lang="ts">
/**
 * Change the own password. While `mustChangePassword` is set (bootstrap admin, admin-created or admin-reset accounts)
 * this is the only page the account can use (global middleware + API guard); the `auth` layout has no navigation,
 * only a way to sign out.
 */
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm.vue'

definePageMeta({ layout: 'auth', middleware: 'auth' })

const { user, logout } = useAuth()
// Decided once: the flag clears as soon as the change succeeds.
const forced = ref(user.value?.mustChangePassword === true)
useHead({ title: computed(() => (forced.value ? 'Choose a new password' : 'Change password')) })

async function onChanged() {
  toast.success('Password changed', { description: 'Every other device was signed out.' })
  await navigateTo(forced.value ? '/dashboard' : '/settings', { replace: true })
}

const signingOut = ref(false)
async function signOut() {
  signingOut.value = true
  try {
    await logout()
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="contents">
    <CardHeader>
      <CardTitle>
        <h1 class="text-xl font-semibold tracking-tight">
          {{ forced ? 'Choose a new password' : 'Change your password' }}
        </h1>
      </CardTitle>
      <CardDescription>
        <template v-if="forced">
          Before you continue, replace the password you were given with one that only you know.
        </template>
        <template v-else>Changing it signs you out on every other device.</template>
      </CardDescription>
    </CardHeader>

    <CardContent>
      <ChangePasswordForm
        id-prefix="change-password"
        :submit-label="forced ? 'Save and continue' : 'Change password'"
        block
        @changed="onChanged"
      />
    </CardContent>

    <CardFooter class="flex-wrap justify-between gap-2 border-t pt-6 text-sm text-muted-foreground">
      <span class="min-w-0 truncate">Signed in as {{ user?.email }}</span>
      <Button v-if="forced" variant="link" size="sm" class="h-auto px-0" :disabled="signingOut" @click="signOut"
        >Sign out</Button
      >
      <NuxtLink v-else to="/settings" class="font-medium text-foreground underline-offset-4 hover:underline"
        >Back to settings</NuxtLink
      >
    </CardFooter>
  </div>
</template>

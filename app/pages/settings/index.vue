<script setup lang="ts">
/** Account settings: display name and password. */
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm.vue'
import ProfileForm from '@/components/auth/ProfileForm.vue'
import SettingsNav from '@/components/auth/SettingsNav.vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Settings' })

function onPasswordChanged() {
  toast.success('Password changed', { description: 'Every other device was signed out.' })
}
</script>

<template>
  <div>
    <AppPageHeader title="Settings" description="Your name, your password and the devices you are signed in on." />
    <SettingsNav />
    <div class="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="settings-profile-title" class="text-lg font-semibold tracking-tight">Profile</h2>
          </CardTitle>
          <CardDescription>How you appear to others.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="settings-password-title" class="text-lg font-semibold tracking-tight">Password</h2>
          </CardTitle>
          <CardDescription>Changing it signs you out on every other device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm id-prefix="settings-password" @changed="onPasswordChanged" />
        </CardContent>
      </Card>
    </div>
  </div>
</template>

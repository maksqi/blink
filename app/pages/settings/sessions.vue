<script setup lang="ts">
/** Signed-in devices of the account, with sign-out per device. */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import SessionList from '@/components/auth/SessionList.vue'
import SettingsNav from '@/components/auth/SettingsNav.vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Devices' })
</script>

<template>
  <div>
    <AppPageHeader title="Settings" description="Your name, your password and the devices you are signed in on." />
    <SettingsNav />
    <Card class="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h2 id="settings-sessions-title" class="text-lg font-semibold tracking-tight">Signed-in devices</h2>
        </CardTitle>
        <CardDescription>
          Sessions end after 7 days without use and after 30 days at most. Sign out anything you do not recognize, then
          change your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SessionList />
      </CardContent>
    </Card>
  </div>
</template>

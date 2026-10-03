<script setup lang="ts">
/** /admin/settings: email status and test email, then every server setting by group. Changes apply without a restart. */
import { RefreshCwIcon } from '@lucide/vue'
import type { Settings } from '#shared/schemas/settings'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import FormAlert from '@/components/auth/FormAlert.vue'
import { adminErrorText } from '@/components/admin/AdminTime.vue'
import SettingsForm from '@/components/admin/SettingsForm.vue'
import SmtpCard from '@/components/admin/SmtpCard.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Admin' })

interface AdminSettingsView {
  settings: Settings
  smtp: { configured: boolean; host: string | null; from: string | null }
}

const api = useApi()
const view = shallowRef<AdminSettingsView | null>(null)
const loadError = ref<string | null>(null)

async function load() {
  loadError.value = null
  try {
    view.value = await api<AdminSettingsView>('/api/admin/settings')
  } catch (error) {
    loadError.value = adminErrorText(error)
  }
}

function onSaved(settings: Settings) {
  if (view.value) view.value = { ...view.value, settings }
}

onMounted(load)
</script>

<template>
  <div>
    <AppPageHeader title="Settings" description="Server-wide settings. Changes apply right away, without a restart." />

    <div v-if="loadError" class="flex flex-col items-start gap-3">
      <FormAlert :message="loadError" title="Settings could not be loaded" />
      <Button variant="outline" @click="load">
        <RefreshCwIcon aria-hidden="true" />
        Try again
      </Button>
    </div>
    <div v-else-if="!view" class="space-y-4" aria-busy="true" aria-label="Loading settings">
      <Skeleton v-for="i in 3" :key="i" class="h-40 w-full" />
    </div>
    <div v-else class="flex max-w-3xl flex-col gap-6">
      <SmtpCard :smtp="view.smtp" />
      <SettingsForm :settings="view.settings" :smtp-configured="view.smtp.configured" @saved="onSaved" />
    </div>
  </div>
</template>

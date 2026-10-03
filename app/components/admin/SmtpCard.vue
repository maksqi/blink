<script setup lang="ts">
/**
 * Email (SMTP) status on `/admin/settings`: configured or not (from the environment; never credentials), and "Send test
 * email" to the admin's own address or another one. Delivery problems show the SMTP server's short reason.
 */
import { useForm } from '@tanstack/vue-form'
import { MailCheckIcon, MailWarningIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { emailSchema } from '#shared/schemas/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from '@/components/auth/FormAlert.vue'
import { adminErrorText } from './AdminTime.vue'

const props = defineProps<{ smtp: { configured: boolean; host: string | null; from: string | null } }>()

const api = useApi()
const { user } = useAuth()
const sendError = ref<string | null>(null)

function optionalEmail({ value }: { value: string }) {
  if (!value.trim()) return undefined
  const parsed = emailSchema.safeParse(value)
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a valid email address')
}

const form = useForm({
  defaultValues: { to: '' },
  onSubmit: async ({ value }) => {
    sendError.value = null
    const to = value.to.trim()
    try {
      await api('/api/admin/settings/test-email', { method: 'POST', body: to ? { to } : {} })
      toast.success(`Test email sent to ${to || user.value?.email || 'you'}`)
    } catch (error) {
      sendError.value = adminErrorText(error)
    }
  },
})
const sending = form.useStore((state) => state.isSubmitting)
const configured = computed(() => props.smtp.configured)
</script>

<template>
  <Card data-testid="smtp-card">
    <CardHeader>
      <CardTitle class="flex flex-wrap items-center gap-2">
        <h2 class="text-base font-semibold">Email</h2>
        <Badge v-if="configured" variant="secondary" data-testid="smtp-status">
          <MailCheckIcon data-icon="inline-start" aria-hidden="true" />
          Configured
        </Badge>
        <Badge v-else variant="outline" data-testid="smtp-status">
          <MailWarningIcon data-icon="inline-start" aria-hidden="true" />
          Not configured
        </Badge>
      </CardTitle>
      <CardDescription>
        <template v-if="configured">
          Sent through <span class="font-mono">{{ smtp.host }}</span> as
          <span class="font-mono break-all">{{ smtp.from }}</span>. Change it in the server environment.
        </template>
        <template v-else>
          Set SMTP_HOST and SMTP_FROM in the server environment to send invites, password resets and address
          confirmations by email.
        </template>
      </CardDescription>
    </CardHeader>
    <CardContent v-if="configured">
      <form class="flex flex-col gap-3" novalidate @submit.prevent.stop="form.handleSubmit()">
        <FormAlert :message="sendError" title="The test email was not sent" />
        <form.Field name="to" :validators="{ onBlur: optionalEmail, onSubmit: optionalEmail }">
          <template #default="{ field }">
            <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
              <FieldLabel for="test-email-to">Send a test email to</FieldLabel>
              <div class="flex flex-wrap gap-2">
                <Input
                  id="test-email-to"
                  type="email"
                  class="w-full sm:w-72"
                  autocomplete="email"
                  maxlength="254"
                  :placeholder="user?.email ?? 'you@example.com'"
                  :model-value="field.state.value"
                  :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <Button type="submit" variant="outline" :disabled="sending" data-testid="send-test-email">
                  <Spinner v-if="sending" data-icon="inline-start" />
                  Send test email
                </Button>
              </div>
              <FieldDescription>Leave empty to send it to your own address.</FieldDescription>
              <FieldError :errors="fieldMessages(field.state.meta.errors)" />
            </Field>
          </template>
        </form.Field>
      </form>
    </CardContent>
  </Card>
</template>

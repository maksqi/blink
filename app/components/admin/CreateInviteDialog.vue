<script setup lang="ts">
/**
 * "Create invite" dialog (`POST /api/admin/invites`): optional email (required for admin invites, which expire within
 * 24 h), role, lifetime, and with SMTP the choice to email the link. The link `${publicUrl}/invite#<token>` is shown
 * once with a copy button; the server keeps only a hash of the token.
 */
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import type { CreatedInvite } from '#shared/schemas/admin'
import type { UserRole } from '#shared/schemas/auth'
import { emailSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from '@/components/auth/FormAlert.vue'
import { adminErrorText, conflictReason } from './AdminTime.vue'
import SecretValue from './SecretValue.vue'

type Lifetime = '24h' | '7d' | '30d'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ smtpEnabled: boolean; publicUrl: string }>()
const emit = defineEmits<{ created: [] }>()

const api = useApi()
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})
const created = shallowRef<CreatedInvite | null>(null)
const link = computed(() =>
  created.value ? `${props.publicUrl.replace(/\/$/, '')}/invite#${created.value.token}` : '',
)

const defaults = () => ({ email: '', role: 'user' as UserRole, expiresIn: '7d' as Lifetime, sendEmail: false })

/** Empty means "anyone with the link"; admin invites need an address. */
function emailRule({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue(name: 'role'): UserRole } } }) {
  const text = value.trim()
  if (!text) return fieldApi.form.getFieldValue('role') === 'admin' ? 'Admin invites need an email address' : undefined
  const parsed = emailSchema.safeParse(text)
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a valid email address')
}

const form = useForm({
  defaultValues: defaults(),
  onSubmit: async ({ value }) => {
    formError.value = null
    serverErrors.value = {}
    const email = value.email.trim()
    try {
      const result = await api<CreatedInvite>('/api/admin/invites', {
        method: 'POST',
        body: {
          ...(email ? { email } : {}),
          role: value.role,
          expiresIn: value.role === 'admin' ? '24h' : value.expiresIn,
          sendEmail: props.smtpEnabled && Boolean(email) && value.sendEmail,
        },
      })
      emit('created')
      created.value = result
      if (result.emailed) toast.success(`Invite emailed to ${result.email}`)
    } catch (error) {
      if (conflictReason(error) === 'email_taken') serverErrors.value = { email: adminErrorText(error) }
      else {
        const fields = apiFieldErrors(error)
        serverErrors.value = fields
        if (!Object.keys(fields).length) formError.value = adminErrorText(error)
      }
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
const role = form.useStore((state) => state.values.role)
const email = form.useStore((state) => state.values.email)

watch(open, (value) => {
  if (!value) return
  created.value = null
  formError.value = null
  serverErrors.value = {}
  form.reset(defaults())
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg" data-testid="create-invite-dialog">
      <template v-if="created">
        <DialogHeader>
          <DialogTitle>Invite created</DialogTitle>
          <DialogDescription>
            Share this link. It is shown only once and works until
            {{ new Date(created.expiresAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) }}.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Invite link</FieldLabel>
          <SecretValue :value="link" label="Invite link" testid="invite-link" />
          <FieldDescription v-if="created.email">Only {{ created.email }} can use it.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button @click="open = false">Done</Button>
        </DialogFooter>
      </template>

      <form v-else class="flex flex-col gap-6" novalidate @submit.prevent.stop="form.handleSubmit()">
        <DialogHeader>
          <DialogTitle>Create invite</DialogTitle>
          <DialogDescription>An invite link lets one person create an account.</DialogDescription>
        </DialogHeader>
        <FormAlert :message="formError" />
        <FieldGroup class="gap-5">
          <form.Field name="role">
            <template #default="{ field }">
              <Field>
                <FieldLabel for="invite-role">Role</FieldLabel>
                <Select
                  :model-value="field.state.value"
                  @update:model-value="(value) => field.handleChange(value === 'admin' ? 'admin' : 'user')"
                >
                  <SelectTrigger id="invite-role" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription v-if="role === 'admin'">
                  Admin invites are bound to one email address and expire after 24 hours.
                </FieldDescription>
              </Field>
            </template>
          </form.Field>

          <form.Field name="email" :validators="{ onBlur: emailRule, onSubmit: emailRule }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined">
                <FieldLabel for="invite-email">Email {{ role === 'admin' ? '' : '(optional)' }}</FieldLabel>
                <Input
                  id="invite-email"
                  :name="field.name"
                  type="email"
                  autocomplete="off"
                  maxlength="254"
                  :model-value="field.state.value"
                  :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <FieldDescription>With an address, only that person can use the invite.</FieldDescription>
                <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors.email)" />
              </Field>
            </template>
          </form.Field>

          <form.Field v-if="role !== 'admin'" name="expiresIn">
            <template #default="{ field }">
              <Field>
                <FieldLabel for="invite-expires">Expires after</FieldLabel>
                <Select
                  :model-value="field.state.value"
                  @update:model-value="(value) => field.handleChange((value as Lifetime) ?? '7d')"
                >
                  <SelectTrigger id="invite-expires" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </template>
          </form.Field>

          <form.Field v-if="smtpEnabled" name="sendEmail">
            <template #default="{ field }">
              <Field orientation="horizontal" :data-disabled="!email.trim() || undefined">
                <Checkbox
                  id="invite-send-email"
                  :model-value="field.state.value && Boolean(email.trim())"
                  :disabled="!email.trim()"
                  @update:model-value="(value) => field.handleChange(value === true)"
                />
                <FieldContent>
                  <FieldLabel for="invite-send-email">Email the invite link</FieldLabel>
                  <FieldDescription>Needs an email address. The link is also shown here once.</FieldDescription>
                </FieldContent>
              </Field>
            </template>
          </form.Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" :disabled="submitting" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting" data-testid="create-invite-submit">
            <Spinner v-if="submitting" data-icon="inline-start" />
            Create invite
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * "Create user" dialog (`POST /api/admin/users`): email, name, role, and with SMTP the choice to email the temporary
 * password. Otherwise the password is shown once in the dialog with a copy button; the new account must change it at
 * the first sign-in.
 */
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import type { CreatedUserCredentials } from '#shared/schemas/admin'
import type { UserRole } from '#shared/schemas/auth'
import { displayNameSchema, emailSchema } from '#shared/schemas/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ smtpEnabled: boolean }>()
const emit = defineEmits<{ created: [] }>()

const api = useApi()
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})
const created = shallowRef<CreatedUserCredentials | null>(null)

const defaults = () => ({ email: '', displayName: '', role: 'user' as UserRole, sendEmail: false })

const form = useForm({
  defaultValues: defaults(),
  onSubmit: async ({ value }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      const result = await api<CreatedUserCredentials>('/api/admin/users', {
        method: 'POST',
        body: { ...value, sendEmail: props.smtpEnabled && value.sendEmail },
      })
      emit('created')
      if (result.tempPassword) created.value = result
      else {
        toast.success(`Account created. The temporary password was emailed to ${result.user.email}.`)
        open.value = false
      }
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
    <DialogContent class="sm:max-w-lg" data-testid="create-user-dialog">
      <template v-if="created">
        <DialogHeader>
          <DialogTitle>Account created</DialogTitle>
          <DialogDescription>
            Give {{ created.user.displayName }} this temporary password. It is shown only once. They must choose a new
            password when they first sign in.
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <Field>
            <FieldLabel>Email</FieldLabel>
            <p class="truncate font-medium" data-testid="created-email">{{ created.user.email }}</p>
          </Field>
          <Field>
            <FieldLabel>Temporary password</FieldLabel>
            <SecretValue :value="created.tempPassword!" label="Temporary password" testid="temp-password" />
          </Field>
        </div>
        <DialogFooter>
          <Button @click="open = false">Done</Button>
        </DialogFooter>
      </template>

      <form v-else class="flex flex-col gap-6" novalidate @submit.prevent.stop="form.handleSubmit()">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            The account gets a temporary password and must change it at the first sign-in.
          </DialogDescription>
        </DialogHeader>
        <FormAlert :message="formError" />
        <FieldGroup class="gap-5">
          <form.Field name="email" :validators="{ onBlur: emailSchema, onSubmit: emailSchema }">
            <template #default="{ field }">
              <Field :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined">
                <FieldLabel for="create-user-email">Email</FieldLabel>
                <Input
                  id="create-user-email"
                  :name="field.name"
                  type="email"
                  autocomplete="off"
                  maxlength="254"
                  :model-value="field.state.value"
                  :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.email).length > 0 || undefined"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors.email)" />
              </Field>
            </template>
          </form.Field>

          <form.Field name="displayName" :validators="{ onBlur: displayNameSchema, onSubmit: displayNameSchema }">
            <template #default="{ field }">
              <Field
                :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined"
              >
                <FieldLabel for="create-user-name">Display name</FieldLabel>
                <Input
                  id="create-user-name"
                  :name="field.name"
                  autocomplete="off"
                  maxlength="64"
                  :model-value="field.state.value"
                  :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors.displayName)" />
              </Field>
            </template>
          </form.Field>

          <form.Field name="role">
            <template #default="{ field }">
              <Field>
                <FieldLabel for="create-user-role">Role</FieldLabel>
                <Select
                  :model-value="field.state.value"
                  @update:model-value="(value) => field.handleChange(value === 'admin' ? 'admin' : 'user')"
                >
                  <SelectTrigger id="create-user-role" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Admins can manage every account, room and setting.</FieldDescription>
              </Field>
            </template>
          </form.Field>

          <form.Field v-if="smtpEnabled" name="sendEmail">
            <template #default="{ field }">
              <Field orientation="horizontal">
                <Checkbox
                  id="create-user-send-email"
                  :model-value="field.state.value"
                  @update:model-value="(value) => field.handleChange(value === true)"
                />
                <FieldContent>
                  <FieldLabel for="create-user-send-email">Email the temporary password</FieldLabel>
                  <FieldDescription>Otherwise it is shown here once.</FieldDescription>
                </FieldContent>
              </Field>
            </template>
          </form.Field>
          <Alert v-else>
            <AlertTitle>Email is not set up</AlertTitle>
            <AlertDescription>The temporary password is shown here once. Pass it on yourself.</AlertDescription>
          </Alert>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" :disabled="submitting" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting" data-testid="create-user-submit">
            <Spinner v-if="submitting" data-icon="inline-start" />
            Create user
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Detail sheet of one account on `/admin/users` (decision: a sheet, no separate page): name and role, disable or
 * enable, reset the password (shown once or emailed), sign out everywhere, delete. Refusals (the last enabled admin,
 * the own account) are shown inline where they happen. Demoting yourself ends your admin access: the sheet then
 * refreshes the session and leaves the admin area.
 */
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import type { AdminUser } from '#shared/schemas/admin'
import type { UserRole } from '#shared/schemas/auth'
import { displayNameSchema } from '#shared/schemas/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import FormAlert from '@/components/auth/FormAlert.vue'
import AdminTime, { adminErrorText } from './AdminTime.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SecretValue from './SecretValue.vue'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ user: AdminUser | null; currentUserId: string | null; smtpEnabled: boolean }>()
const emit = defineEmits<{ updated: [user: AdminUser]; deleted: [id: string] }>()

const api = useApi()
const { refresh } = useAuth()
const current = shallowRef<AdminUser | null>(props.user)
const isSelf = computed(() => current.value !== null && current.value.id === props.currentUserId)
const sheetError = ref<string | null>(null)
const tempPassword = ref<string | null>(null)

watch(
  () => props.user,
  (user) => {
    current.value = user
    sheetError.value = null
    tempPassword.value = null
    if (user) form.reset({ displayName: user.displayName, role: user.role })
  },
)

async function patch(body: Partial<{ displayName: string; role: UserRole; disabled: boolean }>): Promise<boolean> {
  const user = current.value
  if (!user) return false
  sheetError.value = null
  try {
    const result = await api<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      body,
    })
    current.value = result.user
    emit('updated', result.user)
    if (isSelf.value && result.user.role !== 'admin') {
      toast.success('You are no longer an admin')
      await refresh()
      await navigateTo('/dashboard')
    }
    return true
  } catch (error) {
    sheetError.value = adminErrorText(error)
    return false
  }
}

const form = useForm({
  defaultValues: { displayName: props.user?.displayName ?? '', role: (props.user?.role ?? 'user') as UserRole },
  onSubmit: async ({ value, formApi }) => {
    const user = current.value
    if (!user) return
    const body: Partial<{ displayName: string; role: UserRole }> = {}
    if (value.displayName.trim() !== user.displayName) body.displayName = value.displayName
    if (value.role !== user.role) body.role = value.role
    if (!Object.keys(body).length) return
    if (await patch(body)) {
      formApi.reset({ displayName: current.value!.displayName, role: current.value!.role })
      toast.success('Changes saved')
    }
  },
})
const saving = form.useStore((state) => state.isSubmitting)
const dirty = form.useStore((state) => state.isDirty)

// ---- Confirmed actions -----------------------------------------------------------------------------------------------

type Action = 'disable' | 'reset' | 'revoke' | 'delete'
const action = ref<Action | null>(null)
const confirmOpen = ref(false)
const pending = ref(false)
const confirmError = ref<string | null>(null)
const emailPassword = ref(false)

const COPY: Record<Action, { title: string; description: (user: AdminUser) => string; confirm: string }> = {
  disable: {
    title: 'Disable this account?',
    description: (u) =>
      `${u.displayName} is signed out everywhere, leaves any meeting at once and cannot sign in until enabled again.`,
    confirm: 'Disable account',
  },
  reset: {
    title: 'Reset the password?',
    description: (u) =>
      `${u.displayName} gets a temporary password, is signed out everywhere and must choose a new password at the next sign-in.`,
    confirm: 'Reset password',
  },
  revoke: {
    title: 'Sign out everywhere?',
    description: (u) => `Every session of ${u.displayName} ends, including any meeting in progress.`,
    confirm: 'Sign out everywhere',
  },
  delete: {
    title: 'Delete this account?',
    description: (u) =>
      `${u.displayName} (${u.email}) is deleted with their rooms and recordings. Live meetings in their rooms end. This cannot be undone.`,
    confirm: 'Delete account',
  },
}

function ask(next: Action) {
  action.value = next
  confirmError.value = null
  emailPassword.value = false
  confirmOpen.value = true
}

async function setDisabled(disabled: boolean) {
  if (disabled) ask('disable')
  else if (await patch({ disabled: false })) toast.success('Account enabled')
}

async function confirm() {
  const user = current.value
  if (!user || !action.value) return
  pending.value = true
  confirmError.value = null
  const path = `/api/admin/users/${encodeURIComponent(user.id)}`
  try {
    if (action.value === 'disable') {
      const result = await api<{ user: AdminUser }>(path, { method: 'PATCH', body: { disabled: true } })
      current.value = result.user
      emit('updated', result.user)
      toast.success('Account disabled')
    } else if (action.value === 'reset') {
      const sendEmail = props.smtpEnabled && emailPassword.value
      const result = await api<{ tempPassword: string | null; emailed: boolean }>(`${path}/reset-password`, {
        method: 'POST',
        body: { sendEmail },
      })
      tempPassword.value = result.tempPassword
      current.value = { ...user, mustChangePassword: true }
      emit('updated', current.value)
      toast.success(result.emailed ? `A temporary password was emailed to ${user.email}` : 'Password reset')
    } else if (action.value === 'revoke') {
      await api(`${path}/revoke-sessions`, { method: 'POST' })
      toast.success(`${user.displayName} is signed out everywhere`)
    } else {
      await api(path, { method: 'DELETE' })
      toast.success('Account deleted')
      emit('deleted', user.id)
      open.value = false
    }
    confirmOpen.value = false
  } catch (error) {
    confirmError.value = adminErrorText(error)
  } finally {
    pending.value = false
  }
}

const copy = computed(() => (action.value ? COPY[action.value] : null))
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent class="w-full gap-0 overflow-y-auto sm:max-w-md" data-testid="user-sheet">
      <template v-if="current">
        <SheetHeader class="border-b">
          <SheetTitle class="flex flex-wrap items-center gap-2 pr-8">
            <span class="truncate">{{ current.displayName }}</span>
            <Badge v-if="isSelf" variant="outline">You</Badge>
          </SheetTitle>
          <SheetDescription class="truncate">{{ current.email }}</SheetDescription>
          <div class="flex flex-wrap gap-1.5 pt-1">
            <Badge :variant="current.role === 'admin' ? 'secondary' : 'outline'">
              {{ current.role === 'admin' ? 'Admin' : 'User' }}
            </Badge>
            <Badge v-if="current.disabled" variant="destructive">Disabled</Badge>
            <Badge v-if="current.mustChangePassword" variant="outline">Password change pending</Badge>
            <Badge v-if="!current.emailVerified" variant="outline">Email not confirmed</Badge>
          </div>
        </SheetHeader>

        <div class="flex flex-col gap-6 p-4">
          <FormAlert :message="sheetError" />

          <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt class="text-muted-foreground">Created</dt>
              <dd class="mt-0.5 font-medium"><AdminTime :iso="current.createdAt" date-only /></dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Last sign-in</dt>
              <dd class="mt-0.5 font-medium"><AdminTime :iso="current.lastLoginAt" /></dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Rooms</dt>
              <dd class="mt-0.5 font-medium tabular-nums">{{ current.roomCount }}</dd>
            </div>
          </dl>

          <form class="flex flex-col gap-4" novalidate @submit.prevent.stop="form.handleSubmit()">
            <FieldGroup class="gap-4">
              <form.Field name="displayName" :validators="{ onChange: displayNameSchema, onSubmit: displayNameSchema }">
                <template #default="{ field }">
                  <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
                    <FieldLabel for="user-sheet-name">Display name</FieldLabel>
                    <Input
                      id="user-sheet-name"
                      :name="field.name"
                      maxlength="64"
                      autocomplete="off"
                      :model-value="field.state.value"
                      :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                      @update:model-value="(value: string | number) => field.handleChange(String(value))"
                      @blur="field.handleBlur"
                    />
                    <FieldError :errors="fieldMessages(field.state.meta.errors)" />
                  </Field>
                </template>
              </form.Field>
              <form.Field name="role">
                <template #default="{ field }">
                  <Field>
                    <FieldLabel for="user-sheet-role">Role</FieldLabel>
                    <Select
                      :model-value="field.state.value"
                      @update:model-value="(value) => field.handleChange(value === 'admin' ? 'admin' : 'user')"
                    >
                      <SelectTrigger id="user-sheet-role" class="w-full" data-testid="user-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Changing the role signs the account out everywhere.</FieldDescription>
                  </Field>
                </template>
              </form.Field>
            </FieldGroup>
            <Button type="submit" class="self-start" :disabled="saving || !dirty" data-testid="user-save">
              <Spinner v-if="saving" data-icon="inline-start" />
              Save changes
            </Button>
          </form>

          <Separator />

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="user-sheet-disabled">Account disabled</FieldLabel>
              <FieldDescription>
                {{
                  isSelf
                    ? 'You cannot disable your own account.'
                    : 'Disabled accounts cannot sign in and leave meetings at once.'
                }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="user-sheet-disabled"
              :model-value="current.disabled"
              :disabled="isSelf"
              data-testid="user-disabled"
              @update:model-value="(value: boolean) => setDisabled(value)"
            />
          </Field>

          <Separator />

          <section class="flex flex-col gap-3" aria-labelledby="user-sheet-signin">
            <h3 id="user-sheet-signin" class="text-sm font-medium">Sign-in</h3>
            <div v-if="tempPassword" class="flex flex-col gap-2" data-testid="reset-result">
              <p class="text-sm text-muted-foreground">
                New temporary password, shown only once. {{ current.displayName }} must change it at the next sign-in.
              </p>
              <SecretValue :value="tempPassword" label="Temporary password" testid="reset-temp-password" />
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" data-testid="user-reset-password" @click="ask('reset')">Reset password</Button>
              <Button variant="outline" data-testid="user-revoke-sessions" @click="ask('revoke')">
                Sign out everywhere
              </Button>
            </div>
          </section>

          <Separator />

          <section class="flex flex-col gap-3" aria-labelledby="user-sheet-danger">
            <h3 id="user-sheet-danger" class="text-sm font-medium">Delete account</h3>
            <p class="text-sm text-muted-foreground">
              {{
                isSelf
                  ? 'You cannot delete your own account.'
                  : 'Deletes the account with its rooms and recordings. This cannot be undone.'
              }}
            </p>
            <Button
              variant="destructive"
              class="self-start"
              :disabled="isSelf"
              data-testid="user-delete"
              @click="ask('delete')"
            >
              Delete account
            </Button>
          </section>
        </div>
      </template>
    </SheetContent>
  </Sheet>

  <ConfirmDialog
    v-if="current && copy"
    v-model:open="confirmOpen"
    :title="copy.title"
    :description="copy.description(current)"
    :confirm-label="copy.confirm"
    :pending="pending"
    :error="confirmError"
    :destructive="action !== 'reset'"
    @confirm="confirm"
  >
    <Field v-if="action === 'reset' && smtpEnabled" orientation="horizontal">
      <Checkbox
        id="reset-email-password"
        :model-value="emailPassword"
        @update:model-value="(value) => (emailPassword = value === true)"
      />
      <FieldLabel for="reset-email-password" class="font-normal">Email the temporary password instead</FieldLabel>
    </Field>
  </ConfirmDialog>
</template>

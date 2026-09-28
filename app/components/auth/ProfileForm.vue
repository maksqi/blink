<script setup lang="ts">
/** Profile section of `/settings`: the display name (`PATCH /api/me`) and the read-only email and role. */
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import { displayNameSchema } from '#shared/schemas/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from './FormAlert.vue'

const { user, updateProfile } = useAuth()
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

const form = useForm({
  defaultValues: { displayName: user.value?.displayName ?? '' },
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    serverErrors.value = {}
    try {
      const updated = await updateProfile({ displayName: value.displayName })
      formApi.reset({ displayName: updated.displayName })
      toast.success('Profile saved')
    } catch (error) {
      const fields = apiFieldErrors(error)
      serverErrors.value = fields
      if (!Object.keys(fields).length) formError.value = authErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
const dirty = form.useStore((state) => state.isDirty)
</script>

<template>
  <form class="flex flex-col gap-6" novalidate data-testid="profile-form" @submit.prevent.stop="form.handleSubmit()">
    <FormAlert :message="formError" />
    <FieldGroup class="gap-5">
      <form.Field name="displayName" :validators="{ onBlur: displayNameSchema, onSubmit: displayNameSchema }">
        <template #default="{ field }">
          <Field
            :data-invalid="fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined"
          >
            <FieldLabel for="profile-display-name">Display name</FieldLabel>
            <Input
              id="profile-display-name"
              :name="field.name"
              :model-value="field.state.value"
              autocomplete="name"
              maxlength="64"
              class="h-10"
              :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors.displayName).length > 0 || undefined"
              aria-describedby="profile-display-name-hint profile-display-name-error"
              @update:model-value="(value: string | number) => field.handleChange(String(value))"
              @blur="field.handleBlur"
            />
            <FieldDescription id="profile-display-name-hint"
              >Shown to others in meetings. Up to 64 characters.</FieldDescription
            >
            <FieldError
              id="profile-display-name-error"
              :errors="fieldMessages(field.state.meta.errors, serverErrors.displayName)"
            />
          </Field>
        </template>
      </form.Field>

      <Field>
        <FieldLabel for="profile-email">Email</FieldLabel>
        <Input
          id="profile-email"
          :model-value="user?.email ?? ''"
          type="email"
          class="h-10"
          readonly
          aria-describedby="profile-email-hint"
        />
        <FieldDescription id="profile-email-hint" class="flex flex-wrap items-center gap-2">
          <span>Your sign-in address. Ask an administrator to change it.</span>
          <Badge v-if="user?.role === 'admin'" variant="secondary">Admin</Badge>
          <Badge v-if="user && !user.emailVerified" variant="outline">Not confirmed</Badge>
        </FieldDescription>
      </Field>
    </FieldGroup>

    <Button type="submit" size="lg" class="w-full sm:w-auto sm:self-start" :disabled="submitting || !dirty">
      <Spinner v-if="submitting" />
      Save profile
    </Button>
  </form>
</template>

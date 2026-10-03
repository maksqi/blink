<script setup lang="ts">
/**
 * Rename dialog for yourself (`POST /me/name`) or, for moderators, someone else (`POST /participants/:identity/name`).
 * Validated with the shared `displayNameSchema`; the new name reaches everyone through LiveKit, so nothing is changed
 * optimistically here.
 */
import { useForm } from '@tanstack/vue-form'
import { watch } from 'vue'
import { displayNameSchema } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { fieldMessages } from '~/composables/useAuth'

const props = defineProps<{
  title: string
  description: string
  initialName: string
  /** Sends the normalized name; resolves true when the server accepted it. */
  submit: (displayName: string) => Promise<boolean>
}>()

const open = defineModel<boolean>('open', { required: true })

const form = useForm({
  defaultValues: { displayName: props.initialName },
  onSubmit: async ({ value }) => {
    const parsed = displayNameSchema.safeParse(value.displayName)
    if (!parsed.success) return
    if (await props.submit(parsed.data)) open.value = false
  },
})
const submitting = form.useStore((state) => state.isSubmitting)

watch(open, (isOpen) => {
  if (isOpen) form.reset({ displayName: props.initialName })
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md" data-testid="rename-dialog">
      <form novalidate class="flex flex-col gap-5" @submit.prevent.stop="form.handleSubmit()">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription>{{ description }}</DialogDescription>
        </DialogHeader>
        <form.Field name="displayName" :validators="{ onSubmit: displayNameSchema, onBlur: displayNameSchema }">
          <template #default="{ field }">
            <Field :data-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined">
              <FieldLabel for="call-rename-input">Name</FieldLabel>
              <Input
                id="call-rename-input"
                :name="field.name"
                :model-value="field.state.value"
                autocomplete="off"
                maxlength="64"
                class="h-10"
                data-testid="rename-input"
                :aria-invalid="fieldMessages(field.state.meta.errors).length > 0 || undefined"
                aria-describedby="call-rename-error"
                @update:model-value="(value: string | number) => field.handleChange(String(value))"
                @blur="field.handleBlur"
              />
              <FieldError id="call-rename-error" :errors="fieldMessages(field.state.meta.errors)" />
            </Field>
          </template>
        </form.Field>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting" data-testid="rename-save">
            <Spinner v-if="submitting" />
            Save name
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

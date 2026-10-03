<script lang="ts">
/**
 * The settings form of `/admin/settings`: one section per group (registration, guests, media, limits, recording,
 * privacy and audit). Only changed keys are sent (`PUT /api/admin/settings` is a strict partial update); the server
 * re-validates the merged result, and its field errors are shown under the matching control. Changes apply at once.
 *
 * Form values are nested by group (`registration.mode` is `values.registration.mode`), so TanStack field names equal
 * the setting keys. Allowed domains are edited as text, one per line (commas work too).
 */
import type { SettingKey, Settings } from '#shared/schemas/settings'
import { useForm } from '@tanstack/vue-form'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import FormAlert from '@/components/auth/FormAlert.vue'
import { ApiError } from '~/composables/useApi'
import { adminErrorText } from './AdminTime.vue'

type FieldKind = 'switch' | 'select' | 'number' | 'domains'

export interface SettingField {
  key: SettingKey
  label: string
  description: string
  kind: FieldKind
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  step?: number
  integer?: boolean
}

export interface SettingSection {
  id: string
  title: string
  description: string
  fields: SettingField[]
}

const RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
]

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: 'registration',
    title: 'Registration',
    description: 'Who can create an account.',
    fields: [
      {
        key: 'registration.mode',
        label: 'Registration',
        description: 'Invite only: accounts come from invites or admins. Email domains: anyone with a listed domain.',
        kind: 'select',
        options: [
          { value: 'invite_only', label: 'Invite only' },
          { value: 'open', label: 'Open to everyone' },
          { value: 'domain', label: 'Email domains' },
        ],
      },
      {
        key: 'registration.allowedDomains',
        label: 'Allowed email domains',
        description: 'One domain per line, for example company.com. Used when registration is limited to email domains.',
        kind: 'domains',
      },
    ],
  },
  {
    id: 'guests',
    title: 'Guests',
    description: 'People without an account.',
    fields: [
      {
        key: 'guests.allowed',
        label: 'Allow guests',
        description: 'Guests join with an invite link. Room owners can still turn guests off for their room.',
        kind: 'switch',
      },
    ],
  },
  {
    id: 'media',
    title: 'Media',
    description: 'Quality limits for cameras and screen sharing.',
    fields: [
      {
        key: 'media.maxCameraResolution',
        label: 'Camera resolution',
        description: 'The highest camera quality anyone sends.',
        kind: 'select',
        options: RESOLUTIONS,
      },
      {
        key: 'media.maxScreenShareResolution',
        label: 'Screen share resolution',
        description: 'The highest screen share quality.',
        kind: 'select',
        options: RESOLUTIONS,
      },
      {
        key: 'media.maxScreenShareFps',
        label: 'Screen share frame rate',
        description: 'Higher rates suit video, lower rates save bandwidth.',
        kind: 'select',
        options: [
          { value: '5', label: '5 fps' },
          { value: '15', label: '15 fps' },
          { value: '30', label: '30 fps' },
        ],
      },
    ],
  },
  {
    id: 'limits',
    title: 'Limits',
    description: 'Room size and how many rooms each account can have.',
    fields: [
      {
        key: 'limits.maxParticipantsPerRoom',
        label: 'People per meeting',
        description: 'From 2 to 25.',
        kind: 'number',
        min: 2,
        max: 25,
        integer: true,
      },
      {
        key: 'limits.maxRoomsPerUser',
        label: 'Rooms per account',
        description: 'From 1 to 1000.',
        kind: 'number',
        min: 1,
        max: 1000,
        integer: true,
      },
    ],
  },
  {
    id: 'recording',
    title: 'Recording',
    description: 'Recordings are made in the browser and stored encrypted on this server.',
    fields: [
      {
        key: 'recording.enabled',
        label: 'Allow recording',
        description: 'Hosts and co-hosts can record meetings.',
        kind: 'switch',
      },
      {
        key: 'recording.maxDurationMinutes',
        label: 'Longest recording (minutes)',
        description: 'From 1 to 600.',
        kind: 'number',
        min: 1,
        max: 600,
        integer: true,
      },
      {
        key: 'recording.maxResolution',
        label: 'Recording resolution',
        description: 'The highest recording quality.',
        kind: 'select',
        options: RESOLUTIONS,
      },
      {
        key: 'recording.retentionDays',
        label: 'Keep recordings (days)',
        description: 'Recordings are deleted after this many days. From 1 to 3650.',
        kind: 'number',
        min: 1,
        max: 3650,
        integer: true,
      },
      {
        key: 'recording.userQuotaGb',
        label: 'Storage per account (GB)',
        description: '0 means no limit.',
        kind: 'number',
        min: 0,
        max: 100_000,
        step: 0.5,
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy and audit',
    description: 'How long personal data and the audit log are kept.',
    fields: [
      {
        key: 'privacy.ipRetentionDays',
        label: 'Keep IP addresses (days)',
        description: 'IP addresses in sessions and the audit log are erased after this. From 1 to 365.',
        kind: 'number',
        min: 1,
        max: 365,
        integer: true,
      },
      {
        key: 'audit.retentionDays',
        label: 'Keep audit entries (days)',
        description: 'From 30 to 3650.',
        kind: 'number',
        min: 30,
        max: 3650,
        integer: true,
      },
    ],
  },
]

export const SETTING_FIELDS: SettingField[] = SETTING_SECTIONS.flatMap((section) => section.fields)

/** Form value of one setting: numbers stay numbers, the frame rate is a select string, domains are text. */
export function toFormValue(field: SettingField, settings: Settings): unknown {
  const value = settings[field.key]
  if (field.kind === 'domains') return (value as string[]).join('\n')
  if (field.key === 'media.maxScreenShareFps') return String(value)
  return value
}

export function fromFormValue(field: SettingField, value: unknown): unknown {
  if (field.kind === 'domains') {
    return String(value ?? '')
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean)
  }
  if (field.key === 'media.maxScreenShareFps') return Number(value)
  if (field.kind === 'number') return typeof value === 'number' ? value : Number(value)
  return value
}

export function numberProblem(field: SettingField, value: unknown): string | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (value === '' || value === null || !Number.isFinite(number)) return 'Enter a number'
  if (field.integer && !Number.isInteger(number)) return 'Enter a whole number'
  if (field.min !== undefined && number < field.min) return `Use at least ${field.min}`
  if (field.max !== undefined && number > field.max) return `Use at most ${field.max}`
  return undefined
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function domainsProblem(value: unknown): string | undefined {
  const domains = fromFormValue({ key: 'registration.allowedDomains', kind: 'domains' } as SettingField, value) as string[]
  if (domains.length > 50) return 'Use at most 50 domains'
  const invalid = domains.find((domain) => !DOMAIN.test(domain))
  return invalid ? `"${invalid}" is not a domain like company.com` : undefined
}

/** The setting a server issue path (`registration.allowedDomains.0`) belongs to. */
export function settingOfPath(path: string): SettingKey | undefined {
  return SETTING_FIELDS.map((field) => field.key).find((key) => path === key || path.startsWith(`${key}.`))
}
</script>

<script setup lang="ts">
const props = defineProps<{ settings: Settings; smtpConfigured: boolean }>()
const emit = defineEmits<{ saved: [settings: Settings] }>()

const api = useApi()
const formError = ref<string | null>(null)
const serverErrors = ref<Partial<Record<SettingKey, string>>>({})

function toForm(settings: Settings): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {}
  for (const field of SETTING_FIELDS) {
    const [group, name] = field.key.split('.') as [string, string]
    values[group] ??= {}
    values[group][name] = toFormValue(field, settings)
  }
  return values
}

function readField(values: Record<string, Record<string, unknown>>, key: SettingKey): unknown {
  const [group, name] = key.split('.') as [string, string]
  return values[group]?.[name]
}

const form = useForm({
  defaultValues: toForm(props.settings),
  onSubmit: async ({ value, formApi }) => {
    formError.value = null
    serverErrors.value = {}
    const patch: Record<string, unknown> = {}
    for (const field of SETTING_FIELDS) {
      const next = fromFormValue(field, readField(value, field.key))
      if (JSON.stringify(next) !== JSON.stringify(props.settings[field.key])) patch[field.key] = next
    }
    if (!Object.keys(patch).length) {
      toast.info('Nothing to save')
      return
    }
    try {
      const result = await api<{ settings: Settings }>('/api/admin/settings', { method: 'PUT', body: patch })
      formApi.reset(toForm(result.settings))
      emit('saved', result.settings)
      toast.success('Settings saved. They apply right away.')
    } catch (error) {
      const issues =
        error instanceof ApiError && error.code === 'VALIDATION_FAILED'
          ? ((error.details as { issues?: Array<{ path?: unknown; message?: unknown }> } | undefined)?.issues ?? [])
          : []
      const mapped: Partial<Record<SettingKey, string>> = {}
      for (const issue of issues) {
        const key = typeof issue.path === 'string' ? settingOfPath(issue.path) : undefined
        if (key && typeof issue.message === 'string') mapped[key] ??= issue.message
      }
      serverErrors.value = mapped
      formError.value = Object.keys(mapped).length ? 'Some settings are invalid. Check the marked fields.' : adminErrorText(error)
    }
  },
})
const submitting = form.useStore((state) => state.isSubmitting)
const dirty = form.useStore((state) => state.isDirty)

watch(
  () => props.settings,
  (settings) => form.reset(toForm(settings)),
)

function validatorsFor(field: SettingField) {
  if (field.kind === 'number') {
    const rule = ({ value }: { value: unknown }) => numberProblem(field, value)
    return { onChange: rule, onSubmit: rule }
  }
  if (field.kind === 'domains') {
    const rule = ({ value }: { value: unknown }) => domainsProblem(value)
    return { onBlur: rule, onSubmit: rule }
  }
  return {}
}

const inputId = (key: SettingKey) => `setting-${key.replace('.', '-')}`
// TanStack types field names from the form values; the names here are built from the setting keys at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fieldName = (key: SettingKey) => key as any
</script>

<template>
  <form method="post" class="flex flex-col gap-6" novalidate data-testid="settings-form" @submit.prevent.stop="form.handleSubmit()">
    <FormAlert :message="formError" />

    <Card v-for="section in SETTING_SECTIONS" :key="section.id" :data-section="section.id">
      <CardHeader>
        <CardTitle>
          <h2 class="text-base font-semibold">{{ section.title }}</h2>
        </CardTitle>
        <CardDescription>{{ section.description }}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup class="gap-6">
          <form.Field
            v-for="item in section.fields"
            :key="item.key"
            :name="fieldName(item.key)"
            :validators="validatorsFor(item)"
          >
            <template #default="{ field }">
              <Field
                v-if="item.kind === 'switch'"
                orientation="horizontal"
                :data-invalid="serverErrors[item.key] ? true : undefined"
              >
                <FieldContent>
                  <FieldLabel :for="inputId(item.key)">{{ item.label }}</FieldLabel>
                  <FieldDescription>{{ item.description }}</FieldDescription>
                  <FieldError :errors="fieldMessages([], serverErrors[item.key])" />
                </FieldContent>
                <Switch
                  :id="inputId(item.key)"
                  :model-value="field.state.value === true"
                  :data-testid="`setting-${item.key}`"
                  @update:model-value="(value: boolean) => field.handleChange(value)"
                />
              </Field>

              <Field
                v-else
                :data-invalid="fieldMessages(field.state.meta.errors, serverErrors[item.key]).length > 0 || undefined"
              >
                <FieldLabel :for="inputId(item.key)">{{ item.label }}</FieldLabel>
                <Select
                  v-if="item.kind === 'select'"
                  :model-value="String(field.state.value)"
                  @update:model-value="(value) => field.handleChange(String(value))"
                >
                  <SelectTrigger :id="inputId(item.key)" class="w-full sm:w-64" :data-testid="`setting-${item.key}`">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in item.options"
                      :key="option.value"
                      :value="option.value"
                      :disabled="item.key === 'registration.mode' && option.value === 'domain' && !smtpConfigured"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  v-else-if="item.kind === 'domains'"
                  :id="inputId(item.key)"
                  :model-value="String(field.state.value ?? '')"
                  rows="3"
                  class="max-w-md font-mono"
                  spellcheck="false"
                  autocapitalize="off"
                  :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors[item.key]).length > 0 || undefined"
                  :data-testid="`setting-${item.key}`"
                  @update:model-value="(value: string | number) => field.handleChange(String(value))"
                  @blur="field.handleBlur"
                />
                <Input
                  v-else
                  :id="inputId(item.key)"
                  type="number"
                  inputmode="decimal"
                  class="w-full sm:w-40"
                  :min="item.min"
                  :max="item.max"
                  :step="item.step ?? 1"
                  :model-value="field.state.value as number"
                  :aria-invalid="fieldMessages(field.state.meta.errors, serverErrors[item.key]).length > 0 || undefined"
                  :data-testid="`setting-${item.key}`"
                  @update:model-value="(value: string | number) => field.handleChange(value === '' ? '' : Number(value))"
                  @blur="field.handleBlur"
                />
                <FieldDescription>
                  {{ item.description }}
                  <template v-if="item.key === 'registration.mode' && !smtpConfigured">
                    Email domains need SMTP for address confirmation.
                  </template>
                </FieldDescription>
                <FieldError :errors="fieldMessages(field.state.meta.errors, serverErrors[item.key])" />
              </Field>
            </template>
          </form.Field>
        </FieldGroup>
      </CardContent>
    </Card>

    <div
      class="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <span v-if="dirty" class="mr-auto text-sm text-muted-foreground" aria-live="polite">Unsaved changes</span>
      <Button type="button" variant="outline" :disabled="submitting || !dirty" @click="form.reset(toForm(settings))">
        Discard
      </Button>
      <Button type="submit" :disabled="submitting || !dirty" data-testid="save-settings">
        <Spinner v-if="submitting" data-icon="inline-start" />
        Save settings
      </Button>
    </div>
  </form>
</template>

<script lang="ts">
/**
 * `<AdminTime :iso="..." />` renders a timestamp as a `<time>` element (date and time, or `date-only`), and this SFC's
 * plain <script> block holds the helpers every admin page shares (Nuxt would register a loose .ts file under
 * components/ as a component):
 *
 * - `adminErrorText(error)`: one English sentence for a failed admin request, from its code and `details.reason`
 *   (never server text).
 * - `formatDateTime(iso)`, `formatDate(iso)`: in the viewer's time zone (admin lists load on the client).
 * - `copyText(text)`: clipboard write; false when the browser refuses (the caller shows the text to copy by hand).
 * - `pageQuery(route)`: the `?page=` of a list page (1 when missing or invalid).
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { errorMessage } from '#shared/utils/error-codes'
import { ApiError } from '~/composables/useApi'

const REASON_TEXT: Record<string, string> = {
  last_admin: 'This is the last enabled admin. Make another account an admin first.',
  self: 'You cannot do this to your own account.',
  email_taken: 'An account with this email address already exists.',
  not_live: 'This room has no live meeting.',
}

export function conflictReason(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'CONFLICT') return null
  const reason = (error.details as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' ? reason : null
}

export function adminErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage('INTERNAL')
  if (error.code === 'NETWORK') return error.message
  const reason = conflictReason(error)
  if (reason && REASON_TEXT[reason]) return REASON_TEXT[reason]
  if (error.code === 'SERVICE_UNAVAILABLE') {
    const smtpError = (error.details as { smtpError?: unknown } | undefined)?.smtpError
    if (typeof smtpError === 'string' && smtpError) return `Email could not be sent: ${smtpError}`
  }
  if (error.code === 'NOT_FOUND') return 'This item no longer exists. Reload the list.'
  return errorMessage(error.code)
}

const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnlyFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

export function formatDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function formatDate(iso: string | null): string {
  return iso ? dateOnlyFormat.format(new Date(iso)) : '—'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function pageQuery(route: Pick<RouteLocationNormalizedLoaded, 'query'>): number {
  const value = Number(route.query.page)
  return Number.isInteger(value) && value > 0 ? value : 1
}
</script>

<script setup lang="ts">
const props = defineProps<{ iso: string | null; dateOnly?: boolean }>()
const text = computed(() => (props.dateOnly ? formatDate(props.iso) : formatDateTime(props.iso)))
</script>

<template>
  <time v-if="iso" :datetime="iso" class="whitespace-nowrap tabular-nums">{{ text }}</time>
  <span v-else class="text-muted-foreground">—</span>
</template>

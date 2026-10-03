<script setup lang="ts">
/**
 * Audit entries of `/admin/audit`. Details are rendered as plain text (`key: value`), never as HTML. Clicking an actor
 * filters the log by that account.
 */
import type { AuditEntry } from '#shared/schemas/admin'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminTime from './AdminTime.vue'

defineProps<{ items: AuditEntry[] }>()
const emit = defineEmits<{ actor: [userId: string, name: string | null] }>()

function detailLines(details: Record<string, unknown> | null): string[] {
  if (!details) return []
  return Object.entries(details).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return `${key}: ${text}`
  })
}

function actorLabel(entry: AuditEntry): string {
  if (entry.actor.displayName) return entry.actor.displayName
  if (entry.actor.userId) return 'Deleted account'
  if (entry.actor.participantId) return 'Meeting participant'
  return 'System'
}
</script>

<template>
  <Table data-testid="audit-table">
    <TableHeader>
      <TableRow>
        <TableHead class="hidden w-44 sm:table-cell">Time</TableHead>
        <TableHead>Action</TableHead>
        <TableHead class="hidden md:table-cell">Actor</TableHead>
        <TableHead class="hidden lg:table-cell">Target</TableHead>
        <TableHead class="hidden xl:table-cell">Details</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="entry in items" :key="entry.id" :data-action="entry.action" data-testid="audit-row">
        <TableCell class="hidden align-top sm:table-cell"><AdminTime :iso="entry.at" /></TableCell>
        <TableCell class="w-full max-w-0 align-top">
          <span class="block text-xs text-muted-foreground sm:hidden"><AdminTime :iso="entry.at" /></span>
          <code class="block truncate font-mono text-xs">{{ entry.action }}</code>
          <span class="block truncate text-xs text-muted-foreground md:hidden">{{ actorLabel(entry) }}</span>
          <ul v-if="entry.details" class="mt-1 space-y-0.5 text-xs text-muted-foreground xl:hidden">
            <li v-for="line in detailLines(entry.details)" :key="line" class="truncate">{{ line }}</li>
          </ul>
        </TableCell>
        <TableCell class="hidden max-w-48 min-w-0 align-top md:table-cell">
          <button
            v-if="entry.actor.userId"
            type="button"
            class="block max-w-full truncate rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            :title="`Show only entries by ${actorLabel(entry)}`"
            @click="emit('actor', entry.actor.userId, entry.actor.displayName)"
          >
            {{ actorLabel(entry) }}
          </button>
          <span v-else class="block truncate">{{ actorLabel(entry) }}</span>
          <span v-if="entry.ip" class="block truncate font-mono text-xs text-muted-foreground">{{ entry.ip }}</span>
        </TableCell>
        <TableCell class="hidden max-w-56 min-w-0 align-top lg:table-cell">
          <template v-if="entry.targetType">
            <span class="block text-xs text-muted-foreground">{{ entry.targetType }}</span>
            <code v-if="entry.targetId" class="block truncate font-mono text-xs">{{ entry.targetId }}</code>
          </template>
          <span v-else class="text-muted-foreground">—</span>
        </TableCell>
        <TableCell class="hidden max-w-80 min-w-0 align-top xl:table-cell">
          <ul v-if="entry.details" class="space-y-0.5 font-mono text-xs text-muted-foreground">
            <li v-for="line in detailLines(entry.details)" :key="line" class="break-all whitespace-normal">{{ line }}</li>
          </ul>
          <span v-else class="text-muted-foreground">—</span>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

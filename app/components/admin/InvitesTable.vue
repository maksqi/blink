<script setup lang="ts">
/** Account invites of `/admin/invites`: who it is for, role, state, expiry; pending invites can be revoked. */
import { BanIcon } from '@lucide/vue'
import type { AdminInvite } from '#shared/schemas/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminTime from './AdminTime.vue'

defineProps<{ items: AdminInvite[]; now: number }>()
const emit = defineEmits<{ revoke: [invite: AdminInvite] }>()

type InviteState = 'pending' | 'used' | 'expired' | 'revoked'

function stateOf(invite: AdminInvite, now: number): InviteState {
  if (invite.revoked) return 'revoked'
  if (invite.usedAt) return 'used'
  if (Date.parse(invite.expiresAt) <= now) return 'expired'
  return 'pending'
}

const LABEL: Record<InviteState, string> = { pending: 'Pending', used: 'Used', expired: 'Expired', revoked: 'Revoked' }
</script>

<template>
  <Table data-testid="invites-table">
    <TableHeader>
      <TableRow>
        <TableHead>For</TableHead>
        <TableHead class="hidden sm:table-cell">Role</TableHead>
        <TableHead class="hidden sm:table-cell">State</TableHead>
        <TableHead class="hidden md:table-cell">Expires</TableHead>
        <TableHead class="hidden lg:table-cell">Created</TableHead>
        <TableHead class="text-right"><span class="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="invite in items" :key="invite.id" :data-invite-id="invite.id" data-testid="invite-row">
        <TableCell class="w-full max-w-0">
          <span class="block truncate font-medium">{{ invite.email ?? 'Anyone with the link' }}</span>
          <span class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
            <Badge :variant="stateOf(invite, now) === 'pending' ? 'default' : 'outline'">
              {{ LABEL[stateOf(invite, now)] }}
            </Badge>
            <span v-if="invite.role === 'admin'">Admin</span>
          </span>
        </TableCell>
        <TableCell class="hidden sm:table-cell">
          <Badge :variant="invite.role === 'admin' ? 'secondary' : 'outline'">
            {{ invite.role === 'admin' ? 'Admin' : 'User' }}
          </Badge>
        </TableCell>
        <TableCell class="hidden sm:table-cell">
          <Badge
            :variant="stateOf(invite, now) === 'pending' ? 'default' : 'outline'"
            :data-state="stateOf(invite, now)"
          >
            {{ LABEL[stateOf(invite, now)] }}
          </Badge>
        </TableCell>
        <TableCell class="hidden md:table-cell"><AdminTime :iso="invite.expiresAt" /></TableCell>
        <TableCell class="hidden lg:table-cell"><AdminTime :iso="invite.createdAt" date-only /></TableCell>
        <TableCell class="text-right">
          <Button
            v-if="stateOf(invite, now) === 'pending'"
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-destructive"
            :aria-label="`Revoke the invite for ${invite.email ?? 'anyone with the link'}`"
            data-testid="revoke-invite"
            @click="emit('revoke', invite)"
          >
            <BanIcon data-icon="inline-start" aria-hidden="true" />
            <span class="hidden sm:inline">Revoke</span>
          </Button>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

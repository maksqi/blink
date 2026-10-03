<script setup lang="ts">
/** Accounts table of `/admin/users`; "Manage" opens the detail sheet. Columns collapse on narrow screens. */
import { ChevronRightIcon } from '@lucide/vue'
import type { AdminUser } from '#shared/schemas/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminTime from './AdminTime.vue'

defineProps<{ items: AdminUser[]; currentUserId: string | null }>()
const emit = defineEmits<{ select: [user: AdminUser] }>()
</script>

<template>
  <Table data-testid="users-table">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead class="hidden sm:table-cell">Role</TableHead>
        <TableHead class="hidden md:table-cell">Status</TableHead>
        <TableHead class="hidden text-right lg:table-cell">Rooms</TableHead>
        <TableHead class="hidden lg:table-cell">Last sign-in</TableHead>
        <TableHead class="text-right"><span class="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="user in items" :key="user.id" :data-user-id="user.id" data-testid="user-row">
        <TableCell class="max-w-64 min-w-0">
          <span class="flex items-center gap-2">
            <span class="truncate font-medium">{{ user.displayName }}</span>
            <Badge v-if="user.id === currentUserId" variant="outline">You</Badge>
          </span>
          <span class="block truncate text-xs text-muted-foreground">{{ user.email }}</span>
          <span class="mt-1 flex flex-wrap gap-1 md:hidden">
            <Badge v-if="user.role === 'admin'" variant="secondary" class="sm:hidden">Admin</Badge>
            <Badge v-if="user.disabled" variant="destructive">Disabled</Badge>
          </span>
        </TableCell>
        <TableCell class="hidden sm:table-cell">
          <Badge :variant="user.role === 'admin' ? 'secondary' : 'outline'">
            {{ user.role === 'admin' ? 'Admin' : 'User' }}
          </Badge>
        </TableCell>
        <TableCell class="hidden md:table-cell">
          <span class="flex flex-wrap gap-1">
            <Badge v-if="user.disabled" variant="destructive">Disabled</Badge>
            <Badge v-else variant="outline">Active</Badge>
            <Badge v-if="user.mustChangePassword" variant="outline">Password change pending</Badge>
          </span>
        </TableCell>
        <TableCell class="hidden text-right tabular-nums lg:table-cell">{{ user.roomCount }}</TableCell>
        <TableCell class="hidden lg:table-cell"><AdminTime :iso="user.lastLoginAt" /></TableCell>
        <TableCell class="text-right">
          <Button
            variant="ghost"
            size="sm"
            :aria-label="`Manage ${user.displayName}`"
            data-testid="manage-user"
            @click="emit('select', user)"
          >
            Manage
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

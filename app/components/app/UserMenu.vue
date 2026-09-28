<script setup lang="ts">
import { LogOutIcon, SettingsIcon } from '@lucide/vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { initials } from '~/lib/shell/initials'
import SignOutAction from './SignOutAction.vue'

const user = useAuthState()
</script>

<template>
  <DropdownMenu v-if="user">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" class="rounded-full" aria-label="Account menu" data-testid="user-menu">
        <Avatar>
          <AvatarFallback class="bg-primary/12 text-xs font-semibold text-primary">
            {{ initials(user.displayName) }}
          </AvatarFallback>
        </Avatar>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuLabel class="flex items-center gap-3 py-2 font-normal">
        <Avatar size="lg">
          <AvatarFallback class="bg-primary/12 font-semibold text-primary">
            {{ initials(user.displayName) }}
          </AvatarFallback>
        </Avatar>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 truncate text-sm font-medium text-foreground">
            <span class="truncate">{{ user.displayName }}</span>
            <Badge v-if="user.role === 'admin'" variant="secondary" class="shrink-0">Admin</Badge>
          </p>
          <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem as-child>
        <NuxtLink to="/settings">
          <SettingsIcon aria-hidden="true" />
          Settings
        </NuxtLink>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <SignOutAction v-slot="{ signOut, pending }">
        <DropdownMenuItem :disabled="pending" @select="signOut">
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </SignOutAction>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { ADMIN_NAV, isNavItemActive } from '~/lib/shell/nav'
import AppLogo from './AppLogo.vue'

const route = useRoute()
const { setOpenMobile } = useSidebar()

// On phones the sidebar is a sheet: close it after navigating.
watch(
  () => route.fullPath,
  () => setOpenMobile(false),
)
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child tooltip="Admin overview">
            <NuxtLink to="/admin">
              <AppLogo :to="false" icon-only mark-class="size-8!" />
              <span class="flex min-w-0 flex-col leading-tight">
                <span class="truncate text-sm font-semibold tracking-tight">blinq</span>
                <span class="truncate text-xs text-sidebar-foreground/70">Administration</span>
              </span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <nav aria-label="Admin">
        <SidebarGroup v-for="group in ADMIN_NAV" :key="group.label">
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in group.items" :key="item.to">
                <SidebarMenuButton as-child :is-active="isNavItemActive(item, route.path)" :tooltip="item.label">
                  <NuxtLink :to="item.to" :aria-current="isNavItemActive(item, route.path) ? 'page' : undefined">
                    <component :is="item.icon" aria-hidden="true" />
                    <span>{{ item.label }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </nav>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton as-child tooltip="Back to the app">
            <NuxtLink to="/dashboard">
              <ArrowLeftIcon aria-hidden="true" />
              <span>Back to the app</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>

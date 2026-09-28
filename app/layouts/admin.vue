<script setup lang="ts">
/**
 * `admin` layout: collapsible sidebar with every admin section (a sheet on phones), a top bar with breadcrumbs,
 * theme and account, and a content column. Access control stays with the pages' middleware and the API.
 */
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import AdminSidebar from '@/components/app/AdminSidebar.vue'
import SkipLink from '@/components/app/SkipLink.vue'
import ThemeToggle from '@/components/app/ThemeToggle.vue'
import UserMenu from '@/components/app/UserMenu.vue'
import { adminSectionLabel } from '~/lib/shell/nav'

const route = useRoute()
const section = computed(() => adminSectionLabel(route.path))
// The sidebar remembers "collapsed" in this cookie. Reading it here (SSR and client alike) keeps the server-rendered
// state and hydration in agreement; the component itself only looks at document.cookie.
const sidebarState = useCookie<boolean | null>('sidebar_state', { readonly: true })
</script>

<template>
  <SidebarProvider :default-open="sidebarState !== false">
    <SkipLink />
    <AdminSidebar />
    <SidebarInset>
      <header
        class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
      >
        <SidebarTrigger class="-ml-1" aria-label="Toggle sidebar" />
        <Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage v-if="!section || section === 'Overview'">Admin</BreadcrumbPage>
              <BreadcrumbLink v-else as-child>
                <NuxtLink to="/admin">Admin</NuxtLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <template v-if="section && section !== 'Overview'">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{{ section }}</BreadcrumbPage>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>
        <div class="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <div
        id="main"
        tabindex="-1"
        class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8"
      >
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

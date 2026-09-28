/**
 * Navigation of the app shell: header, mobile sheet and admin sidebar. Hiding an entry is presentation only; every
 * page and API route authorizes on the server.
 */
import {
  DoorOpenIcon,
  FilmIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  MailPlusIcon,
  ScrollTextIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { AuthUser } from '#shared/schemas/auth'

export interface NavItem {
  label: string
  to: string
  icon: Component
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

const DASHBOARD: NavItem = { label: 'Dashboard', to: '/dashboard', icon: LayoutGridIcon }
const RECORDINGS: NavItem = { label: 'Recordings', to: '/recordings', icon: FilmIcon }
const ADMIN: NavItem = { label: 'Admin', to: '/admin', icon: ShieldIcon }

/** Main navigation for the signed-in user. Signed-out visitors get none. */
export function mainNav(user: Pick<AuthUser, 'role'> | null): NavItem[] {
  if (!user) return []
  return user.role === 'admin' ? [DASHBOARD, RECORDINGS, ADMIN] : [DASHBOARD, RECORDINGS]
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Manage',
    items: [
      { label: 'Overview', to: '/admin', icon: LayoutDashboardIcon, exact: true },
      { label: 'Users', to: '/admin/users', icon: UsersIcon },
      { label: 'Invites', to: '/admin/invites', icon: MailPlusIcon },
      { label: 'Rooms', to: '/admin/rooms', icon: DoorOpenIcon },
      { label: 'Recordings', to: '/admin/recordings', icon: FilmIcon },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', to: '/admin/settings', icon: SlidersHorizontalIcon },
      { label: 'Audit', to: '/admin/audit', icon: ScrollTextIcon },
    ],
  },
]

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function isNavItemActive(item: Pick<NavItem, 'to' | 'exact'>, currentPath: string): boolean {
  const current = trimSlash(currentPath)
  if (current === item.to) return true
  return !item.exact && current.startsWith(`${item.to}/`)
}

/** Label of the admin section for `currentPath`, for breadcrumbs. */
export function adminSectionLabel(currentPath: string): string | null {
  for (const group of ADMIN_NAV) {
    for (const item of group.items) if (isNavItemActive(item, currentPath)) return item.label
  }
  return null
}

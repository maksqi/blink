import { describe, expect, it } from 'vitest'
import { ADMIN_NAV, adminSectionLabel, isNavItemActive, mainNav } from './nav'

const labels = (items: { label: string }[]) => items.map((item) => item.label)

describe('mainNav', () => {
  it('shows the admin entry only to admins', () => {
    expect(labels(mainNav({ role: 'admin' }))).toEqual(['Dashboard', 'Recordings', 'Admin'])
    expect(labels(mainNav({ role: 'user' }))).toEqual(['Dashboard', 'Recordings'])
    expect(mainNav(null)).toEqual([])
  })
})

describe('ADMIN_NAV', () => {
  it('lists every admin section', () => {
    const items = ADMIN_NAV.flatMap((group) => group.items)
    expect(items.map((item) => item.to)).toEqual([
      '/admin',
      '/admin/users',
      '/admin/invites',
      '/admin/rooms',
      '/admin/recordings',
      '/admin/settings',
      '/admin/audit',
    ])
  })
})

describe('isNavItemActive', () => {
  it('matches the page and its sub-pages', () => {
    const recordings = { to: '/recordings' }
    expect(isNavItemActive(recordings, '/recordings')).toBe(true)
    expect(isNavItemActive(recordings, '/recordings/')).toBe(true)
    expect(isNavItemActive(recordings, '/recordings/0193a9f2')).toBe(true)
    expect(isNavItemActive(recordings, '/recordingsx')).toBe(false)
    expect(isNavItemActive(recordings, '/dashboard')).toBe(false)
  })

  it('matches exact items only on their own path', () => {
    const overview = { to: '/admin', exact: true }
    expect(isNavItemActive(overview, '/admin')).toBe(true)
    expect(isNavItemActive(overview, '/admin/')).toBe(true)
    expect(isNavItemActive(overview, '/admin/users')).toBe(false)
  })

  it('names the current admin section', () => {
    expect(adminSectionLabel('/admin')).toBe('Overview')
    expect(adminSectionLabel('/admin/users')).toBe('Users')
    expect(adminSectionLabel('/admin/audit/')).toBe('Audit')
    expect(adminSectionLabel('/dashboard')).toBeNull()
  })
})

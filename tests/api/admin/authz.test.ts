/**
 * Every route under server/api/admin answers 401 UNAUTHENTICATED to anonymous callers and to callers holding only a
 * guest cookie, and 403 FORBIDDEN to signed-in users. The route list comes from the file tree, so new admin routes
 * are covered without touching this file. Admins get past the check (GET routes only, to stay free of side effects).
 */
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type ApiClient,
  createClient,
  createGuestSession,
  createRoom,
  createUser,
  expectApiError,
  REPO_ROOT,
} from '../_harness'
import { signedInAdmin, signedInUser } from './_support'

interface AdminRoute {
  method: string
  /** With `:id` placeholders (stable test names). */
  pattern: string
  path: string
  file: string
}

function adminRoutes(): AdminRoute[] {
  const root = join(REPO_ROOT, 'server/api/admin')
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).sort()
  return files.map((file) => {
    const segments = file.replace(/\.ts$/, '').split(/[\\/]/)
    const match = segments.pop()!.match(/^(.+)\.(get|post|put|patch|delete)$/)
    if (!match) throw new Error(`Handler without an HTTP method suffix: server/api/admin/${file}`)
    const parts = [...segments, match[1]!].filter((part) => part !== 'index')
    const pattern = ['/api/admin', ...parts.map((part) => part.replace(/^\[(.+)\]$/, ':$1'))].join('/')
    // Every dynamic segment is an id; a random uuid exercises the auth check before any lookup.
    const path = pattern.replace(/:[A-Za-z]+/g, () => randomUUID())
    return { method: match[2]!.toUpperCase(), pattern, path, file: `server/api/admin/${file}` }
  })
}

const routes = adminRoutes()
const send = (api: ApiClient, route: AdminRoute) =>
  api.request(route.method, route.path, ['POST', 'PUT', 'PATCH'].includes(route.method) ? { body: {} } : {})

let user: ApiClient
let guest: ApiClient
let admin: ApiClient

beforeAll(async () => {
  user = (await signedInUser()).api
  admin = (await signedInAdmin()).api
  const session = await createGuestSession(await createRoom(await createUser()))
  guest = createClient().setCookie(session.cookieName, session.token)
})

describe('admin route inventory', () => {
  it('covers every admin handler, including the documented ones', () => {
    expect(routes.length).toBeGreaterThanOrEqual(20)
    const shapes = routes.map((route) => `${route.method} ${route.pattern}`)
    for (const expected of [
      'GET /api/admin/users',
      'POST /api/admin/users',
      'GET /api/admin/users/:id',
      'PATCH /api/admin/users/:id',
      'DELETE /api/admin/users/:id',
      'POST /api/admin/users/:id/reset-password',
      'POST /api/admin/users/:id/revoke-sessions',
      'GET /api/admin/invites',
      'POST /api/admin/invites',
      'DELETE /api/admin/invites/:id',
      'GET /api/admin/settings',
      'PUT /api/admin/settings',
      'POST /api/admin/settings/test-email',
      'GET /api/admin/rooms',
      'DELETE /api/admin/rooms/:id',
      'POST /api/admin/rooms/:id/end',
      'GET /api/admin/rooms/:id/meetings',
      'GET /api/admin/audit',
    ]) {
      expect(shapes).toContain(expected)
    }
  })
})

describe.each(routes)('$method $pattern', (route) => {
  it('answers 401 UNAUTHENTICATED without a session', async () => {
    expectApiError(await send(createClient(), route), 401, 'UNAUTHENTICATED')
  })

  it('answers 401 UNAUTHENTICATED with only a guest cookie', async () => {
    expectApiError(await send(guest, route), 401, 'UNAUTHENTICATED')
  })

  it('answers 403 FORBIDDEN to a signed-in user', async () => {
    expectApiError(await send(user, route), 403, 'FORBIDDEN')
  })

  if (route.method === 'GET') {
    it('lets an admin through', async () => {
      const res = await send(admin, route)
      // List routes answer 200; routes about one (random) id answer 404 after the auth check.
      expect([200, 404], `${route.file}: ${res.text}`).toContain(res.status)
      if (res.status === 200) expect(res.headers.get('cache-control')).toBe('no-store')
      else expectApiError(res, 404, 'NOT_FOUND')
    })
  }
})

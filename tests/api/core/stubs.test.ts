/**
 * Route inventory: every route in docs/API.md has a handler under server/api (and vice versa), and every handler
 * that is still a W0a stub answers 501 with the error envelope. Implemented routes drop out automatically.
 */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient, REPO_ROOT } from '../_harness'

interface Route {
  method: string
  path: string
}

interface FileRoute extends Route {
  file: string
  implemented: boolean
}

const shape = (route: Route) => `${route.method} ${route.path.replace(/:[A-Za-z]+/g, ':param')}`

function fileRoutes(): FileRoute[] {
  const root = join(REPO_ROOT, 'server/api')
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).sort()
  return files.map((file) => {
    const segments = file.replace(/\.ts$/, '').split(/[\\/]/)
    const last = segments.pop()!
    const match = last.match(/^(.+)\.(get|post|put|patch|delete)$/)
    if (!match) throw new Error(`Handler without an HTTP method suffix: server/api/${file}`)
    const parts = [...segments, match[1]!].filter((part) => part !== 'index').map((part) => part.replace(/^\[(.+)\]$/, ':$1'))
    return {
      method: match[2]!.toUpperCase(),
      path: `/api/${parts.join('/')}`,
      file: `server/api/${file}`,
      implemented: !readFileSync(join(root, file), 'utf8').includes('notImplemented('),
    }
  })
}

function documentedRoutes(): Route[] {
  const routes: Route[] = []
  for (const line of readFileSync(join(REPO_ROOT, 'docs/API.md'), 'utf8').split('\n')) {
    const match = line.match(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|/)
    if (!match) continue
    // The in-call table (§7) lists paths relative to /api/calls/:roomId.
    const path = match[2]!.startsWith('/api/') ? match[2]! : `/api/calls/:roomId${match[2]}`
    routes.push({ method: match[1]!, path })
  }
  return routes
}

const SAMPLES: Record<string, string> = { slug: 'abc-defg-hjk', seq: '0', identity: 'p_0123456789abcdef' }

function concrete(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => SAMPLES[name] ?? randomUUID())
}

describe('route inventory', () => {
  const files = fileRoutes()
  const documented = documentedRoutes()

  it('finds the documented routes', () => {
    expect(documented.length).toBeGreaterThan(70)
    expect(new Set(documented.map(shape)).size).toBe(documented.length)
  })

  it('has a handler file for every route in docs/API.md', () => {
    const existing = new Set(files.map(shape))
    expect(documented.filter((route) => !existing.has(shape(route))).map(shape)).toEqual([])
  })

  it('documents every handler file in docs/API.md', () => {
    const known = new Set(documented.map(shape))
    expect(files.filter((route) => !known.has(shape(route))).map((route) => route.file)).toEqual([])
  })
})

describe('unimplemented routes', () => {
  const stubs = fileRoutes().filter((route) => !route.implemented)

  if (stubs.length === 0) {
    it.skip('every route is implemented', () => {})
    return
  }

  it.each(stubs)('$method $path answers 501 with the error envelope', async (route) => {
    const res = await createClient().request(route.method, concrete(route.path))
    expect(res.status, `${route.file}: ${res.text}`).toBe(501)
    expect(res.body).toMatchObject({ statusCode: 501, data: { code: 'INTERNAL' } })
    expect(res.body.statusMessage).toMatch(/^Not implemented yet \([a-z-]+\)$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

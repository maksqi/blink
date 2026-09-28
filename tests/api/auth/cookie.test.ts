/**
 * Session cookie attributes (docs/API.md §13): HttpOnly, SameSite=Lax, Path=/, 30 d, no Domain; behind an https
 * PUBLIC_URL (the production setup) additionally Secure with the `__Host-` prefix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, createUser, type TestServer } from '../_harness'
import { sessionCookie, signIn, startExtraServer } from './support'

const HTTPS_ORIGIN = 'https://blinq.test'
const attr = (attributes: string[], name: string) =>
  attributes.find((a) => a.toLowerCase().startsWith(name.toLowerCase()))

describe('session cookie over http (development name)', () => {
  it('is blinq_session with HttpOnly, SameSite=Lax, Path=/, a 30-day Max-Age and no Secure or Domain', async () => {
    const user = await createUser()
    const res = await signIn(createClient(), user.email, user.password)
    const cookie = sessionCookie(res)!
    expect(cookie.name).toBe('blinq_session')
    expect(attr(cookie.attributes, 'HttpOnly')).toBeDefined()
    expect(attr(cookie.attributes, 'SameSite')).toBe('SameSite=Lax')
    expect(attr(cookie.attributes, 'Path')).toBe('Path=/')
    expect(attr(cookie.attributes, 'Max-Age')).toBe('Max-Age=2592000')
    expect(attr(cookie.attributes, 'Secure')).toBeUndefined()
    expect(attr(cookie.attributes, 'Domain')).toBeUndefined()
  })

  it('is cleared on logout with the same attributes', async () => {
    const user = await createUser()
    const api = createClient()
    await signIn(api, user.email, user.password)
    const res = await api.post('/api/auth/logout')
    expect(res.status).toBe(204)
    const cleared = sessionCookie(res)!
    expect(cleared.value).toBe('')
    expect(attr(cleared.attributes, 'Max-Age')).toBe('Max-Age=0')
    expect(attr(cleared.attributes, 'Path')).toBe('Path=/')
    expect(attr(cleared.attributes, 'HttpOnly')).toBeDefined()
  })
})

describe('session cookie in the production setup (https PUBLIC_URL)', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startExtraServer('https', {}, { publicUrl: HTTPS_ORIGIN })
  })

  afterAll(async () => {
    await server?.stop()
  })

  it('is __Host-blinq_session with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain', async () => {
    const user = await createUser()
    const api = createClient({ baseUrl: server.baseUrl })
    const res = await signIn(api, user.email, user.password, { origin: HTTPS_ORIGIN })
    expect(res.status, res.text).toBe(200)
    const cookie = sessionCookie(res)!
    expect(cookie.name).toBe('__Host-blinq_session')
    expect(attr(cookie.attributes, 'Secure')).toBe('Secure')
    expect(attr(cookie.attributes, 'HttpOnly')).toBeDefined()
    expect(attr(cookie.attributes, 'SameSite')).toBe('SameSite=Lax')
    expect(attr(cookie.attributes, 'Path')).toBe('Path=/')
    expect(attr(cookie.attributes, 'Domain')).toBeUndefined()

    // That cookie authenticates; the development name does not.
    expect((await api.get('/api/auth/me')).body.user.id).toBe(user.id)
    const devName = createClient({ baseUrl: server.baseUrl }).setCookie('blinq_session', cookie.value)
    expect((await devName.get('/api/auth/me')).body.user).toBeNull()
  })
})

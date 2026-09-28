import { describe, expect, it } from 'vitest'
import { csrfRejected, isApiPath, isProbePath, normalizedPath, passwordChangeExempt } from './request-guards'

const publicOrigin = 'https://meet.example.test'
const check = (method: string, path: string, origin?: string, secFetchSite?: string) =>
  csrfRejected({ method, path, origin, secFetchSite, publicOrigin })

describe('normalizedPath', () => {
  it.each([
    ['/api/rooms?page=2', '/api/rooms'],
    ['/api/rooms/', '/api/rooms'],
    ['//api//rooms///', '/api/rooms'],
    ['/api/webhooks/livekit#x', '/api/webhooks/livekit'],
    ['/', '/'],
    ['', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizedPath(input)).toBe(expected)
  })

  it('classifies API and probe paths', () => {
    expect(isApiPath('/api/rooms')).toBe(true)
    expect(isApiPath('/apix')).toBe(false)
    expect(isApiPath('/m/abc-defg-hjk')).toBe(false)
    expect(isProbePath('/api/health')).toBe(true)
    expect(isProbePath('/api/ready')).toBe(true)
    expect(isProbePath('/api/config')).toBe(false)
  })
})

describe('csrfRejected', () => {
  it('never checks safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(check(method, '/api/rooms')).toBe(false)
  })

  it('requires the exact public origin for every mutating method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'PROPFIND']) {
      expect(check(method, '/api/rooms')).toBe(true)
      expect(check(method, '/api/rooms', 'https://evil.test')).toBe(true)
      expect(check(method, '/api/rooms', 'null')).toBe(true)
      expect(check(method, '/api/rooms', `${publicOrigin}/`)).toBe(true)
      expect(check(method, '/api/rooms', 'https://meet.example.test:8443')).toBe(true)
      expect(check(method, '/api/rooms', 'http://meet.example.test')).toBe(true)
      expect(check(method, '/api/rooms', publicOrigin)).toBe(false)
    }
  })

  it('requires Sec-Fetch-Site: same-origin when the header is present', () => {
    expect(check('POST', '/api/rooms', publicOrigin, 'same-origin')).toBe(false)
    expect(check('POST', '/api/rooms', publicOrigin, 'same-site')).toBe(true)
    expect(check('POST', '/api/rooms', publicOrigin, 'cross-site')).toBe(true)
    expect(check('POST', '/api/rooms', publicOrigin, 'none')).toBe(true)
  })

  it('exempts only POST /api/webhooks/livekit', () => {
    expect(check('POST', '/api/webhooks/livekit')).toBe(false)
    expect(check('PUT', '/api/webhooks/livekit')).toBe(true)
    expect(check('POST', '/api/webhooks/livekit/extra')).toBe(true)
    expect(check('POST', '/api/webhooks')).toBe(true)
  })

  it('applies outside /api too', () => {
    expect(check('POST', '/dashboard')).toBe(true)
  })
})

describe('passwordChangeExempt', () => {
  it.each([
    ['GET', '/api/auth/me'],
    ['HEAD', '/api/auth/me'],
    ['POST', '/api/auth/password'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/config'],
    ['GET', '/api/health'],
    ['GET', '/api/ready'],
  ])('allows %s %s', (method, path) => {
    expect(passwordChangeExempt(method, path)).toBe(true)
  })

  it.each([
    ['POST', '/api/auth/me'],
    ['GET', '/api/auth/sessions'],
    ['DELETE', '/api/auth/sessions/x'],
    ['PATCH', '/api/me'],
    ['GET', '/api/rooms'],
    ['POST', '/api/rooms'],
    ['GET', '/api/auth/password'],
  ])('blocks %s %s', (method, path) => {
    expect(passwordChangeExempt(method, path)).toBe(false)
  })
})

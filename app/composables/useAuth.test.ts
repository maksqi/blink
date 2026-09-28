import { describe, expect, it } from 'vitest'
import { ApiError } from './useApi'
import {
  apiFieldErrors,
  authErrorText,
  describeUserAgent,
  fieldMessages,
  isApiError,
  routeNeedsSession,
  signInLocation,
  weakPasswordText,
} from './useAuth'

const apiError = (code: ConstructorParameters<typeof ApiError>[1], details?: unknown, status = 400) =>
  new ApiError(status, code, 'server text that must not be shown', details)

describe('signInLocation', () => {
  it('remembers safe relative paths only', () => {
    expect(signInLocation('/rooms/abc')).toEqual({ path: '/login', query: { next: '/rooms/abc' } })
    expect(signInLocation('/')).toEqual({ path: '/login' })
    expect(signInLocation('/login')).toEqual({ path: '/login' })
    expect(signInLocation('//evil.test/x')).toEqual({ path: '/login' })
    expect(signInLocation('/\\evil.test')).toEqual({ path: '/login' })
    expect(signInLocation('https://evil.test')).toEqual({ path: '/login' })
    expect(signInLocation(undefined)).toEqual({ path: '/login' })
  })
})

describe('routeNeedsSession', () => {
  it('recognizes the auth and admin middleware in any form', () => {
    expect(routeNeedsSession('auth')).toBe(true)
    expect(routeNeedsSession(['guest', 'admin'])).toBe(true)
    expect(routeNeedsSession(['guest'])).toBe(false)
    expect(routeNeedsSession(undefined)).toBe(false)
    expect(routeNeedsSession([() => undefined])).toBe(false)
  })
})

describe('error copy', () => {
  it('uses the stable code, never the server text', () => {
    expect(authErrorText(apiError('AUTH_INVALID_CREDENTIALS', undefined, 401))).toBe('Email or password is incorrect.')
    expect(authErrorText(apiError('INVITE_USED', undefined, 410))).toBe('This invite has already been used.')
    expect(authErrorText(new Error('boom'))).toBe('Something went wrong on the server.')
    expect(authErrorText(new ApiError(0, 'NETWORK', 'Network error. Check your connection.'))).toBe(
      'Network error. Check your connection.',
    )
  })

  it('says how long to wait when rate limited', () => {
    expect(authErrorText(apiError('RATE_LIMITED', { retryAfter: 1 }, 429))).toBe('Too many attempts. Try again in 1 second.')
    expect(authErrorText(apiError('RATE_LIMITED', { retryAfter: 45 }, 429))).toBe('Too many attempts. Try again in 45 seconds.')
    expect(authErrorText(apiError('RATE_LIMITED', { retryAfter: 900 }, 429))).toBe('Too many attempts. Try again in 15 minutes.')
    expect(authErrorText(apiError('RATE_LIMITED', undefined, 429))).toBe('Too many attempts. Wait a moment and try again.')
  })

  it('explains weak passwords by reason', () => {
    expect(weakPasswordText(apiError('AUTH_PASSWORD_WEAK', { reason: 'common' }))).toMatch(/too common/)
    expect(weakPasswordText(apiError('AUTH_PASSWORD_WEAK', { reason: 'same_as_current' }))).toMatch(/differs from your current/)
    expect(weakPasswordText(apiError('AUTH_PASSWORD_WEAK', { reason: 'nope' }))).toBe('Choose a stronger password.')
    expect(weakPasswordText(apiError('VALIDATION_FAILED'))).toBeNull()
    expect(authErrorText(apiError('AUTH_PASSWORD_WEAK', { reason: 'common' }))).toMatch(/too common/)
  })

  it('maps validation issues to fields', () => {
    const error = apiError('VALIDATION_FAILED', {
      issues: [
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'email', message: 'second message is ignored' },
        { path: 'password', message: 'Use at least 12 characters' },
        { path: '', message: 'Whole form' },
        { path: 3, message: 'not a path' },
      ],
    })
    expect(apiFieldErrors(error)).toEqual({
      email: 'Enter a valid email address',
      password: 'Use at least 12 characters',
      _form: 'Whole form',
    })
    expect(apiFieldErrors(apiError('CONFLICT', undefined, 409))).toEqual({})
    expect(apiFieldErrors(new Error('x'))).toEqual({})
    expect(isApiError(error, 'VALIDATION_FAILED')).toBe(true)
    expect(isApiError(error, 'CONFLICT')).toBe(false)
  })
})

describe('fieldMessages', () => {
  it('flattens schema issues and strings, adds the server message, drops duplicates', () => {
    expect(fieldMessages([{ message: 'Enter a name' }, 'Enter a name', undefined, { message: '' }], 'Taken')).toEqual([
      'Enter a name',
      'Taken',
    ])
    expect(fieldMessages([], '')).toEqual([])
  })
})

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1', 'Chrome on iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['curl/8.7.1', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s → %s', (ua, label) => {
    expect(describeUserAgent(ua).label).toBe(label)
  })
})

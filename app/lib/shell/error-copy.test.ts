import { describe, expect, it } from 'vitest'
import { errorCopy } from './error-copy'

describe('errorCopy', () => {
  it.each([
    [404, 'not-found', 'Page not found'],
    [403, 'forbidden', 'You do not have access'],
    [401, 'unauthenticated', 'Sign in to continue'],
    [503, 'unavailable', 'blinq is unavailable right now'],
    [400, 'client', 'This request did not work'],
    [500, 'server', 'Something went wrong'],
    [502, 'server', 'Something went wrong'],
  ])('maps %i to %s', (status, kind, title) => {
    expect(errorCopy(status)).toMatchObject({ status, kind, title })
  })

  it('treats unknown or out-of-range codes as a server error', () => {
    for (const value of [undefined, null, 'oops', 200, 302, 999, 404.5]) {
      expect(errorCopy(value)).toMatchObject({ status: 500, kind: 'server' })
    }
    expect(errorCopy('404')).toMatchObject({ status: 404, kind: 'not-found' })
  })

  it('writes short, plain sentences', () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      const { title, description } = errorCopy(status)
      expect(title).not.toMatch(/[.!]$/)
      expect(description).toMatch(/\.$/)
      expect(description).not.toMatch(/!/)
    }
  })
})

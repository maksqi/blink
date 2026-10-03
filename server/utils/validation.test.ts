import { createError, H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { apiError, notImplemented } from './api-error'
import { isZodLikeError, normalizeApiError, toValidationIssues } from './validation'

const schema = z.object({ email: z.email(), nested: z.object({ list: z.array(z.number()) }) }).strict()

function zodError() {
  const result = schema.safeParse({ email: 'nope', nested: { list: [1, 'x'] }, extra: true })
  if (result.success) throw new Error('expected a failure')
  return result.error
}

/** What h3's readValidatedBody throws when the parser throws. */
function h3ValidationError() {
  return createError({ status: 400, statusMessage: 'Validation Error', message: 'x', data: zodError() })
}

describe('toValidationIssues', () => {
  it('flattens zod issues into path strings', () => {
    const issues = toValidationIssues(zodError())
    expect(issues).toContainEqual({ path: 'email', message: expect.any(String) })
    expect(issues).toContainEqual({ path: 'nested.list.1', message: expect.any(String) })
    expect(issues.some((i) => i.path === '' && i.message.includes('extra'))).toBe(true)
    expect(isZodLikeError(zodError())).toBe(true)
    expect(isZodLikeError(new Error('x'))).toBe(false)
  })
})

describe('normalizeApiError', () => {
  it('turns h3 validation errors into VALIDATION_FAILED with issues', () => {
    const error = h3ValidationError()
    expect(normalizeApiError(error)).toEqual({ kind: 'validation' })
    expect(error.statusCode).toBe(400)
    expect(error.statusMessage).toBe('Some fields are invalid. Check them and try again.')
    expect(error.data).toEqual({ code: 'VALIDATION_FAILED', details: { issues: expect.any(Array) } })
    expect(error.unhandled).toBe(false)
  })

  it('turns uncaught zod errors into VALIDATION_FAILED', () => {
    const error = createError(zodError())
    error.unhandled = true
    expect(normalizeApiError(error).kind).toBe('validation')
    expect(error.statusCode).toBe(400)
    expect((error.data as { code: string }).code).toBe('VALIDATION_FAILED')
  })

  it('keeps errors that already carry a code', () => {
    const coded = apiError('ROOM_NOT_FOUND', 404)
    expect(normalizeApiError(coded)).toEqual({ kind: 'coded' })
    expect(coded.data).toEqual({ code: 'ROOM_NOT_FOUND' })
    const stub = notImplemented('auth')
    normalizeApiError(stub)
    expect(stub.statusCode).toBe(501)
    expect(stub.statusMessage).toBe('Not implemented yet (auth)')
  })

  it('maps unknown routes to NOT_FOUND', () => {
    const error = createError({ statusCode: 404, statusMessage: 'Cannot find any path matching /api/x.' })
    expect(normalizeApiError(error).kind).toBe('not_found')
    expect(error.data).toEqual({ code: 'NOT_FOUND' })
    expect(error.statusMessage).toBe('Not found. It may have been deleted. Refresh and try again.')
  })

  it('hides internal failures behind INTERNAL and returns the original for logging', () => {
    const cause = new Error('relation "secret_table" does not exist')
    const error = createError(cause)
    error.unhandled = true
    const result = normalizeApiError(error)
    expect(result).toEqual({ kind: 'internal', original: cause })
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Something went wrong on the server. Try again in a moment.')
    expect(error.data).toEqual({ code: 'INTERNAL' })
    expect(error.unhandled).toBe(false)
  })

  it('adds generic codes to framework errors', () => {
    const tooLarge = new H3Error('Payload Too Large')
    tooLarge.statusCode = 413
    normalizeApiError(tooLarge)
    expect(tooLarge.statusCode).toBe(413)
    expect(tooLarge.data).toEqual({ code: 'VALIDATION_FAILED' })
    const unavailable = createError({ statusCode: 503 })
    normalizeApiError(unavailable)
    expect(unavailable.data).toEqual({ code: 'SERVICE_UNAVAILABLE' })
  })
})

import { z } from 'zod'
import { normalizeDisplayName } from '../utils/display-name'

export const uuidSchema = z.uuid()

/** Lowercased, trimmed email. */
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase())
  .pipe(z.email('Enter a valid email address'))

/** Length rules only; the common-password denylist is checked on the server. */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(256, 'Use at most 256 characters')

export const displayNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .pipe(z.string().min(1, 'Enter a name').max(64))

/** Room slug `xxx-xxxx-xxx` (23-letter alphabet without i, l, o). */
export const slugSchema = z.string().regex(/^[a-hj-kmnp-z]{3}-[a-hj-kmnp-z]{4}-[a-hj-kmnp-z]{3}$/, 'Invalid room link')

/** 32 random bytes, base64url without padding (43 chars): session/invite/reset/verify/guest tokens. */
export const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid or incomplete link')

/** Join proof: base64url(HKDF(K, "blinq/v1/join|" + slug)) — 32 bytes, 43 chars. */
export const joinProofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid room key')

/** Per-tab random id (sessionStorage), used for refresh-safe resume. */
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
})

export const isoDateSchema = z.iso.datetime({ offset: true })

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

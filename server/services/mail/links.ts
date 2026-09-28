/**
 * Links in emails (docs/API.md §13). Absolute URLs are built only from `PUBLIC_URL` (never from `Host` or
 * `X-Forwarded-Host`, which prevents reset-link poisoning), and tokens travel only in the fragment, which browsers
 * never send to a server. The server never builds or emails room links.
 *
 * - `buildTokenLink(publicUrl, path, token)`: pure.
 * - `accountInviteLink(token)`, `verifyEmailLink(token)`, `passwordResetLink(token)`, `signInLink()`.
 */
import { env } from '../../utils/env'

export type TokenLinkPath = '/invite' | '/verify-email' | '/reset-password'

export function buildTokenLink(publicUrl: string, path: TokenLinkPath, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${path}#${token}`
}

export function accountInviteLink(token: string): string {
  return buildTokenLink(env().PUBLIC_URL, '/invite', token)
}

export function verifyEmailLink(token: string): string {
  return buildTokenLink(env().PUBLIC_URL, '/verify-email', token)
}

export function passwordResetLink(token: string): string {
  return buildTokenLink(env().PUBLIC_URL, '/reset-password', token)
}

export function signInLink(publicUrl: string = env().PUBLIC_URL): string {
  return `${publicUrl.replace(/\/+$/, '')}/login`
}

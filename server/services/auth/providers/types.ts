/**
 * Sign-in providers (auth). A provider only answers "which local user do these credentials identify?"; everything
 * after that (disabled and unverified checks, session creation and rotation, cookie, `last_login_at`, audit) is shared
 * by every provider in `completeSignIn()` (server/services/auth/sign-in.ts), so a new provider cannot skip a rule.
 *
 * - `password`: email + password against `users.password_hash` (argon2id; unknown emails pay the same cost).
 * - `oidc:<id>` (later): verifies the OpenID Connect callback (openid-client, not a dependency yet), then maps the
 *   verified `sub` to a user through `auth_identities (provider = 'oidc:<id>', subject = sub)` with
 *   `createIdentityProvider()`. Sessions record the provider id in `sessions.auth_method`.
 *
 * Contract: `authenticate()` resolves to `{ userId }` or `null` for credentials that do not identify an account. It
 * throws only for infrastructure failures, never for bad credentials, and never reveals why it returned null.
 */
export type AuthProviderId = 'password' | `oidc:${string}`

export interface AuthResult {
  userId: string
}

export interface AuthProvider<Input = unknown> {
  readonly id: AuthProviderId
  authenticate(input: Input): Promise<AuthResult | null>
}

export interface PasswordCredentials {
  email: string
  password: string
}

/** What an external identity provider vouches for after verifying its callback. */
export interface VerifiedIdentity {
  /** Stable subject id at the provider (OIDC `sub`). */
  subject: string
  email?: string | null
}

const PROVIDER_ID = /^(?:password|oidc:[a-z0-9][a-z0-9_-]{0,62})$/

export function isAuthProviderId(value: unknown): value is AuthProviderId {
  return typeof value === 'string' && PROVIDER_ID.test(value)
}

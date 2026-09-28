/**
 * No token or password ever reaches the server log (docs/SECURITY.md §8): run every auth flow with known secrets, then
 * search the captured JSON log of the test server for them (raw, URL-encoded and JSON-escaped) and for token links.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createClient, createInvite, createUser, loginAs, serverLogFile, uniqueEmail, uniqueName } from '../_harness'
import { createEmailToken, mailToken, sessionCookie, signIn, sleep } from './support'

const forms = (value: string) => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]

describe('server log', () => {
  it('contains no password, session, invite, verification or reset token', async () => {
    const secrets: string[] = []
    const track = (value: string | undefined) => {
      expect(value, 'secret to track').toBeTruthy()
      secrets.push(value!)
      return value!
    }

    // Login: success and failure.
    const user = await createUser({ password: track(`Pw-${uniqueName('x').replace(' ', '-')}-alpha`) })
    const api = createClient()
    track(sessionCookie(await signIn(api, user.email, user.password))?.value)
    await signIn(createClient(), user.email, track('wrong-password-that-is-secret-1'))
    await signIn(createClient(), uniqueEmail(), track('unknown-user-password-secret-2'))

    // Password change (current + new, rotated cookie).
    const next = track('topaz-harbor-sparrow-39-new')
    const changed = await api.post('/api/auth/password', {
      body: { currentPassword: user.password, newPassword: next },
    })
    track(sessionCookie(changed)?.value)

    // Invite acceptance.
    const invite = await createInvite()
    track(invite.token)
    await createClient().post('/api/auth/invites/preview', { body: { token: invite.token } })
    const accepted = await createClient().post('/api/auth/invites/accept', {
      body: {
        token: invite.token,
        email: uniqueEmail(),
        displayName: 'Logged Out',
        password: track('cobalt-orchard-violet-66'),
      },
    })
    track(sessionCookie(accepted)?.value)

    // Verification and reset tokens.
    const unverified = await createUser({ emailVerified: false })
    await createClient().post('/api/auth/verify-email', {
      body: { token: track(await createEmailToken(unverified.id, 'verify_email')) },
    })
    await createClient().post('/api/auth/password-reset/request', { body: { email: unverified.email } })
    const resetToken = track(await mailToken(unverified.email, '/reset-password', /Reset your/))
    await createClient().post('/api/auth/password-reset/confirm', {
      body: { token: resetToken, newPassword: track('scarlet-quarry-meadow-12') },
    })

    // Sessions endpoints with a cookie in the request.
    const other = await loginAs(await createUser())
    track(other.session!.token)
    await other.get('/api/auth/sessions')
    await other.post('/api/auth/logout')

    await sleep(500)
    const log = readFileSync(serverLogFile(), 'utf8')
    expect(log.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      for (const form of forms(secret))
        expect(log.includes(form), `a secret (${secret.slice(0, 4)}...) is in the log`).toBe(false)
    }
    expect(log).not.toMatch(/\/(?:invite|verify-email|reset-password)#[\w-]{16,}/)
    expect(log).not.toMatch(/"(?:password|newPassword|currentPassword)"\s*:\s*"(?!\[redacted\])/)
    expect(log).not.toMatch(/\$argon2id\$/)
  })
})

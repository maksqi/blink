import { describe, expect, it } from 'vitest'
import {
  accountExistsTemplate,
  accountInviteTemplate,
  escapeHtml,
  formatUtc,
  resetPasswordTemplate,
  tempPasswordTemplate,
  testEmailTemplate,
  verifyEmailTemplate,
  type EmailContent,
} from '../../mail/templates'
import { buildTokenLink, signInLink } from './links'

const PUBLIC_URL = 'https://meet.example.com'
const TOKEN = 'A'.repeat(21) + '-_' + 'z'.repeat(20)
const HOSTILE_NAME = '<img src=x onerror=alert(1)> "Eve" & co'

const all: Array<[string, EmailContent]> = [
  [
    'verify-email',
    verifyEmailTemplate({
      appName: 'blinq',
      displayName: HOSTILE_NAME,
      link: buildTokenLink(PUBLIC_URL, '/verify-email', TOKEN),
      expiresInHours: 24,
    }),
  ],
  [
    'reset-password',
    resetPasswordTemplate({
      appName: 'blinq',
      displayName: HOSTILE_NAME,
      link: buildTokenLink(PUBLIC_URL, '/reset-password', TOKEN),
      expiresInMinutes: 60,
    }),
  ],
  [
    'account-exists',
    accountExistsTemplate({ appName: 'blinq', displayName: HOSTILE_NAME, signInUrl: signInLink(PUBLIC_URL) }),
  ],
  [
    'account-invite',
    accountInviteTemplate({
      appName: 'blinq',
      link: buildTokenLink(PUBLIC_URL, '/invite', TOKEN),
      role: 'admin',
      expiresAt: new Date('2026-10-05T12:00:00Z'),
      invitedBy: HOSTILE_NAME,
    }),
  ],
  [
    'temp-password',
    tempPasswordTemplate({
      appName: 'blinq',
      displayName: HOSTILE_NAME,
      email: 'new@example.test',
      tempPassword: 'Kx7pQ2mZr9TbWc4N',
      signInUrl: signInLink(PUBLIC_URL),
      reason: 'created',
    }),
  ],
  [
    'test-email',
    testEmailTemplate({ appName: 'blinq', publicUrl: PUBLIC_URL, sentAt: new Date('2026-09-28T09:30:00Z') }),
  ],
]

describe('links', () => {
  it('come from PUBLIC_URL with the token only in the fragment', () => {
    expect(buildTokenLink('https://meet.example.com/', '/invite', TOKEN)).toBe(
      `https://meet.example.com/invite#${TOKEN}`,
    )
    expect(buildTokenLink(PUBLIC_URL, '/verify-email', TOKEN)).toBe(`${PUBLIC_URL}/verify-email#${TOKEN}`)
    expect(buildTokenLink(PUBLIC_URL, '/reset-password', TOKEN)).toBe(`${PUBLIC_URL}/reset-password#${TOKEN}`)
    expect(signInLink(PUBLIC_URL)).toBe(`${PUBLIC_URL}/login`)
  })
})

describe('email templates', () => {
  it.each(all)('%s has a subject, a text part and an HTML part', (_, mail) => {
    expect(mail.subject.length).toBeGreaterThan(5)
    expect(mail.text.length).toBeGreaterThan(20)
    expect(mail.html).toMatch(/^<!doctype html><html lang="en">/)
  })

  it.each(all)('%s loads nothing remote and runs nothing', (_, mail) => {
    expect(mail.html).not.toMatch(/<img|<script|<link|<iframe|url\(|@import|javascript:/i)
    // The only absolute URLs are PUBLIC_URL links.
    for (const url of mail.html.match(/https?:\/\/[^\s"'<]+/g) ?? []) expect(url.startsWith(PUBLIC_URL)).toBe(true)
  })

  it.each(all)('%s never contains a room link', (_, mail) => {
    expect(`${mail.text}\n${mail.html}`).not.toMatch(/\/m\/|#k=|&t=/)
  })

  it('escapes names in HTML and keeps them readable in text', () => {
    for (const [name, mail] of all.filter(([name]) => name !== 'test-email')) {
      expect(mail.html, name).not.toContain('<img src=x')
      expect(mail.html, name).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;Eve&quot; &amp; co')
      expect(mail.text, name).toContain(HOSTILE_NAME)
    }
  })

  it('puts token links in both parts', () => {
    const [, verify] = all[0]!
    expect(verify.text).toContain(`${PUBLIC_URL}/verify-email#${TOKEN}`)
    expect(verify.html).toContain(`href="${PUBLIC_URL}/verify-email#${TOKEN}"`)
    const [, reset] = all[1]!
    expect(reset.text).toContain(`${PUBLIC_URL}/reset-password#${TOKEN}`)
    expect(reset.text).toContain('expires in 1 hour')
    const [, invite] = all[3]!
    expect(invite.text).toContain(`${PUBLIC_URL}/invite#${TOKEN}`)
    expect(invite.text).toContain('as an administrator')
    expect(invite.text).toContain('2026-10-05 12:00 UTC')
  })

  it('shows the temporary password and says it must be changed', () => {
    const [, mail] = all[4]!
    expect(mail.subject).toBe('Your blinq account is ready')
    expect(mail.text).toContain('Temporary password: Kx7pQ2mZr9TbWc4N')
    expect(mail.text).toContain('choose your own password')
    const reset = tempPasswordTemplate({
      appName: 'blinq',
      displayName: 'A',
      email: 'a@example.test',
      tempPassword: 'x'.repeat(16),
      signInUrl: signInLink(PUBLIC_URL),
      reason: 'reset',
    })
    expect(reset.subject).toBe('Your blinq password was reset')
  })

  it('has helpers for escaping and dates', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(formatUtc(new Date('2026-01-02T03:04:59.999Z'))).toBe('2026-01-02 03:04 UTC')
  })
})

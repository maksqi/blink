/**
 * Ready-to-send messages (auth): template + links from `PUBLIC_URL` + recipient. Send them with `sendMail()` (awaited,
 * admin flows that report SMTP errors) or `sendMailInBackground()` (flows that must not leak timing).
 *
 *   await sendMail(tempPasswordMessage({ to, displayName, email, tempPassword, reason: 'created' }))
 *   sendMailInBackground(passwordResetMessage({ to, displayName, token }), 'reset-password')
 *
 * Token lifetimes shown in the text come from the services that issue the tokens.
 */
import { APP_NAME } from '../settings/public-config'
import {
  accountExistsTemplate,
  accountInviteTemplate,
  resetPasswordTemplate,
  tempPasswordTemplate,
  testEmailTemplate,
  verifyEmailTemplate,
  type EmailContent,
} from '../../mail/templates'
import { env } from '../../utils/env'
import { accountInviteLink, passwordResetLink, signInLink, verifyEmailLink } from './links'
import type { MailMessage } from './transport'

function message(to: string, content: EmailContent): MailMessage {
  return { to, ...content }
}

export function verificationMessage(input: {
  to: string
  displayName: string
  token: string
  expiresInHours: number
}): MailMessage {
  return message(
    input.to,
    verifyEmailTemplate({
      appName: APP_NAME,
      displayName: input.displayName,
      link: verifyEmailLink(input.token),
      expiresInHours: input.expiresInHours,
    }),
  )
}

export function passwordResetMessage(input: {
  to: string
  displayName: string
  token: string
  expiresInMinutes: number
}): MailMessage {
  return message(
    input.to,
    resetPasswordTemplate({
      appName: APP_NAME,
      displayName: input.displayName,
      link: passwordResetLink(input.token),
      expiresInMinutes: input.expiresInMinutes,
    }),
  )
}

export function accountExistsMessage(input: { to: string; displayName: string }): MailMessage {
  return message(
    input.to,
    accountExistsTemplate({ appName: APP_NAME, displayName: input.displayName, signInUrl: signInLink() }),
  )
}

export function accountInviteMessage(input: {
  to: string
  token: string
  role: 'admin' | 'user'
  expiresAt: Date
  invitedBy?: string | null
}): MailMessage {
  return message(
    input.to,
    accountInviteTemplate({
      appName: APP_NAME,
      link: accountInviteLink(input.token),
      role: input.role,
      expiresAt: input.expiresAt,
      invitedBy: input.invitedBy,
    }),
  )
}

export function tempPasswordMessage(input: {
  to: string
  displayName: string
  tempPassword: string
  reason: 'created' | 'reset'
}): MailMessage {
  return message(
    input.to,
    tempPasswordTemplate({
      appName: APP_NAME,
      displayName: input.displayName,
      email: input.to,
      tempPassword: input.tempPassword,
      signInUrl: signInLink(),
      reason: input.reason,
    }),
  )
}

/** For `POST /api/admin/settings/test-email` (Stage 03): `await sendMail(testMessage(to))`. */
export function testMessage(to: string, sentAt: Date = new Date()): MailMessage {
  return message(to, testEmailTemplate({ appName: APP_NAME, publicUrl: env().PUBLIC_URL, sentAt }))
}

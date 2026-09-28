import { greeting, renderEmail, type EmailContent } from './layout'

export interface ResetPasswordInput {
  appName: string
  displayName: string
  /** `${PUBLIC_URL}/reset-password#<token>` */
  link: string
  expiresInMinutes: number
}

export function resetPasswordTemplate(input: ResetPasswordInput): EmailContent {
  const expiry =
    input.expiresInMinutes % 60 === 0
      ? `${input.expiresInMinutes / 60} hour${input.expiresInMinutes === 60 ? '' : 's'}`
      : `${input.expiresInMinutes} minutes`
  return renderEmail({
    appName: input.appName,
    subject: `Reset your ${input.appName} password`,
    heading: 'Reset your password',
    paragraphs: [
      greeting(input.displayName),
      `Someone asked to reset the password of your ${input.appName} account. If this was you, choose a new password with the link below.`,
    ],
    action: { label: 'Choose a new password', url: input.link },
    footer: [
      `The link works once and expires in ${expiry}. Choosing a new password signs you out on every device.`,
      'If you did not ask for this, ignore this email. Your password stays the same.',
    ],
  })
}

import { greeting, renderEmail, type EmailContent } from './layout'

export interface VerifyEmailInput {
  appName: string
  displayName: string
  /** `${PUBLIC_URL}/verify-email#<token>` */
  link: string
  expiresInHours: number
}

export function verifyEmailTemplate(input: VerifyEmailInput): EmailContent {
  return renderEmail({
    appName: input.appName,
    subject: `Confirm your email address for ${input.appName}`,
    heading: 'Confirm your email address',
    paragraphs: [
      greeting(input.displayName),
      `Confirm that this is your email address to finish setting up your ${input.appName} account.`,
    ],
    action: { label: 'Confirm email address', url: input.link },
    footer: [
      `The link works once and expires in ${input.expiresInHours} hours.`,
      'If you did not create an account, you can ignore this email.',
    ],
  })
}

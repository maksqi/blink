import { formatUtc, renderEmail, type EmailContent } from './layout'

export interface TestEmailInput {
  appName: string
  publicUrl: string
  sentAt: Date
}

/** `POST /api/admin/settings/test-email` (Stage 03). */
export function testEmailTemplate(input: TestEmailInput): EmailContent {
  return renderEmail({
    appName: input.appName,
    subject: `${input.appName} test email`,
    heading: 'SMTP works',
    paragraphs: [
      `This is a test email from the ${input.appName} server at ${input.publicUrl}, sent ${formatUtc(input.sentAt)}.`,
      'Invites, email confirmations and password resets can be delivered.',
    ],
  })
}

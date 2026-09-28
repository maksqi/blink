import { formatUtc, renderEmail, type EmailContent } from './layout'

export interface AccountInviteInput {
  appName: string
  /** `${PUBLIC_URL}/invite#<token>` */
  link: string
  role: 'admin' | 'user'
  expiresAt: Date
  /** Display name of the inviting admin, when known. */
  invitedBy?: string | null
}

export function accountInviteTemplate(input: AccountInviteInput): EmailContent {
  const who = input.invitedBy?.trim() ? `${input.invitedBy.trim()} invited you` : 'You have been invited'
  const as = input.role === 'admin' ? ' as an administrator' : ''
  return renderEmail({
    appName: input.appName,
    subject: `You are invited to join ${input.appName}`,
    heading: `Join ${input.appName}`,
    paragraphs: [
      `${who} to create an account on ${input.appName}${as}, a private video meeting server.`,
      'Open the invite to choose your name and password.',
    ],
    action: { label: 'Accept invite', url: input.link },
    footer: [
      `The invite works once and expires on ${formatUtc(input.expiresAt)}.`,
      'If you did not expect this invite, you can ignore this email.',
    ],
  })
}

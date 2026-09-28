import { greeting, renderEmail, type EmailContent } from './layout'

export interface AccountExistsInput {
  appName: string
  displayName: string
  /** `${PUBLIC_URL}/login` */
  signInUrl: string
}

/** Sent instead of a verification mail when someone registers with an address that already has an account. */
export function accountExistsTemplate(input: AccountExistsInput): EmailContent {
  return renderEmail({
    appName: input.appName,
    subject: `You already have a ${input.appName} account`,
    heading: 'You already have an account',
    paragraphs: [
      greeting(input.displayName),
      `Someone tried to create a new ${input.appName} account with this email address. You already have one, so nothing was changed.`,
    ],
    action: { label: 'Sign in', url: input.signInUrl },
    footer: [
      'Forgot your password? Choose "Forgot password" on the sign-in page.',
      'If this was not you, you can ignore this email.',
    ],
  })
}

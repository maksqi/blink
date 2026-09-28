import { greeting, renderEmail, type EmailContent } from './layout'

export interface TempPasswordInput {
  appName: string
  displayName: string
  email: string
  tempPassword: string
  /** `${PUBLIC_URL}/login` */
  signInUrl: string
  /** `created`: an admin created the account; `reset`: an admin reset its password. */
  reason: 'created' | 'reset'
}

/** Admin-created accounts and admin password resets. The account must choose its own password at the next sign-in. */
export function tempPasswordTemplate(input: TempPasswordInput): EmailContent {
  const created = input.reason === 'created'
  return renderEmail({
    appName: input.appName,
    subject: created ? `Your ${input.appName} account is ready` : `Your ${input.appName} password was reset`,
    heading: created ? 'Your account is ready' : 'Your password was reset',
    paragraphs: [
      greeting(input.displayName),
      created
        ? `An administrator created a ${input.appName} account for ${input.email}.`
        : `An administrator reset the password of your ${input.appName} account (${input.email}) and signed you out on every device.`,
      'Sign in with your email address and the temporary password below. You will choose your own password right away.',
    ],
    code: { label: 'Temporary password', value: input.tempPassword },
    action: { label: 'Sign in', url: input.signInUrl },
    footer: ['If you did not expect this email, contact your administrator.'],
  })
}

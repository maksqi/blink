/**
 * Mail service (auth). One import point for other workstreams:
 *
 *   import { isSmtpConfigured, sendMail, testMessage, MailDeliveryError } from '../../services/mail'
 *
 * - transport: `isSmtpConfigured()`, `sendMail(message)`, `sendMailInBackground(message, label)`, `MailDeliveryError`
 *   (`.smtpError` is safe to show admins as `details.smtpError`), `smtpErrorReason(error)`.
 * - messages: `verificationMessage`, `passwordResetMessage`, `accountExistsMessage`, `accountInviteMessage`,
 *   `tempPasswordMessage`, `testMessage`.
 * - links: `accountInviteLink`, `verifyEmailLink`, `passwordResetLink`, `signInLink` (from `PUBLIC_URL`, token in the
 *   fragment). The server never emails room links.
 */
export * from './links'
export * from './messages'
export * from './transport'

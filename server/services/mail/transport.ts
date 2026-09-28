/**
 * Mail transport (auth, docs/ARCHITECTURE.md: optional SMTP via nodemailer).
 *
 * - `isSmtpConfigured()`: true when `SMTP_HOST` is set (`env().smtpEnabled`). Features that need email check it and
 *   answer 503 `SERVICE_UNAVAILABLE` (or show links to admins instead) when it is false.
 * - `sendMail(message)`: sends one message through the shared SMTP transport, from `SMTP_FROM`. Rejects with
 *   `MailDeliveryError` (a short SMTP reason, never credentials) on failure or after `MAIL_SEND_TIMEOUT_MS`.
 * - `sendMailOr503(message)`: admin flows; 503 `SERVICE_UNAVAILABLE` with `details.smtpError` when SMTP is off or fails.
 * - `sendMailInBackground(message, label)`: fire and forget for flows that must not reveal whether an account exists
 *   through their response time (password reset request, domain-mode registration). Failures are logged with the
 *   template label only: never the recipient, the body or a link (links carry tokens).
 * - `createMailer({ transport, from })`: the same over any nodemailer-compatible transport (unit tests).
 * - `setMailerForTests(mailer)`: replaces the shared mailer in-process (service tests); `null` restores it.
 */
import { createTransport } from 'nodemailer'
import { apiError } from '../../utils/api-error'
import { env } from '../../utils/env'
import { logger } from '../../utils/logger'

export const MAIL_SEND_TIMEOUT_MS = 20_000

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

/** The part of a nodemailer transporter this module uses. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

export class MailDeliveryError extends Error {
  constructor(
    message: string,
    /** Short, credential-free reason for admins (`details.smtpError`). */
    readonly smtpError: string,
  ) {
    super(message)
    this.name = 'MailDeliveryError'
  }
}

export function isSmtpConfigured(): boolean {
  return env().smtpEnabled
}

/** A readable one-line reason. SMTP servers answer with codes and text; nodemailer never includes the password. */
export function smtpErrorReason(error: unknown): string {
  if (error instanceof MailDeliveryError) return error.smtpError
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split('\n', 1)[0]!.trim()
  return (firstLine || 'Unknown SMTP error').slice(0, 200)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new MailDeliveryError('SMTP send timed out', `No answer from the SMTP server within ${ms / 1000} s`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function createMailer(options: { transport: MailTransport; from: string; timeoutMs?: number }): Mailer {
  const timeoutMs = options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS
  return {
    async send(message) {
      try {
        await withTimeout(
          options.transport.sendMail({
            from: options.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          timeoutMs,
        )
      } catch (error) {
        if (error instanceof MailDeliveryError) throw error
        throw new MailDeliveryError('SMTP send failed', smtpErrorReason(error))
      }
    },
  }
}

let shared: Mailer | undefined
let override: Mailer | null = null

function smtpMailer(): Mailer {
  const config = env()
  if (!config.SMTP_HOST || !config.SMTP_FROM)
    throw new MailDeliveryError('SMTP is not configured', 'SMTP is not configured')
  shared ??= createMailer({
    from: config.SMTP_FROM,
    transport: createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      // Never log SMTP conversations: they contain message bodies, and message bodies contain tokens.
      logger: false,
      debug: false,
    }),
  })
  return shared
}

export function setMailerForTests(mailer: Mailer | null): void {
  override = mailer
}

export async function sendMail(message: MailMessage): Promise<void> {
  await (override ?? smtpMailer()).send(message)
}

/**
 * For admin flows that report delivery problems: 503 `SERVICE_UNAVAILABLE` when SMTP is off or the send fails
 * (`details.smtpError`, credential-free). Call it inside the transaction that creates the thing being mailed, so a
 * failed send rolls it back.
 */
export async function sendMailOr503(message: MailMessage): Promise<void> {
  if (!isSmtpConfigured()) throw apiError('SERVICE_UNAVAILABLE', 503, { smtpError: 'SMTP is not configured' })
  try {
    await sendMail(message)
  } catch (error) {
    throw apiError('SERVICE_UNAVAILABLE', 503, { smtpError: smtpErrorReason(error) })
  }
}

export function sendMailInBackground(message: MailMessage, label: string): void {
  sendMail(message).catch((error: unknown) => {
    logger.error('email could not be sent', { template: label, smtpError: smtpErrorReason(error) })
  })
}
